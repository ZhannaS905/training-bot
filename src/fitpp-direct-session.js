'use strict';
// Preparation only: no imports of Firebase, login, or network on module load.
const OWNER_UID='lLlMAetSG1aEeJSeBl4F4ypydEh2';
function settings(env) {
 if(env.FITPP_DIRECT_ENABLED!=='true'||env.BOT_MODE!=='test')throw Error('DIRECT_DISABLED');
 if(env.FIREBASE_PROJECT_ID!=='fitpp-test')throw Error('TEST_PROJECT_REQUIRED');
 if(env.OWNER_DIALOG_ENABLED!==undefined&&env.OWNER_DIALOG_ENABLED!=='false')throw Error('OWNER_DIALOG_MUST_STAY_DISABLED');
 for(const k of ['AUTO_PUBLISH','TEST_ALLOW_SEND','TEST_ALLOW_EDIT','TEST_ALLOW_DELETE'])if(env[k]!=='false')throw Error('POLL_WRITES_MUST_BE_DISABLED');
 for(const k of ['FIREBASE_API_KEY','FIREBASE_BOT_UID','FIREBASE_BOT_EMAIL','FIREBASE_BOT_PASSWORD'])if(typeof env[k]!=='string'||!env[k].trim())throw Error(k+'_REQUIRED');
 if(env.FIREBASE_BOT_UID!==OWNER_UID)throw Error('EXPECTED_TEST_UID_REQUIRED');
 return {apiKey:env.FIREBASE_API_KEY,projectId:'fitpp-test',authDomain:'fitpp-test.firebaseapp.com',uid:env.FIREBASE_BOT_UID,email:env.FIREBASE_BOT_EMAIL,password:env.FIREBASE_BOT_PASSWORD};
}
async function connect({env,sdk}) {
 const c=settings(env);
 let app;
 try {app=sdk.initializeApp({apiKey:c.apiKey,projectId:c.projectId,authDomain:c.authDomain},'training-test-direct')}catch{throw Error('DIRECT_AUTH_CONNECTION_REJECTED')}
 let auth,raw;
 let closed=false;
 const close=async()=>{if(closed)return;closed=true;for(const action of [()=>auth&&sdk.signOut(auth),()=>raw&&sdk.terminate(raw),()=>sdk.deleteApp(app)]){try{await action()}catch{ /* Never expose SDK errors or credentials. */ }}};
 try {
  auth=sdk.initializeAuth(app,{persistence:sdk.inMemoryPersistence});
  const result=await sdk.signInWithEmailAndPassword(auth,c.email,c.password);
  async function validateAuth() {
   try {
    const user=auth.currentUser;
    if(closed||user?.uid!==OWNER_UID||result.user.uid!==OWNER_UID)throw Error();
    // SDK refreshes expired/soon-expiring tokens here, including after idle periods.
    const token=await user.getIdTokenResult();
    if(closed||auth.currentUser!==user||token.claims.aud!=='fitpp-test'||token.claims.iss!=='https://securetoken.google.com/fitpp-test'||token.claims.sub!==OWNER_UID)throw Error();
   }catch{throw Error('BOT_AUTH_REQUIRED')}
  }
  await validateAuth();
  raw=sdk.getFirestore(app);
  const {createDirectDb}=require('./fitpp-direct-db');
  const db=createDirectDb({sdk,raw,projectId:c.projectId,botUid:c.uid,validateAuth,getUid:()=>auth.currentUser?.uid,writeEnabled:()=>env.FITPP_DIRECT_WRITES_ENABLED==='true',dailyBotId:env.TRAINING_TEST_AUTOPOST_ENABLED==='true'?env.TEST_EXPECTED_BOT_ID:undefined});
  // Firebase client SDK owns refresh lifecycle. Never persist or log tokens.
  // Separate capability: never widen the booking adapter's paths or write flag.
  function contactStore(botId,{writeEnabled=()=>false}={}) {
   const {firebaseStore,MAIN,LINKS}=require('./contact-linking');
   const guarded={doc(database,path){
    if(database!==raw||![MAIN,LINKS].includes(path))throw Error('CONTACT_PATH_REFUSED');
    return sdk.doc(raw,path);
   },runTransaction:async(database,fn)=>{
    if(database!==raw)throw Error('CONTACT_PATH_REFUSED');
    await validateAuth();
    return sdk.runTransaction(raw,async tx=>{
     await validateAuth();
     const value=await fn({get:ref=>tx.get(ref),set(ref,data){
      if(ref.path!==LINKS||!writeEnabled())throw Error('CONTACT_WRITES_DISABLED');
      tx.set(ref,data);
     }});
     await validateAuth();return value;
    },{maxAttempts:5});
   }};
   return firebaseStore({sdk:guarded,db:raw,botId});
  }
  // Independent capability: the booking adapter and its write flag remain unchanged.
  function autopostStore(botId,{writeEnabled=()=>false,now=Date.now}={}) {
   return require('./training-test-firestore').createFirestoreStore({sdk,raw,botId,validateAuth,writeEnabled,now});
  }
  return {db,contactStore,autopostStore,close};
 } catch(error) {await close();const safe=require('./fitpp-direct-diagnostic').mark(error,'CONNECT');safe.message='DIRECT_AUTH_CONNECTION_REJECTED';throw safe}
}
module.exports={settings,connect,OWNER_UID};
