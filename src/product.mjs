import { readFile } from 'node:fs/promises';
import { Store } from './store.mjs';
import { Source } from './source.mjs';
import { prepare, resolve } from './confirmations.mjs';
import { accept } from './representation.mjs';
import { present, assess } from './submissions.mjs';
export async function createProduct({ sourceUrl, statePath = null }) {
  const config = JSON.parse(await readFile(new URL('./domain.json', import.meta.url), 'utf8'));
  const store = new Store(config.initial, statePath); await store.open();
  const source = new Source(sourceUrl, config.route);
  return {
    async collect(input) {
      return store.update(async state => { const request = prepare(state, input); const response = await source.request(request); const data = resolve(state, request, response); const decision = assess(state, request, data); accept(state, request, data, decision); return present(state); });
    },
    view() { return present(store.snapshot()); },
  };
}
