'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDirectTransport}=require('../src/fitpp-direct');
const {createDirectDb,checkPath}=require('../src/fitpp-direct-db');
const {signedPost,receiver}=require('../src/fitpp-test-bridge');
const {POLL,USER}=require('../direct-core/src/pilot-policy.cjs');
const {hash,MAIN,BOOKINGS,bookingKey}=require('../direct-core/src/service.cjs');
const now=Date.parse('2026-10-25T12:00:00Z'),key='a'.repeat(64),poll={...POLL,openedAt:now-1000};
const scope={...poll,user:USER};
const event=(id='one',action='yes',at=now)=>({update_type:'message_callback',timestamp:at,callback:{callback_id:id,user:{user_id:Number(USER),is_bot:false},payload:`poll:${POLL.uuid}:${action}`,timestamp:at},message:{recipient:{chat_type:'chat',chat_id:POLL.chat},body:{mid:POLL.mid}}});
function fixture(){
 const prefix='fitppTestWorkspaces/synthetic-v1/',data=new Map();
 const main=structuredClone(require('../direct-core/fixtures/main.json'));
 data.set(MAIN,main);data.set(BOOKINGS,{...main,clients:undefined,entries:{}});data.set(prefix+'states/bookingClock',{revision:0});
 data.set(prefix+'maxBindings/'+hash(USER),{active:true,clientId:'demo-client-1'});
 data.set(prefix+'maxPolls/'+hash([POLL.chat,POLL.mid]),{...poll,open:true});
 const db={doc:path=>({path}),async runTransaction(fn){const staged=new Map(data),tx={get:async r=>({exists:staged.has(r.path),data:()=>structuredClone(staged.get(r.path))}),set:(r,v)=>staged.set(r.path,structuredClone(v)),create:(r,v)=>{assert.ok(!staged.has(r.path));staged.set(r.path,v)}};const result=await fn(tx);data.clear();for(const [k,v]of staged)data.set(k,v);return result}};
 return {db,data};
}
test('direct disabled and identity gates',()=>{
 assert.throws(()=>createDirectTransport({key,poll}),/DISABLED/);
 assert.throws(()=>createDirectTransport({key,poll,enabled:true}),/DISABLED/);
 assert.throws(()=>createDirectTransport({key,poll:{...poll,mid:'wrong'},enabled:true,verifiedTestIdentity:true}),/EXACT/);
});
test('signature, route, timestamps and scope are checked before database access',async()=>{
 const transport=createDirectTransport({db:{runTransaction(){throw Error('DB_REACHED')}},key,poll,enabled:true,verifiedTestIdentity:true,now:()=>now});
 const s={key,url:'https://direct.invalid/bot/update'};
 await assert.rejects(()=>transport(s.url,{method:'POST',headers:{},body:'{}'}),/INGRESS/);
 await assert.rejects(()=>signedPost({...s,url:'https://foreign.invalid/bot/update'},'/bot/update',event(),{transport,now:()=>now}),/ROUTE/);
 await assert.rejects(()=>signedPost(s,'/bot/update',event(),{transport,now:()=>now-61000}),/INGRESS/);
 await assert.rejects(()=>signedPost(s,'/bot/update',{...event(),message:{}},{transport,now:()=>now}),/SCOPE/);
 await assert.rejects(()=>signedPost(s,'/bot/update',event(),{transport,now:()=>now}),/DB_REACHED/);
});
test('persisted duplicate survives new direct transport; conflicting replay fails',async()=>{
 const {db,data}=fixture();const e=event(),normalized={source:'max',eventId:'one',uid:USER,desired:true,at:now,pollIdentity:[POLL.chat,POLL.mid],pollUuid:POLL.uuid};
 const result={applied:true,booked:true,revision:7};
 // Receipt created by a prior durable commit; retry must not change its revision.
 const digest=hash({...normalized,uid:USER,key:null,expectedRevision:null});
 data.set('fitppTestWorkspaces/synthetic-v1/maxEvents/'+hash(['max','one']),{digest,result});
 const make=()=>createDirectTransport({db,key,poll,enabled:true,verifiedTestIdentity:true,now:()=>now});
 const s={key,url:'https://direct.invalid/bot/update'};
 for(let i=0;i<2;i++)assert.deepEqual(await signedPost(s,'/bot/update',e,{transport:make(),now:()=>now}),{...result,duplicate:true});
 await assert.rejects(()=>signedPost(s,'/bot/update',event('one','cancel'),{transport:make(),now:()=>now}),/EVENT_ID_CONFLICT/);
});
test('existing callback receiver awaits durable failure and propagates retry',async()=>{
 let reached=false;
 const transport=async()=>{reached=true;throw Error('COMMIT_FAILED')};
 const r=receiver({scope,key,url:'https://direct.invalid/bot/update'},{transport,now:()=>now,log:()=>{}});
 await assert.rejects(()=>r.receive(event()),/COMMIT_FAILED/);assert.ok(reached);
});
test('database rejects production, owner credentials, foreign paths and binding writes',async()=>{
 assert.throws(()=>createDirectDb({projectId:'fitpp-crm'}),/IDENTITY/);
 assert.throws(()=>createDirectDb({projectId:'fitpp-test',raw:{app:{options:{projectId:'fitpp-test'}}},botUid:'owner',ownerUid:'owner'}),/IDENTITY/);
 for(const p of ['trainers/x','fitppTestWorkspaces/production/states/main',MAIN+'/x'])assert.throws(()=>checkPath(p),/PATH/);
 let uid='bot',writes=0;const sdk={doc:(_,p)=>p,runTransaction:async(_,fn)=>fn({get:async()=>({exists:()=>false}),set:()=>writes++})};
 const opts={sdk,raw:{app:{options:{projectId:'fitpp-test'}}},projectId:'fitpp-test',botUid:'bot',ownerUid:'owner',getUid:()=>uid};
 const db=createDirectDb(opts);
 await assert.rejects(()=>db.runTransaction(tx=>tx.set(db.doc(MAIN),{})),/WRITES_DISABLED/);
 const writable=createDirectDb({...opts,writeEnabled:()=>true});
 await assert.rejects(()=>writable.runTransaction(tx=>tx.set(writable.doc('fitppTestWorkspaces/synthetic-v1/maxBindings/'+'a'.repeat(64)),{})),/READ_ONLY/);
 uid='owner';await assert.rejects(()=>db.runTransaction(()=>{}),/AUTH/);assert.equal(writes,0);
});
test('real service commits yes/cancel, ignores stale events, and renders authoritative snapshot',async()=>{
 const {db,data}=fixture(),s={key,url:'https://direct.invalid/bot/update'};
 const transport=createDirectTransport({db,key,poll,enabled:true,verifiedTestIdentity:true,now:()=>now});
 const post=(id,action,at)=>signedPost(s,'/bot/update',event(id,action,at),{transport,now:()=>now});
 assert.equal((await post('yes','yes',now)).booked,true);
 assert.equal((await post('cancel','cancel',now+10)).booked,false);
 assert.equal((await post('late','yes',now+5)).reason,'stale');
 assert.equal((await post('cancel','cancel',now+10)).duplicate,true);
 const result=await signedPost(s,'/bot/poll-view',{chat:POLL.chat,mid:POLL.mid,uuid:POLL.uuid},{transport,now:()=>now});
 assert.deepEqual(result.participants,[]);assert.equal(result.revision,2);
 assert.equal(data.get(BOOKINGS).entries[bookingKey('demo-client-1',POLL.date,POLL.location)],undefined);
});
