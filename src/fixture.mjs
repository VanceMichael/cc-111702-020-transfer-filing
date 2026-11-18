import { readFile } from 'node:fs/promises';
import { listen, readJson, reply } from './http.mjs';
export async function startFixture(script, port = 0) {
  const calls = []; const cursors = new Map();
  const service = await listen(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://local');
      if (url.pathname === '/health') return reply(response, 200, { ok: true });
      if (url.pathname === '/trace') return reply(response, 200, calls);
      const body = await readJson(request);
      const key = `${request.method} ${url.pathname}`;
      const route = script.routes.find(item => `${item.method} ${item.path}` === key);
      const index = cursors.get(key) ?? 0;
      calls.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, authenticated: Boolean(request.headers.authorization) });
      if (!route) return reply(response, 404, { error: '来源未登记该路径' });
      const step = route.responses[Math.min(index, route.responses.length - 1)];
      cursors.set(key, index + 1);
      if (step.delayMs) await new Promise(resolve => setTimeout(resolve, step.delayMs));
      if (step.disconnect) return request.socket.destroy();
      reply(response, step.status ?? 200, structuredClone(step.body));
    } catch (error) { reply(response, 400, { error: error.message }); }
  }, port);
  return { ...service, calls };
}
if (process.argv[1]?.endsWith('/fixture.mjs')) {
  const path = process.env.SOURCE_SCRIPT ?? new URL('../fixtures/source.json', import.meta.url);
  const service = await startFixture(JSON.parse(await readFile(path, 'utf8')), Number(process.env.PORT ?? 4101));
  console.log(JSON.stringify({ 来源地址: service.url }));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await service.close(); process.exit(0); });
}
