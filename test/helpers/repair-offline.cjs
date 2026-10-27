'use strict';
// No .env, ADC, Firebase, live bot, or outbound transport can be used by this run.
for(const key of Object.keys(process.env))if(!['PATH','LANG','LC_ALL','TMPDIR','__CF_USER_TEXT_ENCODING','NODE_TEST_CONTEXT','NODE_TEST_WORKER_ID'].includes(key))throw Error('CLEAN_ENV_REQUIRED: '+key);
globalThis.fetch=()=>{throw Error('OFFLINE_ONLY')};
for(const protocol of ['node:http','node:https'])for(const method of ['get','request'])require(protocol)[method]=()=>{throw Error('OFFLINE_ONLY')};
for(const method of ['connect','createConnection'])require('node:net')[method]=()=>{throw Error('OFFLINE_ONLY')};
const Module=require('node:module'),load=Module._load;
Module._load=function(name,...rest){if(/^(firebase|firebase-admin|google-auth-library)(\/|$)/.test(name)||/firestore-(cloud|client)|cloud-session/.test(name))throw Error('CLOUD_MODULE_FORBIDDEN');return load.call(this,name,...rest)};
