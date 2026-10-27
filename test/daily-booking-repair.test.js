'use strict';
const test=require('node:test'),a=require('node:assert/strict'),{Readable}=require('node:stream');
const {database}=require('./helpers/autopost-firestore'),{createDirectDb}=require('../src/fitpp-direct-db'),{createDailyBooking}=require('../src/fitpp-daily-booking'),{Autopost,pollBody}=require('../src/training-test-autopost'),{createWebhook}=require('../src/memory-test-webhook');
const {Service,MAIN,BOOKINGS,hash,bookingKey}=require('../direct-core/src/service.cjs'),{CHAT,USER}=require('../direct-core/src/pilot-policy.cjs');
const date='2026-10-27',now=Date.parse(date+'T12:00:00Z'),uuid='2058779d-f536-4b18-b725-f7fc842ac2a8',mid='mid.ffffb6ed054c9f4801a17c28b22e3473';
function fixture(){
 const f=database(),logs=[],calls=[],main=structuredClone(require('../direct-core/fixtures/main.json'));main.clients[0].locations.push('pole');
 f.data.set(MAIN,main);f.data.set(BOOKINGS,{ownerUid:main.ownerUid,datasetId:'synthetic-v1',schemaVersion:1,entries:{}});f.data.set('fitppTestWorkspaces/synthetic-v1/states/bookingClock',{revision:0});f.data.set('fitppTestWorkspaces/synthetic-v1/maxBindings/'+hash(USER),{active:true,clientId:'demo-client-1'});
 const p={id:uuid,mid,version:1,botId:'123',chat:CHAT,date,status:'published',createdAt:now-3600000,votes:{},order:[],last:{},revision:0,displayedRevision:0};f.data.set('trainingTestAutopostBots/123/polls/'+date,p);
 const db=createDirectDb({sdk:f.sdk,raw:f.raw,projectId:'fitpp-test',botUid:'testuid',ownerUid:'owner',getUid:()=> 'testuid',validateAuth:async()=>{},writeEnabled:()=>true,dailyBotId:'123'}),booking=createDailyBooking({db,botId:'123',now:()=>now});
 const api={verify:async()=>{},send:async()=>{throw Error('FORBIDDEN_PUBLICATION')},edit:async(p,{beforePut})=>{await beforePut();calls.push({edit:pollBody(p)})},answer:async id=>calls.push({answer:id})};
 const service=new Autopost({store:f.store({now:()=>now}),api,booking,now:()=>new Date(now),log:l=>logs.push(l)});return {...f,db,booking,p,service,logs,calls};
}
function callback(id='current',action='yes',at=now){return {update_type:'message_callback',timestamp:at,callback:{callback_id:id,timestamp:at,payload:`poll:${uuid}:${action}`,user:{user_id:Number(USER),is_bot:false,first_name:'PRIVATE_PERSON'}},message:{recipient:{chat_type:'chat',chat_id:CHAT},body:{mid}}}}
async function webhook(service,u,secret='test_secret',supplied=secret,logs=[]){
 const server=createWebhook(service,secret,{log:entry=>logs.push(entry)}),req=Readable.from([Buffer.from(JSON.stringify(u))]);req.method='POST';req.url='/webhook';req.headers={'x-max-bot-api-secret':supplied};let status;
 await server.listeners('request')[0](req,{writeHead:code=>{status=code;return {end(){}}}});server.close();return status;
}
test('webhook -> current daily poll -> durable vote -> FitPP booking -> browser read; replay survives restart; buttons unchanged',async()=>{
 const f=fixture(),u=callback(),before=pollBody(f.p).attachments;a.equal(await webhook(f.service,u),200);
 a.equal((await new Service(f.db).view([bookingKey('demo-client-1',date,'pole')])).entries[bookingKey('demo-client-1',date,'pole')],true);
 a.equal(f.data.get('trainingTestAutopostBots/123/polls/'+date).revision,1);a.equal(f.data.get('fitppTestWorkspaces/synthetic-v1/states/bookingClock').revision,1);a.equal(f.calls.filter(c=>c.answer).length,1);
 const second=new Autopost({store:f.store({now:()=>now}),api:f.service.api,booking:f.booking,now:()=>new Date(now),log:l=>f.logs.push(l)});a.equal(await webhook(second,u),200);a.equal(f.data.get('fitppTestWorkspaces/synthetic-v1/states/bookingClock').revision,1);
 await second.tick();a.deepEqual(f.calls.find(c=>c.edit).edit.attachments,before);a(f.logs.some(l=>l.includes('fitpp_booking')));for(const value of ['PRIVATE_PERSON',USER,uuid])a(!f.logs.join('').includes(value));
});
test('cancel updates same day/hall; another user never writes FitPP booking',async()=>{
 const f=fixture();await f.service.receive(callback());await f.service.receive(callback('cancel','cancel',now+1));a.equal(f.data.get(BOOKINGS).entries[bookingKey('demo-client-1',date,'pole')],undefined);
 const foreign=callback('foreign','yes',now+2);foreign.callback.user.user_id=999;await f.service.receive(foreign);a.equal(f.data.get('fitppTestWorkspaces/synthetic-v1/states/bookingClock').revision,2);a(f.logs.some(l=>l.includes('"skipped":true')));
});
test('wrong secret/chat/mid/uuid/bot/time cannot write booking; safe rejection diagnostics',async()=>{
 for(const alter of [u=>u.message.recipient.chat_id='-1',u=>u.message.body.mid='mid.wrong',u=>u.callback.payload='poll:00000000-0000-0000-0000-000000000000:yes',u=>u.callback.user.is_bot=true,u=>u.callback.timestamp=now-90000000]){
  const f=fixture(),u=callback();alter(u);await webhook(f.service,u);a.equal(f.data.get('fitppTestWorkspaces/synthetic-v1/states/bookingClock').revision,0);a(f.logs.some(l=>l.includes('filter')));a(!f.logs.join('').includes('PRIVATE_PERSON'));
 }
 const f=fixture(),notes=[];a.equal(await webhook(f.service,callback(),'secret_value','wrong',notes),403);a.equal(f.commits.length,0);a.deepEqual(notes,[{event:'training_test_webhook',reason:'secret_rejected'}]);
});
test('booking failure -> 503 after durable vote; retry repairs booking without re-voting',async()=>{
 const f=fixture(),real=f.service.booking;let fail=true;f.service.booking={receive:async(...args)=>{if(fail)throw Error('PRIVATE_TOKEN');return real.receive(...args)}};
 a.equal(await webhook(f.service,callback()),503);a.equal(f.data.get('trainingTestAutopostBots/123/polls/'+date).revision,1);a.equal(f.data.get('fitppTestWorkspaces/synthetic-v1/states/bookingClock').revision,0);a.equal(f.calls.length,0);
 fail=false;a.equal(await webhook(f.service,callback()),200);a.equal(f.data.get('trainingTestAutopostBots/123/polls/'+date).revision,1);a.equal(f.data.get('fitppTestWorkspaces/synthetic-v1/states/bookingClock').revision,1);a(!f.logs.join('').includes('PRIVATE_TOKEN'));
});
test('current mid/uuid rechecked in transaction; no poll registrations or widened write paths',async()=>{
 const f=fixture();f.data.set('trainingTestAutopostBots/123/polls/'+date,{...f.p,mid:'mid.replaced'});await a.rejects(f.booking.receive(callback(),f.p),/SCOPE/);a.equal(f.commits.length,0);
 await a.rejects(f.db.runTransaction(async tx=>tx.set(f.db.doc('trainingTestAutopostBots/123/polls/'+date),f.p)),/READ_ONLY/);
 a.throws(()=>f.db.doc('trainingTestAutopostBots/999/polls/'+date),/PATH/);a.throws(()=>f.db.doc('fitpp-crm/states/main'),/PATH/);
});
test('unbound, archived, cancelled workout retain booking guards',async()=>{
 for(const change of [f=>f.data.delete('fitppTestWorkspaces/synthetic-v1/maxBindings/'+hash(USER)),f=>f.data.get(MAIN).clients[0].archivedAt='now',f=>{f.data.get(MAIN).workouts={'pole_2026-10-27':{id:'pole_2026-10-27',location:'pole',originDate:date,date,time:'18:30',cancelled:true}}}]){
  const f=fixture();f.p.last[USER]=now;f.p.votes[USER]='synthetic';f.p.order=[USER];change(f);await a.rejects(f.booking.receive(callback(),f.p));a.equal(f.data.get('fitppTestWorkspaces/synthetic-v1/states/bookingClock').revision,0);
 }
});
test('MAX callback answer uses query callback_id and empty body, no message replacement; existing transport spaces API calls',async t=>{
 const {capability}=require('../src/training-test-autopost'),{MaxApi}=require('../src/api');const requests=[];
 const raw={request:async(...args)=>{requests.push(args);return args[1]==='/me'?{user_id:123,username:'id623401053090_1_bot',is_bot:true}:args[1].endsWith('/members/me')?{user_id:123,is_bot:true}:{chat_id:CHAT,title:'Тест тренировок'}}};
 const api=await capability({expectedId:'123'},{raw});await api.answer('callback-test');a.deepEqual(requests.at(-1),['POST','/answers',{callback_id:'callback-test'},{}]);await a.rejects(api.answer('   '),/CALLBACK_ID/);
 let clock=0;const times=[];t.mock.method(Date,'now',()=>clock);const transport=new MaxApi('mock',async()=>{times.push(clock);return {ok:true,json:async()=>({success:true})}},async ms=>{clock+=ms});await transport.request('POST','/answers',{callback_id:'one'},{});await transport.request('POST','/answers',{callback_id:'two'},{});a(times[1]-times[0]>=500);
});
test('older callback cannot project stale intent while latest booking is pending; missing durable vote refuses writes',async()=>{
 const f=fixture();await a.rejects(f.booking.receive(callback(),f.p),/VOTE_MISSING/);a.equal(f.commits.length,0);
 f.p.last[USER]=now+1;f.p.votes={};f.p.order=[];a.deepEqual(await f.booking.receive(callback(),f.p),{applied:false,reason:'stale_vote'});a.equal(f.commits.length,0);
});
