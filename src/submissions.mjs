export function present(state) {
  return { applications: Object.entries(state.applications).map(([application, value]) => ({ application, ...value, submissions: Object.entries(state.drafts).filter(([, draft]) => draft.application === application).map(([draft, item]) => ({ draft, representative: item.representative, receipt: item.acceptedReceipt, accepted: Boolean(item.acceptedReceipt) })) })) };
}

export function assess(state, request, data) {
  if (!data.draft || !data.representative || !Array.isArray(data.materials) || !data.materials.length) throw new Error('代表或草稿资料未齐');
  const ids = new Set();
  for (const material of data.materials) { if (!material.id || ids.has(material.id) || material.holder !== data.holders[0].id || !Number.isInteger(material.revision)) throw new Error('持有人资料归属不符'); ids.add(material.id); }
  const existing = state.drafts[data.draft];
  if (existing && existing.application !== request.application) throw new Error('门户草稿属于其他业务申请');
  return { application: request.application, representative: data.representative, ready: true };
}
