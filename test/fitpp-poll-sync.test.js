const {test}=require('node:test');const assert=require('node:assert/strict');
const {createPollSync,render,plainText}=require('../src/fitpp-poll-sync');
const {guardedApi,CHAT}=require('../src/memory-training-test');
const scope={chat:CHAT,mid:'mid.mock1',uuid:'11111111-2222-4333-8444-555555555555'};
const view=(revision,participants=[])=>({...scope,date:'2026-10-26',location:'zarya',time:'20:00',revision,participants});
const person={clientId:'demo-client-1',name:'Елена <&>'};
function fixture(){let current=view(1),message='old',edits=[],fail=false,onEdit=null;
const api={pollMessage:async()=>({body:{text:message}}),editPollText:async text=>{edits.push(text);if(fail)throw Error('MAX HTTP 500');message=plainText(text);if(onEdit)onEdit()}};
return {api,loadView:async()=>structuredClone(current),set:v=>current=v,text:()=>message,edits,fail:v=>fail=v,onEdit:f=>onEdit=f};}
test('yes, duplicates and cancellation render current Firestore names/count only',async()=>{const f=fixture(),s=createPollSync({scope,api:f.api,loadView:f.loadView});f.set(view(2,[person]));await s.sync();assert.match(f.text(),/Записано \(1\)/);assert.equal(f.text().split(person.name).length,2);await s.sync();assert.equal(f.edits.length,1,'plain MAX text does not cause repeated edits');f.set(view(3));await s.sync();assert.match(f.text(),/Записано \(0\)/);assert.ok(!f.text().includes(person.name));assert.equal(f.edits.length,2);assert.ok(f.edits[0].includes('Елена &lt;&amp;&gt;'))});
test('failed MAX edit is repaired from bookings after process restart',async()=>{const f=fixture();f.set(view(2,[person]));f.fail(true);await assert.rejects(()=>createPollSync({scope,...f}).sync(),/MAX HTTP/);f.set(view(3));f.fail(false);const restarted=createPollSync({scope,api:f.api,loadView:f.loadView});await restarted.sync();assert.match(f.text(),/Записано \(0\)/);assert.ok(!f.text().includes(person.name))});
test('state changed during edit converges to latest version, no stale overwrite',async()=>{const f=fixture();f.set(view(2,[person]));f.onEdit(()=>{f.set(view(3));f.onEdit(null)});await createPollSync({scope,api:f.api,loadView:f.loadView}).sync();assert.match(f.text(),/Записано \(0\)/);assert.equal(f.edits.length,2)});
test('invalid scope and duplicate participant identity fail before editing',async()=>{const f=fixture();for(const v of [{...view(2),mid:'wrong'},view(2,[person,person])]){f.set(v);await assert.rejects(()=>createPollSync({scope,api:f.api,loadView:f.loadView}).sync(),/REJECTED/)}assert.equal(f.edits.length,0)});
test('edit API verifies existing bot message and preserves exact keyboard by omitting attachments',async()=>{
const calls=[],keyboard=[{type:'inline_keyboard',payload:{buttons:[[{type:'callback',text:'✅ Приду',payload:`poll:${scope.uuid}:yes`},{type:'callback',text:'↩️ Отменить',payload:`poll:${scope.uuid}:cancel`}]]}}];let foreign=false;
const fetch=async(url,o)=>{const p=url.pathname;calls.push({method:o.method,path:p,query:url.search,body:o.body?JSON.parse(o.body):null});const d=p==='/me'?{user_id:123,is_bot:true,username:'id623401053090_1_bot'}:p.endsWith('/members/me')?{user_id:123,is_bot:true}:p.startsWith('/chats/')?{chat_id:Number(CHAT),title:'Тест тренировок'}:p.startsWith('/messages/')?{sender:{user_id:foreign?999:123,is_bot:true},recipient:{chat_id:CHAT},body:{mid:scope.mid,attachments:keyboard,text:'old'}}:{success:true};return {ok:true,json:async()=>d}};
const a=await guardedApi({token:'mock',expectedId:'123',send:false,edit:false,remove:false},fetch,{pollScope:scope});await a.editPollText(render(view(2,[person]),scope));const put=calls.find(c=>c.method==='PUT');assert.equal(put.path,'/messages');assert.equal(new URLSearchParams(put.query).get('message_id'),scope.mid);assert.deepEqual(Object.keys(put.body).sort(),['format','notify','text']);assert.equal(put.body.notify,false);assert.ok(!calls.some(c=>['POST','DELETE'].includes(c.method)));foreign=true;await assert.rejects(()=>a.editPollText('text'),/POLL_MESSAGE_REFUSED/);assert.equal(calls.filter(c=>c.method==='PUT').length,1);assert.equal(keyboard[0].payload.buttons[0][0].payload,`poll:${scope.uuid}:yes`);
});
test('duplicate callback with old booked=true repairs display using latest cancelled bookings',async()=>{
 const {receiver}=require('../src/fitpp-test-bridge');const f=fixture();f.set(view(3));const sync=createPollSync({scope,api:f.api,loadView:f.loadView});
 const s={key:'a'.repeat(64),url:'https://example.test/bot/update',scope:{...scope,user:'1234'}};
 const u={update_type:'message_callback',timestamp:100000,callback:{callback_id:'same-event',payload:`poll:${scope.uuid}:yes`,user:{user_id:1234,is_bot:false}},message:{recipient:{chat_type:'chat',chat_id:CHAT},body:{mid:scope.mid}}};
 const r=receiver(s,{now:()=>100000,log:()=>{},sync:()=>sync.sync(),transport:async()=>({ok:true,json:async()=>({duplicate:true,booked:true})})});
 await r.receive(u);await r.receive(u);assert.match(f.text(),/Записано \(0\)/);assert.equal(f.edits.length,1);
});
test('MAX display failure makes webhook retryable; retry repairs from Firestore',async()=>{
 const {receiver}=require('../src/fitpp-test-bridge');const f=fixture();f.set(view(2,[person]));f.fail(true);const sync=createPollSync({scope,api:f.api,loadView:f.loadView});
 const u={update_type:'message_callback',timestamp:100000,callback:{callback_id:'retry-event',payload:`poll:${scope.uuid}:yes`,user:{user_id:1234,is_bot:false}},message:{recipient:{chat_type:'chat',chat_id:CHAT},body:{mid:scope.mid}}};
 const r=receiver({key:'a'.repeat(64),url:'https://example.test/bot/update',scope:{...scope,user:'1234'}},{now:()=>100000,log:()=>{},sync:()=>sync.sync(),transport:async()=>({ok:true,json:async()=>({duplicate:true})})});
 await assert.rejects(()=>r.receive(u),/MAX HTTP/);f.fail(false);await r.receive(u);assert.match(f.text(),/Записано \(1\)/);
});
test('poll projection request signature is bound to its own read-only endpoint',async()=>{
 const {signedPost}=require('../src/fitpp-test-bridge');const key='b'.repeat(64);let called=false;
 await signedPost({key,url:'https://example.test/bot/update'},'/bot/poll-view',scope,{now:()=>100000,transport:async(url,o)=>{called=true;assert.equal(url,'https://example.test/bot/poll-view');assert.equal(o.headers['x-signature'],require('node:crypto').createHmac('sha256',key).update(['100000','POST','/bot/poll-view',o.body].join(String.fromCharCode(10))).digest('hex'));return {ok:true,json:async()=>view(3)}}});assert.equal(called,true);
});
