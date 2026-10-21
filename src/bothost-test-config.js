const path = require('node:path');
const { checkTestBotIdentity } = require('./test-bot-identity');
const CHAT = '-80345864298680';
const STATE_DIR = '/app/data/training-test/live';
const CA_PATH = path.resolve(__dirname, '../certs/russian-trusted-root-ca.pem');
function loadBothostTestConfig(env = process.env) {
  if (env.BOT_MODE !== 'test' || env.CHAT_IDS !== CHAT) throw Error('TEST_CONFIG');
  // No administrative commands run in this profile. Personal administrator IDs
  // are optional runtime settings, never repository constants or examples.
  const admins = (env.ADMIN_IDS || '').split(',').filter(Boolean);
  if (admins.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw Error('TEST_ADMIN_CONFIG');
  if ((env.PORT !== undefined && env.PORT !== '3000') || (env.HOST !== undefined && env.HOST !== '0.0.0.0')) throw Error('TEST_BIND');
  if (env.STATE_DIR !== undefined && env.STATE_DIR !== STATE_DIR) throw Error('TEST_STORAGE_PATH');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('TLS_REQUIRED');
  if (env.NODE_OPTIONS) throw Error('NODE_PRELOAD_REFUSED');
  if (env.NODE_EXTRA_CA_CERTS && env.NODE_EXTRA_CA_CERTS !== CA_PATH) throw Error('UNEXPECTED_CA');
  // BotHost's generic token can only be an alias for this verified test token.
  if (env.BOT_TOKEN && env.TEST_BOT_TOKEN && env.BOT_TOKEN !== env.TEST_BOT_TOKEN) throw Error('TOKEN_CONFLICT');
  const token = env.TEST_BOT_TOKEN || env.BOT_TOKEN;
  if (typeof token !== 'string' || !token || token.length > 4096 || /\s/.test(token) || /^Bearer/i.test(token)) throw Error('TEST_TOKEN_REQUIRED');
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(env.WEBHOOK_SECRET || '')) throw Error('WEBHOOK_SECRET_REQUIRED');
  if (!checkTestBotIdentity(null, env.TEST_EXPECTED_BOT_ID).expectedIdValid) throw Error('EXPECTED_ID_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(env.TEST_EXPECTED_STATE_SHA256 || '')) throw Error('EXPECTED_STATE_REQUIRED');
  // This release intentionally has no environment switch that enables writes.
  for (const key of ['AUTO_PUBLISH', 'TEST_ALLOW_SEND', 'TEST_ALLOW_EDIT', 'TEST_ALLOW_DELETE']) {
    if (env[key] !== undefined && env[key] !== 'false') throw Error('WRITES_NOT_AUTHORIZED');
  }
  return Object.freeze({ testMode: true, autoPublish: false, allowSend: false, allowEdit: false, allowDelete: false,
    token, secret: env.WEBHOOK_SECRET, expectedBotId: env.TEST_EXPECTED_BOT_ID,
    expectedStateHash: env.TEST_EXPECTED_STATE_SHA256, chatIds: Object.freeze([CHAT]), adminIds: Object.freeze(admins),
    port: 3000, host: '0.0.0.0', stateDir: STATE_DIR, caPath: CA_PATH });
}
function workerEnvironment(config) {
  return { BOT_MODE: 'test', TEST_BOT_TOKEN: config.token, WEBHOOK_SECRET: config.secret,
    TEST_EXPECTED_BOT_ID: config.expectedBotId, TEST_EXPECTED_STATE_SHA256: config.expectedStateHash,
    CHAT_IDS: CHAT, ADMIN_IDS: config.adminIds.join(','), PORT: '3000', HOST: '0.0.0.0', STATE_DIR,
    AUTO_PUBLISH: 'false', TEST_ALLOW_SEND: 'false', TEST_ALLOW_EDIT: 'false', TEST_ALLOW_DELETE: 'false',
    NODE_TLS_REJECT_UNAUTHORIZED: '1', NODE_EXTRA_CA_CERTS: CA_PATH };
}
module.exports = { CHAT, STATE_DIR, CA_PATH, loadBothostTestConfig, workerEnvironment };
