export class Source {
  constructor(base, route) { this.base = new URL(base); this.route = route; if (!['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname)) throw new Error('本地运行只允许回环来源'); }
  async request(input) {
    const target = new URL(this.route.path, this.base);
    if (target.origin !== this.base.origin) throw new Error('来源路径越界');
    const method = this.route.method;
    const options = { method, redirect: 'manual', signal: AbortSignal.timeout(4000), headers: { 'accept': 'application/json' } };
    if (input.authorization) options.headers.authorization = input.authorization;
    const safe = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'authorization'));
    if (method === 'GET') for (const [key, value] of Object.entries(safe)) target.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    else { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(safe); }
    const response = await fetch(target, options);
    if (!response.ok) { const error = new Error(`来源请求未接纳：${response.status}`); error.status = response.status; throw error; }
    const text = await response.text();
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('来源响应超过限制');
    return JSON.parse(text);
  }
}
