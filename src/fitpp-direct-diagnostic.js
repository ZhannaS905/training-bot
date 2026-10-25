'use strict';
// Never format external messages, stacks, paths, identities or credentials.
const issued=new WeakSet();
const stages=new Set(['FLAGS','SETTINGS','SDK_LOAD','BRIDGE_SETTINGS','POLL_TIME','SCOPE','CONNECT','TRANSPORT','POLL_VIEW','READ_MAIN','READ_BOOKINGS','READ_CLOCK']);
const reasons=new Set(['FIREBASE_API_KEY_REQUIRED','FIREBASE_BOT_UID_REQUIRED','FIREBASE_BOT_EMAIL_REQUIRED','FIREBASE_BOT_PASSWORD_REQUIRED','PREFLIGHT_WRITES_MUST_BE_DISABLED','PREFLIGHT_FLAGS_REQUIRED','PREFLIGHT_ARGUMENTS_REJECTED','DIRECT_DISABLED','TEST_PROJECT_REQUIRED','OWNER_DIALOG_MUST_STAY_DISABLED','POLL_WRITES_MUST_BE_DISABLED','EXPECTED_TEST_UID_REQUIRED','TEST_BRIDGE_DISABLED','BRIDGE_SETTINGS_REJECTED','EXACT_SCOPE_REQUIRED','POLL_SYNC_FLAG_REJECTED','POLL_OPEN_TIME_REQUIRED','POLL_CLOSED','DIRECT_AUTH_CONNECTION_REJECTED','BOT_AUTH_REQUIRED','DEDICATED_TEST_IDENTITY_REQUIRED','DIRECT_WRITES_DISABLED','DIRECT_KEY_REQUIRED','EXACT_POLL_REQUIRED','INGRESS_AUTH','POLL_SCOPE_REJECTED','POLL_VIEW_MISSING','POLL_VIEW_METADATA','DUPLICATE_CLIENT_ID','CLIENT_NAME_REQUIRED','TEST_STATE_REQUIRED']);
const sdkCodes=new Set(['permission-denied','unauthenticated','unavailable','deadline-exceeded','failed-precondition','invalid-argument','resource-exhausted','aborted','auth/invalid-credential','auth/network-request-failed','auth/too-many-requests','auth/invalid-api-key']);
function mark(error,stage){
 if(issued.has(error))return error;
 const safe=new Error(reasons.has(error?.message)?error.message:'DIRECT_CHECK_REJECTED');
 safe.stage=stages.has(stage)?stage:'UNKNOWN';
 safe.reason=reasons.has(error?.message)?error.message:sdkCodes.has(error?.code)?error.code:error instanceof SyntaxError?'INVALID_JSON':error?.code==='ERR_INVALID_URL'?'INVALID_URL':'UNKNOWN';
 issued.add(safe);return safe;
}
async function at(stage,fn){try{return await fn()}catch(error){throw mark(error,stage)}}
function format(error){return issued.has(error)?`stage=${error.stage} reason=${error.reason}`:'stage=UNKNOWN reason=UNKNOWN'}
module.exports={mark,at,format};
