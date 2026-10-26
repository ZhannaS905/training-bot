'use strict';
// Dedicated synthetic-client capability. Does not change the general bot write flags.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {MaxApi} = require('./api');
const {checkTestBotIdentity, identityAccepted} = require('./test-bot-identity');
const {validBinding} = require('./fitpp-notification-dry-run.cjs');
const BOT = '131384398', CHAT = 126619382, USER = 5819064;
function settings(env) {
  const token = env.TEST_BOT_TOKEN || env.BOT_TOKEN;
  if (env.BOT_MODE !== 'test' || env.FIREBASE_PROJECT_ID !== 'fitpp-test' ||
      env.TEST_EXPECTED_BOT_ID !== BOT || !token || /\s/.test(token) ||
      (env.TEST_BOT_TOKEN && env.BOT_TOKEN && env.TEST_BOT_TOKEN !== env.BOT_TOKEN) ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      ['AUTO_PUBLISH','TEST_ALLOW_SEND','TEST_ALLOW_EDIT','TEST_ALLOW_DELETE'].some(k => env[k] !== 'false'))
    throw Error('NOTIFICATION_SCOPE_REFUSED');
  return token;
}
async function verify(raw, binding) {
  if (!validBinding(binding,'demo-client-1')) throw Error('NOTIFICATION_BINDING_REFUSED');
  if (!identityAccepted(checkTestBotIdentity(await raw.request('GET','/me'),BOT))) throw Error('NOTIFICATION_IDENTITY_REFUSED');
  const chat = await raw.request('GET','/chats/' + CHAT);
  if (chat.chat_id !== CHAT || chat.type !== 'dialog' || chat.status !== 'active' ||
      chat.dialog_with_user?.user_id !== USER || chat.dialog_with_user?.is_bot !== false)
    throw Error('NOTIFICATION_RECIPIENT_REFUSED');
}
// A separate file per operation is an exclusive, durable claim across processes/restarts.
// Claims are NEVER deleted/retried automatically, including timeout or uncertain success.
function reserve(directory, operationId) {
  const name = createHash('sha256').update('fitpp-test:synthetic-v1:' + operationId).digest('hex');
  const fd = (() => {try {return fs.openSync(path.join(directory,name),'wx',0o600)} catch(e) {if(e.code==='EEXIST')return null;throw e}})();
  if (fd === null) return false;
  try {fs.writeSync(fd,'attempted\n');fs.fsyncSync(fd)} finally {fs.closeSync(fd)}
  const dir = fs.openSync(directory,'r');try {fs.fsyncSync(dir)} finally {fs.closeSync(dir)}
  return true;
}
function createSender({env, directory, raw, limit = 3}) {
  const token = settings(env);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('NOTIFICATION_LIMIT_REFUSED');
  raw ||= new MaxApi(token);
  let attempts = 0, tail = Promise.resolve();
  return {verify: binding => verify(raw,binding), send(item,binding) {
    const job = tail.then(async () => {
      if (item?.clientId !== 'demo-client-1' || item.maxChatId !== CHAT ||
          !/^[a-zA-Z0-9-]{8,128}$/.test(item.operationId || '') ||
          !Number.isSafeInteger(item.remaining) || item.remaining < 0 || item.previous !== item.remaining + 1)
        throw Error('NOTIFICATION_CANDIDATE_REFUSED');
      if (attempts >= limit) return 'limit';
      await verify(raw,binding);
      if (!reserve(directory,item.operationId)) return 'duplicate';
      attempts++;
      try {
        await raw.send(String(CHAT),{text:'ТЕСТ FitPP: списано 1 занятие. Остаток: ' + item.remaining + ' зан.',notify:false});
        return 'sent';
      } catch {return 'uncertain'}
    });
    tail = job.catch(()=>{});return job;
  }};
}
module.exports = {settings,verify,reserve,createSender};
