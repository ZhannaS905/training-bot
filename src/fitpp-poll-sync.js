'use strict';
const {body}=require('./memory-training-test');
function validateView(view,scope){
 if(view?.chat!==scope.chat||view?.mid!==scope.mid||view?.uuid!==scope.uuid||!/^\d{4}-\d{2}-\d{2}$/.test(view.date||'')||view.location!=='zarya'||view.time!=='20:00'||!Number.isSafeInteger(view.revision)||view.revision<0||!Array.isArray(view.participants)||view.participants.length>4)throw Error('POLL_VIEW_REJECTED');
 const seen=new Set();for(const p of view.participants){if(!/^demo-client-[1-4]$/.test(p.clientId||'')||seen.has(p.clientId)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100)throw Error('POLL_PARTICIPANT_REJECTED');seen.add(p.clientId)}
 return view;
}
function render(view,scope){validateView(view,scope);return body({id:scope.uuid,date:view.date,votes:new Map(view.participants.map(p=>[p.clientId,p.name]))}).text.replace('🤨 Пока никто не записался!','✅ Записано (0):\nПока никто не записался.')}
function plainText(html){return html.replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39);/g,(_,x)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[x]))}
function createPollSync({scope,loadView,api,clock=()=>performance.now(),log=()=>{}}){
 let flight=null,again=false,diagnosticPending=false;const observers=new Set();
 async function once(){const started=clock(),timing={event:'fitpp_poll_sync',pollViewMs:0,maxVerifyMs:0,maxPutMs:0,puts:0};let firstPutAt=null,finalText;
 async function read(){const at=clock();try{return validateView(await loadView(),scope)}finally{timing.pollViewMs+=clock()-at}}
 const finish=revision=>{if(timing.puts>0||diagnosticPending){log({...timing,pollViewMs:Math.round(timing.pollViewMs),maxVerifyMs:Math.round(timing.maxVerifyMs),maxPutMs:Math.round(timing.maxPutMs),totalMs:Math.round(clock()-started)});diagnosticPending=false}return {synced:true,revision,puts:timing.puts,firstPutAt,text:finalText}};
 for(let attempt=0;attempt<3;attempt++){
   const view=await read(),text=render(view,scope);finalText=text;
   // The scoped API performs all identity/chat/MID/keyboard checks once, then compares/edits.
   const result=await api.syncPollText(text,{clock});
   timing.maxVerifyMs+=result.maxVerifyMs;timing.maxPutMs+=result.maxPutMs;
   if(!result.edited)return finish(view.revision);
   timing.puts++;const at=clock();firstPutAt??=at;for(const observer of observers)observer({at,text});
   // Recheck Firestore only after a PUT: recover concurrent changes without doubling idle reads.
   const latest=await read();
   if(latest.revision===view.revision&&render(latest,scope)===text)return finish(latest.revision);
  }throw Error('POLL_VIEW_CHANGED_RETRY');}
 function sync({diagnostic=false,onPut}={}){if(onPut)observers.add(onPut);diagnosticPending||=diagnostic;if(flight){again=true;return flight}flight=(async()=>{let result,puts=0,firstPutAt=null;do{again=false;result=await once();puts+=result.puts;firstPutAt??=result.firstPutAt}while(again);return {...result,puts,firstPutAt}})().finally(()=>{flight=null;observers.clear()});return flight}
 return {sync,busy:()=>!!flight};
}
module.exports={createPollSync,render,validateView,plainText};
