import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startFixture } from '../src/fixture.mjs';
import { Source } from '../src/source.mjs';
const script = JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url), 'utf8'));
for (const route of script.routes.slice(1)) test(`来源实际资源 ${route.method} ${route.path}`, async () => {
  const fixture = await startFixture(structuredClone(script));
  try {
    const client = new Source(fixture.url, { method: route.method, path: route.path });
    const value = await client.request({}); assert.deepEqual(value, route.responses[0].body);
    assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].path, route.path);
    assert.match(client.receipts()[0].sha256, /^[a-f0-9]{64}$/);
  } finally { await fixture.close(); }
});
test('来源拒绝不消耗正常响应进度', async () => {
  const value = { routes: [{ method: 'POST', path: '/scope', requireBody: { owner: 'A' }, responses: [{ body: { ordinal: 1 } }, { body: { ordinal: 2 } }] }] };
  const fixture = await startFixture(value);
  try {
    const client = new Source(fixture.url, { method: 'POST', path: '/scope' });
    await assert.rejects(client.request({ owner: 'B' }), /409/);
    assert.deepEqual(await client.request({ owner: 'A' }), { ordinal: 1 });
    assert.deepEqual(await client.request({ owner: 'A' }), { ordinal: 2 });
  } finally { await fixture.close(); }
});
test('来源凭据不进入请求轨迹及收据', async () => {
  const value = { routes: [{ method: 'POST', path: '/private', responses: [{ body: { ok: true } }] }] };
  const fixture = await startFixture(value);
  try {
    const client = new Source(fixture.url, { method: 'POST', path: '/private' });
    await client.request({ authorization: 'Bearer private-synthetic', secret: 'private-synthetic' });
    assert.ok(!JSON.stringify(fixture.calls).includes('private-synthetic'));
    assert.ok(!JSON.stringify(client.receipts()).includes('private-synthetic'));
  } finally { await fixture.close(); }
});
test('跨来源路径及带凭据地址被拒绝', async () => {
  assert.throws(() => new Source('http://user:pass@127.0.0.1', { method: 'GET', path: '/' }), /凭据/);
  const client = new Source('http://127.0.0.1:1', { method: 'GET', path: 'https://example.com/' });
  await assert.rejects(client.request({}), /越界/);
});
