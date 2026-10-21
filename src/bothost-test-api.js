const { MaxApi } = require('./api');
const { CHAT } = require('./bothost-test-config');
const { checkTestBotIdentity, identityAccepted } = require('./test-bot-identity');
async function createBothostTestApi(config, fetchImpl = fetch) {
  const reads = new Set(['/me', '/subscriptions', `/chats/${CHAT}`, `/chats/${CHAT}/members/me`]);
  const guardedFetch = async (input, options) => {
    const url = new URL(input);
    if (options?.method !== 'GET' || url.origin !== 'https://platform-api2.max.ru' ||
        !reads.has(url.pathname) || url.search || url.hash || options.body !== undefined) throw Error('API_OPERATION_BLOCKED');
    return fetchImpl(input, options);
  };
  const raw = new MaxApi(config.token, guardedFetch);
  const me = await raw.request('GET', '/me');
  if (!identityAccepted(checkTestBotIdentity(me, config.expectedBotId))) throw Error('TEST_IDENTITY_REFUSED');
  const chat = await raw.request('GET', `/chats/${CHAT}`);
  if (String(chat?.chat_id) !== CHAT || chat?.title !== 'Тест тренировок') throw Error('TEST_CHAT_REFUSED');
  const member = await raw.request('GET', `/chats/${CHAT}/members/me`);
  if (member?.user_id !== me.user_id || member?.is_bot !== true) throw Error('TEST_MEMBERSHIP_REFUSED');
  // No generic request/raw client or credentials escape this facade.
  const blocked = async () => { throw Error('API_OPERATION_BLOCKED'); };
  return Object.freeze({ send: blocked, edit: blocked, remove: blocked });
}
module.exports = { createBothostTestApi };
