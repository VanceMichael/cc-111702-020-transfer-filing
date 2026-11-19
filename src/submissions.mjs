const text = value => typeof value === 'string' && value.trim().length > 0;
const clone = value => structuredClone(value);

export function present(state) {
  return {
    applications: Object.entries(state.applications).map(([application, value]) => ({
      application,
      ...value,
      status: value.status ?? 'collecting',
      canSubmit: value.canSubmit === true,
      reasons: value.reasons ?? [],
      portal: value.portal ?? { accepted: false, acceptedReceipt: null, receiptPreserved: false },
      confirmations: Object.entries(value.confirmations ?? {}).map(([holder, item]) => ({
        holder,
        confirmation: item.confirmation ?? null,
        recordSource: item.source ?? null,
        valid: item.valid === true,
        status: item.status ?? null,
        code: item.code ?? null,
        confirmed: item.confirmed === true,
        seenRevision: item.seenRevision ?? null,
        seenHolders: item.seenHolders ?? [],
        seenMaterials: item.seenMaterials ?? [],
        seenContact: item.seenContact ?? null,
        recordedAgainstRevision: item.recordedAgainstRevision ?? null,
        sourceConflict: item.sourceConflict ?? null,
        arrangementMatches: item.arrangementMatches ?? false,
        materialsMatch: item.materialsMatch ?? false,
        materialRetained: item.materialRetained ?? false,
        changedMaterials: item.changedMaterials ?? [],
        reasons: item.reasons ?? [],
      })),
      drafts: Object.entries(state.drafts)
        .filter(([, draft]) => draft.application === application)
        .map(([draft, item]) => ({
          draft,
          representative: item.representative,
          receipt: item.acceptedReceipt ?? null,
          accepted: Boolean(item.acceptedReceipt),
          canSubmit: item.canSubmit === true,
          canOperate: item.canOperate === true,
          attachments: item.attachments ?? [],
          status: item.status ?? 'unverified',
          reasons: item.reasons ?? [],
          history: item.history ?? [],
        })),
      submissions: (value.submissions ?? []).map(item => ({ ...item, receipt: item.acceptedReceipt ?? null, accepted: Boolean(item.acceptedReceipt) })),
    })),
  };
}

function strictReadback(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label}无效`);
  if (typeof input.canOperate !== 'boolean') throw new Error(`${label}未给出可继续操作结论`);
  if (!text(input.ownerApplication)) throw new Error(`${label}未给出所属业务申请`);
  if (!Array.isArray(input.attachments)) throw new Error(`${label}未给出附件清单`);
  if (input.acceptedReceipt !== undefined && input.acceptedReceipt !== null && !text(input.acceptedReceipt)) throw new Error(`${label}的受理号无效`);
  return input;
}

export function assessPortal(state, request, application, readback) {
  const draft = strictReadback(readback, '门户草稿回读');
  if (!text(draft.draft)) throw new Error('门户草稿回读缺少草稿标识');
  if (request.draft !== undefined && request.draft !== null && draft.draft !== request.draft) throw new Error('门户草稿回读不是本次草稿');
  if (draft.ownerApplication !== request.application) throw new Error('门户草稿属于其他业务申请');

  const localReceipt = application.acceptedReceipt ?? null;
  const readReceipt = draft.acceptedReceipt ?? null;

  let status;
  let canOperate = draft.canOperate === true;
  let canSubmit = false;
  let receiptPreserved = Boolean(localReceipt);
  let acceptedReceipt = readReceipt;
  const reasons = [];
  if (readReceipt) {
    status = 'accepted-correction';
    canSubmit = false;
    if (!canOperate) reasons.push('门户已受理，但回读显示当前代表不能继续补正');
    if (localReceipt && localReceipt !== readReceipt) reasons.push('门户受理号与本地记录不一致，按回读处理');
    receiptPreserved = true;
  } else if (localReceipt) {
    // 本地已有受理依据，但回读不再显示受理：不能把它当作新草稿重新开一张。
    status = 'accepted-correction';
    canOperate = draft.canOperate === true;
    canSubmit = false;
    acceptedReceipt = localReceipt;
    receiptPreserved = true;
    reasons.push('门户回读未显示已记录的受理号，保留本地受理依据；如需再次报送应按门户补正办理，不在本地重开相同申请');
  } else if (canOperate) {
    status = 'draft-operable';
    canSubmit = true;
  } else {
    status = 'blocked';
    canOperate = false;
    reasons.push('门户回读显示当前代表不能继续操作该草稿，请由实际可操作的代表或门户管理员处理');
  }

  const knownMaterials = [...(application.materials ?? []), ...(application.retiredMaterials ?? [])];
  const attachments = draft.attachments.map(item => {
    if (!item || !text(item.id)) throw new Error('门户附件标识无效');
    const owner = knownMaterials.find(material => material.id === item.id)?.holder ?? item.holder ?? null;
    return { id: item.id, holder: owner ?? null, revision: item.revision ?? null };
  });
  return { draft: draft.draft, status, canOperate, canSubmit, receiptPreserved, acceptedReceipt, attachments, reasons };
}

export function recordDraft(state, application, request, portal) {
  const existing = state.drafts[portal.draft] ?? {};
  state.drafts[portal.draft] = {
    application: request.application,
    representative: application.representative,
    materials: application.materials.map(material => clone(material)),
    attachments: clone(portal.attachments),
    canOperate: portal.canOperate,
    canSubmit: portal.canSubmit,
    status: portal.status,
    acceptedReceipt: portal.acceptedReceipt,
    reasons: clone(portal.reasons),
    history: [
      ...(existing.history ?? []),
      { representative: application.representative, canOperate: portal.canOperate, status: portal.status, acceptedReceipt: portal.acceptedReceipt },
    ],
    updatedAgainstRevision: application.revision,
  };
}

export function nextCorrectionOrdinal(application) {
  const ordinals = (application.corrections ?? []).map(item => item.ordinal).filter(Number.isInteger);
  return (ordinals.length ? Math.max(...ordinals) : 0) + 1;
}

export function recordSubmission(application, portal) {
  const submission = {
    draft: portal.draft,
    representative: application.representative,
    status: portal.status,
    acceptedReceipt: portal.acceptedReceipt ?? null,
    attachments: clone(portal.attachments),
    atRevision: application.revision,
    holderCount: application.holders.length,
  };
  const existing = application.submissions.findIndex(item => item.draft === submission.draft);
  if (existing === -1) application.submissions.push(submission);
  else application.submissions[existing] = submission;
  return submission;
}

export function assessCompletion(state, request, application, portal, pending, corrections) {
  if (portal.status === 'accepted-correction') {
    application.status = 'accepted-correction';
    application.canSubmit = false;
    application.reasons = [
      ...(portal.reasons ?? []),
      ...(corrections.length
        ? ['门户已受理，只能按门户允许的补正办理；本地不另行重开相同申请']
        : ['门户已受理，不再在本草稿重复提交']),
    ];
    return;
  }
  if (portal.status === 'blocked' || !portal.canOperate) {
    application.status = 'blocked';
    application.canSubmit = false;
    application.reasons = ['门户回读显示当前代表不能继续操作该草稿', ...portal.reasons];
    return;
  }
  if (pending.length) {
    application.status = 'pending-confirmation';
    application.canSubmit = false;
    application.reasons = pending.map(item => item.reason);
    return;
  }
  application.status = 'ready';
  application.canSubmit = true;
  application.reasons = [];
}
