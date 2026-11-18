import { readFile } from 'node:fs/promises';
import { startFixture } from '../src/fixture.mjs';
import { createProduct } from '../src/product.mjs';
const fixture = await startFixture(JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url), 'utf8')));
try {
  const product = await createProduct({ sourceUrl: fixture.url });
  console.log('本地来源已就绪，办理一次正常业务');
  console.log(JSON.stringify(await product.collect({}), null, 2));
  console.log('来源实际请求'); console.log(JSON.stringify(fixture.calls, null, 2));
} finally { await fixture.close(); }
