'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const R=require('../src/fitpp-receipt-notifications.cjs');
const binding={version:1,botId:131384398,bindings:[{clientId:'demo-client-1',maxChatId:126619382,maxUserId:5819064,notificationsEnabled:true}]};
const env={BOT_MODE:'test',FIREBASE_PROJECT_ID:'fitpp-test',TEST_EXPECTED_BOT_ID:'131384398',TEST_BOT_TOKEN:'mock',AUTO_PUBLISH:'false',TEST_ALLOW_SEND:'false',TEST_ALLOW_EDIT:'false',TEST_ALLOW_DELETE:'false'};
function state(){return {clients:[{id:'demo-client-1',subscriptions:[{id:'sub',saleOperationId:'cycle',left:8,expires:'2026-12-20'}]}],mutationReceipts:{old:{type:'subscription',event:{version:1,operationId:'old',cycleId:'cycle',clientId:'demo-client-1',subscriptionId:'sub',oldExpires:null,newExpires:'2026-11-20',sessions:8}}}}}
function add(s,id,type){s.mutationReceipts[id]={type,event:{version:1,operationId:id,cycleId:'cycle',clientId:'demo-client-1',subscriptionId:'sub',oldExpires:type==='subscription'?null:'2026-11-20',newExpires:'2026-11-27',...(type==='subscription'?{sessions:8}:{days:7}),...(type==='freeze'?{freezeStart:'2026-10-27',returnDate:'2026-11-03'}:{})}};}
function dir(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-restart-repair-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d}
function raw(){let calls=0;return {get calls(){return calls},request:async(m,p)=>p==='/me'?{user_id:131384398,username:'id623401053090_1_bot',is_bot:true}:{chat_id:126619382,type:'dialog',status:'active',dialog_with_user:{user_id:5819064,is_bot:false}},send:async()=>{calls++}}}
test('durable original baseline recovers purchase, extension and freeze committed during downtime; old history stays silent',async t=>{
 const d=dir(t),s=state();a.deepEqual(R.createReceiptSession({directory:d}).check(s,binding),[]);const before=fs.readFileSync(d+'/receipt-baseline-v1.json','utf8');
 for(const [id,type] of [['purchase','subscription'],['extension','extendSubscription'],['freeze','freeze']])add(s,id,type);
 const items=R.createReceiptSession({directory:d}).check(s,binding);a.deepEqual(items.map(x=>x.kind),['purchase','extension','freeze']);a(items.every(x=>R.current(x,s,binding)));
 const api=raw(),sender=R.createReceiptSender({env,directory:d,raw:api});for(const item of items)a.equal(await sender.send(item,s,binding),'sent');a.equal(api.calls,3);
 const again=R.createReceiptSession({directory:d}).check(s,binding);for(const item of again)a.equal(await sender.send(item,s,binding),'duplicate');a.equal(api.calls,3);a.equal(fs.readFileSync(d+'/receipt-baseline-v1.json','utf8'),before);
 fs.writeFileSync(d+'/fixture.json',JSON.stringify({s,binding,env}));
 const code=`const a=require('node:assert/strict'),fs=require('node:fs'),R=require(${JSON.stringify(require.resolve('../src/fitpp-receipt-notifications.cjs'))}),d=process.argv[1],f=JSON.parse(fs.readFileSync(d+'/fixture.json'));(async()=>{const items=R.createReceiptSession({directory:d}).check(f.s,f.binding);a.equal(items.length,3);const raw={request:async(m,p)=>p==='/me'?{user_id:131384398,username:'id623401053090_1_bot',is_bot:true}:{chat_id:126619382,type:'dialog',status:'active',dialog_with_user:{user_id:5819064,is_bot:false}},send:async()=>{throw Error('FORBIDDEN_SEND')}};for(const i of items)a.equal(await R.createReceiptSender({env:f.env,directory:d,raw}).send(i,f.s,f.binding),'duplicate')})().catch(()=>process.exitCode=1)`;
 const child=spawnSync(process.execPath,['--require',path.resolve(__dirname,'helpers/repair-offline.cjs'),'-e',code,d],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});a.equal(child.status,0,child.stderr);
});
test('uncertain extension keeps its claim after restart; current() still rejects changed/cancelled cycles',async t=>{
 const d=dir(t),s=state();R.createReceiptSession({directory:d}).check(s,binding);add(s,'extension','extendSubscription');const [item]=R.createReceiptSession({directory:d}).check(s,binding),api=raw();api.send=async()=>{throw Error('UNCERTAIN')};const sender=R.createReceiptSender({env,directory:d,raw:api});a.equal(await sender.send(item,s,binding),'uncertain');a.equal(await sender.send(R.createReceiptSession({directory:d}).check(s,binding)[0],s,binding),'duplicate');
 s.clients[0].subscriptions[0].cancelledAt='now';a.equal(R.current(item,s,binding),false);a.deepEqual(R.createReceiptSession({directory:d}).check(s,binding),[]);
});
test('specified extension reproduces restart loss without repeating extension or sending',t=>{
 const d=dir(t),s=state();R.createReceiptSession({directory:d}).check(s,binding);const id='37146a27-2b15-4f9e-8a32-e8e2bfcc6332';add(s,id,'extendSubscription');const items=R.createReceiptSession({directory:d}).check(s,binding);a.deepEqual(items.map(x=>x.operationId),[id]);a.equal(items[0].days,7);a.equal(fs.readdirSync(d).length,1);
});
test('first-ever start skips all existing event types; dry-run stays disk-free; corrupt baseline never resets',t=>{
 const s=state();for(const type of ['subscription','extendSubscription','freeze'])add(s,type,type);const d=dir(t);a.deepEqual(R.createReceiptSession({directory:d}).check(s,binding),[]);a.deepEqual(R.createReceiptSession().check(s,binding),[]);fs.writeFileSync(d+'/receipt-baseline-v1.json','broken');a.throws(()=>R.createReceiptSession({directory:d}).check(s,binding));a.equal(fs.readFileSync(d+'/receipt-baseline-v1.json','utf8'),'broken');
});
