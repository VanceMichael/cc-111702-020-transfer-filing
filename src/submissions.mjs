export function present(state) {
  return { applications: Object.entries(state.applications).map(([application, value]) => ({ application, ...value, submissions: Object.entries(state.drafts).filter(([, draft]) => draft.application === application).map(([draft, item]) => ({ draft, representative: item.representative, receipt: item.acceptedReceipt, accepted: Boolean(item.acceptedReceipt) })) })) };
}
