const text = value => typeof value === 'string' && value.trim().length > 0;
const clone = value => structuredClone(value);

function snapshotHolders(value, label) {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label}不能为空`);
  const ids = new Set();
  return value.map(holder => {
    if (!holder || !text(holder.id) || ids.has(holder.id)) throw new Error(`${label}中的持有人无效`);
    if (!Number.isInteger(holder.share) || holder.share < 0 || holder.share > 100) throw new Error(`${label}中的份额无效`);
    ids.add(holder.id);
    return { id: holder.id, share: holder.share };
  });
}

function snapshotMaterials(value, holder, label) {
  if (!Array.isArray(value)) throw new Error(`${label}无效`);
  const ids = new Set();
  return value.map(material => {
    if (!material || !text(material.id) || ids.has(material.id)) throw new Error(`${label}中的资料无效`);
    if (material.holder !== undefined && material.holder !== holder) throw new Error(`${label}只能包含本人的资料`);
    if (!Number.isInteger(material.revision) || material.revision < 1) throw new Error(`${label}中的资料修订无效`);
    ids.add(material.id);
    return { id: material.id, revision: material.revision };
  });
}

export function prepare(state, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('办理参数无效');
  const application = input.application ?? 'APP1';
  if (!text(application)) throw new Error('业务申请不能为空');

  const confirmations = input.confirmations ?? [];
  if (!Array.isArray(confirmations)) throw new Error('确认列表无效');
  const seen = new Set();
  for (const item of confirmations) {
    if (!item || !text(item.holder)) throw new Error('确认缺少持有人');
    if (seen.has(item.holder)) throw new Error('同一持有人一次只能提交一份确认');
    seen.add(item.holder);
    if (item.confirmed !== undefined && typeof item.confirmed !== 'boolean') throw new Error('确认状态无效');
    if (item.seenRevision !== undefined && (!Number.isInteger(item.seenRevision) || item.seenRevision < 1)) throw new Error('确认所依据的修订无效');
  }

  let representation = input.representation ?? null;
  if (typeof representation === 'string') representation = { representative: representation };
  if (representation !== null && (typeof representation !== 'object' || Array.isArray(representation))) throw new Error('代表信息无效');
  if (representation?.representative !== undefined && !text(representation.representative)) throw new Error('代表不能为空');
  if (representation?.draft !== undefined && !text(representation.draft)) throw new Error('门户草稿不能为空');

  const actor = input.actor ?? null;
  const role = input.role ?? null;

  const corrections = input.corrections ?? [];
  if (!Array.isArray(corrections)) throw new Error('补正列表无效');
  for (const correction of corrections) {
    if (!correction || !text(correction.holder)) throw new Error('补正缺少持有人');
    if (role === 'holder' && actor && correction.holder !== actor) throw new Error('持有人只能更正自己的联系人');
  }
  for (const item of confirmations) {
    if (!actor || item.holder === actor) continue;
    const recorded = Boolean(item.confirmation || item.ref);
    if (role === 'representative' && recorded) continue; // 代表可以汇总其他持有人已有的确认记录
    if (role === 'representative') throw new Error('代表只能汇总和提交，不能替其他持有人确认');
    throw new Error('持有人只能确认自己的资料');
  }

  const draft = input.draft ?? representation?.draft ?? null;
  if (draft !== null && !text(draft)) throw new Error('门户草稿不能为空');

  return {
    application,
    confirmations,
    representation,
    corrections,
    submit: input.submit === true || input.action === 'submit' || input.submissions === true,
    portal: input.portal,
    actor,
    role,
    draft,
  };
}

export function resolve(state, request, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('来源业务资料无效');
  if (data.application !== request.application) throw new Error('业务申请不符');
  if (!Number.isInteger(data.applicationRevision) || data.applicationRevision < 1) throw new Error('业务申请修订无效');
  if (!Array.isArray(data.holders) || !data.holders.length) throw new Error('持有人名单不能为空');

  const holderIds = new Set();
  let total = 0;
  for (const holder of data.holders) {
    if (!holder || !text(holder.id)) throw new Error('持有人标识无效');
    if (holderIds.has(holder.id)) throw new Error('持有人名单重复');
    if (!Number.isInteger(holder.share) || holder.share < 0 || holder.share > 100) throw new Error('份额无效');
    holderIds.add(holder.id);
    total += holder.share;
  }
  if (total !== 100) throw new Error('份额合计必须为100');
  if (!text(data.representative)) throw new Error('代表不能为空');

  const materials = data.materials ?? [];
  if (!Array.isArray(materials)) throw new Error('资料清单无效');
  const materialIds = new Set();
  for (const material of materials) {
    if (!material || !text(material.id) || materialIds.has(material.id)) throw new Error('资料标识无效');
    if (!holderIds.has(material.holder)) throw new Error('资料归属不符');
    if (!Number.isInteger(material.revision) || material.revision < 1) throw new Error('资料修订无效');
    materialIds.add(material.id);
  }
  if (data.draft !== undefined && data.draft !== null && !text(data.draft)) throw new Error('门户草稿无效');
  if (data.acceptedReceipt !== undefined && data.acceptedReceipt !== null && !text(data.acceptedReceipt)) throw new Error('受理号无效');
  return data;
}

export function contactOf(data, holderId) {
  if (data.contacts && typeof data.contacts === 'object' && !Array.isArray(data.contacts)) {
    return data.contacts[holderId] === undefined ? null : clone(data.contacts[holderId]);
  }
  const holder = data.holders.find(item => item.id === holderId);
  return holder?.contact === undefined ? null : clone(holder.contact);
}

export function ownMaterials(data, holderId) {
  return (data.materials ?? []).filter(material => material.holder === holderId).map(material => ({ id: material.id, revision: material.revision }));
}

export function sameArrangement(seen, current) {
  if (!Array.isArray(seen) || !Array.isArray(current) || seen.length !== current.length) return false;
  const currentShares = new Map(current.map(holder => [holder.id, holder.share]));
  return seen.every(holder => currentShares.get(holder.id) === holder.share);
}

export function basisFor(data, item) {
  if (!data.holders.some(holder => holder.id === item.holder)) throw new Error('确认持有人不在当前名单');
  const holders = snapshotHolders(clone(item.seenHolders ?? item.seenParticipants ?? data.holders), '确认所依据的持有人名单');
  const materials = snapshotMaterials(clone(item.seenMaterials ?? ownMaterials(data, item.holder)), item.holder, '确认所依据的资料版本');
  const seenContact = item.seenContact !== undefined ? clone(item.seenContact)
    : item.contact !== undefined ? clone(item.contact)
    : contactOf(data, item.holder);
  const seenRevision = item.seenRevision ?? data.applicationRevision;
  if (!Number.isInteger(seenRevision) || seenRevision < 1) throw new Error('确认所依据的修订无效');
  return {
    seenRevision,
    seenHolders: holders,
    seenMaterials: materials,
    seenContact,
  };
}

function compareMaterials(confirmation, data) {
  const current = ownMaterials(data, confirmation.holder);
  const currentById = new Map(current.map(material => [material.id, material]));
  const seen = Array.isArray(confirmation.seenMaterials) ? confirmation.seenMaterials : [];
  const changed = [];
  for (const material of seen) {
    const now = currentById.get(material.id);
    if (!now) return { ok: false, code: 'MATERIAL_REMOVED', changed: [...changed, material.id], reason: `资料 ${material.id} 已不在当前清单中` };
    if (now.revision !== material.revision) {
      changed.push(material.id);
      return { ok: false, code: 'MATERIAL_CHANGED', changed, reason: `资料 ${material.id} 已更新至修订 ${now.revision}，原确认基于修订 ${material.revision}` };
    }
  }
  for (const material of current) {
    if (!seen.some(item => item.id === material.id)) {
      return { ok: false, code: 'MATERIAL_ADDED', changed: [...changed, material.id], reason: `新增资料 ${material.id} 尚未确认` };
    }
  }
  return { ok: true, changed: [], code: 'VALID', reason: null };
}

export function evaluate(confirmation, data) {
  if (!confirmation || confirmation.confirmed !== true) {
    return { status: 'invalid', valid: false, code: 'NOT_CONFIRMED', reasons: ['持有人尚未确认'], reconfirmRequired: true, arrangementMatches: false, materialsMatch: false };
  }
  if (confirmation.application !== data.application) {
    return { status: 'invalid', valid: false, code: 'APPLICATION_MISMATCH', reasons: ['确认不属于当前业务申请'], reconfirmRequired: true, arrangementMatches: false, materialsMatch: false };
  }
  if (!data.holders.some(holder => holder.id === confirmation.holder)) {
    return { status: 'exited', valid: false, code: 'HOLDER_EXITED', reasons: [`${confirmation.holder} 已退出，其确认不再用于本次报送`], reconfirmRequired: false, arrangementMatches: false, materialsMatch: false };
  }

  const arrangementMatches = sameArrangement(confirmation.seenHolders, data.holders);
  const materials = compareMaterials(confirmation, data);
  if (!arrangementMatches) {
    return {
      status: 'stale',
      valid: false,
      code: 'ARRANGEMENT_CHANGED',
      reasons: ['持有人名单或份额安排已变化，原确认不适用于新安排；本人已确认的材料版本保留，无需重新收集，只补确认新安排'],
      reconfirmRequired: true,
      arrangementMatches: false,
      materialsMatch: materials.ok,
      materialRetained: true,
      changedMaterials: materials.changed,
    };
  }
  if (!materials.ok) {
    return {
      status: 'stale',
      valid: false,
      code: materials.code,
      reasons: [materials.reason],
      reconfirmRequired: true,
      arrangementMatches: true,
      materialsMatch: false,
      materialRetained: true,
      changedMaterials: materials.changed,
    };
  }
  return { status: 'valid', valid: true, code: 'VALID', reasons: [], reconfirmRequired: false, arrangementMatches: true, materialsMatch: true, materialRetained: true, changedMaterials: [] };
}

export function validateSourceConfirmation(response, item, data) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('来源确认无效');
  if (response.application !== undefined && response.application !== data.application) throw new Error('来源确认申请不符');
  if (response.holder !== undefined && response.holder !== item.holder) throw new Error('来源确认持有人不符');
  if (response.confirmed !== undefined && typeof response.confirmed !== 'boolean') throw new Error('来源确认状态无效');
  if (response.seenRevision !== undefined && (!Number.isInteger(response.seenRevision) || response.seenRevision < 1)) throw new Error('来源确认修订无效');
  // 来源与本次提交的确认依据不一致时不能悄悄替持有人改掉依据，交回调用方按冲突处理。
  if (item.seenHolders !== undefined && response.seenHolders !== undefined && !sameArrangement(response.seenHolders, item.seenHolders)) {
    const error = new Error('来源确认所依据的持有人名单与提交不符');
    error.basisConflict = true;
    throw error;
  }
  if (item.seenMaterials !== undefined && response.seenMaterials !== undefined) {
    const seen = new Map(item.seenMaterials.map(material => [material.id, material.revision]));
    const returned = new Map(response.seenMaterials.map(material => [material.id, material.revision]));
    if (seen.size !== returned.size || [...seen].some(([id, revision]) => returned.get(id) !== revision)) {
      const error = new Error('来源确认所依据的资料版本与提交不符');
      error.basisConflict = true;
      throw error;
    }
  }
  return response;
}

export function buildRecord(data, item, source = null) {
  const basis = basisFor(data, item);
  const holder = source?.holder ?? item.holder;
  if (holder !== item.holder) throw new Error('来源确认持有人不符');
  if (source?.application !== undefined && source.application !== data.application) throw new Error('来源确认申请不符');
  const confirmed = source?.confirmed !== false && item.confirmed !== false;
  return {
    holder,
    application: data.application,
    confirmation: source?.confirmation ?? item.confirmation ?? item.ref ?? null,
    confirmed,
    seenRevision: source?.seenRevision ?? basis.seenRevision,
    seenHolders: snapshotHolders(clone(source?.seenHolders ?? basis.seenHolders), '确认所依据的持有人名单'),
    seenMaterials: snapshotMaterials(clone(source?.seenMaterials ?? basis.seenMaterials), holder, '确认所依据的资料版本'),
    seenContact: source?.seenContact !== undefined ? clone(source.seenContact) : basis.seenContact,
    recordedAgainstRevision: data.applicationRevision,
    source: source ? 'source' : (item.confirmation || item.ref ? 'recorded' : 'caller'),
  };
}

export function implicitRecord(data) {
  return buildRecord(data, { holder: data.holders[0].id }, null);
}

export function reconcile(previous, data, records) {
  const previousHolders = previous?.holders ?? [];
  const previousMaterials = previous?.materials ?? [];
  const currentIds = new Set(data.holders.map(holder => holder.id));
  const exitedIds = previousHolders.map(holder => holder.id).filter(id => !currentIds.has(id));
  const currentMaterialIds = new Set((data.materials ?? []).map(material => material.id));

  const retiredMaterials = clone(previous?.retiredMaterials ?? []);
  for (const material of previousMaterials) {
    const holderExited = exitedIds.includes(material.holder);
    const removed = !currentMaterialIds.has(material.id);
    if ((holderExited || removed) && !retiredMaterials.some(item => item.id === material.id)) {
      retiredMaterials.push({ ...clone(material), retiredAtRevision: data.applicationRevision, reason: holderExited ? 'holder-exited' : 'removed' });
    }
  }

  const confirmations = clone(previous?.confirmations ?? {});
  for (const record of records) confirmations[record.holder] = record;

  const evaluated = {};
  for (const [holder, record] of Object.entries(confirmations)) evaluated[holder] = { ...record, ...evaluate(record, data) };

  const pending = [];
  for (const holder of data.holders) {
    const record = evaluated[holder.id];
    if (!record) {
      pending.push({ holder: holder.id, code: 'NOT_CONFIRMED', reason: `持有人 ${holder.id} 尚未确认`, retainedMaterials: ownMaterials(data, holder.id), reconfirmRequired: true });
      continue;
    }
    if (record.status === 'valid') continue;
    pending.push({
      holder: holder.id,
      code: record.code,
      reason: `持有人 ${holder.id}：${record.reasons?.[0] ?? '确认无效'}`,
      confirmation: record.confirmation ?? null,
      retainedMaterials: ownMaterials(data, holder.id),
      changedMaterials: record.changedMaterials ?? [],
      reconfirmRequired: record.reconfirmRequired === true,
    });
  }

  const exited = clone(previous?.exited ?? []);
  for (const holder of exitedIds) {
    if (exited.some(item => item.holder === holder)) continue;
    exited.push({
      holder,
      confirmation: evaluated[holder]?.confirmation ?? null,
      materials: previousMaterials.filter(material => material.holder === holder).map(material => material.id),
      reason: '持有人已退出；其资料仍保留在原持有人名下，不转给新代表',
    });
  }

  return { confirmations: evaluated, pending, exited, retiredMaterials };
}
