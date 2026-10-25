'use strict';

async function readTimestamp(env, fetchImpl = globalThis.fetch, now = Date.now) {
  // Reject before loading application modules or making any request.
  for (const key of ['FITPP_DIRECT_ENABLED', 'FITPP_DIRECT_WRITES_ENABLED', 'OWNER_DIALOG_ENABLED']) {
    if (env[key] !== 'false') throw Error('DISABLED_FLAGS_REQUIRED');
  }
  const { POLL, assertPoll } = require('./direct-core/src/pilot-policy.cjs');
  const { config, guardedApi } = require('./src/memory-training-test.js');
  assertPoll(POLL);
  if (POLL.chat !== '-80345864298680' || POLL.mid !== 'mid.ffffb6ed054c9f4801a169a000563611' ||
      POLL.uuid !== '99732d34-b609-4266-9418-f12de9b3fe62' ||
      POLL.timezone !== 'Europe/Moscow' || POLL.closesAt !== Date.parse('2026-10-26T18:00:00Z')) {
    throw Error('POLL_SCOPE_REQUIRED');
  }
  const c = config(env);
  const paths = ['/me', `/chats/${POLL.chat}`, `/chats/${POLL.chat}/members/me`, `/messages/${POLL.mid}`];
  let requestIndex = 0;
  const readOnlyFetch = (url, options) => {
    if (!(url instanceof URL) || url.origin !== 'https://platform-api2.max.ru' ||
        url.pathname !== paths[requestIndex] || requestIndex >= paths.length || url.search ||
        options?.method !== 'GET' || options.body !== undefined || options.redirect !== 'error') {
      throw Error('READ_ONLY_REQUIRED');
    }
    requestIndex++;
    return fetchImpl(url, options);
  };
  const api = await guardedApi({ ...c, send: false, edit: false, remove: false, auto: false }, readOnlyFetch, { pollScope: POLL });
  const message = await api.pollMessage();
  const timestamp = message?.timestamp;
  const current = now();
  if (requestIndex !== paths.length || message?.recipient?.chat_type !== 'chat' ||
      !Number.isSafeInteger(current) || !Number.isSafeInteger(timestamp) || timestamp <= 0 ||
      timestamp > current || timestamp >= POLL.closesAt) throw Error('TIMESTAMP_REQUIRED');
  return timestamp;
}

async function run(env = process.env, fetchImpl = globalThis.fetch, now = Date.now, output = line => console.log(line)) {
  try {
    const timestamp = await readTimestamp(env, fetchImpl, now);
    output(`MAX_POLL_TIMESTAMP_OK\nFITPP_DIRECT_POLL_OPENED_AT=${timestamp}\nOPENED_AT_UTC=${new Date(timestamp).toISOString()}`);
    return 0;
  } catch {
    output('MAX_POLL_TIMESTAMP_READ_REJECTED');
    return 1;
  }
}

if (require.main === module) run().then(code => { process.exitCode = code; });
module.exports = { readTimestamp, run };
