export function prepare(state, input) {
  const application = input.application ?? 'APP1';
  if (!application.trim()) throw new Error('业务申请不能为空');
  return { application };
}

export function resolve(state, request, data) {
  if (data.application !== request.application || !Number.isInteger(data.applicationRevision) || data.applicationRevision < 1) throw new Error('业务申请修订无效');
  if (data.holders.length !== 1 || !data.holders[0].id || data.holders[0].share !== 100) throw new Error('当前办理仅支持单持有人全部份额');
  return data;
}
