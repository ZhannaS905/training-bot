const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { Service, body } = require('../src/service');
const { moscow, times } = require('../src/schedule');
const { MaxApi } = require('../src/api');
const { loadConfig } = require('../config');
const { createWebhook } = require('../src/webhook');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-test-'));
  let store = new Store(dir);
  let now = new Date('2026-10-19T07:00:00Z');
  const calls = { send: [], edit: [] };
  const api = { send: async (...args) => { calls.send.push(args); return `mid-${calls.send.length}`; },
    edit: async (...args) => { calls.edit.push(args); } };
  const config = { chatIds: ['-1', '-2'], adminIds: ['9'] };
  let service = new Service(store, api, config, () => now);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { calls, api, config, get store() { return store; }, get service() { return service; },
    now: value => { now = new Date(value); },
    restart: () => { store.close(); store = new Store(dir); service = new Service(store, api, config, () => now); } };
}
function command(user, text = '/опрос', chat = -1, mid = require('node:crypto').randomUUID()) {
  return { update_type: 'message_created', message: { sender: { user_id: user }, recipient: { chat_id: chat }, body: { text, mid } } };
}
function vote(poll, user, choice, extra = {}) {
  return { update_type: 'message_callback', callback: { user: { user_id: user, first_name: 'Одинаковое имя' }, payload: `poll:${poll.id}:${choice}` },
    message: { recipient: { chat_id: Number(poll.chat) }, body: { mid: poll.mid } }, ...extra };
}
async function deliver(f, update) { f.service.receive(update); await f.service.drain(); await f.service.refresh(); }
test('Moscow boundaries and all seven training days', () => {
  assert.equal(moscow(new Date('2026-10-18T21:00:00Z')).date, '2026-10-19');
  assert.equal(moscow(new Date('2026-10-19T06:59:00Z')).clock, '09:59');
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => times[moscow(new Date(`2026-10-${19+i}T07:00:00Z`)).day]),
    ['20:00','18:30','20:00','18:30',null,'18:00','18:00']);
});
test('10:00 publication, restart, chat isolation and concurrent ticks have no duplicates', async t => {
  const f = fixture(t); f.now('2026-10-19T06:59:59Z'); await f.service.tick(); assert.equal(f.calls.send.length, 0);
  f.now('2026-10-19T07:00:00Z');
  await Promise.all([f.service.run(() => f.service.tick()), f.service.run(() => f.service.tick())]);
  assert.equal(f.calls.send.length, 2); f.restart(); await f.service.tick(); assert.equal(f.calls.send.length, 2);
  f.now('2026-10-23T07:00:00Z'); await f.service.tick(); assert.equal(f.calls.send.length, 2);
});
test('manual creation restricted to admin and allowlisted chat, Friday excluded', async t => {
  const f = fixture(t); await deliver(f, command(8)); assert.equal(f.calls.send.length, 0);
  await deliver(f, command(9, '/опрос', -3)); assert.equal(f.calls.send.length, 0);
  await deliver(f, command(9)); await deliver(f, command(9)); assert.equal(f.calls.send.length, 1);
  f.now('2026-10-23T07:00:00Z'); await deliver(f, command(9, '/опрос', -1, 'friday')); assert.equal(f.calls.send.length, 1);
});
test('ID-based vote change/cancel, durable state, independent chats and stale buttons', async t => {
  const f = fixture(t); await f.service.tick();
  const a = f.store.state.polls['-1/2026-10-19'], b = f.store.state.polls['-2/2026-10-19'];
  const first = vote(a, 1, 'yes'); await deliver(f, first); await deliver(f, vote(a, 2, 'maybe'));
  await deliver(f, vote(a, 1, 'no')); await deliver(f, first);
  assert.deepEqual(a.votes, { 1: 'no', 2: 'maybe' }); assert.deepEqual(b.votes, {});
  f.restart(); const restored = f.store.state.polls['-1/2026-10-19'];
  assert.deepEqual(restored.votes, a.votes); await deliver(f, vote(restored, 1, 'cancel')); assert.deepEqual(restored.votes, { 2: 'maybe' });
  const forged = vote(restored, 3, 'yes'); forged.message.body.mid = 'other'; await deliver(f, forged); assert.equal(restored.votes['3'], undefined);
  f.now('2026-10-20T07:00:00Z'); await f.service.tick(); await deliver(f, vote(restored, 4, 'yes'));
  assert.deepEqual(f.store.state.polls['-1/2026-10-20'].votes, {});
  assert.deepEqual(body(restored).attachments[0].payload.buttons.flat().map(b => b.text), ['Приду','Не приду','Возможно','Отменить']);
});
test('uncertain publication is never resent, including after restart', async t => {
  const f = fixture(t); let attempts = 0;
  f.api.send = async () => { attempts++; throw new Error('timeout after remote accepted'); };
  await f.service.tick(); f.restart(); await f.service.tick(); assert.equal(attempts, 2);
  assert.equal(f.store.state.polls['-1/2026-10-19'].status, 'uncertain');
});
test('durable pending reservation and inbox survive restart; failed edit retries without send', async t => {
  const f = fixture(t); await f.service.tick(); const p = f.store.state.polls['-1/2026-10-19'];
  f.service.receive(vote(p, 1, 'yes')); f.restart();
  f.api.edit = async () => { throw new Error('unavailable'); }; await f.service.tick();
  assert.equal(f.store.state.polls['-1/2026-10-19'].dirty, true);
  f.restart(); f.api.edit = async () => {}; await f.service.tick();
  assert.equal(f.store.state.polls['-1/2026-10-19'].dirty, false); assert.equal(f.calls.send.length, 2);
  f.store.state.polls['-1/2026-10-19'].status = 'pending'; f.store.save(); f.restart(); await f.service.tick(); assert.equal(f.calls.send.length, 2);
});
test('removed commands produce no effects; schedule stays in requesting chat', async t => {
  const f = fixture(t);
  for (const text of ['/помощь','/приду','/неприду','/возможно','/отменить','/старт']) await deliver(f, command(9, text));
  assert.equal(f.calls.send.length, 0); await deliver(f, command(8, '/расписание')); assert.equal(f.calls.send[0][0], '-1');
});
test('storage rejects second writer and corrupt state', t => {
  const f = fixture(t); assert.throws(() => new Store(f.store.dir), /EEXIST/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-corrupt-'));
  fs.writeFileSync(path.join(dir, 'state.json'), '{'); assert.throws(() => new Store(dir));
  fs.rmSync(dir, { recursive: true });
});
test('config rejects insecure TLS, unsafe IDs and missing secrets', () => {
  assert.throws(() => loadConfig({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /TLS/);
  const good = { BOT_TOKEN: 'fake', WEBHOOK_SECRET: 'test_secret_123456', ADMIN_IDS: '9', CHAT_IDS: '-1' };
  assert.deepEqual(loadConfig(good).chatIds, ['-1']); assert.throws(() => loadConfig({ ...good, CHAT_IDS: '9007199254740993' }));
  assert.throws(() => loadConfig({ ...good, WEBHOOK_SECRET: '' }));
});
test('REST contract: Authorization, current host, POST create, PUT edit, error handling', async () => {
  const calls = []; const fake = async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => ({ message: { body: { mid: 'mid' } } }) }; };
  const api = new MaxApi('fake-token', fake, async () => {});
  assert.equal(await api.send('-1', { text: 'test' }), 'mid'); await api.edit('mid', { text: 'changed' });
  assert.equal(calls[0][0].origin, 'https://platform-api2.max.ru'); assert.equal(calls[0][1].headers.Authorization, 'fake-token');
  assert.equal(calls[0][0].searchParams.get('chat_id'), '-1'); assert.equal(calls[1][1].method, 'PUT');
  assert.equal(calls[1][0].searchParams.get('message_id'), 'mid'); assert.equal(calls[0][1].redirect, 'error');
  api.fetch = async () => ({ ok: true, json: async () => ({ success: false }) }); await assert.rejects(api.edit('mid', {}));
  api.fetch = async () => ({ ok: false, status: 401 }); await assert.rejects(api.send('-1', {}), /401/);
});
test('webhook secret and durable receipt before acknowledgment (loopback only)', async t => {
  const f = fixture(t); const server = createWebhook(f.service, 'test_secret_123456');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/webhook`;
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'X-Max-Bot-Api-Secret': 'test_secret_123456' }, body: JSON.stringify(command(9)) })).status, 200);
  assert.equal(Object.keys(f.store.state.inbox).length, 1); assert.equal(f.calls.send.length, 0);
  f.restart(); await f.service.drain(); assert.equal(f.calls.send.length, 1);
});
