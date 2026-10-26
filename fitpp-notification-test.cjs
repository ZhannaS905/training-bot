'use strict';
// Explicit standalone watcher; no polling/webhook changes, no Firestore writes.
const fs = require('node:fs');
const {config,signIn,readBoth} = require('./fitpp-notification-preview.cjs');
const {createPreviewSession} = require('./src/fitpp-notification-dry-run.cjs');
const {createSender,settings} = require('./src/fitpp-notification-send.cjs');
async function main(env=process.env,args=process.argv.slice(2),{
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  storageRoot=env.FITPP_NOTIFICATION_STORAGE_ROOT || '/app/data'
}={}) {
  const mode=args.join(' ');
  if (!['--verify','--watch','--send --watch'].includes(mode)) throw Error('ARGUMENT_REFUSED');
  config(env);settings(env);
  const live=mode==='--send --watch';
  const directory=require('node:path').join(storageRoot,'fitpp-notification-attempts-v1');
  if(live){
    const path=require('node:path');
    const confirmed=env.FITPP_NOTIFICATION_STORAGE_CONFIRMED;
    if(confirmed === 'fitpp-test:training-test:storage-check-20261026') {
      // Operator verified these exact files across restart AND rebuild on Training Test.
      // Never create or repair the evidence: a missing volume must stop sending.
      if(storageRoot !== '/app/data' ||
         fs.readFileSync(path.join(storageRoot,'fitpp-storage-check.txt'),'utf8').trim() !== 'fitpp-storage-check-20261026' ||
         fs.readFileSync(path.join(directory,'f50668b32b88ed07d5831a719737b31b6aff4c59b9f4b8f4aa6362a8bf7e3a3e'),'utf8') !== 'attempted\n')
        throw Error('DURABLE_STORAGE_REQUIRED');
    } else if(confirmed !== 'fitpp-test:synthetic-v1:training-test:v1' ||
       fs.readFileSync(path.join(storageRoot,'.fitpp-notification-volume'),'utf8').trim() !== confirmed)
      throw Error('DURABLE_STORAGE_REQUIRED');
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
if(require.main===module)(async()=>{let lock;try{if(process.argv.slice(2).join(' ')==='--send --watch')lock=await require('./src/fitpp-notification-lock.cjs').acquire();await main()}finally{lock?.close()}})().catch(()=>{console.error('FITPP_NOTIFICATION_STOPPED verification_or_io_failed no_automatic_retry');process.exitCode=1});
module.exports={main};
