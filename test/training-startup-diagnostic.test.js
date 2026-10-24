const {test}=require('node:test');
const assert=require('node:assert/strict');
const {at,format}=require('../src/training-startup-diagnostic');
const {main}=require('../src/fitpp-test-bridge');
const secret='PRIVATE token HMAC https://private.invalid персональные данные\nforged log';
const scope={chat:'-80345864298680',user:'1234',mid:'mid.mock001',uuid:'11111111-2222-4333-8444-555555555555'};
const env={BOT_MODE:'test',CHAT_IDS:scope.chat,TEST_BOT_TOKEN:'mock-token',TEST_EXPECTED_BOT_ID:'1',WEBHOOK_SECRET:'mock_secret_123456',FITPP_BRIDGE_ENABLED:'true',AUTO_PUBLISH:'false',TEST_ALLOW_SEND:'false',TEST_ALLOW_EDIT:'false',TEST_ALLOW_DELETE:'false',FITPP_BRIDGE_HMAC_KEY:'a'.repeat(64),FITPP_BRIDGE_URL:'https://example.test/bot/update',FITPP_BRIDGE_SCOPE:JSON.stringify(scope),FITPP_POLL_SYNC_ENABLED:'true'};
const view={...scope,date:'2026-10-26',location:'zarya',time:'20:00',revision:1,participants:[]};
const failure=()=>Object.assign(Error(secret),{code:secret,stack:secret,cause:{code:secret},stage:secret});
for(const stage of ['CONFIG','MAX_IDENTITY','BRIDGE_SNAPSHOT','MAX_POLL','LISTEN']){
 test(`real startup path classifies ${stage} with mocks only`,async()=>{
  const calls=[];
  await assert.rejects(main({env:stage==='CONFIG'?{...env,FITPP_BRIDGE_URL:secret}:env,
   verify:async()=>{calls.push('identity');if(stage==='MAX_IDENTITY')throw failure();return {syncPollText:async()=>{calls.push('poll');if(stage==='MAX_POLL')throw failure();return {edited:false}}}},
   post:async()=>{calls.push('snapshot');if(stage==='BRIDGE_SNAPSHOT')throw failure();return view},
   reconcile:()=>({stop(){calls.push('stop')}}),
   makeServer:()=>({once(name,listener){this.fail=listener},listen(){calls.push('listen');this.fail(Object.assign(failure(),{code:'EADDRINUSE'}))}})
  }),error=>{
   const line=format(error);assert.match(line,new RegExp(`^Training Test startup refused stage=${stage} code=[A-Z0-9_]+$`));
   assert.ok(!line.includes(secret));assert.ok(!line.includes(env.FITPP_BRIDGE_HMAC_KEY));
   if(stage==='LISTEN')assert.ok(line.endsWith('code=EADDRINUSE'));return true;
  });
  const expected={CONFIG:[],MAX_IDENTITY:['identity'],BRIDGE_SNAPSHOT:['identity','snapshot'],MAX_POLL:['identity','snapshot','poll'],LISTEN:['identity','snapshot','poll','listen','stop']};
  assert.deepEqual(calls,expected[stage]);
 });
}
test('fixed codes, nested stages and forged external diagnostics never expose raw data',async()=>{
 for(const [error,code] of [[failure(),'UNKNOWN'],[new SyntaxError(secret),'INVALID_JSON'],[Object.assign(failure(),{code:'ECONNRESET'}),'ECONNRESET'],[Object.assign(failure(),{cause:{code:'ENOTFOUND'}}),'ENOTFOUND'],[Object.assign(failure(),{name:'TimeoutError'}),'TIMEOUT_OR_ABORT'],[Error('TEST_IDENTITY_REFUSED'),'TEST_IDENTITY_REFUSED'],[Error('MAX HTTP 401'),'MAX_HTTP_401'],[Error('MAX HTTP 401 '+secret),'UNKNOWN']]){
  await assert.rejects(at('BRIDGE_SNAPSHOT',()=>at('MAX_POLL',()=>{throw error})),caught=>{assert.equal(format(caught),`Training Test startup refused stage=MAX_POLL code=${code}`);return true});
 }
 assert.equal(format({stage:'CONFIG',code:secret,message:secret}),'Training Test startup refused stage=UNKNOWN code=UNKNOWN');
 await assert.rejects(at(secret,()=>{throw failure()}),error=>{assert.equal(format(error),'Training Test startup refused stage=UNKNOWN code=UNKNOWN');return true});
});
test('invalid snapshot is BRIDGE_SNAPSHOT and never reaches MAX',async()=>{
 await assert.rejects(main({env,verify:async()=>({syncPollText:()=>assert.fail('MAX must not run')}),post:async()=>({...view,chat:secret})}),error=>{assert.equal(format(error),'Training Test startup refused stage=BRIDGE_SNAPSHOT code=POLL_VIEW_REJECTED');return true});
});
