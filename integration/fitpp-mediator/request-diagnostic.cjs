'use strict';
// Exact literals only. Never log messages, stacks, headers, tokens or bodies.
const reasons=new Set(['PILOT_DISABLED','BUSY','POLL_SCOPE_REJECTED','BODY_LIMIT','POLL_VIEW_MISSING','POLL_VIEW_METADATA','DUPLICATE_CLIENT_ID','CLIENT_NAME_REQUIRED','TOKEN_REJECTED','SDK_UID_REJECTED','SESSION_CHANGED','INGRESS_AUTH','CLOUD_WRITES_DISABLED']);
const firebase=new Map([['permission-denied','FIREBASE_PERMISSION_DENIED'],['unauthenticated','FIREBASE_UNAUTHENTICATED'],['unavailable','FIREBASE_UNAVAILABLE'],['deadline-exceeded','FIREBASE_TIMEOUT'],['aborted','FIREBASE_ABORTED']]);
function diagnostic(error,path){
 const code=reasons.has(error?.message)?error.message:firebase.get(error?.code)||'UNKNOWN';
 return {event:'pilot-request-rejected',route:path==='/bot/poll-view'?'snapshot':path==='/bot/update'?'update':'unknown',code};
}
module.exports={diagnostic};
