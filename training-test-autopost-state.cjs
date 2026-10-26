'use strict';
// Administrative Firestore status / explicit import. Never sends MAX messages.
const {moscow}=require('./src/schedule');
const {config}=require('./src/memory-training-test');
const {training,capability}=require('./src/training-test-autopost');
const {validate,validDate}=require('./src/training-test-firestore');
const {POLL}=require('./direct-core/src/pilot-policy.cjs');
function legacyPolls(state,botId){
 if(state?.version!==1||state.autopost?.chat!==POLL.chat||!state.polls||Array.isArray(state.polls))throw Error('AUTOPOST_LEGACY_REFUSED');
 for(const [date,p]of Object.entries(state.polls)){
  if(!training(date)||p?.date!==date||!Array.isArray(p.votes)||!Array.isArray(p.last)||!Array.isArray(p.done))throw Error('AUTOPOST_LEGACY_REFUSED');
  if(p.status==='external'&&(date!==POLL.date||p.mid!==POLL.mid||p.id!==POLL.uuid))throw Error('AUTOPOST_LEGACY_REFUSED');
  validate({version:1,botId,chat:POLL.chat,date,id:p.id,status:p.status,mid:p.mid,votes:Object.fromEntries(p.votes),order:p.votes.map(v=>String(v[0])),last:Object.fromEntries(p.last),revision:0,displayedRevision:0,legacyDone:p.done},botId,date);
 }
 return Object.entries(state.polls);
}
async function main({args=process.argv.slice(2),env=process.env,readInput=async()=>{let s='';for await(const b of process.stdin){s+=b;if(s.length>8000000)throw Error('INPUT_LIMIT')}return s}}={}){
 const [action,date=moscow().date]=args;
 if(!['status','import-legacy'].includes(action)||args.length>2||!validDate(date)||env.FIREBASE_PROJECT_ID!=='fitpp-test')throw Error('AUTOPOST_STATE_COMMAND_REFUSED');
 if(action==='import-legacy'&&(env.TRAINING_TEST_AUTOPOST_IMPORT_ENABLED!=='true'||env.TRAINING_TEST_AUTOPOST_ENABLED!=='false'))throw Error('AUTOPOST_IMPORT_DISABLED');
 const c=config(env),entries=action==='import-legacy'?legacyPolls(JSON.parse(await readInput()),c.expectedId):[];
 const load=require('node:module').createRequire(require('node:path').join(__dirname,'direct-sdk/package.json'));
 const sdk={...load('firebase/app'),...load('firebase/auth'),...load('firebase/firestore')};
 const session=await require('./src/fitpp-direct-session').connect({env,sdk});
 try{
  await capability(c); // Identity/chat checks only. No send/edit methods are called.
  const store=session.autopostStore(c.expectedId,{writeEnabled:()=>action==='import-legacy'&&env.TRAINING_TEST_AUTOPOST_IMPORT_ENABLED==='true'});
  for(const [day,p]of entries)await store.importLegacy(day,p);
  const p=await store.read(date);
  console.log(JSON.stringify({storage:'firestore',date,status:p?.status??'absent',mid:p?.mid??null,revision:p?.revision??null,displayedRevision:p?.displayedRevision??null,importedDates:entries.map(([day])=>day)}));
 }finally{await session.close()}
}
if(require.main===module)main().catch(()=>{console.error('AUTOPOST_STATE_COMMAND_REFUSED');process.exitCode=1});
module.exports={main,legacyPolls};
