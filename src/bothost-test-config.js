const path = require('node:path');
const { checkTestBotIdentity } = require('./test-bot-identity');
const CHAT = '-80345864298680';
const STATE_DIR = '/app/data/training-test/live';
const CA_PATH = path.resolve(__dirname, '../certs/russian-trusted-root-ca.pem');
function assertNodeVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) || Number(version.split('.')[0]) < 22) throw Error('NODE_VERSION_REQUIRED');
}
function safeStartupReason(error) {
  const allowed = new Set(['NODE_VERSION_REQUIRED', 'TEST_CONFIG', 'TEST_ADMIN_CONFIG', 'TEST_BIND',
    'TEST_STORAGE_PATH', 'TLS_REQUIRED', 'NODE_PRELOAD_REFUSED', 'UNEXPECTED_CA', 'TOKEN_CONFLICT',
    'TEST_TOKEN_REQUIRED', 'WEBHOOK_SECRET_REQUIRED', 'EXPECTED_ID_REQUIRED', 'EXPECTED_STATE_REQUIRED',
    'WRITES_NOT_AUTHORIZED', 'CA_REFUSED', 'WORKER_CONFIG', 'TEST_IDENTITY_REFUSED', 'TEST_CHAT_REFUSED',
    'TEST_MEMBERSHIP_REFUSED', 'API_OPERATION_BLOCKED', 'STORAGE_PATH_REFUSED', 'LINKED_STORAGE_REFUSED',
    'STATE_FILE_REFUSED', 'STATE_HASH_REFUSED', 'EXPECTED_HISTORY_REQUIRED', 'STATE_POLL_REFUSED',
    'STATE_MESSAGE_REFUSED', 'STATE_VOTE_REFUSED', 'STATE_HISTORY_REFUSED']);
  if (allowed.has(error?.message)) return error.message;
  if (/^MAX HTTP [1-5]\d{2}$/.test(error?.message || '')) return error.message;
  // Unknown exceptions can contain paths, response data or credentials.
  return 'STARTUP_REFUSED';
}
// Metadata stays private; arbitrary error properties are never logged.
const startupStages = new WeakMap();
const STAGES = new Set(['CA', 'API_ME', 'API_CHAT', 'API_MEMBER', 'STATE_READ', 'STATE_JSON', 'STATE_LOCK', 'HTTP_LISTEN', 'WORKER']);
const SYSTEM_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EROFS', 'EEXIST', 'ENOTDIR', 'EISDIR', 'EMFILE', 'ENFILE', 'ENOSPC', 'EIO', 'EADDRINUSE', 'EADDRNOTAVAIL']);
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']);
const TLS_CODES = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER']);
function markStartup(error, stage) {
  if (error && (typeof error === 'object' || typeof error === 'function') && STAGES.has(stage) && !startupStages.has(error)) startupStages.set(error, stage);
  return error;
}
function safeStartupDiagnostic(error) {
  const reason = safeStartupReason(error);
  if (reason !== 'STARTUP_REFUSED') return reason;
  const stage = startupStages.get(error) || 'UNKNOWN';
  const api = ['API_ME', 'API_CHAT', 'API_MEMBER'].includes(stage);
  let code = 'UNKNOWN';
  if (api) {
    const candidates = [error?.code, error?.cause?.code];
    code = candidates.find(value => TLS_CODES.has(value)) || candidates.find(value => NETWORK_CODES.has(value)) ||
      (['TimeoutError', 'AbortError'].includes(error?.name) ? 'TIMEOUT_OR_ABORT' :
        error instanceof SyntaxError ? 'INVALID_JSON' : error?.message === 'MAX rejected request' ? 'API_REJECTED' : 'API_ERROR');
  } else if (stage === 'STATE_JSON') code = error instanceof SyntaxError ? 'INVALID_JSON' : 'UNKNOWN';
  else if (SYSTEM_CODES.has(error?.code)) code = error.code;
  else if (stage === 'CA') code = 'CA_ERROR';
  return `STARTUP_REFUSED stage=${stage} code=${code}`;
}
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
module.exports = { CHAT, STATE_DIR, CA_PATH, loadBothostTestConfig, workerEnvironment, assertNodeVersion, safeStartupReason, markStartup, safeStartupDiagnostic };
