'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Attendance}=require('../direct-core/src/attendance.cjs');
const {MAIN}=require('../direct-core/src/service.cjs');
const {createPreviewSession}=require('../src/fitpp-notification-dry-run.cjs');
const UID='lLlMAetSG1aEeJSeBl4F4ypydEh2';
function setup(){
 const before=structuredClone(require('../direct-core/fixtures/main.json'));
 before._fitppRevision=89;
 const workoutId='online_2026-10-24';
 before.workouts[workoutId]={id:workoutId,date:'2026-10-24',originDate:'2026-10-24',time:'18:00',location:'online',cancelled:false};
 let main=structuredClone(before),writes=0;
 const db={doc:path=>({path}),async runTransaction(fn){let pending;
 const result=await fn({get:async ref=>({exists:true,data:()=>structuredClone(ref.path===MAIN?main:{ownerUid:UID,datasetId:'synthetic-v1',entries:{}})}),set(ref,value){assert.equal(ref.path,MAIN);pending=structuredClone(value)}});
 if(pending){main=pending;writes++}return result;}};
 return {before,api:new Attendance(db,{now:()=>Date.parse('2026-10-24T18:00:00Z')}),
 request:{operationId:'confirmed-attendance',trainerConfirmed:true,expectedRevision:0,workoutId,date:'2026-10-24',marks:[{clientId:'demo-client-1',status:'attended',source:'manual'}]},read:()=>structuredClone(main),writes:()=>writes};
}
const binding={version:1,botId:131384398,bindings:[{clientId:'demo-client-1',maxChatId:126619382,maxUserId:5819064,notificationsEnabled:true}]};
test('Pilot confirmed attendance commits revision 89→90 and previews once; retry writes nothing',async()=>{
 const s=setup(),session=createPreviewSession();session.check(s.before,binding);
 await s.api.confirm(s.request,UID);const after=s.read();
 assert.equal(after._fitppRevision,90);assert.equal(after.attendanceRevision,1);
 assert.equal(after.clients[0].subscriptions[0].left,s.before.clients[0].subscriptions[0].left-1);assert.equal(s.writes(),1);
 const result=session.check(after,binding);assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].remaining,7);
 assert.equal((await s.api.confirm(s.request,UID)).duplicate,true);assert.deepEqual(s.read(),after);assert.equal(s.writes(),1);
 assert.equal(session.check(s.read(),binding).candidates.length,0);
});
test('unconfirmed or stale request cannot write or increment revision',async()=>{
 for(const change of [{trainerConfirmed:false},{expectedRevision:1}]){const s=setup();await assert.rejects(s.api.confirm({...s.request,...change},UID));assert.deepEqual(s.read(),s.before);assert.equal(s.writes(),0);}
});
test('several marks in one confirmation increment main revision only once',async()=>{
 const s=setup();s.request.marks.push({clientId:'demo-client-2',status:'attended',source:'manual'});
 await s.api.confirm(s.request,UID);assert.equal(s.read()._fitppRevision,90);assert.equal(s.writes(),1);
});
