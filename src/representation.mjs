const text = value => typeof value === 'string' && value.trim().length > 0;
const clone = value => structuredClone(value);

function holderIdsOf(data) {
  return new Set(data.holders.map(holder => holder.id));
}

export function accept(state, request, data) {
  const holderIds = holderIdsOf(data);
  if (!text(data.representative)) throw new Error('代表不能为空');

  const materials = data.materials ?? [];
  if (!Array.isArray(materials)) throw new Error('资料清单无效');
  for (const material of materials) {
    if (!holderIds.has(material.holder)) throw new Error('资料归属不符');
  }

  if (data.draft !== undefined && data.draft !== null) {
    const owner = state.drafts[data.draft]?.application;
    if (owner !== undefined && owner !== data.application) throw new Error('门户草稿属于其他业务申请');
  }

  const previous = state.applications[data.application] ?? null;
  const contacts = { ...clone(data.contacts ?? {}), ...clone(previous?.contactCorrections ?? {}) };
  const representativeHistory = clone(previous?.representativeHistory ?? []);
  if (previous?.representative && previous.representative !== data.representative && !representativeHistory.includes(previous.representative)) {
    representativeHistory.push(previous.representative);
  }

  state.applications[data.application] = {
    ...(previous ?? {}),
    revision: data.applicationRevision,
    holders: data.holders.map(holder => ({ id: holder.id, share: holder.share })),
    representative: data.representative,
    materials: materials.map(material => ({ id: material.id, holder: material.holder, revision: material.revision })),
    previousRepresentative: previous?.representative && previous.representative !== data.representative ? previous.representative : (previous?.previousRepresentative ?? null),
    representativeHistory,
    contacts,
    contactCorrections: clone(previous?.contactCorrections ?? {}),
    portalAccepted: Boolean(data.acceptedReceipt) || Boolean(previous?.portalAccepted),
    acceptedReceipt: data.acceptedReceipt ?? previous?.acceptedReceipt ?? null,
    previous: previous ? {
      revision: previous.revision,
      holders: clone(previous.holders),
      representative: previous.representative,
      acceptedReceipt: previous.acceptedReceipt ?? null,
    } : null,
    confirmations: clone(previous?.confirmations ?? {}),
    pending: clone(previous?.pending ?? []),
    exited: clone(previous?.exited ?? []),
    retiredMaterials: clone(previous?.retiredMaterials ?? []),
    corrections: clone(previous?.corrections ?? []),
    submissions: clone(previous?.submissions ?? []),
    transitions: clone(previous?.transitions ?? []),
    portal: clone(previous?.portal ?? null),
  };
  return data.draft ?? null;
}

export function canRepresent(state, application, actor) {
  const current = state.applications[application];
  if (!current || !actor) return false;
  return current.representative === actor;
}

export function applyContactCorrections(state, request, corrections) {
  const application = state.applications[request.application];
  if (!application) return [];
  const results = [];
  for (const correction of corrections) {
    if (!correction || !text(correction.holder)) throw new Error('联系人更正缺少持有人');
    const holder = application.holders.find(item => item.id === correction.holder);
    if (!holder) throw new Error('联系人更正所指持有人不在当前名单');
    const contact = clone(correction.contact ?? null);
    application.contacts[correction.holder] = contact;
    application.contactCorrections[correction.holder] = contact;
    results.push({ holder: correction.holder, contact: clone(contact) });
  }
  return results;
}
