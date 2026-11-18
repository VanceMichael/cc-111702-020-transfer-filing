import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixture } from '../src/fixture.mjs';
import { createProduct } from '../src/product.mjs';
import { startProduct } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { Source } from '../src/source.mjs';
const script = JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url), 'utf8'));
async function fixtureTest(operation, value = script) { const fixture = await startFixture(structuredClone(value)); try { await operation(fixture); } finally { await fixture.close(); } }
test('正常业务的领域结果', async () => { await fixtureTest(async fixture => { const product = await createProduct({ sourceUrl: fixture.url }); const result = await product.collect({}); assert.equal(result.applications[0].holders[0].share, 100); assert.equal(result.applications[0].submissions[0].accepted, true); assert.equal(fixture.calls.length, 1); }); });
test('持久状态重开后保持领域结果', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'intake-'));
  try { await fixtureTest(async fixture => { const statePath = join(directory, 'state.json'); const first = await createProduct({ sourceUrl: fixture.url, statePath }); const before = await first.collect({}); const second = await createProduct({ sourceUrl: fixture.url, statePath }); assert.deepEqual(second.view(), before); }); } finally { await rm(directory, { recursive: true, force: true }); }
});
test('业务入口和查询入口共享状态', async () => { await fixtureTest(async fixture => { const service = await startProduct({ sourceUrl: fixture.url }); try { const health = await fetch(service.url + '/health'); assert.equal(health.status, 200); const collected = await fetch(service.url + '/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(collected.status, 200); const expected = await collected.json(); assert.deepEqual(await (await fetch(service.url + '/state')).json(), expected); } finally { await service.close(); } }); });
test('来源失败不会提交半成品业务状态', async () => { const failure = structuredClone(script); failure.routes[0].responses = [{ status: 503, body: { error: '来源维护' } }]; await fixtureTest(async fixture => { const product = await createProduct({ sourceUrl: fixture.url }); const before = product.view(); await assert.rejects(product.collect({}), /503/); assert.deepEqual(product.view(), before); }, failure); });
test('存储串行写入与异常回滚', async () => { const store = new Store({ count: 0 }); await Promise.all(Array.from({ length: 8 }, () => store.update(async state => { const value = state.count; await new Promise(resolve => setTimeout(resolve, 1)); state.count = value + 1; }))); await assert.rejects(store.update(state => { state.count = 100; throw new Error('拒绝'); })); assert.equal(store.snapshot().count, 8); });
test('本地来源边界不允许外部地址', () => { assert.throws(() => new Source('https://example.com', { method: 'GET', path: '/' }), /回环/); });
test('来源顺序脚本保留真实请求并独立推进', async () => { await fixtureTest(async fixture => { const first = await fetch(fixture.url + '/health'); assert.equal(first.status, 200); const unknown = await fetch(fixture.url + '/unknown'); assert.equal(unknown.status, 404); const trace = await (await fetch(fixture.url + '/trace')).json(); assert.equal(trace.length, 1); assert.equal(trace[0].path, '/unknown'); }); });
