'use strict';
const {validateView,render}=require('./fitpp-poll-sync');
function provisional(view,event,scope,now){
 validateView(view,scope);if(String(event.callback?.user?.user_id)!==String(scope.user)||event.message?.body?.mid!==scope.mid||String(event.message?.recipient?.chat_id)!==scope.chat||![`poll:${scope.uuid}:yes`,`poll:${scope.uuid}:cancel`].includes(event.callback?.payload))return null;const b=view.optimistic,at=event.callback.timestamp??event.timestamp;
 if(!b||b.userId!==String(scope.user)||!/^demo-client-[1-4]$/.test(b.clientId||'')||typeof b.name!=='string'||!b.name.trim()||b.name.length>100||![b.lastEventAt,b.openedAt,b.closesAt,at].every(Number.isSafeInteger)||at<=b.lastEventAt||at<b.openedAt||now>=b.closesAt||at>now+30000||at<now-86400000||event.callback.timestamp!==undefined&&event.timestamp!==undefined&&event.callback.timestamp!==event.timestamp)return null;
 const desired=event.callback.payload===`poll:${scope.uuid}:yes`,present=view.participants.some(p=>p.clientId===b.clientId);
 if(desired===present)return null;
 const participants=view.participants.filter(p=>p.clientId!==b.clientId);if(desired)participants.push({clientId:b.clientId,name:b.name});participants.sort((a,b)=>a.clientId.localeCompare(b.clientId));
 const confirmedText=render({...view,participants},scope);
 return {confirmedText,text:confirmedText.replace('✅ Записано','⏳ Предварительный список')+'\n\n⏳ Изменение ещё не подтверждено FitPP.'};
}
function createOptimistic({scope,loadView,api,reconcile,clock=()=>performance.now(),now=Date.now,log=()=>{}}){
 let tail=Promise.resolve();
 async function apply(event,commit,receivedAt){
  let preview=null,previewSucceeded=false,previewFailed=false,firstPutAt=null,firebaseConfirmMs=null,firebaseSettlementMs=null,finalSyncMs=null,correctiveUpdates=0,finalPuts=0,reconciled=false;
  // Fresh authoritative snapshot per action. Never persist or reuse a participant cache across callbacks.
  try{preview=provisional(await loadView(),event,scope,now())}catch{/* Older mediator, missing binding, or unavailable snapshot: confirmed path only. */}
  const write=Promise.resolve().then(commit).then(value=>{firebaseConfirmMs=clock()-receivedAt;firebaseSettlementMs=firebaseConfirmMs;return value},error=>{firebaseSettlementMs=clock()-receivedAt;throw error});
  const display=preview?Promise.resolve().then(()=>api.syncPollText(preview.text,{clock})).then(result=>{if(result.edited){firstPutAt=clock();previewSucceeded=true}},()=>{previewFailed=true}):Promise.resolve();
  // Firebase and preview may overlap; PUTs never do. Wait for preview before correcting it.
  const [saved]=await Promise.allSettled([write,display]);
  let finalError;
  const started=clock();try{
   const final=await reconcile({onPut:({at,text})=>{finalPuts++;firstPutAt??=at;if(previewSucceeded&&(saved.status==='rejected'||text!==preview.confirmedText))correctiveUpdates++}});reconciled=true;
   if(finalPuts===0){finalPuts=final?.puts||0;if(previewSucceeded&&(saved.status==='rejected'||final?.text!==preview.confirmedText))correctiveUpdates=finalPuts;}
   if(firstPutAt===null&&final?.firstPutAt!=null)firstPutAt=final.firstPutAt;
  }catch(error){finalError=error}finally{finalSyncMs=clock()-started}
  log({event:'fitpp_optimistic_timing',optimisticUsed:preview!==null,previewFailed,firebaseConfirmed:saved.status==='fulfilled',firebaseApplied:saved.status==='fulfilled'&&saved.value?.applied===true,reconciled,firstPutMs:firstPutAt===null?null:Math.round(firstPutAt-receivedAt),firebaseConfirmMs:firebaseConfirmMs===null?null:Math.round(firebaseConfirmMs),firebaseSettlementMs:Math.round(firebaseSettlementMs),finalSyncMs:Math.round(finalSyncMs),finalPuts,correctiveUpdates});
  if(saved.status==='rejected')throw saved.reason;if(finalError)throw finalError;return saved.value;
 }
 return {run(event,commit,receivedAt=clock()){const job=tail.then(()=>apply(event,commit,receivedAt));tail=job.catch(()=>{});return job}};
}
module.exports={createOptimistic,provisional};
