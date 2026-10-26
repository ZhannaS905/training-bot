'use strict';
// Current Training Test entrypoint; daily test polls are an opt-in capability.
async function main({env=process.env}={}) {
 require('./src/fitpp-direct-session').settings(env);
 const autopostModule=require('./src/training-test-autopost');
 autopostModule.settings(env);
 const load=require('node:module').createRequire(require('node:path').join(__dirname,'direct-sdk/package.json'));
 const sdk={...load('firebase/app'),...load('firebase/auth'),...load('firebase/firestore')};
 const prepared=await require('./src/fitpp-direct-runtime').prepare({env,sdk});
 let autopost;
 try {
  autopost=await autopostModule.prepare({env});
  const server=await require('./src/fitpp-test-bridge').main({...prepared,autopost});
  server.once('close',()=>void prepared.close().catch(()=>console.error('DIRECT_CLOSE_FAILED')));
  return server;
 } catch {if(autopost)await autopost.close();await prepared.close();throw Error('DIRECT_STARTUP_REJECTED')}
}
if(require.main===module)main().catch(()=>{console.error('DIRECT_STARTUP_REJECTED');process.exitCode=1});
module.exports={main};
