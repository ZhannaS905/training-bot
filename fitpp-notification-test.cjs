'use strict';
// Explicit standalone watcher; no polling/webhook changes, no Firestore writes.
const fs = require('node:fs');
const {config,signIn,readBoth} = require('./fitpp-notification-preview.cjs');
const {createPreviewSession} = require('./src/fitpp-notification-dry-run.cjs');
const {createSender,settings} = require('./src/fitpp-notification-send.cjs');
async function main(env=process.env,args=process.argv.slice(2),{
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  storageRoot='/app/data'
}={}) {
  const mode=args.join(' ');
  if (!['--verify','--watch','--send --watch'].includes(mode)) throw Error('ARGUMENT_REFUSED');
  config(env);settings(env);
  const live=mode==='--send --watch';
  const directory=require('node:path').join(storageRoot,'fitpp-notification-attempts-v1');
  if(live){
    if(!fs.statSync(storageRoot).isDirectory())throw Error('DURABLE_STORAGE_REQUIRED');
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
  }
  const sender=createSender({env,directory}), session=createPreviewSession();
  let token=await signIn(env),expires=Date.now()+45*60000;
  do {
    if(Date.now()>=expires){token=await signIn(env);expires=Date.now()+45*60000}
    const {main:state,binding}=await readBoth(token);
    await sender.verify(binding);
    if(mode==='--verify'){console.log('FITPP_NOTIFICATION_VERIFIED no_send no_firestore_write');return}
    const {baseline,candidates}=session.check(state,binding);
    console.log(baseline?'FITPP_NOTIFICATION_BASELINE no_history_send':'FITPP_NOTIFICATION_CANDIDATES '+candidates.length);
    for(const item of candidates)console.log('FITPP_NOTIFICATION_RESULT '+(live?await sender.send(item,binding):'dry-run'));
    await wait(30000);
  } while(true);
}
if(require.main===module)main().catch(()=>{console.error('FITPP_NOTIFICATION_STOPPED verification_or_io_failed no_automatic_retry');process.exitCode=1});
module.exports={main};
