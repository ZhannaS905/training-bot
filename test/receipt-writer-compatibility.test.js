'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const N=require('../src/fitpp-receipt-notifications.cjs'),R=require('../src/fitpp-notification-recovery.cjs');
const {reserve,createSender}=require('../src/fitpp-notification-send.cjs');
const env={BOT_MODE:'test',FIREBASE_PROJECT_ID:'fitpp-test',TEST_EXPECTED_BOT_ID:'131384398',TEST_BOT_TOKEN:'mock',AUTO_PUBLISH:'false',TEST_ALLOW_SEND:'false',TEST_ALLOW_EDIT:'false',TEST_ALLOW_DELETE:'false',FITPP_NOTIFICATION_RECEIPTS_ENABLED:'true',FITPP_NOTIFICATION_EXPIRY_ENABLED:'true'};
function fixture(t,n=2){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-writer-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const cid='demo-client-'+n,cycle='sale-fixture-'+n,sid='subscription-'+cycle;
 const sale={type:'subscription',clientId:cid,date:'2026-10-25',operationId:cycle,templateId:'plan-zarya',expectedTemplateRevision:2,homeGroupId:'zarya',method:'transfer',received:4400,visit:null};
 const extend={type:'extendSubscription',clientId:cid,operationId:'extension-fixture-'+n,subscriptionIndex:1,expectedExpires:'2026-11-22',expectedUsed:0,days:1};
 const receipt=(action,revision)=>({type:action.type,revision,at:1793290000000,signature:JSON.stringify({action,operationDay:'2026-10-29'})});
 const sub={id:sid,saleOperationId:cycle,saleRequest:JSON.stringify(sale),termsVersion:1,terms:{sessions:8,durationDays:28,locations:['zarya','pole','online'],priceKopecks:440000,name:'Test'},startDate:'2026-10-25',expires:'2026-11-23',extensionDays:1,left:5};
 const state={...structuredClone(require('../direct-core/fixtures/main.json')),_fitppRevision:3,clients:[{id:cid,subscriptions:[{id:'cancelled-old',cancelledAt:'2026-10-24'},sub]}],visits:{},visitOps:{},attendanceOps:{},workouts:{},mutationReceipts:{[cycle]:receipt(sale,1),[extend.operationId]:receipt(extend,2)}};
 const row={clientId:cid,maxChatId:70+n,maxUserId:80+n,notificationsEnabled:true,recoverNotifications:true},binding={version:1,botId:131384398,bindings:[row]};
 const sends=[],raw={request:async(m,url)=>url==='/me'?{user_id:131384398,username:'id623401053090_1_bot',is_bot:true}:{chat_id:row.maxChatId,type:'dialog',status:'active',dialog_with_user:{user_id:row.maxUserId,is_bot:false}},send:async(chat,body)=>{sends.push({chat,body});return 'mid.mock'}};
 return {cid,cycle,sid,sub,sale,extend,receipt,state,binding,row,directory,sends,raw,env,now:()=>Date.parse('2026-10-29T18:00:00Z'),readFresh:async()=>({main:state,binding})};
}
test('all four test participants: unified writer purchase and extension produce verified personal notifications',async t=>{
 for(let n=1;n<=4;n++){
  const f=fixture(t,n),session=N.createReceiptSession();session.check({...f.state,mutationReceipts:{}},f.binding);
  const items=session.check(f.state,f.binding);a.deepEqual(items.map(x=>x.kind),['purchase','extension']);
  a.equal(items[0].sessions,8);a.equal(items[0].newExpires,'2026-11-22');a.equal(items[1].newExpires,'2026-11-23');
  for(const item of items)a.equal(await N.createReceiptSender(f).send(item,f.state,f.binding),'sent');
  a.ok(f.sends.every(s=>s.chat===String(70+n)));
 }
});
test('receipt recovery remains possible after earlier visit recovery completion; existing claims are preserved',async t=>{
 const f=fixture(t);reserve(f.directory,'recovery-completed-v1:'+JSON.stringify([f.cid,f.row.maxUserId,f.row.maxChatId]));reserve(f.directory,'previous-visit-fixture');
 a.deepEqual(await R.recover(f),['sent','sent']);a.equal(f.sends.length,2);
 a.match(f.sends[0].body.text,/Покупка абонемента/);a.match(f.sends[1].body.text,/Абонемент продлён/);
 a.deepEqual(await R.recover(f),[]);a.equal(f.sends.length,2);
});
test('invalid, mismatched, cancelled and stale signature receipts fail closed',async t=>{
 const mutations=[f=>f.state.mutationReceipts[f.cycle].signature='not-json',f=>f.state.mutationReceipts[f.cycle].event={},f=>f.state.mutationReceipts[f.cycle].revision=100,f=>f.sub.saleRequest=JSON.stringify({...f.sale,clientId:'demo-client-4'}),f=>f.sub.cancelledAt='2026-10-29',f=>f.sub.saleOperationId='different-cycle'];
 for(const mutate of mutations){const f=fixture(t);mutate(f);a.equal(N.eventFor(f.state.mutationReceipts[f.cycle],f.cycle,f.state),null)}
 for(const change of [{operationId:'wrong-id'},{subscriptionIndex:0},{expectedUsed:2},{days:15},{clientId:'demo-client-4'}]){
  const f=fixture(t);f.state.mutationReceipts[f.extend.operationId]=f.receipt({...f.extend,...change},2);
  a.equal(N.eventFor(f.state.mutationReceipts[f.extend.operationId],f.extend.operationId,f.state),null);
 }
});
test('all four participants: freeze from retained committed freeze record and burned lesson are sent to own dialog',async t=>{
 for(let n=1;n<=4;n++){
  const f=fixture(t,n),freeze={type:'freeze',clientId:f.cid,operationId:'freeze-fixture-'+n,subscriptionIndex:1,startDate:'2026-10-30',returnDate:'2026-11-02'};
  f.sub.freezes=[{version:1,start:freeze.startDate,end:freeze.returnDate,returnDate:freeze.returnDate,baseExpires:'2026-11-23'}];f.sub.expires='2026-11-26';
  f.state.mutationReceipts[freeze.operationId]=f.receipt(freeze,3);
  const session=N.createReceiptSession();session.check({...f.state,mutationReceipts:{}},f.binding);const items=session.check(f.state,f.binding);
  const item=items.find(x=>x.kind==='freeze');a.ok(item);a.equal(item.days,3);a.equal(item.newExpires,'2026-11-26');
  a.equal(await N.createReceiptSender(f).send(item,f.state,f.binding),'sent');a.match(f.sends[0].body.text,/Абонемент заморожен/);
  const burned={clientId:f.cid,maxChatId:f.row.maxChatId,operationId:'burned-fixture-'+n,workoutId:'w'+n,status:'missed',date:'2026-10-29',previous:6,remaining:5};
  a.equal(await createSender(f).send(burned,f.binding),'sent');a.match(f.sends[1].body.text,/🔥 Занятие сгорело/);
  a.ok(f.sends.every(s=>s.chat===String(f.row.maxChatId)));
 }
});
