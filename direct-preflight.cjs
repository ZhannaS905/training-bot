'use strict';
// Explicit read-only check. Never starts the MAX listener or poll synchronizer.
async function main({env=process.env}={}) {
 if(env.FITPP_DIRECT_WRITES_ENABLED!=='false')throw Error('PREFLIGHT_WRITES_MUST_BE_DISABLED');
 require('./src/fitpp-direct-session').settings(env);
 const load=require('node:module').createRequire(require('node:path').join(__dirname,'direct-sdk/package.json'));
 const sdk={...load('firebase/app'),...load('firebase/auth'),...load('firebase/firestore')};
 const prepared=await require('./src/fitpp-direct-runtime').prepare({env,sdk});
 await prepared.close();
}
if(require.main===module)main().then(()=>console.log('DIRECT_READ_PREFLIGHT_OK')).catch(()=>{console.error('DIRECT_READ_PREFLIGHT_REJECTED');process.exitCode=1});
module.exports={main};
