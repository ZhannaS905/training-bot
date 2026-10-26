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

async function captureLogs(run) {
  const original=console.log,lines=[];
  console.log=line=>lines.push(line);
  try {await run(lines);} finally {console.log=original;}
}
function snapshotResponse(snapshots, failAt = -1) {
  let reads=0;
  return (url,options,n)=>{
    if(n===1)return ok({localId:'lLlMAetSG1aEeJSeBl4F4ypydEh2',idToken:token()});
    if(n===failAt)return {ok:false,status:403};
    assert.equal(options.method,'GET');
    assert.match(url,/^https:\/\/firestore.googleapis.com\/v1\/projects\/fitpp-test\//);
    const value=reads++%2===0?snapshots[Math.floor((reads-1)/2)]:binding;
    return ok({name:url.split('/v1/')[1],fields:wire(value).mapValue.fields});
  };
}
test('--checks 4 reads baseline plus three snapshots with exactly three 30-second waits',async()=>{
  const after=state(5,mark('bounded-operation'),visits());
  await captureLogs(async lines=>mocked(async calls=>{
    const waits=[];
    await cli.main(env,['--checks','4'],{wait:async ms=>{waits.push(ms);assert.equal(calls.length,1+waits.length*2);}});
    assert.deepEqual(waits,[30000,30000,30000]);
    assert.equal(calls.length,9); // one Auth POST, eight Firestore GETs
    assert.deepEqual(lines,[
      'FITPP_DRY_RUN_BASELINE_OK','FITPP_DRY_RUN_CHECK_OK previews=1',
      'FITPP_PREVIEW_ONLY remaining=5','FITPP_DRY_RUN_CHECK_OK previews=0',
      'FITPP_DRY_RUN_CHECK_OK previews=0'
    ]);
  },snapshotResponse([state(6),after,after,after])));
});
test('--checks 1 performs only baseline without waiting',async()=>{
  await captureLogs(async lines=>mocked(async calls=>{
    await cli.main(env,['--checks','1'],{wait:()=>assert.fail('unexpected wait')});
    assert.equal(calls.length,3);assert.deepEqual(lines,['FITPP_DRY_RUN_BASELINE_OK']);
  },snapshotResponse([state(6)])));
});
test('--checks rejects invalid, missing, conflicting and excessive arguments before network',async()=>{
  await mocked(async calls=>{
    for(const args of [['--checks'],['--checks','0'],['--checks','-1'],['--checks','1.5'],
      ['--checks','NaN'],['--checks','Infinity'],['--checks','9007199254740992'],
      ['--checks','4','--watch'],['--watch','--checks','4'],['--checks','4','extra']])
      await assert.rejects(()=>cli.main(env,args),/ARGUMENT_REFUSED/);
    assert.equal(calls.length,0);
  },()=>assert.fail('network reached'));
});
test('--checks stops immediately on a later Firestore error',async()=>{
  await captureLogs(async lines=>mocked(async calls=>{
    const waits=[];
    await assert.rejects(()=>cli.main(env,['--checks','4'],{wait:async ms=>waits.push(ms)}),/HTTP_403/);
    assert.equal(calls.length,4);assert.deepEqual(waits,[30000]);
    assert.deepEqual(lines,['FITPP_DRY_RUN_BASELINE_OK']);
  },snapshotResponse([state(6)],4)));
});
test('--watch remains unbounded with unchanged active diagnostic and sequential 30-second waits',async()=>{
  await captureLogs(async lines=>mocked(async calls=>{
    let waits=0;
    await assert.rejects(()=>cli.main(env,['--watch'],{wait:async ms=>{
      assert.equal(ms,30000);if(++waits===5)throw Error('TEST_STOP');
    }}),/TEST_STOP/);
    assert.equal(calls.length,11); // baseline and four additional checks
    assert.equal(lines[0],'FITPP_DRY_RUN_BASELINE_OK');
    assert.equal(lines[1],'FITPP_DRY_RUN_WATCH_ACTIVE no_max_send no_firestore_write');
    assert.deepEqual(lines.slice(2),Array(4).fill('FITPP_DRY_RUN_CHECK_OK previews=0'));
  },snapshotResponse(Array(5).fill(state(6)))));
});
test('--checks 4 actual CLI exits 0; later HTTP or network error exits 1 with safe output',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fitpp-bounded-test-'));
  try {
    for(const failure of ['none','http','network']) {
      const hook=path.join(dir,'fetch.cjs');
      const auth={localId:'lLlMAetSG1aEeJSeBl4F4ypydEh2',idToken:token()};
      const fields=wire(state(6)).mapValue.fields,bindingFields=wire(binding).mapValue.fields;
      fs.writeFileSync(hook,`
        const original=setTimeout;
        global.setTimeout=(fn,ms,...args)=>original(fn,ms===30000?0:ms,...args);
        let calls=0;
        global.fetch=async(url,options)=>{
          calls++;
          if(calls===1)return {ok:true,json:async()=>(${JSON.stringify(auth)})};
          if(calls===4&&${JSON.stringify(failure)}==='network')throw Error('fake-secret private-name');
          if(calls===4&&${JSON.stringify(failure)}==='http')return {ok:false,status:403};
          if(options.method!=='GET'||!url.startsWith('https://firestore.googleapis.com/v1/projects/fitpp-test/'))throw Error('unsafe request');
          return {ok:true,json:async()=>({name:url.split('/v1/')[1],fields:calls%2===0?${JSON.stringify(fields)}:${JSON.stringify(bindingFields)}})};
        };`);
      const result=spawnSync(process.execPath,['--require',hook,path.resolve(__dirname,'../fitpp-notification-preview.cjs'),'--checks','4'],
        {env:{...env},encoding:'utf8',timeout:5000});
      assert.equal(result.error,undefined);
      assert.equal(result.status,failure==='none'?0:1);
      if(failure==='none') {
        assert.equal(result.stderr,'');
        assert.deepEqual(result.stdout.trim().split('\n'),['FITPP_DRY_RUN_BASELINE_OK',...Array(3).fill('FITPP_DRY_RUN_CHECK_OK previews=0')]);
      } else {
        assert.equal(result.stdout.trim(),'FITPP_DRY_RUN_BASELINE_OK');
        assert.equal(result.stderr.trim(),'FITPP_DRY_RUN_FAILED '+(failure==='http'?'HTTP_403':'CHECK_FAILED'));
      }
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});


test('diagnostics report skipped revisions and visible operations without changing eligibility', () => {
  const before=state(6),after=state(5,mark('private-operation'),visits());
  after._fitppRevision=before._fitppRevision+2;
  after.clients[0].name='PRIVATE_NAME';
  const session=createPreviewSession({diagnose:true});
  const baseline=session.check(before,binding);
  assert.deepEqual(baseline.diagnostics.reasons,{BASELINE_ONLY:1});
  const result=session.check(after,binding);
  assert.equal(result.candidates.length,0);
  assert.equal(result.diagnostics.beforeRevision,before._fitppRevision);
  assert.equal(result.diagnostics.afterRevision,after._fitppRevision);
  assert.equal(result.diagnostics.afterPilotVisitOps,1);
  assert.equal(result.diagnostics.reasons.REVISION_NOT_PLUS_ONE,1);
  assert.doesNotMatch(JSON.stringify(result.diagnostics),/private-operation|PRIVATE_NAME|demo-client|subscription-demo|126619382|5819064/);
  const unchanged=session.check(after,binding);
  assert.equal(unchanged.diagnostics.reasons.OPERATION_ALREADY_IN_BEFORE,1);
  assert.equal(unchanged.diagnostics.beforeRevision,after._fitppRevision);
});
test('diagnostics identify each operation filter and retain the same preview result', () => {
  const before=state(6),after=state(5,mark('new-operation'),visits());
  const cases=[
    ['NOT_ATTENDED',s=>{s.visitOps[WORKOUT][CLIENT].status='missed';}],
    ['OPERATION_FIELDS_INVALID',s=>{s.visitOps[WORKOUT][CLIENT].operationId='x';}],
    ['DUPLICATE_OPERATION_ID',s=>{s.attendanceOps.other={[CLIENT]:{operationId:'new-operation'}};}],
    ['MONEY_CHARGE',s=>{s.visitOps[WORKOUT][CLIENT].moneyChargeId='PRIVATE';}],
    ['WORKOUT_MISMATCH',s=>{s.workouts[WORKOUT].cancelled=true;}],
    ['SUBSCRIPTION_MISSING_AMBIGUOUS_OR_ARCHIVED',s=>{s.clients[0].archivedAt='PRIVATE';}],
    ['SUBSCRIPTION_TERMS_CHANGED',s=>{s.clients[0].subscriptions[0].price=5;}],
    ['OTHER_CLIENT_VISITS_CHANGED',s=>{s.visits.other={[CLIENT]:'missed'};}],
    ['BALANCE_NOT_MINUS_ONE',s=>{s.clients[0].subscriptions[0].left=6;}]
  ];
  for (const [reason,mutate] of cases) {
    const next=structuredClone(after);mutate(next);
    const session=createPreviewSession({diagnose:true});session.check(before,binding);
    const result=session.check(next,binding);
    assert.equal(result.diagnostics.reasons[reason],1,reason);
    assert.deepEqual(result.candidates,previewDeductions(before,next,binding));
  }
  const session=createPreviewSession({diagnose:true});session.check(before,{...binding,bindings:[]});
  const result=session.check(after,{...binding,bindings:[]});
  assert.equal(result.diagnostics.reasons.BINDING_NOT_APPROVED,1);
  assert.deepEqual(result.candidates,[]);
});
test('--diagnose --checks emits safe diagnostics for baseline and unchanged snapshot using only test GETs',async()=>{
  await captureLogs(async lines=>mocked(async calls=>{
    await cli.main(env,['--diagnose','--checks','2'],{wait:async()=>{}});
    assert.equal(calls.length,5);
    const diagnostics=lines.filter(line=>line.startsWith('FITPP_DRY_RUN_DIAGNOSTIC '))
      .map(line=>JSON.parse(line.slice('FITPP_DRY_RUN_DIAGNOSTIC '.length)));
    assert.equal(diagnostics.length,2);
    assert.equal(diagnostics[0].reasons.BASELINE_ONLY,1);
    assert.equal(diagnostics[1].reasons.REVISION_NOT_PLUS_ONE,1);
    assert.equal(diagnostics[1].reasons.NO_PILOT_VISIT_OPS,1);
    assert.doesNotMatch(lines.join(' '),/fake-secret|fake-key|fake@example|demo-client|126619382|5819064/);
  },snapshotResponse([state(6),state(6)])));
  await assert.rejects(()=>cli.main(env,['--diagnose','--diagnose']),/ARGUMENT_REFUSED/);
});
