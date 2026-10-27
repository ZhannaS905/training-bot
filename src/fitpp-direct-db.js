'use strict';
// SDK supplied by composition root; no SDK import, ADC, credentials or network on import.
const {at}=require('./fitpp-direct-diagnostic');
const PREFIX='fitppTestWorkspaces/synthetic-v1/';
function checkPath(path,write=false){
 const readOnly=['states/main','maxBindings','maxClientBindings','maxPolls'];
 if(typeof path!=='string'||!path.startsWith(PREFIX))throw Error('PATH_REJECTED');
 const tail=path.slice(PREFIX.length);
 if(!/^states\/(main|bookings|bookingClock)$/.test(tail)&&! /^(maxBindings|maxClientBindings|maxPolls|maxEvents|bookingVersions)\/[a-f0-9]{64}$/.test(tail))throw Error('PATH_REJECTED');
 // main is writable only for the existing atomic bookingFreeze path.
 if(write&&readOnly.slice(1).some(x=>tail.startsWith(x+'/')))throw Error('BINDING_READ_ONLY');
 return path;
}
function createDirectDb({sdk,raw,projectId,botUid,ownerUid,validateAuth,writeEnabled=()=>false,getUid,dailyBotId}) {
 if(projectId!=='fitpp-test'||raw?.app?.options?.projectId!=='fitpp-test'||!botUid||botUid===ownerUid)throw Error('DEDICATED_TEST_IDENTITY_REQUIRED');
 if(typeof getUid!=='function')throw Error('AUTH_PROVIDER_REQUIRED');
 const auth=async()=>{if(getUid()!==botUid)throw Error('BOT_AUTH_REQUIRED');if(validateAuth)await validateAuth();if(getUid()!==botUid)throw Error('BOT_AUTH_REQUIRED')};
 const dailyPath=path=>typeof dailyBotId==='string'&&/^[1-9]\d*$/.test(dailyBotId)&&new RegExp('^trainingTestAutopostBots/'+dailyBotId+'/polls/\\d{4}-\\d{2}-\\d{2}$').test(path);
 const checkedPath=(path,write=false)=>{if(dailyPath(path)){if(write)throw Error('DAILY_POLL_READ_ONLY');return path}return checkPath(path,write)};
 const check=ref=>{if(ref?._owner!==db)throw Error('REF_REJECTED');checkedPath(ref.path);return sdk.doc(raw,ref.path)};
 const wrap=s=>({exists:s.exists(),data:()=>s.data()});
 const db={doc(path){checkedPath(path);return {path,_owner:db,get:async()=>{await auth();return wrap(await sdk.getDocFromServer(sdk.doc(raw,path)))} }},
 async runTransaction(fn){await auth();return sdk.runTransaction(raw,async tx=>{await auth();
  const seen=new Map(),ctx={get:async ref=>{const stage={'states/main':'READ_MAIN','states/bookings':'READ_BOOKINGS','states/bookingClock':'READ_CLOCK'}[ref?.path?.slice(PREFIX.length)];const s=await at(stage,()=>tx.get(check(ref)));seen.set(ref.path,s.exists());return wrap(s)}};
  for(const kind of ['set','update','create'])ctx[kind]=(ref,data)=>{
   const native=check(ref);checkedPath(ref.path,true);
   if(!writeEnabled())throw Error('DIRECT_WRITES_DISABLED');
   if(kind==='create'&&seen.get(ref.path)!==false)throw Error('CREATE_REQUIRES_ABSENCE_READ');
   if(kind==='update')tx.update(native,data);else tx.set(native,data);return ctx;
  };
  const value=await fn(ctx);await auth();return value;
 },{maxAttempts:5})}};
 return db;
}
module.exports={createDirectDb,checkPath};
