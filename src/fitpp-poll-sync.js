'use strict';
const {body}=require('./memory-training-test');
function validateView(view,scope){
 if(view?.chat!==scope.chat||view?.mid!==scope.mid||view?.uuid!==scope.uuid||!/^\d{4}-\d{2}-\d{2}$/.test(view.date||'')||view.location!=='zarya'||view.time!=='20:00'||!Number.isSafeInteger(view.revision)||view.revision<0||!Array.isArray(view.participants)||view.participants.length>4)throw Error('POLL_VIEW_REJECTED');
 const seen=new Set();for(const p of view.participants){if(!/^demo-client-[1-4]$/.test(p.clientId||'')||seen.has(p.clientId)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100)throw Error('POLL_PARTICIPANT_REJECTED');seen.add(p.clientId)}
 return view;
}
function render(view,scope){validateView(view,scope);return body({id:scope.uuid,date:view.date,votes:new Map(view.participants.map(p=>[p.clientId,p.name]))}).text.replace('🤨 Пока никто не записался!','✅ Записано (0):\nПока никто не записался.')}
function plainText(html){return html.replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39);/g,(_,x)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[x]))}
function createPollSync({scope,loadView,api}){
 let flight=null,again=false;
 async function once(){for(let attempt=0;attempt<3;attempt++){
   const view=validateView(await loadView(),scope),text=render(view,scope);
   const existing=await api.pollMessage();
   // Always read the actual message: recover after a restart or an uncertain edit.
   if(existing.body.text!==text&&existing.body.text!==plainText(text))await api.editPollText(text);
   const latest=validateView(await loadView(),scope);
   if(latest.revision===view.revision&&render(latest,scope)===text)return {synced:true,revision:latest.revision};
  }throw Error('POLL_VIEW_CHANGED_RETRY');}
 function sync(){if(flight){again=true;return flight}flight=(async()=>{do{again=false;await once()}while(again)})().finally(()=>{flight=null});return flight}
 return {sync,busy:()=>!!flight};
}
module.exports={createPollSync,render,validateView,plainText};
