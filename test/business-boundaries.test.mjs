import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startFixture } from '../src/fixture.mjs';
import { createProduct } from '../src/product.mjs';
const script = JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url), 'utf8'));
const cases = JSON.parse(await readFile(new URL('../fixtures/invalid-normal-business.json', import.meta.url), 'utf8'));
function change(target, path, value) { const parts = path.split('.'); const field = parts.pop(); let current = target; for (const part of parts) current = current[part]; current[field] = value; }
for (const example of cases) test(`当前正常业务拒绝：${example.name}`, async () => {
  const source = structuredClone(script);
  for (const [path,value] of Object.entries(example.changes)) change(source.routes[0].responses[0].body, path, value);
  const fixture = await startFixture(source);
  try { const product = await createProduct({ sourceUrl: fixture.url }); const before = product.view(); await assert.rejects(product.collect({})); assert.deepEqual(product.view(), before); assert.equal(fixture.calls.length, 1); }
  finally { await fixture.close(); }
});
