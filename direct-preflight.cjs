'use strict';
const {at,format}=require('./src/fitpp-direct-diagnostic');
// Explicit read-only check. Never starts the MAX listener or poll synchronizer.
async function authRead({env=process.env,sdk,now=Date.now}={}) {
 if(env.FITPP_DIRECT_ENABLED!=='false'||env.FITPP_DIRECT_WRITES_ENABLED!=='false'||env.OWNER_DIALOG_ENABLED!=='false')throw Error('PREFLIGHT_FLAGS_REQUIRED');
 const {POLL}=require('./direct-core/src/pilot-policy.cjs');
 const checkTime=()=>{if(now()>=POLL.closesAt)throw Error('POLL_CLOSED')};
 checkTime();
 // Enable only the isolated session, never the bot or poll transport. Copy env.
 const sessionEnv={...env,FITPP_DIRECT_ENABLED:'true'};
 const session=await require('./src/fitpp-direct-session').connect({env:sessionEnv,sdk});
 try {
  checkTime();
  const snapshot=await session.db.doc('fitppTestWorkspaces/synthetic-v1/states/main').get();
  checkTime();
  if(!snapshot.exists)throw Error('TEST_STATE_REQUIRED');
 } finally {await session.close()}
}
async function main({env=process.env,authReadOnly=false}={}) {
 await at('FLAGS',()=>{if(env.FITPP_DIRECT_WRITES_ENABLED!=='false')throw Error('PREFLIGHT_WRITES_MUST_BE_DISABLED')});
 await at('SETTINGS',()=>require('./src/fitpp-direct-session').settings(authReadOnly?{...env,FITPP_DIRECT_ENABLED:'true'}:env));
 const load=require('node:module').createRequire(require('node:path').join(__dirname,'direct-sdk/package.json'));
 const sdk=await at('SDK_LOAD',()=>({...load('firebase/app'),...load('firebase/auth'),...load('firebase/firestore')}));
 if(authReadOnly)return authRead({env,sdk});
 const prepared=await require('./src/fitpp-direct-runtime').prepare({env,sdk});
 await prepared.close();
}
if(require.main===module) {
 const args=process.argv.slice(2),authReadOnly=args.length===1&&args[0]==='--auth-read';
 const run=args.length&&!authReadOnly?Promise.reject(Error('PREFLIGHT_ARGUMENTS_REJECTED')):main({authReadOnly});
 run.then(()=>console.log(authReadOnly?'DIRECT_AUTH_READ_PREFLIGHT_OK':'DIRECT_READ_PREFLIGHT_OK')).catch(error=>{console.error('DIRECT_READ_PREFLIGHT_REJECTED '+format(error));process.exitCode=1});
}
module.exports={main,authRead};
