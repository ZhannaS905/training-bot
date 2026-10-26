'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {settings,initialize,open,capability,Autopost,attach}=require('../src/training-test-autopost');
const {CHAT,body}=require('../src/memory-training-test');
const {POLL}=require('../direct-core/src/pilot-policy.cjs');
const env={BOT_MODE:'test',CHAT_IDS:CHAT,TEST_BOT_TOKEN:'offline',TEST_EXPECTED_BOT_ID:'123',WEBHOOK_SECRET:'offline_secret_123',AUTO_PUBLISH:'false',TEST_ALLOW_SEND:'false',TEST_ALLOW_EDIT:'false',TEST_ALLOW_DELETE:'false',TRAINING_TEST_AUTOPOST_ENABLED:'true',TRAINING_TEST_AUTOPOST_DURABLE_VOLUME:'true'};
function fixture(t,date='2026-11-02T06:59:59Z'){
 const parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'autopost-'))),dir=path.join(parent,'ledger');initialize(dir,'2026-10-26');
 let now=new Date(date),s;const calls={send:[],edit:[],verify:0},logs=[];
 const api={verify:async()=>{calls.verify++},send:async p=>{calls.send.push(structuredClone(p));return 'mid.test'},edit:async p=>{calls.edit.push(body({...p,votes:new Map(p.votes)}))}};
 function restart(){s=new Autopost({store:open({dir}),api,admins:['1'],now:()=>now,log:x=>logs.push(x)});return s}
 restart();t.after(async()=>{if(!s.stopped)await s.close();fs.rmSync(parent,{recursive:true,force:true})});
 return {dir,calls,api,logs,get s(){return s},time:x=>{now=new Date(x)},restart};
}
function callback(p,id='a',action='yes',at=Date.parse('2026-11-02T07:01:00Z')){return {update_type:'message_callback',timestamp:at,callback:{callback_id:id,timestamp:at,payload:`poll:${p.id}:${action}`,user:{user_id:1,is_bot:false,first_name:'Елена <&>'}},message:{recipient:{chat_id:CHAT,chat_type:'chat'},body:{mid:p.mid}}}}
function command(at=Date.parse('2026-11-02T08:00:00Z')){return {update_type:'message_created',timestamp:at,message:{timestamp:at,sender:{user_id:1,is_bot:false},recipient:{chat_id:CHAT,chat_type:'chat'},body:{mid:'mid.command',text:'/тестопрос-сегодня'}}}}
test('explicit scoped permission keeps general writes disabled; missing durable mount fails closed',()=>{
 assert.equal(settings({}),null);assert.equal(settings({...env,TRAINING_TEST_AUTOPOST_ENABLED:'false'}),null);
 assert(settings({...env,TRAINING_TEST_AUTOPOST_STATE_DIR:'/data/polls'}));
 for(const patch of [{BOT_MODE:'production'},{CHAT_IDS:'-1'},{TEST_ALLOW_SEND:'true'},{TEST_ALLOW_EDIT:'true'},{TEST_ALLOW_DELETE:'true'},{AUTO_PUBLISH:'true'},{TRAINING_TEST_AUTOPOST_DURABLE_VOLUME:'false'},{TRAINING_TEST_AUTOPOST_STATE_DIR:'relative'},{TRAINING_TEST_AUTOPOST_STATE_DIR:'/'},{TRAINING_TEST_AUTOPOST_ENABLED:'yes'}])assert.throws(()=>settings({...env,TRAINING_TEST_AUTOPOST_STATE_DIR:'/data/polls',...patch}));
});
test('all seven days use Moscow 10:00 and the existing exact renderer',async t=>{
 for(let day=2;day<=8;day++){
  const date=`2026-11-0${day}`,f=fixture(t,date+'T06:59:59Z');await f.s.tick();assert.equal(f.calls.send.length,0);
  f.time(date+'T07:00:00Z');await Promise.all([f.s.tick(),f.s.tick()]);
  assert.equal(f.calls.send.length,day===6?0:1);
  if(day!==6){const p=f.s.store.state.polls[date],b=body({...p,votes:new Map()});assert.match(b.text,new RegExp(['20:00','18:30','20:00','18:30','','18:00','18:00'][day-2]));assert.match(b.text,/🤨 Пока никто не записался!/);assert.doesNotMatch(b.text,/2026|60 минут|[━─]/);assert.deepEqual(b.attachments[0].payload.buttons[0].map(b=>b.text),['✅ Приду','↩️ Отменить']);if([2,4].includes(day))assert.match(b.text,/<b>Заря<\/b>/);if([3,5].includes(day))assert.match(b.text,/<b>Поле чудес<\/b>/);if(day>=7)assert.match(b.text,/35289250295816/)}
 }
});
test('late startup, missed minute, previous date, early startup and training end never catch up',async t=>{
 for(const time of ['2026-11-02T07:00:00.001Z','2026-11-02T08:00:00Z']){const f=fixture(t,time);await f.s.tick();assert.equal(f.calls.send.length,0)}
 const f=fixture(t);f.time('2026-11-02T07:01:00Z');await f.s.tick();assert.equal(f.calls.send.length,0);
 await f.s.publish('2026-11-01');assert.equal(f.calls.send.length,0);
 f.time('2026-11-02T17:00:00Z');await f.s.receive(command(Date.parse('2026-11-02T17:00:00Z')));assert.equal(f.calls.send.length,0);
});
test('persisted reservation prevents concurrency and restart duplicates',async t=>{
 const f=fixture(t);f.time('2026-11-02T07:00:00Z');await Promise.all([f.s.tick(),f.s.tick()]);assert.equal(f.calls.send.length,1);
 await f.s.close();f.restart();await f.s.tick();await f.s.receive(command(Date.parse('2026-11-02T07:00:00Z')));assert.equal(f.calls.send.length,1);
 assert.throws(()=>initialize(f.dir,'2026-10-26'));
});
test('timeout, malformed success and HTTP errors stay uncertain after restart',async t=>{
 for(const result of ['timeout','malformed','http']){
  const f=fixture(t);f.api.send=async p=>{f.calls.send.push(p);if(result==='malformed')return '';throw Error('SECRET_TOKEN PRIVATE_NAME')};
  f.time('2026-11-02T07:00:00Z');await f.s.tick();assert.equal(f.s.store.state.polls['2026-11-02'].status,'uncertain');
  await f.s.close();f.restart();await f.s.tick();await f.s.publish('2026-11-02');assert.equal(f.calls.send.length,1);assert.doesNotMatch(f.logs.join(' '),/SECRET|PRIVATE/);
 }
});
test('crash-equivalent reserved receipt blocks a later process and exclusive writer lock',async t=>{
 const f=fixture(t);assert.throws(()=>open({dir:f.dir}));f.s.store.state.polls['2026-11-02']={...f.s.store.state.polls[POLL.date],date:'2026-11-02',status:'reserved',mid:null};f.s.store.save();
 await f.s.close();f.restart();f.time('2026-11-02T07:00:00Z');await f.s.tick();assert.equal(f.calls.send.length,0);
});
test('missing/corrupt ledger, symlink and existing pilot removal fail closed',async t=>{
 const f=fixture(t);await f.s.close();const file=path.join(f.dir,'state.json'),bytes=fs.readFileSync(file);
 fs.unlinkSync(file);assert.throws(()=>open({dir:f.dir}));fs.writeFileSync(file,'bad');assert.throws(()=>open({dir:f.dir}));
 const s=JSON.parse(bytes);delete s.polls[POLL.date];fs.writeFileSync(file,JSON.stringify(s));assert.throws(()=>open({dir:f.dir}));
 fs.writeFileSync(file,bytes);fs.symlinkSync(file,path.join(f.dir,'link'));assert.throws(()=>open({dir:f.dir}));
});
test('existing today pilot is never duplicated and keeps its FitPP callback route',async t=>{
 const f=fixture(t,'2026-10-26T06:59:59Z');f.time('2026-10-26T07:00:00Z');await f.s.tick();await f.s.publish(POLL.date);assert.equal(f.calls.send.length,0);
 assert.equal(await f.s.receive(callback({...POLL,id:POLL.uuid})),false);
});
test('manual today command requires explicit fresh test-group admin action and dedupes with scheduler',async t=>{
 const f=fixture(t,'2026-11-02T08:00:00Z');await f.s.tick();assert.equal(f.calls.send.length,0);
 for(const mutate of [u=>{u.message.sender.user_id=2},u=>{u.message.sender.is_bot=true},u=>{u.message.recipient.chat_id='-1'},u=>{u.message.timestamp-=61000},u=>{u.message.body.text='/тестопрос-сегодня 2026-11-03'}]){const u=command();mutate(u);await f.s.receive(u);assert.equal(f.calls.send.length,0)}
 await Promise.all([f.s.receive(command()),f.s.receive(command())]);assert.equal(f.calls.send.length,1);
 await f.s.close();f.restart();await f.s.receive(command());assert.equal(f.calls.send.length,1);
});
test('yes/cancel persist before ack; names, deduplication, ordering and edit retry survive restart',async t=>{
 const f=fixture(t);f.time('2026-11-02T07:00:00Z');await f.s.tick();const p=f.s.store.state.polls['2026-11-02'];f.time('2026-11-02T07:01:00Z');
 await f.s.receive(callback(p));await f.s.receive(callback(p));assert.equal(p.votes.length,1);assert.equal(p.done.length,1);
 const saved=JSON.parse(fs.readFileSync(path.join(f.dir,'state.json')));assert.equal(saved.polls[p.date].votes.length,1);
 f.api.edit=async()=>{throw Error('SECRET PRIVATE')};await f.s.tick();assert(p.dirty);assert.equal(f.logs.at(-1),'Training Test: PUT /messages failed; edit will retry.');
 await f.s.close();f.restart();f.api.edit=async p=>f.calls.edit.push(body({...p,votes:new Map(p.votes)}));await f.s.tick();assert.match(f.calls.edit.at(-1).text,/1. Елена &lt;&amp;&gt;/);
 const current=f.s.store.state.polls[p.date];await f.s.receive(callback(current,'cancel','cancel',Date.parse('2026-11-02T07:01:01Z')));assert.equal(current.votes.length,0);
 await f.s.receive(callback(current,'stale','yes'));assert.equal(current.votes.length,0);await f.s.tick();assert.match(f.calls.edit.at(-1).text,/🤨 Пока никто не записался!/);
 assert.equal(f.calls.send.length,1);
});
test('foreign message/group/bot users and stale callbacks cannot mutate votes',async t=>{
 const f=fixture(t);f.time('2026-11-02T07:00:00Z');await f.s.tick();const p=f.s.store.state.polls['2026-11-02'];f.time('2026-11-02T07:01:00Z');
 for(const mutate of [u=>{u.message.body.mid='mid.foreign'},u=>{u.message.recipient.chat_id='-1'},u=>{u.callback.user.is_bot=true},u=>{u.callback.timestamp-=86400001},u=>{u.callback.user.user_id=0}]){const u=callback(p);mutate(u);await f.s.receive(u);assert.equal(p.votes.length,0)}
});
test('failed durable reservation never dispatches; failed vote persistence never acknowledges',async t=>{
 const f=fixture(t);f.time('2026-11-02T07:00:00Z');f.s.store.save=()=>{f.s.store.failed=true;throw Error('DISK_FULL')};await assert.rejects(f.s.tick());assert.equal(f.calls.send.length,0);await assert.rejects(f.s.tick());
 const g=fixture(t);g.time('2026-11-02T07:00:00Z');await g.s.tick();g.time('2026-11-02T07:01:00Z');const p=g.s.store.state.polls['2026-11-02'];g.s.store.save=()=>{g.s.store.failed=true;throw Error('DISK_FULL')};await assert.rejects(g.s.receive(callback(p)));await assert.rejects(g.s.tick());
});
function rawFixture(){
 const requests=[],p={id:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+ 'a'.repeat(12),date:'2026-11-02',votes:[],mid:'mid.test',status:'published'};
 let me={user_id:123,username:'id623401053090_1_bot',is_bot:true},chat={chat_id:CHAT,title:'Тест тренировок'},member={user_id:123,is_bot:true};
 let message={sender:me,recipient:{chat_id:CHAT},body:{mid:p.mid,attachments:body({...p,votes:new Map()}).attachments}};
 return {requests,p,setMe:v=>me=v,setChat:v=>chat=v,setMember:v=>member=v,setMessage:v=>message=v,raw:{async request(method,url){requests.push([method,url]);return url==='/me'?me:url.endsWith('/members/me')?member:url.startsWith('/chats/')?chat:message},async send(chat,b,opts){requests.push(['POST',chat,b,opts]);return 'mid.test'},async edit(mid,b){requests.push(['PUT',mid,b])}}};
}
test('capability rechecks identity before every send, pins chat and verifies edit ownership/buttons',async()=>{
 const r=rawFixture(),c={token:'offline',expectedId:'123'},api=await capability(c,{raw:r.raw});
 await api.send(r.p);await api.edit(r.p);assert.equal(r.requests.find(x=>x[0]==='POST')[1],CHAT);assert.deepEqual(r.requests.find(x=>x[0]==='PUT')[2],{text:body({...r.p,votes:new Map()}).text,format:'html',notify:false});assert(!('remove'in api));
 r.setMe({user_id:123,username:'production_bot',is_bot:true});await assert.rejects(api.send(r.p),/IDENTITY/);assert.equal(r.requests.filter(x=>x[0]==='POST').length,1);
});
test('wrong bot, chat, membership, edit sender/recipient/keyboards cannot write',async()=>{
 for(const patch of [r=>r.setMe({user_id:124,username:'id623401053090_1_bot',is_bot:true}),r=>r.setMe({user_id:123,username:'id623401053090_1_bot',is_bot:false}),r=>r.setChat({chat_id:'-1',title:'Тест тренировок'}),r=>r.setChat({chat_id:CHAT,title:'Рабочая группа'}),r=>r.setMember({user_id:124,is_bot:true})]){const r=rawFixture();patch(r);await assert.rejects(capability({expectedId:'123'},{raw:r.raw}));assert(!r.requests.some(x=>['POST','PUT','DELETE'].includes(x[0])))}
 for(const m of [{},{sender:{user_id:123,is_bot:true},recipient:{chat_id:'-1'},body:{mid:'mid.test'}},{sender:{user_id:124,is_bot:true},recipient:{chat_id:CHAT},body:{mid:'mid.test',attachments:[]}}]){const r=rawFixture(),a=await capability({expectedId:'123'},{raw:r.raw});r.setMessage(m);await assert.rejects(a.edit(r.p),/SCOPE/);assert(!r.requests.some(x=>x[0]==='PUT'))}
});
test('scheduler uses 1000ms and no backlog; foreign FitPP traffic bypasses publication queue',async t=>{
 const f=fixture(t);let interval,cancelled=false;const stop=attach(f.s,{schedule(fn,ms){interval={fn,ms};return 1},cancel(){cancelled=true}});assert.equal(interval.ms,1000);
 let release;const pending=f.s.run(()=>new Promise(resolve=>{release=resolve}));await new Promise(r=>setImmediate(r));
 assert.equal(await f.s.receive({update_type:'bot_started'}),false);assert.equal(await f.s.receive(callback({...POLL,id:POLL.uuid})),false);release();await pending;await stop();assert(cancelled);
});

test('authenticated shared webhook routes new polls, old FitPP pilot and contacts independently',async t=>{
 const {EventEmitter}=require('node:events'),{Readable}=require('node:stream');
 const {main}=require('../src/fitpp-test-bridge');
 const f=fixture(t),scope={chat:POLL.chat,mid:POLL.mid,uuid:POLL.uuid,user:'5819064'};
 const c={...env,FITPP_BRIDGE_ENABLED:'true',FITPP_BRIDGE_URL:'https://offline.invalid/bot/update',FITPP_BRIDGE_HMAC_KEY:'a'.repeat(64),FITPP_BRIDGE_SCOPE:JSON.stringify(scope),FITPP_POLL_SYNC_ENABLED:'false',OWNER_DIALOG_ENABLED:'false'};
 let handler,contacts=0,commits=0;const server=new EventEmitter();server.listen=(_p,_h,fn)=>fn();server.close=()=>server.emit('close');
 const before=Object.fromEntries(['SIGINT','SIGTERM'].map(k=>[k,process.listeners(k)]));
 t.after(()=>{server.close();for(const sig of ['SIGINT','SIGTERM'])for(const fn of process.listeners(sig))if(!before[sig].includes(fn))process.removeListener(sig,fn)});
 await main({env:c,verify:async()=>({}),makeServer:fn=>{handler=fn;return server},reconcile:()=>({stop(){}}),autopost:f.s,contact:{receive:async()=>{contacts++}},callbackTransport:async()=>{commits++;return {ok:true,json:async()=>({applied:true})}}});
 async function request(u,secret=c.WEBHOOK_SECRET){
  let status;const req=Readable.from([Buffer.from(JSON.stringify(u))]);Object.assign(req,{method:'POST',url:'/webhook',headers:{'x-max-bot-api-secret':secret}});
  await new Promise(resolve=>handler(req,{writeHead(code){status=code;return this},end(){resolve()}}));return status;
 }
 f.time('2026-11-02T08:00:00Z');assert.equal(await request(command(),'wrong_secret'),403);assert.equal(f.calls.send.length,0);
 assert.equal(await request(command()),200);assert.equal(f.calls.send.length,1);
 const p=f.s.store.state.polls['2026-11-02'];const vote=callback(p,'join','yes',Date.parse('2026-11-02T08:00:00Z'));assert.equal(await request(vote),200);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'state.json'))).polls[p.date].votes.length,1);assert.equal(commits,0);
 const old=callback({...POLL,id:POLL.uuid},'pilot','yes',Date.now());old.callback.user.user_id=5819064;
 assert.equal(await request(old),200);assert.equal(commits,1);
 assert.equal(await request({update_type:'bot_started'}),200);assert.equal(contacts,1);
});

test('lost ledger acknowledgement after successful POST leaves a reservation and never resends',async t=>{
 const f=fixture(t);let saves=0;const save=f.s.store.save.bind(f.s.store);
 f.s.store.save=()=>{if(++saves===1)return save();f.s.store.failed=true;throw Error('DISK_LOST')};
 f.time('2026-11-02T07:00:00Z');await assert.rejects(f.s.tick());assert.equal(f.calls.send.length,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'state.json'))).polls['2026-11-02'].status,'reserved');
 await f.s.close();f.restart();await f.s.tick();await f.s.publish('2026-11-02');assert.equal(f.calls.send.length,1);
});

test('votes remain open during the 60 minute workout, then close as the existing direct pilot does',async t=>{
 const f=fixture(t);f.time('2026-11-02T07:00:00Z');await f.s.tick();const p=f.s.store.state.polls['2026-11-02'];
 f.time('2026-11-02T17:30:00Z');await f.s.receive(callback(p,'during','yes',Date.parse('2026-11-02T17:30:00Z')));assert.equal(p.votes.length,1);await f.s.tick();assert.equal(p.dirty,false);
 f.time('2026-11-02T18:00:00Z');await f.s.receive(callback(p,'closed','cancel',Date.parse('2026-11-02T18:00:00Z')));assert.equal(p.votes.length,1);
});
