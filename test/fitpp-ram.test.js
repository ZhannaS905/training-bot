'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRam}=require('../src/fitpp-ram');
const scope={chat:'-1',mid:'mid.test',uuid:'11111111-2222-4333-8444-555555555555',user:'1'};
const self={clientId:'demo-client-1',name:'Confirmed'},other={clientId:'demo-client-2',name:'Other'};
const tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function fixture(initial=[]){
 let participants=initial,revision=0,lastEventAt=0,reads=0,failRead=false,failMax=0,active=0,peak=0,text='';const puts=[],logs=[],order=[];
 const view=()=>({...scope,date:'2026-10-26',location:'zarya',time:'20:00',revision,participants:structuredClone(participants),optimistic:{userId:'1',...self,lastEventAt,openedAt:1,closesAt:200000}});
 const loadView=async()=>{reads++;order.push('read');if(failRead)throw Error('read');return view()};
 const api={syncPollText:async value=>{active++;peak=Math.max(peak,active);try{await tick();if(failMax-->0)throw Error('max');const edited=text!==value;if(edited){puts.push(value);order.push('put');text=value}return {edited}}finally{active--}}};
 const make=()=>createRam({scope,loadView,api,now:()=>100000,log:x=>logs.push(x)});
 const e=(choice='yes',at=100000,id=String(at))=>({timestamp:at,callback:{callback_id:id,user:{user_id:1,is_bot:false},payload:`poll:${scope.uuid}:${choice}`},message:{recipient:{chat_id:scope.chat,chat_type:'chat'},body:{mid:scope.mid}}});
 const commit=async event=>{order.push('write');if(event.timestamp<=lastEventAt)return {applied:false};lastEventAt=event.timestamp;revision++;participants=participants.filter(p=>p.clientId!==self.clientId);if(event.callback.payload.endsWith(':yes'))participants.push(self);return {applied:true}};
 return {make,e,commit,puts,logs,order,view,reads:()=>reads,text:()=>text,peak:()=>peak,failRead:v=>failRead=v,failMax:n=>failMax=n,external:p=>{participants=p;revision++}};
}
test('warm first PUT precedes blocked Firebase and has zero additional reads; cancel and second participant survive',async()=>{
 const f=fixture([other]),c=f.make();await c.refresh();const before=f.reads(),gate=deferred(),e=f.e();
 const job=c.run(e,()=>gate.promise.then(()=>f.commit(e)));await tick();await tick();
 assert.equal(f.reads(),before);assert.match(f.text(),/Confirmed/);assert.match(f.text(),/Other/);assert.match(f.text(),/Предварительный список/);assert.match(f.text(),/ещё не подтверждено/);assert.doesNotMatch(f.text(),/✅ Записано/);
 gate.resolve();await job;const cancel=f.e('cancel',100001);await c.run(cancel,()=>f.commit(cancel));assert.doesNotMatch(f.text(),/Confirmed/);assert.match(f.text(),/Other/);assert.equal(f.peak(),1);
});
test('rapid yes/cancel renders cancel before first save settles; duplicate shares durable work',async()=>{
 const f=fixture(),c=f.make();await c.refresh();const gate=deferred(),yes=f.e(),cancel=f.e('cancel',100001);let writes=0;
 const a=c.run(yes,()=>{writes++;return gate.promise.then(()=>f.commit(yes))});
 const duplicate=c.run(yes,()=>{throw Error('duplicate write')});assert.equal(a,duplicate);
 await tick();await tick();const b=c.run(cancel,()=>{writes++;return f.commit(cancel)});await tick();await tick();assert.doesNotMatch(f.text(),/Confirmed/);
 gate.resolve();await Promise.all([a,b]);assert.equal(writes,2);assert.equal(f.view().participants.length,0);assert.equal(f.peak(),1);
});
test('Firebase rejection rolls back and returns failure for webhook retry',async()=>{
 const f=fixture([other]),c=f.make();await c.refresh();await assert.rejects(c.run(f.e(),async()=>{throw Error('firebase')}),/firebase/);assert.doesNotMatch(f.text(),/Confirmed/);assert.match(f.text(),/Other/);
});
test('MAX failure is repaired after independent successful persistence',async()=>{
 const f=fixture(),c=f.make();await c.refresh();f.failMax(1);const e=f.e();await c.run(e,()=>f.commit(e));assert.match(f.text(),/Confirmed/);
});
test('restart restores confirmed state and durable replay rejects stale intent',async()=>{
 const f=fixture([other]),first=f.make();await first.refresh();const gate=deferred(),e=f.e();const job=first.run(e,()=>gate.promise);await tick();await tick();assert.match(f.text(),/Confirmed/);
 const restarted=f.make();await restarted.refresh();assert.doesNotMatch(f.text(),/Confirmed/);gate.reject(Error('crashed'));await assert.rejects(job);await restarted.run(e,()=>f.commit(e));
 const again=f.make();await again.refresh();const count=f.puts.length;await again.run(e,()=>f.commit(e));assert.equal(f.puts.length,count);
});
test('background refresh never erases pending intents; external participants recovered after save',async()=>{
 const f=fixture(),c=f.make();await c.refresh();const gate=deferred(),e=f.e(),reads=f.reads();const job=c.run(e,()=>gate.promise.then(()=>f.commit(e)));await tick();await c.refresh();assert.equal(f.reads(),reads);
 f.external([other]);gate.resolve();await job;assert.match(f.text(),/Other/);assert.match(f.text(),/Confirmed/);
});
test('failed startup cannot manufacture empty state; cold fallback persists before rendering',async()=>{
 const f=fixture([other]),c=f.make();f.failRead(true);await assert.rejects(c.refresh());f.failRead(false);const e=f.e();await c.run(e,()=>f.commit(e));assert.match(f.text(),/Other/);assert.match(f.text(),/Confirmed/);
});
test('invalid identity and stale timestamps never appear optimistically',async()=>{
 const f=fixture(),c=f.make();await c.refresh();const gate=deferred(),e=f.e();e.callback.user.user_id=2;
 const count=f.puts.length,job=c.run(e,()=>gate.promise);await tick();assert.equal(f.puts.length,count);gate.resolve({applied:false});await job;
});
test('snapshot started before a callback cannot replace newer RAM and final refresh repairs it',async()=>{
 const f=fixture(),gate=deferred(),write=deferred();let calls=0;
 const c=createRam({scope,now:()=>100000,loadView:async()=>{calls++;if(calls===2)return gate.promise;return f.view()},api:{syncPollText:async text=>{f.puts.push(text);return {edited:true}}}});
 await c.refresh();const stale=f.view(),reading=c.refresh(),e=f.e();
 const saving=c.run(e,()=>write.promise.then(()=>f.commit(e)));await tick();gate.resolve(stale);await reading;
 assert.match(f.puts.at(-1),/Confirmed/);write.resolve();await saving;assert.match(f.puts.at(-1),/Confirmed/);assert.ok(calls>=3);
});
test('failed corrective read disables fast path until retry and does not acknowledge failed persistence',async()=>{
 const f=fixture(),c=f.make();await c.refresh();f.failRead(true);await assert.rejects(c.run(f.e(),async()=>{throw Error('ambiguous')}),/ambiguous/);
 const gate=deferred(),count=f.puts.length,e=f.e('cancel',100001);const job=c.run(e,()=>gate.promise);await tick();assert.equal(f.puts.length,count);
 f.failRead(false);gate.resolve({applied:false});await job;assert.doesNotMatch(f.text(),/Confirmed/);
});
test('missing confirmed binding never displays MAX profile data before durable save',async()=>{
 const f=fixture([other]),gate=deferred();let text='',reads=0;
 const c=createRam({scope,now:()=>100000,loadView:async()=>{reads++;return {...f.view(),optimistic:null}},api:{syncPollText:async value=>{text=value;return {edited:true}}}});
 await c.refresh();const e=f.e();e.callback.user.first_name='Untrusted profile';const job=c.run(e,()=>gate.promise.then(()=>f.commit(e)));await tick();assert.equal(reads,1);assert.doesNotMatch(text,/Confirmed|Untrusted/);gate.resolve();await job;assert.match(text,/Confirmed/);assert.doesNotMatch(text,/Untrusted/);
});

test('MAX completes before persistence starts and success removes pending marker',async()=>{
 const f=fixture(),max=deferred();let writes=0,block=false,text='';
 const c=createRam({scope,now:()=>100000,loadView:async()=>f.view(),api:{syncPollText:async value=>{text=value;if(block)await max.promise;return {edited:true}}}});
 await c.refresh();block=true;const e=f.e();const job=c.run(e,()=>{writes++;return f.commit(e)});
 await tick();assert.match(text,/Confirmed/);assert.match(text,/ещё не подтверждено/);assert.equal(writes,0);
 max.resolve();await job;assert.equal(writes,1);assert.doesNotMatch(text,/ещё не подтверждено/);assert.match(text,/✅ Записано/);
});
test('failed save and unavailable repair roll back to known participants and allow durable retry',async()=>{
 const f=fixture([other]),c=f.make();await c.refresh();f.failRead(true);
 await assert.rejects(c.run(f.e(),async()=>{throw Error('offline')}),/offline/);
 assert.doesNotMatch(f.text(),/Confirmed|ещё не подтверждено/);assert.match(f.text(),/Other/);assert.equal(c.status().ready,false);
 f.failRead(false);await c.refresh();const e=f.e();await c.run(e,()=>f.commit(e));assert.match(f.text(),/Confirmed/);assert.equal(c.status().pending,0);
});
test('older rejected yes cannot overwrite newer pending cancel or other participants',async()=>{
 const f=fixture([self,other]),c=f.make();await c.refresh();const gate=deferred();
 const a=c.run(f.e('cancel'),()=>gate.promise);await tick();await tick();
 const e=f.e('yes',100001),b=c.run(e,()=>f.commit(e));await tick();await tick();assert.match(f.text(),/Confirmed/);
 gate.reject(Error('rejected'));await assert.rejects(a);await b;assert.match(f.text(),/Confirmed/);assert.match(f.text(),/Other/);assert.doesNotMatch(f.text(),/ещё не подтверждено/);
});
