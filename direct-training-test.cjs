'use strict';
// Explicit candidate command only. Default entrypoint and Dockerfile are unchanged.
async function main({env=process.env}={}) {
 require('./src/fitpp-direct-session').settings(env);
 const load=require('node:module').createRequire(require('node:path').join(__dirname,'direct-sdk/package.json'));
 const sdk={...load('firebase/app'),...load('firebase/auth'),...load('firebase/firestore')};
 const prepared=await require('./src/fitpp-direct-runtime').prepare({env,sdk});
 try {
  const server=await require('./src/fitpp-test-bridge').main(prepared);
  server.once('close',()=>void prepared.close().catch(()=>console.error('DIRECT_CLOSE_FAILED')));
  return server;
 } catch {await prepared.close();throw Error('DIRECT_STARTUP_REJECTED')}
}
if(require.main===module)main().catch(()=>{console.error('DIRECT_STARTUP_REJECTED');process.exitCode=1});
module.exports={main};
