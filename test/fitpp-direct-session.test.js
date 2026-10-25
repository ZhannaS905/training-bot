'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {settings,connect,OWNER_UID}=require('../src/fitpp-direct-session');
const {prepare}=require('../src/fitpp-direct-runtime');
const env=()=>({BOT_MODE:'test',FITPP_DIRECT_ENABLED:'true',FIREBASE_PROJECT_ID:'fitpp-test',FIREBASE_API_KEY:'synthetic-key',FIREBASE_BOT_UID:OWNER_UID,FIREBASE_BOT_EMAIL:'bot@example.invalid',FIREBASE_BOT_PASSWORD:'synthetic-password',AUTO_PUBLISH:'false',TEST_ALLOW_SEND:'false',TEST_ALLOW_EDIT:'false',TEST_ALLOW_DELETE:'false'});
function fixture(uid=OWNER_UID,project='fitpp-test') {
 const calls=[],user={uid,getIdTokenResult:async()=>({claims:{aud:project,iss:'https://securetoken.google.com/'+project,sub:uid}})},auth={currentUser:user};
 const sdk={initializeApp:c=>(calls.push('init'),{options:c}),initializeAuth:()=>auth,inMemoryPersistence:{},signInWithEmailAndPassword:async()=>{calls.push('login');return {user}},getFirestore:app=>({app}),signOut:async()=>calls.push('logout'),terminate:async()=>calls.push('terminate'),deleteApp:async()=>calls.push('delete'),doc:(_,p)=>p,getDocFromServer:async()=>({exists:()=>true,data:()=>({})})};
 return {sdk,calls,auth};
}
test('disabled, production, other identity and missing credentials refuse before SDK access',async()=>{
 for(const change of [{FITPP_DIRECT_ENABLED:'false'},{FIREBASE_PROJECT_ID:'fitpp'},{FIREBASE_PROJECT_ID:'fitpp-crm'},{FIREBASE_BOT_UID:'other'},{FIREBASE_BOT_PASSWORD:''},{OWNER_DIALOG_ENABLED:'true'},{TEST_ALLOW_SEND:'true'}]) {
  const f=fixture();await assert.rejects(()=>connect({env:{...env(),...change},sdk:f.sdk}));assert.deepEqual(f.calls,[]);
 }
 assert.equal(settings(env()).projectId,'fitpp-test');
});
test('wrong uid or token project signs out and destroys app',async()=>{
 for(const f of [fixture('other'),fixture(OWNER_UID,'fitpp')]){await assert.rejects(()=>connect({env:env(),sdk:f.sdk}),/REJECTED/);assert.deepEqual(f.calls,['init','login','logout','delete']);}
});
test('client session defaults to no writes and refuses identity loss',async()=>{
 const f=fixture(),s=await connect({env:env(),sdk:f.sdk});
 assert.equal((await s.db.doc('fitppTestWorkspaces/synthetic-v1/states/main').get()).exists,true);
 f.auth.currentUser=null;await assert.rejects(()=>s.db.doc('fitppTestWorkspaces/synthetic-v1/states/main').get(),/BOT_AUTH/);
 await s.close();assert.deepEqual(f.calls,['init','login','logout','terminate','delete']);
});
test('composition refuses closed poll before login',async()=>{
 const f=fixture();await assert.rejects(()=>prepare({env:{...env(),FITPP_BRIDGE_ENABLED:'true',FITPP_BRIDGE_HMAC_KEY:'a'.repeat(64),CHAT_IDS:'-80345864298680',FITPP_BRIDGE_SCOPE:JSON.stringify({chat:'-80345864298680',user:'5819064',mid:'mid.ffffb6ed054c9f4801a169a000563611',uuid:'99732d34-b609-4266-9418-f12de9b3fe62'}),FITPP_DIRECT_POLL_OPENED_AT:'1792880000000'},sdk:f.sdk,now:()=>Date.parse('2026-10-27')}),/POLL_CLOSED/);assert.deepEqual(f.calls,[]);
});
test('existing test account uses memory auth and credentials only for SDK login',async()=>{
 const f=fixture();let received;
 f.sdk.initializeAuth=(app,options)=>{assert.equal(options.persistence,f.sdk.inMemoryPersistence);assert.equal(app.options.projectId,'fitpp-test');return f.auth};
 f.sdk.signInWithEmailAndPassword=async(a,email,password)=>{received={a,email,password};return {user:f.auth.currentUser}};
 const s=await connect({env:env(),sdk:f.sdk});assert.equal(received.a,f.auth);assert.equal(received.email,env().FIREBASE_BOT_EMAIL);assert.equal(received.password,env().FIREBASE_BOT_PASSWORD);
 await s.close();await s.close();assert.equal(f.calls.filter(x=>x==='delete').length,1);
});
test('SDK token refresh checked on every access, rejects changed claims and refresh failure',async()=>{
 for(const mode of ['project','issuer','subject','failure','identity']) {
  const f=fixture(),s=await connect({env:env(),sdk:f.sdk});let refreshes=0;
  f.auth.currentUser.getIdTokenResult=async()=>{refreshes++;if(mode==='failure')throw Error('synthetic-password private-token');
   const claims={aud:'fitpp-test',iss:'https://securetoken.google.com/fitpp-test',sub:OWNER_UID};
   if(mode==='project')claims.aud='fitpp';if(mode==='issuer')claims.iss='https://securetoken.google.com/fitpp';if(mode==='subject')claims.sub='other';
   if(mode==='identity')f.auth.currentUser=null;
   return {claims};};
  await assert.rejects(()=>s.db.doc('fitppTestWorkspaces/synthetic-v1/states/main').get(),e=>e.message==='BOT_AUTH_REQUIRED');assert.equal(refreshes,1);await s.close();
 }
});
test('valid refreshed token continues reads without another password login',async()=>{
 const f=fixture(),s=await connect({env:env(),sdk:f.sdk});let refreshed=0;
 f.auth.currentUser.getIdTokenResult=async()=>{refreshed++;return {claims:{aud:'fitpp-test',iss:'https://securetoken.google.com/fitpp-test',sub:OWNER_UID}}};
 for(let i=0;i<3;i++)await s.db.doc('fitppTestWorkspaces/synthetic-v1/states/main').get();
 assert.equal(refreshed,3);assert.equal(f.calls.filter(x=>x==='login').length,1);await s.close();
});
test('login and cleanup errors cannot expose secrets',async()=>{
 const f=fixture();f.sdk.signInWithEmailAndPassword=async()=>{throw Error('synthetic-password private-token')};f.sdk.signOut=async()=>{throw Error('private-token')};
 await assert.rejects(()=>connect({env:env(),sdk:f.sdk}),e=>e.message==='DIRECT_AUTH_CONNECTION_REJECTED');assert.ok(f.calls.includes('delete'));
});
