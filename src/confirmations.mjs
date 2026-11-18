export function prepare(state, input) {
  const application = input.application ?? 'APP1';
  if (!application.trim()) throw new Error('业务申请不能为空');
  return { application };
}
