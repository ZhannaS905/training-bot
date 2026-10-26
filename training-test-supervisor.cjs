'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
// Linux /proc is mandatory: refuse startup if the old terminal watcher is alive.
function manualWatchers(root='/proc') {
 return fs.readdirSync(root).filter(p=>/^\d+$/.test(p)).filter(p=>{
  let argv;try{argv=fs.readFileSync(path.join(root,p,'cmdline'),'utf8').split('\0')}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return false;throw e}
  return argv.some(a=>/\/(fitpp-notification-test|fitpp-notification-preview)\.cjs$/.test(a)||/^(fitpp-notification-test|fitpp-notification-preview)\.cjs$/.test(a)) && argv.includes('--send') && argv.includes('--watch');
 });
}
function supervise({enabled=false,launch=(file,args)=>spawn(process.execPath,[path.join(__dirname,file),...args],{stdio:'inherit'}),schedule=setTimeout,cancel=clearTimeout,log=console.log,finish=code=>process.exit(code)}={}) {
 let stopping=false,timer,killTimer,failures=0;
 const children=new Set();
 function stop(code=0){
  if(stopping)return;stopping=true;if(timer)cancel(timer);
  for(const child of children)child.kill('SIGTERM');
  if(!children.size)return finish(code);
  killTimer=schedule(()=>{for(const child of children)child.kill('SIGKILL')},10000);
  exitCode=code;
 }
 let exitCode=0;
 function start(file,args,watcher){
  let child;try{child=launch(file,args)}catch{stop(1);return}
  children.add(child);let done=false;
  function ended(){
   if(done)return;done=true;children.delete(child);
   if(stopping){if(!children.size){if(killTimer)cancel(killTimer);finish(exitCode)}return}
   if(!watcher){stop(1);return}
   const delay=Math.min(300000,5000*2**Math.min(failures++,6));
   log('FITPP_SUPERVISOR watcher_stopped retry_ms='+delay);
   timer=schedule(()=>{timer=null;start(file,args,true)},delay);
  }
  child.once('exit',ended);child.once('error',ended);
 }
 start('direct-training-test.cjs',[],false);
 if(enabled&&!stopping)start('fitpp-notification-test.cjs',['--send','--watch'],true);
 return {stop};
}
if(require.main===module)(async()=>{
 let lock;try{
  const flag=process.env.FITPP_NOTIFICATION_SUPERVISED;
  if(flag!==undefined&&!['true','false'].includes(flag))throw Error('FLAG_REFUSED');
  if(flag==='true')lock=await require('./src/fitpp-notification-lock.cjs').acquire('supervisor');
  if(flag==='true'&&manualWatchers().length)throw Error('EXISTING_WATCHER');
  const runtime=supervise({enabled:flag==='true'});
  process.once('SIGTERM',()=>runtime.stop());process.once('SIGINT',()=>runtime.stop());
 }catch{lock?.close();console.error('FITPP_SUPERVISOR_START_REFUSED check_flag_and_existing_watchers');process.exitCode=1}
})();
module.exports={supervise,manualWatchers};
