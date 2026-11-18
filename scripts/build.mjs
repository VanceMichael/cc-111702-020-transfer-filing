import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await inspect(path);
    else if (path.endsWith('.mjs')) { const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1); }
  }
}
await inspect('src'); await inspect('scripts'); await inspect('test');
console.log('语法检查完成');
