'use strict';
const {MAIN,BOOKINGS,bookingKey}=require('./service.cjs');
const {optimisticContext}=require('./optimistic-context.cjs');
const {POLL,assertPoll}=require('./pilot-policy.cjs');
async function readPollView(db,scope,{optimistic=false}={}){
assertPoll(scope);
return db.runTransaction(async tx=>{
 const [main,bookings,clock]=await Promise.all([tx.get(db.doc(MAIN)),tx.get(db.doc(BOOKINGS)),tx.get(db.doc('fitppTestWorkspaces/synthetic-v1/states/bookingClock'))]);
 if(!main.exists||!bookings.exists||!clock.exists)throw Error('POLL_VIEW_MISSING');
 const m=main.data(),b=bookings.data(),c=clock.data();
 if([m,b].some(d=>d.ownerUid!=='lLlMAetSG1aEeJSeBl4F4ypydEh2'||d.datasetId!=='synthetic-v1'||d.schemaVersion!==1)||!Number.isSafeInteger(c.revision)||c.revision<0)throw Error('POLL_VIEW_METADATA');
 const participants=[],seen=new Set();
 for(const client of m.clients||[]){
  if(!/^demo-client-[1-4]$/.test(client.id)||client.archivedAt||b.entries?.[bookingKey(client.id,POLL.date,POLL.location)]!==true)continue;
  if(seen.has(client.id))throw Error('DUPLICATE_CLIENT_ID');seen.add(client.id);
  const name=String(client.name||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,100);if(!name)throw Error('CLIENT_NAME_REQUIRED');
  participants.push({clientId:client.id,name});
 }
 participants.sort((a,b)=>a.clientId.localeCompare(b.clientId));
 let optimisticSkipReason;
 const context=optimistic?await optimisticContext(tx,db,m,b,scope,reason=>{optimisticSkipReason=reason}):null;
 return {chat:POLL.chat,mid:POLL.mid,uuid:POLL.uuid,date:POLL.date,location:POLL.location,time:POLL.time,revision:c.revision,participants,...(optimistic?{optimistic:context,...(optimisticSkipReason?{optimisticSkipReason}:{})}:{})};
});
}
module.exports={readPollView};
