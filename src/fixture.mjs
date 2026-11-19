import { readFile } from 'node:fs/promises';
import { listen, readJson, reply } from './http.mjs';
function equal(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }
function matches(route, method, path) {
  if (route.method !== method) return false;
  const actual = path.split('/'); const pattern = route.path.split('/');
  return actual.length === pattern.length && pattern.every((part, index) => part.startsWith(':') || part === actual[index]);
}
export async function startFixture(script, port = 0) {
  const calls = []; const cursors = new Map(); const counters = new Map();
  const service = await listen(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://local');
      if (url.pathname === '/health') return reply(response, 200, { ok: true });
      if (url.pathname === '/trace') return reply(response, 200, calls);
      if (url.pathname === '/counters') return reply(response, 200, Object.fromEntries(counters));
      const body = await readJson(request);
      const key = `${request.method} ${url.pathname}`;
      const route = script.routes.find(item => matches(item, request.method, url.pathname));
      const query = Object.fromEntries(url.searchParams);
      const cleanBody = Object.fromEntries(Object.entries(body).map(([field, value]) => [/token|password|secret|authorization|proof/i.test(field) ? field : field, /token|password|secret|authorization|proof/i.test(field) ? '[已隐藏]' : value]));
      const call = { method: request.method, path: url.pathname, query: Object.fromEntries(Object.entries(query).filter(([field]) => !/token|secret|password|proof/i.test(field))), body: cleanBody, authenticated: Boolean(request.headers.authorization) };
      calls.push(call);
      if (!route) return reply(response, 404, { error: '来源未登记该路径' });
      for (const [field, value] of Object.entries(route.requireBody ?? {})) if (!equal(body[field], value)) return reply(response, 409, { error: '来源业务参数不符', field });
      for (const [field, value] of Object.entries(route.requireQuery ?? {})) if (!equal(query[field], value)) return reply(response, 409, { error: '来源查询范围不符', field });
      if (route.requireAuthentication && !request.headers.authorization) return reply(response, 401, { error: '需要授权' });
      const index = cursors.get(key) ?? 0;
      const step = route.responses[Math.min(index, route.responses.length - 1)];
      if (step?.accept === false) return reply(response, 409, { error: '来源不受理该确认' });
      if (step?.accepted === false) return reply(response, 409, { error: '门户不受理该草稿' });
      if (!step) return reply(response, 410, { error: '来源响应已结束' });
      cursors.set(key, index + 1); counters.set(key, (counters.get(key) ?? 0) + 1);
      call.responseIndex = index;
      if (step.delayMs) await new Promise(resolve => setTimeout(resolve, step.delayMs));
      if (step.disconnect) return request.socket.destroy();
      if (step.headers) for (const [name, value] of Object.entries(step.headers)) response.setHeader(name, value);
      reply(response, step.status ?? 200, structuredClone(step.body));
    } catch (error) { if (!response.headersSent) reply(response, 400, { error: error.message }); else response.destroy(); }
  }, port);
  return { ...service, calls };
}
if (process.argv[1]?.endsWith('/fixture.mjs')) {
  const path = process.env.SOURCE_SCRIPT ?? new URL('../fixtures/source.json', import.meta.url);
  const service = await startFixture(JSON.parse(await readFile(path, 'utf8')), Number(process.env.PORT ?? 4101));
  console.log(JSON.stringify({ 来源地址: service.url }));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await service.close(); process.exit(0); });
}
