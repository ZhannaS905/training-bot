'use strict';
const {validateView,render}=require('./fitpp-poll-sync');
const {provisionalSkipReason}=require('./fitpp-optimistic');
const contextReasons=new Set(['binding_or_poll_missing','client_binding_invalid','poll_context_invalid','reverse_binding_invalid','booking_version_invalid','client_name_invalid']);
// One controller per exact poll. RAM is a projection, never a durable inbox.
function createRam({scope,loadView,api,now=Date.now,clock=()=>performance.now(),log=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let ready=false,base=null,generation=0,writeTail=Promise.resolve(),displayTail=Promise.resolve(),refreshFlight=null;
 const pending=new Map(),inflight=new Map();
 function view(){
  const result=structuredClone(base);
  for(const {event,fast,at} of pending.values()){
   if(!fast)continue;
   const b=result.optimistic;
   if(!b||at<=b.lastEventAt)continue;
   result.participants=result.participants.filter(p=>p.clientId!==b.clientId);
   if(event.callback.payload.endsWith(':yes'))result.participants.push({clientId:b.clientId,name:b.name});
  }
  result.participants.sort((a,b)=>a.clientId.localeCompare(b.clientId));return result;
 }
 function display(receivedAt){
  const job=displayTail.then(async()=>{
   if(!base)return;
   // Render the intent immediately with the final layout. Confirmation alone
   // must not change the text and cause another MAX PUT.
   const text=render(view(),scope);
   const started=clock();
   let result;
   try{result=await api.syncPollText(text,{clock})}catch(error){
    if(receivedAt!==undefined)log({event:'fitpp_ram_first_put',outcome:'max_failed',edited:false,firstPutMs:null,putStartedMs:null,displayQueueMs:Math.round(started-receivedAt),displayMs:Math.round(clock()-started)});
    throw error;
   }
   if(receivedAt!==undefined)log({event:'fitpp_ram_first_put',outcome:result.edited?'edited':'text_unchanged',edited:result.edited===true,firstPutMs:result.edited?Math.round(clock()-receivedAt):null,displayQueueMs:Math.round(started-receivedAt),putStartedMs:result.edited&&result.putStartedAt!=null?Math.round(result.putStartedAt-receivedAt):null,maxVerifyMs:result.maxVerifyMs??null,maxPutMs:result.maxPutMs??null});
  });
  displayTail=job.catch(()=>{});return job;
 }
 async function refresh(){
  if(pending.size)return;
  if(refreshFlight){await refreshFlight;return refresh()}
  const version=generation;
  refreshFlight=(async()=>{
   const fresh=validateView(await loadView(),scope);
   // A read begun before an accepted action cannot replace that action's projection.
   if(version!==generation||pending.size)return;
   if(base&&fresh.revision<base.revision)throw Error('RAM_REVISION_REGRESSION');
   base=structuredClone(fresh);ready=true;await display();
  })().catch(error=>{ready=false;throw error}).finally(()=>{refreshFlight=null});return refreshFlight;
 }
 function run(event,commit,receivedAt=clock()){
  const id=event.callback.callback_id;
  if(inflight.has(id)){log({event:'fitpp_ram_fast_path',used:false,reason:'duplicate_inflight'});return inflight.get(id)}
  if(inflight.size>=256){log({event:'fitpp_ram_fast_path',used:false,reason:'backpressure'});throw Error('RAM_BACKPRESSURE')}
  const at=event.callback.timestamp??event.timestamp;
  const newest=Math.max(base?.optimistic?.lastEventAt||0,...Array.from(pending.values(),p=>p.at));
  // Reuse the strict binding, time, identity and scope validation of the old path.
  let reason=!base?'snapshot_missing':!ready?'snapshot_not_ready':null;
  if(!reason){
   if(pending.size&&at<=newest)reason='pending_newer_event';
   else try{reason=provisionalSkipReason({...base,participants:view().participants},event,scope,now())}catch{reason='snapshot_invalid'}
  }
  const fast=reason===null;
  log({event:'fitpp_ram_fast_path',used:fast,reason:reason||'scheduled',...(reason==='optimistic_context_missing'?{contextReason:contextReasons.has(base.optimisticSkipReason)?base.optimisticSkipReason:'unspecified'}:{})});
  generation++;
  // Track even no-op/stale/fallback writes: refresh must never race an unsettled write.
  pending.set(id,{event,at,fast});
  // No Firebase operation is awaited before scheduling the first guarded MAX PUT.
  const shown=fast?display(receivedAt):Promise.resolve();
  const saved=writeTail.then(async()=>{
   // Persistence and the immediate MAX attempt overlap. Durable writes keep
   // their own order; settlement below waits for MAX before any correction.
   const started=clock();
   for(let attempt=1;;attempt++){
    try{const value=await commit();log({event:'fitpp_ram_persistence',attempts:attempt,confirmed:true,persistenceQueueMs:Math.round(started-receivedAt),persistenceMs:Math.round(clock()-started)});return value}
    catch(error){
     const code=String(error?.code||'').replace(/^firestore\//,'');
     const transient=['unavailable','deadline-exceeded','aborted','resource-exhausted'].includes(code)||[408,429,500,502,503,504].includes(error?.status)||['TimeoutError','AbortError'].includes(error?.name);
     // Retry the identical callback inside the ordered write slot. Durable event
     // deduplication handles an ambiguous acknowledgement; webhook stays pending.
     if(!transient||attempt>=3){log({event:'fitpp_ram_persistence',attempts:attempt,confirmed:false,persistenceQueueMs:Math.round(started-receivedAt),persistenceMs:Math.round(clock()-started)});throw error}
     await sleep(100*2**(attempt-1));
    }
   }
  });writeTail=saved.catch(()=>{});
  const job=(async()=>{
   const [write]=await Promise.allSettled([saved,shown]);
   // Apply the accepted intent to the confirmed local base before removing its overlay.
   if(write.status==='fulfilled'&&write.value?.applied===true&&fast&&at>base.optimistic.lastEventAt){
    const b=base.optimistic;base.participants=base.participants.filter(p=>p.clientId!==b.clientId);
    if(event.callback.payload.endsWith(':yes'))base.participants.push({clientId:b.clientId,name:b.name});
    b.lastEventAt=Math.max(b.lastEventAt,at);
   }
   pending.delete(id);generation++;
   // Ambiguous transport failures invalidate the binding until authoritative recovery.
   if(write.status==='rejected')ready=false;
   let repairError;
   try{if(pending.size)await display();else await refresh()}catch(error){
    repairError=error;ready=false;
    // Read failure must not leave a rejected intent on screen. Best-effort local rollback,
    // then the 30-second authoritative retry handles ambiguous remote outcomes.
    try{await display()}catch{/* MAX retry remains pending as well. */}
   }
   if(write.status==='rejected')throw write.reason;
   if(repairError)throw repairError;
   return write.value;
  })().finally(()=>inflight.delete(id));
  inflight.set(id,job);return job;
 }
 return {run,refresh,status:()=>({ready,pending:pending.size})};
}
module.exports={createRam};
