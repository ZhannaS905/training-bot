'use strict';
// Training Test only. Reuse the existing transactional booking engine and bindings.
const {Service,MAIN,hash}=require('../direct-core/src/service.cjs');
const E=require('../direct-core/FitPP-Test/persistence.js').createProductionPricingModel();
const {CHAT,USER}=require('../direct-core/src/pilot-policy.cjs');
const {times,moscow}=require('./schedule');
const {validate}=require('./training-test-firestore');
function createDailyBooking({db,botId,now=Date.now}) {
 if(typeof botId!=='string'||!/^[1-9]\d*$/.test(botId))throw Error('DAILY_TEST_BOT_REQUIRED');
 return {async receive(u,expected){
  const cb=u?.callback,m=u?.message;
  if(u?.update_type!=='message_callback'||m?.recipient?.chat_type!=='chat'||String(m.recipient.chat_id)!==CHAT||String(cb?.user?.user_id)!==USER||cb.user.is_bot!==false)return {applied:false,reason:'outside_test_binding'};
  const match=/^poll:([a-f0-9-]{36}):(yes|cancel)$/.exec(cb.payload||'');
  if(!match||match[1]!==expected?.id||m.body?.mid!==expected.mid)throw Error('DAILY_POLL_SCOPE_REJECTED');
  const at=cb.timestamp??u.timestamp;
  if(typeof cb.callback_id!=='string'||!cb.callback_id.trim()||cb.callback_id.length>256||!Number.isSafeInteger(at)||(cb.timestamp!==undefined&&u.timestamp!==undefined&&cb.timestamp!==u.timestamp))throw Error('DAILY_CALLBACK_REJECTED');
  const date=moscow(new Date(now())).date,day=new Date(date+'T12:00:00Z').getUTCDay(),time=times[day];
  if(expected.date!==date||!time)throw Error('DAILY_DATE_REJECTED');
  const location=[0,6].includes(day)?'online':[1,3].includes(day)?'zarya':'pole';
  const pollPath=`trainingTestAutopostBots/${botId}/polls/${date}`;
  const virtualPoll='fitppTestWorkspaces/synthetic-v1/maxPolls/'+hash([CHAT,expected.mid]);
  const guarded={doc:path=>db.doc(path),runTransaction:fn=>db.runTransaction(async tx=>{
   // The authoritative current poll is read IN the booking transaction. A changed
   // mid/uuid/status causes refusal/retry; no callback payload can register a poll.
   const [ps,ms]=await Promise.all([tx.get(db.doc(pollPath)),tx.get(db.doc(MAIN))]);
   if(!ps.exists||!ms.exists)throw Error('DAILY_STATE_MISSING');
   const p=validate(ps.data(),botId,date),main=ms.data();
   if(p.status!=='published'||p.id!==match[1]||p.mid!==m.body.mid||!Number.isSafeInteger(p.createdAt)||p.createdAt>at)throw Error('DAILY_POLL_SCOPE_REJECTED');
   if(!Number.isSafeInteger(p.last[USER]))throw Error('DAILY_VOTE_MISSING');
   // A delayed callback must not project an older intent over a newer poll vote,
   // even if the newer booking commit previously failed.
   if(p.last[USER]!==at||Object.hasOwn(p.votes,USER)!==(match[2]==='yes'))return {applied:false,reason:'stale_vote'};
   if(main.ownerUid!=='lLlMAetSG1aEeJSeBl4F4ypydEh2'||main.datasetId!=='synthetic-v1'||main.schemaVersion!==1)throw Error('DAILY_MAIN_REJECTED');
   const workouts=E.workoutsOn(main,location,date).filter(w=>w.time===time&&!w.cancelled);
   if(workouts.length!==1)throw Error('DAILY_WORKOUT_REJECTED');
   const scope={chat:CHAT,mid:p.mid,uuid:p.id,date,location,workoutId:workouts[0].id,openedAt:p.createdAt,closesAt:Date.parse(date+'T'+time+':00+03:00')+3600000,open:true};
   return fn({...tx,get:ref=>ref.path===virtualPoll?Promise.resolve({exists:true,data:()=>scope}):ref.path===MAIN?Promise.resolve(ms):tx.get(ref)});
  })};
  return new Service(guarded,{now}).callback({pollUuid:match[1],id:cb.callback_id,uid:USER,at,chat:CHAT,mid:m.body.mid,payload:match[2]==='yes'?'poll_yes':'poll_cancel'});
 }};
}
module.exports={createDailyBooking};
