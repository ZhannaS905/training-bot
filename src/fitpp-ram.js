'use strict';
const {validateView,render}=require('./fitpp-poll-sync');
const {provisional}=require('./fitpp-optimistic');
// One controller per exact poll. RAM is a projection, never a durable inbox.
function createRam({scope,loadView,api,now=Date.now,clock=()=>performance.now(),log=()=>{}}){
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
   const projected=render(view(),scope);
   const waiting=Array.from(pending.values()).some(p=>p.fast);
   const text=waiting?projected.replace('✅ Записано','⏳ Предварительный список')+'\n\n⏳ Изменение ещё не подтверждено FitPP.':projected;
   const result=await api.syncPollText(text,{clock});
   if(receivedAt!==undefined)log({event:'fitpp_ram_first_put',edited:result.edited===true,firstPutMs:result.edited?Math.round(clock()-receivedAt):null});
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
  if(inflight.has(id))return inflight.get(id);
  if(inflight.size>=256)throw Error('RAM_BACKPRESSURE');
  const at=event.callback.timestamp??event.timestamp;
  const newest=Math.max(base?.optimistic?.lastEventAt||0,...Array.from(pending.values(),p=>p.at));
  // Reuse the strict binding, time, identity and scope validation of the old path.
  const fast=ready&&base&&at>newest&&provisional({...base,participants:view().participants},event,scope,now());
  generation++;
  // Track even no-op/stale/fallback writes: refresh must never race an unsettled write.
  pending.set(id,{event,at,fast});
  // No Firebase operation is awaited before scheduling the first guarded MAX PUT.
  const shown=fast?display(receivedAt):Promise.resolve();
  const saved=writeTail.then(async()=>{
   // Finish the immediate MAX attempt before starting persistence. A failed MAX
   // attempt must not lose the action; authoritative reconciliation repairs it.
   await shown.catch(()=>{});return commit();
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
