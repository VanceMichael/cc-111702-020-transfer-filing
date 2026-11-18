import { createHash } from 'node:crypto';
export class Source {
  constructor(base, route) {
    this.base = new URL(base); this.route = route;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname)) throw new Error('本地运行只允许回环来源');
    if (this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error('来源地址不能携带凭据或附加参数');
    this.history = [];
  }
  async request(input, route = this.route) {
    const target = new URL(route.path, this.base);
    if (target.origin !== this.base.origin) throw new Error('来源路径越界');
    const method = route.method;
    if (!['GET', 'POST', 'DELETE', 'PUT', 'PATCH'].includes(method)) throw new Error('不支持的来源操作');
    const options = { method, redirect: 'manual', signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } };
    if (input.authorization) options.headers.authorization = input.authorization;
    const safe = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'authorization'));
    if (method === 'GET') for (const [key, value] of Object.entries(safe)) target.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    else { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(safe); }
    const started = performance.now();
    try {
      const response = await fetch(target, options);
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body ?? []) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('来源响应超过限制'); chunks.push(chunk); }
      const content = Buffer.concat(chunks);
      const receipt = { method, path: target.pathname, status: response.status, bytes, sha256: createHash('sha256').update(content).digest('hex'), milliseconds: Math.round(performance.now() - started) };
      this.history.push(receipt);
      if (!response.ok) { const error = new Error(`来源请求未接纳：${response.status}`); error.status = response.status; error.receipt = receipt; throw error; }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) throw new Error('来源未声明JSON表示');
      try { return JSON.parse(content.toString('utf8')); } catch { throw new Error('来源JSON不完整'); }
    } catch (error) {
      if (!error.receipt) this.history.push({ method, path: target.pathname, status: null, error: error.message, milliseconds: Math.round(performance.now() - started) });
      throw error;
    }
  }
  receipts() { return structuredClone(this.history); }
}
