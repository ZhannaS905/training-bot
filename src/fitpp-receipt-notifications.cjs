'use strict';
const {validBinding}=require('./fitpp-notification-dry-run.cjs');
const {expiryTime,formatPurchase}=require('./fitpp-subscription-notifications.cjs');
const {frozenOn}=require('../direct-core/FitPP-Test/persistence.js');
const {reserve}=require('./fitpp-notification-send.cjs');
const kindOf=r=>r.type==='subscription'?'purchase':r.type==='freeze'?'freeze':'extension';
function valid(r,id){
 const e=r?.event;
 return e?.version===1&&e.operationId===id&&typeof e.cycleId==='string'&&e.cycleId&&
  typeof e.clientId==='string'&&typeof e.subscriptionId==='string'&&Number.isFinite(expiryTime(e.newExpires))&&(
   (r.type==='subscription'&&e.oldExpires===null&&Number.isSafeInteger(e.sessions)&&e.sessions>0)||
   (r.type==='extendSubscription'&&Number.isFinite(expiryTime(e.oldExpires))&&Number.isSafeInteger(e.days)&&e.days>0&&e.days<=14&&Date.parse(e.newExpires)-Date.parse(e.oldExpires)===e.days*86400000)||
   (r.type==='freeze'&&Number.isFinite(expiryTime(e.oldExpires))&&Number.isFinite(expiryTime(e.freezeStart))&&Number.isFinite(expiryTime(e.returnDate))&&Number.isSafeInteger(e.days)&&e.days>0&&Date.parse(e.returnDate)-Date.parse(e.freezeStart)===e.days*86400000&&Date.parse(e.newExpires)-Date.parse(e.oldExpires)===e.days*86400000));
}
function current(item,state,binding){
 const r=state.mutationReceipts?.[item.requestId];
 if(!valid(r,item.requestId)||JSON.stringify(r)!==item.receipt||item.kind!==kindOf(r)||
    Object.entries(r.event).some(([key,value])=>item[key]!==value))return false;
 const cs=state.clients.filter(c=>c.id===item.clientId&&!c.archivedAt);
 const ss=cs.length===1?(cs[0].subscriptions||[]).filter(s=>s.id===item.subscriptionId&&!s.cancelledAt):[];
 if(ss.length!==1||(ss[0].saleOperationId||ss[0].id)!==item.cycleId||!validBinding(binding,item.clientId))return false;
 const sub=ss[0];
 if(!Number.isSafeInteger(sub.left)||sub.left<0||!Number.isFinite(expiryTime(sub.expires)))return false;
 try{frozenOn(sub,sub.expires);}catch{return false;}
 // A freeze receipt describes the committed operation and its planned dates.
 // Early thaw (including cancellation of a pending freeze) can shorten the current
 // expiry or remove its history row. It cannot undo the successful receipt.
 // Other receipt kinds keep the existing expiry freshness rule.
 return item.kind==='freeze'||sub.expires>=item.newExpires;
}
function initialBaseline(directory,ids){
 if(!directory)return new Set(ids);
 const fs=require('node:fs'),path=require('node:path');
 const file=path.join(directory,'receipt-baseline-v1.json');
 const read=()=>{
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(data.version!==1||data.scope!=='fitpp-test:synthetic-v1:training-test:demo-client-1'||
     !Array.isArray(data.ids)||data.ids.length>500||data.ids.some(id=>typeof id!=='string'||!id)||
     new Set(data.ids).size!==data.ids.length)throw Error('RECEIPT_BASELINE_REFUSED');
  return new Set(data.ids);
 };
 try{return read();}catch(e){if(e.code!=='ENOENT')throw e;}
 // Publish a fully flushed file exclusively: concurrent starters use the winner.
 // An interrupted write leaves only an unused temporary file, never a partial baseline.
 const temp=path.join(directory,'.receipt-baseline-'+require('node:crypto').randomUUID());
 let fd;
 try{
  fd=fs.openSync(temp,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify({version:1,scope:'fitpp-test:synthetic-v1:training-test:demo-client-1',ids}));
  fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temp,file);const d=fs.openSync(directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
  catch(e){if(e.code!=='EEXIST')throw e;}
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.unlinkSync(temp);}
 return read();
}
function createReceiptSession({directory}={}){
 let seen;
 return {diagnose(state,binding,options={}){return diagnoseReceipts(state,binding,{directory,...options,seenIds:seen,seenObserved:true});},check(state,binding){
  const entries=Object.entries(state.mutationReceipts||{});
  // Without durable storage retain the previous read-only, no-history baseline.
  // In live mode the first baseline survives restarts: events committed after it
  // remain eligible even if the process stopped before the next poll. Durable
  // sender claims suppress already attempted events, including uncertain sends.
  if(!seen){
   const baseline=initialBaseline(directory,entries.map(([id])=>id));
   // The original durable cutoff applies to every receipt event type. Claims,
   // not a fresh in-memory baseline, suppress attempts after a restart.
   seen=new Set(directory?baseline:entries.map(([id])=>id));
   if(!directory)return [];
  }
  const result=[];
  for(const [id,r]of entries){
   if(seen.has(id))continue;seen.add(id);
   if(!valid(r,id)||r.event.clientId!=='demo-client-1')continue;
   const item={...r.event,kind:kindOf(r),requestId:id,receipt:JSON.stringify(r)};
   if(current(item,state,binding))result.push(item);
  }
  return result;
 }};
}
const daysLabel=n=>n%100>=11&&n%100<=14?'дней':n%10===1?'день':n%10>=2&&n%10<=4?'дня':'дней';
function format(item){
 if(item.kind==='purchase')return formatPurchase({sessions:item.sessions,expires:item.newExpires});
 if(item.kind==='freeze')return `❄️ Абонемент заморожен!\n\n🧊 Возвращение: ${item.returnDate}\n📅 Новая дата окончания: ${item.newExpires.split('-').reverse().join('.')}\n\n🫶 Ждём возвращения на тренировки!`;
 return `📅 Абонемент продлён!\n\n➕ Продление: ${item.days} ${daysLabel(item.days)}\n📅 Новая дата окончания: ${item.newExpires.split('-').reverse().join('.')}\n\n🫶 Ждём на тренировке!`;
}
function createReceiptSender({env,directory,raw}){const {settings,verify}=require('./fitpp-notification-send.cjs');const token=settings(env);raw||=new (require('./api').MaxApi)(token);return {async send(item,state,binding){if(!current(item,state,binding))return 'stale';await verify(raw,binding,item.clientId);const text=format(item);if(!reserve(directory,'receipt-v1:'+item.requestId))return 'duplicate';try{await raw.send(String(binding.bindings.find(b=>b.clientId===item.clientId).maxChatId),{text,notify:false});return 'sent';}catch{return 'uncertain';}}};}
// Diagnostic observations never initialize/reset seen, create a baseline, reserve
// a claim, invoke a sender, or expose customer/transport data in their output.
const DIAGNOSTIC_IDS=Object.freeze(['37146a27-2b15-4f9e-8a32-e8e2bfcc6332','67b4700d-d4cb-4845-9b8e-ebfefbe9e729','9ff7137b-1ea0-4ce7-b915-6bdb8c2c56ce']);
function diagnosticBaseline(directory){
 if(!directory)return {code:'baseline_unavailable'};
 try{
  const data=JSON.parse(require('node:fs').readFileSync(require('node:path').join(directory,'receipt-baseline-v1.json'),'utf8'));
  if(data.version!==1||data.scope!=='fitpp-test:synthetic-v1:training-test:demo-client-1'||!Array.isArray(data.ids)||data.ids.length>500||data.ids.some(id=>typeof id!=='string'||!id)||new Set(data.ids).size!==data.ids.length)return {code:'baseline_invalid'};
  return {ids:new Set(data.ids)};
 }catch(e){return {code:e.code==='ENOENT'?'baseline_missing':'baseline_unreadable'};}
}
function diagnosticClaim(directory,id){
 if(!directory)return 'claim_unavailable';
 const name=require('node:crypto').createHash('sha256').update('fitpp-test:synthetic-v1:receipt-v1:'+id).digest('hex');
 try{return require('node:fs').readFileSync(require('node:path').join(directory,name),'utf8')==='attempted\n'?'claim_attempted':'claim_invalid';}
 catch(e){return e.code==='ENOENT'?'claim_absent':'claim_unreadable';}
}
function diagnoseReceipts(state,binding,{directory,ids=DIAGNOSTIC_IDS,seenIds,seenObserved=false,freshState,freshBinding,candidates}={}){
 const baseline=diagnosticBaseline(directory),rows=[];
 ids.forEach((id,index)=>{
  const r=state?.mutationReceipts?.[id],kind=r?.type==='subscription'?'purchase':r?.type==='extendSubscription'?'extension':r?.type==='freeze'?'freeze':'unknown',target=DIAGNOSTIC_IDS.includes(id)?'target_'+(DIAGNOSTIC_IDS.indexOf(id)+1):'other';
  const note=(status,code)=>rows.push({kind,target,status,code});
  const check=(value,ok,bad)=>note(value?'PASS':'REJECT',value?ok:bad);
  check(Boolean(r),'firestore_received','firestore_missing');
  if(baseline.ids)check(!baseline.ids.has(id),'outside_baseline','in_initial_baseline');else note('UNKNOWN',baseline.code);
  if(!seenObserved)note('UNKNOWN','seen_not_observable');
  else if(!seenIds)note('PASS','seen_not_initialized');
  else check(!seenIds.has(id),'not_seen','already_seen');
  const claim=diagnosticClaim(directory,id);note(claim==='claim_absent'?'PASS':claim==='claim_attempted'||claim==='claim_invalid'?'REJECT':'UNKNOWN',claim);
  if(!r){note('SKIP','receipt_checks_unavailable');return;}
  let validResult=false;try{validResult=Boolean(valid(r,id));}catch{}
  check(validResult,'valid','invalid_receipt');
  const e=r.event;
  if(!e){note('SKIP','event_checks_unavailable');return;}
  check(e.clientId==='demo-client-1','test_client_scope','outside_test_client');
  check(Number.isFinite(expiryTime(e.newExpires)),'event_expiry_valid','event_expiry_invalid');
  if(r.type==='subscription')check(e.oldExpires===null&&Number.isSafeInteger(e.sessions)&&e.sessions>0,'purchase_terms_valid','purchase_terms_invalid');
  else check(Number.isFinite(expiryTime(e.oldExpires))&&Number.isSafeInteger(e.days)&&e.days>0&&(r.type==='freeze'||e.days<=14)&&Date.parse(e.newExpires)-Date.parse(e.oldExpires)===e.days*86400000,'event_duration_valid','event_duration_invalid');
  if(r.type==='freeze')check(Number.isFinite(expiryTime(e.freezeStart))&&Number.isFinite(expiryTime(e.returnDate))&&Date.parse(e.returnDate)-Date.parse(e.freezeStart)===e.days*86400000,'freeze_dates_valid','freeze_dates_invalid');
  const clients=Array.isArray(state?.clients)?state.clients.filter(c=>c?.id===e.clientId&&!c.archivedAt):[];
  check(clients.length===1,'active_client','active_client_missing_or_ambiguous');
  const subs=clients.length===1&&Array.isArray(clients[0].subscriptions)?clients[0].subscriptions.filter(s=>s?.id===e.subscriptionId&&!s.cancelledAt):[];
  check(subs.length===1,'active_subscription','active_subscription_missing_or_ambiguous');
  let bound=false;try{bound=Boolean(validBinding(binding,e.clientId));}catch{}
  check(bound,'valid_binding','invalid_binding');
  if(subs.length===1){
   const sub=subs[0];check((sub.saleOperationId||sub.id)===e.cycleId,'cycle_matches','cycle_mismatch');
   check(Number.isSafeInteger(sub.left)&&sub.left>=0,'balance_valid','balance_invalid');
   check(Number.isFinite(expiryTime(sub.expires)),'subscription_expiry_valid','subscription_expiry_invalid');
   try{frozenOn(sub,sub.expires);note('PASS','freeze_history_valid');}catch{note('REJECT','freeze_history_invalid');}
   check(kind==='freeze'||sub.expires>=e.newExpires,'expiry_fresh','expiry_before_event');
  }else note('SKIP','subscription_checks_unavailable');
  // Use the real candidate when available, so recheck includes full receipt and
  // candidate integrity. Historical events get a diagnostic-only reconstruction.
  const item=candidates?.find(x=>x.requestId===id)||{...e,kind,requestId:id,receipt:JSON.stringify(r)};
  try{check(current(item,state,binding),'current','not_current');}catch{note('REJECT','current_error');}
  if(freshState!==undefined){
   check(Boolean(freshState?.mutationReceipts?.[id]),'fresh_firestore_received','fresh_firestore_missing');
   try{check(current(item,freshState,freshBinding),'fresh_current','fresh_not_current');}catch{note('REJECT','fresh_current_error');}
   const details=new Set(['valid','invalid_receipt','test_client_scope','outside_test_client','event_expiry_valid','event_expiry_invalid','purchase_terms_valid','purchase_terms_invalid','event_duration_valid','event_duration_invalid','freeze_dates_valid','freeze_dates_invalid','active_client','active_client_missing_or_ambiguous','active_subscription','active_subscription_missing_or_ambiguous','valid_binding','invalid_binding','cycle_matches','cycle_mismatch','balance_valid','balance_invalid','subscription_expiry_valid','subscription_expiry_invalid','freeze_history_valid','freeze_history_invalid','expiry_fresh','expiry_before_event']);
   for(const row of diagnoseReceipts(freshState,freshBinding,{directory,ids:[id],candidates:[item]}))if(details.has(row.code))note(row.status,'fresh_'+row.code);
   const freshR=freshState?.mutationReceipts?.[id];
   const exact=JSON.stringify(freshR)===item.receipt;
   check(exact,'fresh_receipt_unchanged','fresh_receipt_changed');
   if(!exact)try{note('REJECT',require('node:util').isDeepStrictEqual(JSON.parse(item.receipt),freshR)?'fresh_receipt_key_order_changed':'fresh_receipt_content_changed');}catch{note('REJECT','candidate_receipt_invalid');}
  }else note('UNKNOWN','fresh_read_unavailable');
 });return rows;
}
function diagnosticLines(rows){return rows.map(r=>`FITPP_RECEIPT_DIAG ${r.kind} ${r.target} ${r.status} ${r.code}`);}

module.exports={createReceiptSession,createReceiptSender,current,format,diagnoseReceipts,diagnosticLines,DIAGNOSTIC_IDS};
