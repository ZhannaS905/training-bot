'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const R=require('../src/fitpp-receipt-notifications.cjs');
const binding={version:1,botId:131384398,bindings:[{clientId:'demo-client-1',maxChatId:126619382,maxUserId:5819064,notificationsEnabled:true}]};
function fixture(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-diag-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));const s={clients:[{id:'demo-client-1',name:'PRIVATE_NAME',phone:'PRIVATE_PHONE',subscriptions:[{id:'sub',saleOperationId:'cycle',left:8,expires:'2026-12-20'}]}],mutationReceipts:{}};return {d,s};}
function add(s,id=R.DIAGNOSTIC_IDS[0],type='extendSubscription'){s.mutationReceipts[id]={type,event:{version:1,operationId:id,cycleId:'cycle',clientId:'demo-client-1',subscriptionId:'sub',oldExpires:type==='subscription'?null:'2026-11-20',newExpires:'2026-11-27',...(type==='subscription'?{sessions:8}:{days:7}),...(type==='freeze'?{freezeStart:'2026-10-27',returnDate:'2026-11-03'}:{})}};}
const fingerprint=d=>fs.readdirSync(d).sort().map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(d,n))).digest('hex')]);
const has=(rows,code,status)=>rows.some(r=>r.code===code&&r.status===status);
test('missing baseline and saved historical receipt are diagnosed without creating files or initializing seen',t=>{
 const {d,s}=fixture(t);add(s);const session=R.createReceiptSession({directory:d}),before=structuredClone(s);const rows=session.diagnose(s,binding,{freshState:s,freshBinding:binding});a(has(rows,'baseline_missing','UNKNOWN'));a(has(rows,'seen_not_initialized','PASS'));a(has(rows,'fresh_current','PASS'));a.deepEqual(fs.readdirSync(d),[]);a.deepEqual(s,before);a(has(session.diagnose(s,binding),'seen_not_initialized','PASS'));
});
test('baseline and already-seen events remain diagnosable; diagnosis never changes candidate delivery or claims',t=>{
 const {d,s}=fixture(t);add(s);const session=R.createReceiptSession({directory:d});a.deepEqual(session.check(s,binding),[]);const before=fingerprint(d);const rows=session.diagnose(s,binding,{freshState:s,freshBinding:binding});a(has(rows,'in_initial_baseline','REJECT'));a(has(rows,'already_seen','REJECT'));a(has(rows,'current','PASS'));a.deepEqual(session.check(s,binding),[]);a.deepEqual(fingerprint(d),before);
 const restart=R.createReceiptSession({directory:d});a(has(restart.diagnose(s,binding),'seen_not_initialized','PASS'));a.deepEqual(restart.check(s,binding),[]);a(has(restart.diagnose(s,binding),'already_seen','REJECT'));a.deepEqual(fingerprint(d),before);
});
test('diagnosis of seen post-baseline event never retries it; claims read attempted/invalid without writes',t=>{
 const {d,s}=fixture(t),session=R.createReceiptSession({directory:d});session.check(s,binding);add(s);a.equal(session.check(s,binding).length,1);const id=R.DIAGNOSTIC_IDS[0],name=crypto.createHash('sha256').update('fitpp-test:synthetic-v1:receipt-v1:'+id).digest('hex');fs.writeFileSync(path.join(d,name),'attempted\n');const before=fingerprint(d);a(has(session.diagnose(s,binding),'claim_attempted','REJECT'));a(has(session.diagnose(s,binding),'already_seen','REJECT'));a.deepEqual(session.check(s,binding),[]);a.deepEqual(fingerprint(d),before);
 fs.writeFileSync(path.join(d,name),'INVALID_PRIVATE_VALUE');a(has(session.diagnose(s,binding),'claim_invalid','REJECT'));a(!R.diagnosticLines(session.diagnose(s,binding)).join('').includes('INVALID_PRIVATE_VALUE'));
});
test('each independent guard has an actual reason; fresh changed receipt/cycle/binding are inspected',t=>{
 const {d,s}=fixture(t);add(s);const observe=(state=s,b=binding,fresh=state)=>R.diagnoseReceipts(state,b,{directory:d,freshState:fresh,freshBinding:b});
 for(const [change,code] of [[x=>x.mutationReceipts[R.DIAGNOSTIC_IDS[0]].event.days=0,'invalid_receipt'],[x=>x.clients[0].archivedAt='now','active_client_missing_or_ambiguous'],[x=>x.clients[0].subscriptions[0].cancelledAt='now','active_subscription_missing_or_ambiguous'],[x=>x.clients[0].subscriptions[0].saleOperationId='other','cycle_mismatch'],[x=>x.clients[0].subscriptions[0].left=-1,'balance_invalid'],[x=>x.clients[0].subscriptions[0].expires='broken','subscription_expiry_invalid']]){const changed=structuredClone(s);change(changed);a(has(observe(changed),code,'REJECT'));}
 const disabled=structuredClone(binding);disabled.bindings[0].notificationsEnabled=false;a(has(observe(s,disabled),'invalid_binding','REJECT'));
 const fresh=structuredClone(s);fresh.clients[0].subscriptions[0].saleOperationId='changed';const rows=observe(s,binding,fresh);a(has(rows,'current','PASS'));a(has(rows,'fresh_not_current','REJECT'));a(has(rows,'fresh_cycle_mismatch','REJECT'));
 const replaced=structuredClone(s);replaced.mutationReceipts[R.DIAGNOSTIC_IDS[0]].event.days=2;a(has(observe(s,binding,replaced),'fresh_receipt_changed','REJECT'));
});
test('all three requested IDs, missing events, purchase/freeze dates and safe output; standalone seen is explicitly unknown',t=>{
 const {d,s}=fixture(t);R.DIAGNOSTIC_IDS.forEach((id,i)=>add(s,id,i===2?'freeze':'extendSubscription'));let rows=R.diagnoseReceipts(s,binding,{directory:d,freshState:s,freshBinding:binding});a.equal(rows.filter(r=>r.code==='firestore_received').length,3);a(has(rows,'seen_not_observable','UNKNOWN'));a(has(rows,'freeze_dates_valid','PASS'));let lines=R.diagnosticLines(rows).join('\n');for(const secret of ['PRIVATE_NAME','PRIVATE_PHONE','126619382','5819064',...R.DIAGNOSTIC_IDS])a(!lines.includes(secret));
 s.mutationReceipts[R.DIAGNOSTIC_IDS[2]].event.returnDate='bad';a(has(R.diagnoseReceipts(s,binding,{directory:d}),'freeze_dates_invalid','REJECT'));delete s.mutationReceipts[R.DIAGNOSTIC_IDS[1]];a(has(R.diagnoseReceipts(s,binding,{directory:d}),'firestore_missing','REJECT'));
 add(s,R.DIAGNOSTIC_IDS[0],'subscription');a(has(R.diagnoseReceipts(s,binding,{directory:d}),'purchase_terms_valid','PASS'));
});
test('standalone CLI uses only Auth/Firestore reads, no MAX requests, claims, baseline or sender verification',async t=>{
 const {d,s}=fixture(t);add(s);const {main}=require('../fitpp-notification-test.cjs');const calls=[],logs=[];
 t.mock.method(console,'log',line=>logs.push(line));const wire=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(wire)}}:typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wire(x)]))}}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:{integerValue:String(v)};
 t.mock.method(global,'fetch',async(input,options)=>{const url=new URL(input);calls.push([url.hostname,options.method]);if(url.hostname==='identitytoolkit.googleapis.com'){const uid='lLlMAetSG1aEeJSeBl4F4ypydEh2';return {ok:true,json:async()=>({localId:uid,idToken:'h.'+Buffer.from(JSON.stringify({aud:'fitpp-test',iss:'https://securetoken.google.com/fitpp-test',sub:uid,exp:Date.now()/1000+3600})).toString('base64url')+'.s'})};}a.equal(url.hostname,'firestore.googleapis.com');a.equal(options.method,'GET');const value=url.pathname.endsWith('states/main')?s:binding;return {ok:true,json:async()=>({name:url.pathname.slice(4),fields:wire(value).mapValue.fields})};});
 await main({FIREBASE_PROJECT_ID:'fitpp-test',FIREBASE_API_KEY:'mock',FIREBASE_BOT_EMAIL:'mock',FIREBASE_BOT_PASSWORD:'mock'},['--diagnose-receipts'],{storageRoot:d});a.equal(calls.length,5);a.deepEqual(fs.readdirSync(d),[]);a(logs.some(l=>l.includes('fresh_current')));a(logs.every(l=>l.startsWith('FITPP_RECEIPT_DIAG ')));
});
test('fresh rejection distinguishes JSON key order from changed values without altering current()',t=>{
 const {d,s}=fixture(t);add(s);const fresh=structuredClone(s),id=R.DIAGNOSTIC_IDS[0],r=fresh.mutationReceipts[id];fresh.mutationReceipts[id]=Object.fromEntries(Object.entries(r).reverse());fresh.mutationReceipts[id].event=Object.fromEntries(Object.entries(r.event).reverse());
 a(has(R.diagnoseReceipts(s,binding,{directory:d,freshState:fresh,freshBinding:binding}),'fresh_receipt_key_order_changed','REJECT'));
 fresh.mutationReceipts[id].event.days=2;a(has(R.diagnoseReceipts(s,binding,{directory:d,freshState:fresh,freshBinding:binding}),'fresh_receipt_content_changed','REJECT'));a.deepEqual(fs.readdirSync(d),[]);
});
