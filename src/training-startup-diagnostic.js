'use strict';
// Only locally issued diagnostics can cross the startup logging boundary.
const issued = new WeakSet();
const stages = new Set(['CONFIG','MAX_IDENTITY','BRIDGE_SNAPSHOT','MAX_POLL','LISTEN']);
const codes = new Set(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EADDRINUSE','EACCES',
 'UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT']);
const reasons = new Set(['TEST_CONFIG','TEST_TOKEN_REQUIRED','EXPECTED_ID_REQUIRED','WEBHOOK_SECRET_REQUIRED',
 'TLS_REQUIRED','TEST_ADMIN_IDS_INVALID','TEST_BRIDGE_DISABLED','POLL_WRITES_MUST_BE_DISABLED',
 'BRIDGE_SETTINGS_REJECTED','EXACT_SCOPE_REQUIRED','POLL_SYNC_FLAG_REJECTED','TEST_IDENTITY_REFUSED',
 'TEST_CHAT_REFUSED','TEST_MEMBERSHIP_REFUSED','POLL_SCOPE_REFUSED','POLL_MESSAGE_REFUSED',
 'POLL_BUTTONS_REFUSED','POLL_TEXT_REFUSED','FITPP_BRIDGE_REJECTED','POLL_VIEW_REJECTED',
 'POLL_PARTICIPANT_REJECTED','RAM_REVISION_REGRESSION','INVALID_TRAINING_DATE']);
function classify(error) {
 // Equality against fixed literals only: never interpolate external data.
 if (reasons.has(error?.message)) return error.message;
 if (codes.has(error?.code)) return error.code;
 if (codes.has(error?.cause?.code)) return error.cause.code;
 if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'TIMEOUT_OR_ABORT';
 if (error instanceof SyntaxError) return 'INVALID_JSON';
 if (error?.code === 'ERR_INVALID_URL') return 'INVALID_URL';
 if (['MAX HTTP 401','MAX HTTP 403','MAX HTTP 404','MAX HTTP 429'].includes(error?.message))
   return 'MAX_HTTP_' + error.message.slice(-3);
 if (error?.message === 'MAX rejected request') return 'API_REJECTED';
 return 'UNKNOWN';
}
function mark(error, stage) {
 if (issued.has(error)) return error;
 const safe = new Error('Training Test startup refused');
 safe.stage = stages.has(stage) ? stage : 'UNKNOWN';
 safe.code = classify(error); issued.add(safe); return safe;
}
async function at(stage, operation) {
 try { return await operation(); } catch (error) { throw mark(error, stage); }
}
function format(error) {
 return issued.has(error)
  ? `Training Test startup refused stage=${error.stage} code=${error.code}`
  : 'Training Test startup refused stage=UNKNOWN code=UNKNOWN';
}
module.exports = {at, format};
