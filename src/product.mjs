import { readFile } from 'node:fs/promises';
import { Store } from './store.mjs';
import { Source } from './source.mjs';
import { prepare, resolve, buildRecord, implicitRecord, validateSourceConfirmation, evaluate, reconcile, ownMaterials } from './confirmations.mjs';
import { accept, applyContactCorrections, canRepresent } from './representation.mjs';
import { assessPortal, recordDraft, recordSubmission, nextCorrectionOrdinal, assessCompletion, present } from './submissions.mjs';

export async function createProduct({ sourceUrl, statePath = null }) {
  const config = JSON.parse(await readFile(new URL('./domain.json', import.meta.url), 'utf8'));
  const store = new Store(config.initial, statePath); await store.open();
  const source = new Source(sourceUrl, config.route);

  const draftRoute = draft => ({ method: 'GET', path: config.draftPath.replace(':draft', encodeURIComponent(draft)) });
  const correctionRoute = draft => ({ method: 'POST', path: config.correctionPath.replace(':draft', encodeURIComponent(draft)) });

  async function recordSourceConfirmation(request, item, data) {
    if (request.role === 'holder' && request.actor && request.actor !== item.holder) throw new Error('持有人只能确认自己的资料');
    const payload = {
      application: request.application,
      holder: item.holder,
      confirmed: item.confirmed,
      seenRevision: item.seenRevision ?? data.applicationRevision,
    };
    if (item.confirmation) payload.confirmation = item.confirmation;
    if (item.seenHolders) payload.seenHolders = item.seenHolders;
    if (item.seenMaterials) payload.seenMaterials = item.seenMaterials;
    return validateSourceConfirmation(await source.request(payload, config.confirmationRoute), item, data);
  }

  function legacyPortal(data) {
    return {
      draft: data.draft ?? null,
      status: data.acceptedReceipt ? 'accepted-correction' : 'draft-operable',
      canOperate: true,
      canSubmit: !data.acceptedReceipt,
      receiptPreserved: Boolean(data.acceptedReceipt),
      acceptedReceipt: data.acceptedReceipt ?? null,
      attachments: (data.materials ?? []).map(material => ({ id: material.id, holder: material.holder, revision: material.revision })),
      reasons: [],
    };
  }

  async function perform(state, input) {
    const request = prepare(state, input);
    const data = resolve(state, request, await source.request({ application: request.application }));
    const prior = state.applications[request.application] ? structuredClone(state.applications[request.application]) : null;

    const records = [];
    const rejected = new Map();
    for (const item of request.confirmations) {
      if (item.confirmed === false) continue;
      try {
        const response = await recordSourceConfirmation(request, item, data);
        const record = buildRecord(data, item, {
          ...response,
          seenHolders: item.seenHolders ?? response.seenHolders ?? data.holders,
          seenMaterials: item.seenMaterials ?? response.seenMaterials,
          seenContact: item.seenContact ?? item.contact,
        });
        records.push(record);
      } catch (error) {
        if (error.basisConflict) {
          // 来源回执与本次提交的依据不一致时，以持有人提交的依据为准并保留冲突说明，不替其改掉依据。
          const record = buildRecord(data, item, { seenHolders: item.seenHolders, seenMaterials: item.seenMaterials, seenContact: item.seenContact, confirmation: item.confirmation ?? item.ref });
          record.sourceConflict = error.message;
          records.push(record);
          continue;
        }
        // 来源明确拒绝某家的确认时，只让该家回到待办；连接或来源故障仍然整体回滚。
        if (![400, 409, 422].includes(error.status)) throw error;
        rejected.set(item.holder, { holder: item.holder, code: 'SOURCE_REJECTED', reason: `持有人 ${item.holder} 的确认未被来源接纳：${error.message}`, reconfirmRequired: true, retainedMaterials: ownMaterials(data, item.holder) });
      }
    }

    // 旧单持有人样例：未显式给出确认时，来源名单本身就是唯一持有人的确认依据。
    const implicitLegacy = !records.length
      && !request.confirmations.length
      && data.holders.length === 1
      && request.representation === null
      && request.draft === null
      && request.corrections.length === 0;
    if (implicitLegacy) {
      const implicit = implicitRecord(data);
      if (evaluate(implicit, data).valid) records.push(implicit);
    }

    accept(state, request, data);
    const application = state.applications[request.application];
    applyContactCorrections(state, request, request.corrections);

    const reconciled = reconcile(prior, data, records);
    application.confirmations = reconciled.confirmations;
    application.pending = reconciled.pending;
    application.exited = reconciled.exited;
    application.retiredMaterials = reconciled.retiredMaterials;
    if (rejected.size) {
      for (const [holder, entry] of rejected) {
        application.pending = application.pending.filter(item => item.holder !== holder);
        application.pending.push(entry);
      }
      application.pending.sort((left, right) => data.holders.findIndex(item => item.id === left.holder) - data.holders.findIndex(item => item.id === right.holder));
    }

    if (request.representation?.representative !== undefined && request.representation.representative !== data.representative) {
      throw new Error('代表与来源名单不符');
    }

    // 代表变更只改变办理权限，不改变任何持有人已确认的依据或资料归属。
    const representativeChanged = Boolean(prior) && prior.representative !== application.representative;
    const wantsPortal = request.representation !== null || request.draft !== null || request.submit || request.corrections.length > 0
      || (representativeChanged && Boolean(application.portal?.draft ?? data.draft));
    const draft = wantsPortal
      ? (request.draft ?? request.representation?.draft ?? application.portal?.draft ?? data.draft ?? null)
      : (implicitLegacy ? data.draft ?? null : null);

    if (!draft) {
      application.status = application.portalAccepted ? 'accepted-correction' : (application.pending.length ? 'pending-confirmation' : 'ready');
      application.canSubmit = !application.portalAccepted && application.pending.length === 0;
      application.reasons = application.pending.map(item => item.reason);
      return present(state);
    }

    if (request.actor && application.representative !== request.actor) throw new Error('只有当前代表能操作门户草稿');
    if (request.actor && request.role === 'representative' && !canRepresent(state, request.application, request.actor)) throw new Error('只有当前代表能操作门户草稿');
    // 已受理的申请只能按门户补正办理，不能改用新草稿把旧受理藏起来。
    if (application.portalAccepted && application.portal?.draft && draft !== application.portal.draft) {
      throw new Error('业务申请已受理，只能按门户补正办理，不能改用其他草稿重新提交');
    }

    let portal;
    if (implicitLegacy && !wantsPortal) {
      portal = legacyPortal(data);
    } else {
      const readback = await source.request({ application: request.application }, draftRoute(draft));
      portal = assessPortal(state, request, application, readback);
    }

    application.portal = {
      accepted: portal.status === 'accepted-correction',
      acceptedReceipt: portal.acceptedReceipt,
      receiptPreserved: portal.receiptPreserved,
      status: portal.status,
      canOperate: portal.canOperate,
      draft: portal.draft,
    };
    if (portal.acceptedReceipt) {
      if (!application.acceptedReceipt) application.acceptedReceipt = portal.acceptedReceipt;
      application.portalAccepted = true;
    }
    recordDraft(state, application, request, { ...portal, draft });

    if (request.submit && request.corrections.length) {
      if (portal.status !== 'accepted-correction') throw new Error('门户尚未受理，不能按补正办理；请先提交草稿');
      if (!portal.canOperate) throw new Error('门户回读显示当前代表不能继续补正');
      const held = new Set(application.holders.map(holder => holder.id));
      const corrections = [];
      for (const correction of request.corrections) {
        if (!correction || !held.has(correction.holder)) throw new Error('补正所指持有人不在当前名单');
        const ordinal = nextCorrectionOrdinal(application) + corrections.length;
        validateSourceConfirmation(
          await source.request({ ...correction, application: request.application, draft: portal.draft, ordinal }, correctionRoute(portal.draft)),
          correction,
          data,
        );
        corrections.push({
          ordinal,
          holder: correction.holder,
          content: structuredClone(correction.content ?? {}),
          representative: application.representative,
          acceptedReceipt: portal.acceptedReceipt,
          atRevision: application.revision,
        });
      }
      application.corrections.push(...corrections);
    }

    if (prior && (prior.representative !== application.representative || prior.revision !== application.revision)) {
      application.transitions = [
        ...(prior.transitions ?? []),
        { fromRevision: prior.revision, toRevision: application.revision, fromRepresentative: prior.representative, toRepresentative: application.representative },
      ];
    }

    recordSubmission(application, portal);
    assessCompletion(state, request, application, portal, application.pending, request.corrections);
    // 已受理的申请不能由本地重新开一张相同申请隐藏旧受理：保留最早受理号与补正记录。
    if (prior?.acceptedReceipt && portal.acceptedReceipt && prior.acceptedReceipt !== portal.acceptedReceipt) {
      application.reasons = [...(application.reasons ?? []), '门户受理号与历史记录不同，按回读保留原受理依据'];
    }
    return present(state);
  }

  return {
    async collect(input) { return store.update(state => perform(state, input)); },
    view() { return present(store.snapshot()); },
    receipts() { return source.receipts(); },
  };
}
