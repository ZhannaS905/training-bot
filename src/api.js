const { setTimeout: sleep } = require('node:timers/promises');
class MaxApi {
  constructor(token, fetchImpl = fetch, wait = sleep) { this.token = token; this.fetch = fetchImpl; this.wait = wait; this.next = 0; }
  async request(method, endpoint, query, body) {
    // All application calls are serialized. Stay below the per-chat edit/send limit.
    await this.wait(Math.max(0, this.next - Date.now()));
    this.next = Date.now() + 550;
    const url = new URL(endpoint, 'https://platform-api2.max.ru');
    url.search = new URLSearchParams(query).toString();
    const response = await this.fetch(url, { method, redirect: 'error',
      headers: { Authorization: this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`MAX HTTP ${response.status}`);
    const result = await response.json();
    if (result.success === false) throw new Error('MAX rejected request');
    return result;
  }
  async send(chat, body) {
    const result = await this.request('POST', '/messages', { chat_id: chat }, body);
    const mid = result.message?.body?.mid;
    if (typeof mid !== 'string' || !mid) throw new Error('MAX missing message ID');
    return mid;
  }
  edit(mid, body) { return this.request('PUT', '/messages', { message_id: mid }, body); }
}
module.exports = { MaxApi };
