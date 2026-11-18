import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export class Store {
  constructor(initial, path = null) { this.initial = structuredClone(initial); this.path = path; this.value = structuredClone(initial); this.tail = Promise.resolve(); }
  async open() {
    if (!this.path) return;
    try { const stored = JSON.parse(await readFile(this.path, 'utf8')); if (stored.version !== 1 || !stored.state) throw new Error('存储版本不受支持'); this.value = stored.state; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async update(operation) {
    const run = this.tail.then(async () => {
      const candidate = structuredClone(this.value);
      const result = await operation(candidate);
      if (this.path) { await mkdir(dirname(this.path), { recursive: true }); const pending = `${this.path}.pending`; await writeFile(pending, JSON.stringify({ version: 1, state: candidate })); await rename(pending, this.path); }
      this.value = candidate;
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
  snapshot() { return structuredClone(this.value); }
}
