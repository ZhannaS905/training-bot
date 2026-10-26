'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { previewDeductions, createPreviewSession } = require('../src/fitpp-notification-dry-run.cjs');
const { decodeFields, config } = require('../fitpp-notification-preview.cjs');

const CLIENT = 'demo-client-1';
const SUB = 'subscription-demo-sale-demo-client-1';
const WORKOUT = 'online_2026-10-24';
const binding = { version: 1, botId: 131384398, bindings: [{
  clientId: CLIENT, maxChatId: 126619382, maxUserId: 5819064, notificationsEnabled: true
}] };
function state(left, ops = {}, visits = {}) {
  return { ...structuredClone(require('../direct-core/fixtures/main.json')),
    _fitppRevision: 8-left, clients: [{ id: CLIENT, subscriptions: [{ id: SUB, left }] }], visitOps: ops, visits,
    workouts: { [WORKOUT]: {id:WORKOUT,date:'2026-10-24',location:'online',cancelled:false} } };
}
function mark(operationId, status = 'attended') {
  return { [WORKOUT]: { [CLIENT]: { operationId, subscriptionId: SUB, workoutId: WORKOUT, status, location: 'online' } } };
}
function visits(status = 'attended') { return { [WORKOUT]: { [CLIENT]: status } }; }

test('first read is baseline and cannot notify historical operations', () => {
  assert.deepEqual(previewDeductions(null, state(5, mark('old-operation'), visits()), binding), []);
});
test('new attended operation with one confirmed decrement previews once', () => {
  const result = previewDeductions(state(6), state(5, mark('new-operation'), visits()), binding);
  assert.equal(result.length, 1);
  assert.equal(result[0].remaining, 5);
  assert.equal(result[0].operationId, 'new-operation');
});
test('unchanged operation is not previewed after unrelated edits', () => {
  const before = state(5, mark('old-operation'), visits());
  assert.deepEqual(previewDeductions(before, state(5, mark('old-operation'), visits()), binding), []);
});
test('reverted or unpaid marks do not produce a deduction preview', () => {
  assert.deepEqual(previewDeductions(state(5, mark('old-operation'), visits()), state(6), binding), []);
  assert.deepEqual(previewDeductions(state(6), state(6, mark('new-operation'), visits()), binding), []);
  assert.deepEqual(previewDeductions(state(6), state(5, mark('new-operation', 'razov'), visits('razov')), binding), []);
  assert.deepEqual(previewDeductions(state(6), state(5, mark('new-operation', 'missed'), visits('missed')), binding), []);
});
test('no preview without explicit enabled test-client binding', () => {
  assert.deepEqual(previewDeductions(state(6), state(5, mark('new-operation'), visits()),
    { ...binding, bindings: [{ ...binding.bindings[0], notificationsEnabled: false }] }), []);
  assert.deepEqual(previewDeductions(state(6), state(5, mark('new-operation'), visits()),
    { ...binding, botId: 123 }), []);
});
test('ambiguous multi-operation transition fails closed', () => {
  const second = 'zarya_2026-10-26';
  const after = state(4, { ...mark('first-op'), [second]: { [CLIENT]: {
    operationId: 'second-op', subscriptionId: SUB, status: 'attended'
  } } }, { ...visits(), [second]: { [CLIENT]: 'attended' } });
  assert.deepEqual(previewDeductions(state(6), after, binding), []);
});
test('Firestore REST values decode without leaking unrelated fields', () => {
  const decoded = decodeFields({ left: { integerValue: '5' },
    enabled: { booleanValue: true },
    rows: { arrayValue: { values: [{ mapValue: { fields: { status: { stringValue: 'attended' } } } }] } } });
  assert.deepEqual(decoded, { left: 5, enabled: true, rows: [{ status: 'attended' }] });
});
test('preview configuration refuses any non-test project', () => {
  assert.throws(() => config({ FIREBASE_PROJECT_ID: 'fitpp-165a2' }), /PROJECT_REFUSED/);
});

test('recipient must match exact approved Training Test pilot identity', () => {
  const before = state(6);
  const after = state(5, mark('new-operation'), visits());
  assert.deepEqual(previewDeductions(before, after, { ...binding, bindings: [{
    ...binding.bindings[0], maxUserId: 999
  }] }), []);
  assert.deepEqual(previewDeductions(before, after, { ...binding, bindings: [{
    ...binding.bindings[0], maxChatId: 999
  }] }), []);
});
test('moving a historical operation to another workout never previews as new', () => {
  const oldWorkout = 'online_2026-10-24';
  const before = state(6, { [oldWorkout]: { [CLIENT]: {
    operationId: 'reused-operation', subscriptionId: SUB, status: 'attended'
  } } }, { [oldWorkout]: { [CLIENT]: 'attended' } });
  const after = state(5, mark('reused-operation'), visits());
  assert.deepEqual(previewDeductions(before, after, binding), []);
});


test('invalid initial snapshot fails before baseline acknowledgement', () => {
  for (const invalid of [{}, {...state(6),visitOps:[]}, {...state(6),visits:null}, {...state(6),datasetId:'production'}]) {
    assert.throws(()=>createPreviewSession().check(invalid,binding),/STATE_REFUSED/);
  }
});
test('corrections and cancellation mixed with another decrement fail closed', () => {
  assert.deepEqual(previewDeductions(state(6,mark('old-operation','missed'),visits('missed')),
    state(5,mark('new-operation'),visits()),binding),[]);
  const before=state(6),after=state(5,mark('new-operation'),visits());
  before.visitOps.other={[CLIENT]:{operationId:'cancelled-op',subscriptionId:SUB,status:'attended'}};
  before.visits.other={[CLIENT]:'attended'};
  assert.deepEqual(previewDeductions(before,after,binding),[]);
});
test('session remembers old IDs after cancellation and reappearance', () => {
  const session=createPreviewSession();
  assert.equal(session.check(state(6),binding).baseline,true);
  assert.equal(session.check(state(5,mark('new-operation'),visits()),binding).candidates.length,1);
  const cancelled=state(6);cancelled._fitppRevision=4;
  assert.equal(session.check(cancelled,binding).candidates.length,0);
  const replay=state(5,mark('new-operation'),visits());replay._fitppRevision=5;
  assert.equal(session.check(replay,binding).candidates.length,0);
});
test('unknown workout, duplicate IDs, money charge, changed terms and skipped revision do not preview', () => {
  const before=state(6),after=state(5,mark('new-operation'),visits());
  for (const mutate of [
    s=>{s.workouts={};},s=>{s.workouts[WORKOUT].cancelled=true;},
    s=>{s.visitOps[WORKOUT][CLIENT].moneyChargeId='charge';},
    s=>{s.visitOps[WORKOUT].other={operationId:'new-operation'};},
    s=>{s.clients[0].subscriptions[0].price=100;},s=>{s._fitppRevision+=1;},
    s=>{s.visitOps[WORKOUT][CLIENT].workoutId='other';},
    s=>{s.clients[0].archivedAt='2026-10-24';}
  ]) {const candidate=structuredClone(after);mutate(candidate);assert.deepEqual(previewDeductions(before,candidate,binding),[]);}
});
test('real bundled FitPP reducer: deduction, undo and new attendance', () => {
  const store=require('../direct-core/FitPP-Test/persistence.js');
  const before=structuredClone(require('../direct-core/fixtures/main.json'));
  const action={type:'attendance',workoutId:WORKOUT,clientId:CLIENT,status:'attended',date:'2026-10-24',location:'online'};
  const after=store.reduce(before,action,'2026-10-24');after._fitppRevision=before._fitppRevision+1;
  const session=createPreviewSession();session.check(before,binding);
  const result=session.check(after,binding);assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].remaining,before.clients[0].subscriptions[0].left-1);
  const undone=store.reduce(after,action,'2026-10-24');undone._fitppRevision=after._fitppRevision+1;
  assert.equal(session.check(undone,binding).candidates.length,0);
  const repeated=store.reduce(undone,action,'2026-10-24');repeated._fitppRevision=undone._fitppRevision+1;
  assert.equal(session.check(repeated,binding).candidates.length,1);
});

const cli=require('../fitpp-notification-preview.cjs');
const env={FIREBASE_API_KEY:'fake-key',FIREBASE_BOT_EMAIL:'fake@example.invalid',FIREBASE_BOT_PASSWORD:'fake-secret'};
const token=(aud='fitpp-test')=>'header.'+Buffer.from(JSON.stringify({aud,iss:'https://securetoken.google.com/'+aud,
  sub:'lLlMAetSG1aEeJSeBl4F4ypydEh2',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
function wire(v) {
  if(v===null)return {nullValue:null};if(Array.isArray(v))return {arrayValue:{values:v.map(wire)}};
  if(typeof v==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wire(x)]))}};
  return typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:{integerValue:String(v)};
}
async function mocked(run,respond) {
  const original=global.fetch,calls=[];
  global.fetch=async(url,options)=>{calls.push({url,options});return respond(url,options,calls.length);};
  try {await run(calls);} finally {global.fetch=original;}
}
const ok=value=>({ok:true,json:async()=>value});
test('CLI baseline uses exactly Auth POST and two fixed test GETs; never MAX or bot imports',async()=>{
  await mocked(async calls=>{
    await cli.main(env,[]);assert.equal(calls.length,3);
    assert.equal(calls[0].options.method,'POST');
    for(const c of calls.slice(1)){assert.equal(c.options.method,'GET');assert.match(c.url,/^https:\/\/firestore.googleapis.com\/v1\/projects\/fitpp-test\//);}
    assert.ok(calls.every(c=>c.options.redirect==='error'));
  },(url,opts,n)=> n===1?ok({localId:'lLlMAetSG1aEeJSeBl4F4ypydEh2',idToken:token()}):
    ok({name:url.split('/v1/')[1],fields:wire(n===2?state(6):binding).mapValue.fields}));
});
test('Auth 400/401 and Firestore 403/404 fail closed',async()=>{
  for(const status of [400,401,403,404]) await mocked(async calls=>{
    await assert.rejects(()=>cli.main(env,[]),new RegExp('HTTP_'+status));
    assert.equal(calls.length,status<403?1:2);
  },(url,opts,n)=>n===1&&status>=403?ok({localId:'lLlMAetSG1aEeJSeBl4F4ypydEh2',idToken:token()}):{ok:false,status});
});
test('wrong token project is refused before any Firestore request',async()=>{
  await mocked(async calls=>{await assert.rejects(()=>cli.main(env,[]),/TOKEN_REFUSED/);assert.equal(calls.length,1);},
    ()=>ok({localId:'lLlMAetSG1aEeJSeBl4F4ypydEh2',idToken:token('fitpp-crm')}));
});
test('wrong document project or path and invalid CLI arguments are refused',async()=>{
  await assert.rejects(()=>cli.main(env,['--send']),/ARGUMENT_REFUSED/);
  await mocked(async()=>{await assert.rejects(()=>cli.main(env,[]),/PATH_REFUSED/);},(url,opts,n)=>n===1?
    ok({localId:'lLlMAetSG1aEeJSeBl4F4ypydEh2',idToken:token()}):ok({name:'projects/fitpp-crm/databases/(default)/documents/fitppTestWorkspaces/synthetic-v1/states/main',fields:{}}));
});
test('network failures and malformed JSON propagate without success',async()=>{
  await mocked(async()=>{await assert.rejects(()=>cli.main(env,[]));},()=>{throw Error('fake-secret');});
  await mocked(async()=>{await assert.rejects(()=>cli.main(env,[]));},()=>({ok:true,json:async()=>{throw Error('malformed');}}));
});

test('missing or unknown binding fails closed; disabled binding remains untouched',()=>{
  for(const b of [null,{}, {...binding,bindings:[{}]}])
    assert.throws(()=>createPreviewSession().check(state(6),b),/BINDING_REFUSED/);
  const disabled=structuredClone(binding);disabled.bindings[0].notificationsEnabled=false;
  const session=createPreviewSession();session.check(state(6),disabled);
  assert.equal(session.check(state(5,mark('new-operation'),visits()),disabled).candidates.length,0);
  assert.equal(disabled.bindings[0].notificationsEnabled,false);
});
test('CLI error output never includes credentials or transport error details',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fitpp-preview-test-'));
  try {
    const hook=path.join(dir,'fetch.cjs');fs.writeFileSync(hook,"global.fetch=async()=>{throw Error('fake-secret fake-key private-name')};");
    const result=spawnSync(process.execPath,['--require',hook,path.resolve(__dirname,'../fitpp-notification-preview.cjs')],
      {env:{...env},encoding:'utf8'});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.equal(result.stderr.trim(),'FITPP_DRY_RUN_FAILED CHECK_FAILED');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
