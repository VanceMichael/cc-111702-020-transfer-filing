export function accept(state, request, data) {
  if (data.application !== request.application || data.holders.length !== 1 || data.holders[0].share !== 100) throw new Error('当前办理范围为单持有人全部份额');
  if (!data.representative || data.materials.some(item => item.holder !== data.holders[0].id)) throw new Error('代表或资料归属无效');
  state.applications[data.application] = { revision: data.applicationRevision, holders: data.holders, representative: data.representative };
  state.drafts[data.draft] = { application: data.application, materials: data.materials, representative: data.representative, acceptedReceipt: data.acceptedReceipt };
  return data.draft;
}
