const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CHAT,MemoryTrainingTest,trainingDate,body}=require('../src/memory-training-test');
const {TestPublicationAttempts}=require('../src/test-publication-attempts');
const command=(text='/тестопрос',mid='event1')=>({update_type:'message_created',message:{recipient:{chat_id:CHAT},sender:{user_id:42,is_bot:false},body:{mid,text}}});
async function fixture(){
 const calls=[];const api={async send(...args){calls.push(args);return 'owned';},async edit(){},async remove(){}};
 const c={send:true,auto:false,admins:['42'],expectedId:'123'};
 const service=()=>new MemoryTrainingTest(api,c,()=>new Date('2026-10-23T09:00:00Z'));
 return {c,calls,api,service};
}
test('Friday selects Saturday; invalid, past and Friday dates rejected, no null body',()=>{
 const now=new Date('2026-10-23T09:00:00Z');
 assert.equal(trainingDate(undefined,now),'2026-10-24');
 for(const date of ['2026-10-23','2026-02-30','2026-10-22','bad'])assert.equal(trainingDate(date,now),null);
 assert.throws(()=>body({date:'2026-10-23',votes:new Map()}));
});
test('manual command, duplicate events, new events, restart, names on future poll',async t=>{
 const f=await fixture(t),s=f.service();await Promise.all([s.receive(command()),s.receive(command())]);
 await s.receive(command('/тестопрос 2026-10-24','event2'));
 await s.receive(command('/тестопрос 2026-10-25','event1')); // Same event cannot select another date.
 assert.equal(f.calls.length,1);assert.match(f.calls[0][1].text,/18:00/);assert.match(f.calls[0][1].text,/онлайн/);
 const p=s.polls.get('2026-10-24');await s.receive({update_type:'message_callback',callback:{callback_id:'cb',payload:`poll:${p.id}:yes`,user:{user_id:8,first_name:'Анна'}},message:{recipient:{chat_id:CHAT},body:{mid:p.mid}}});
 assert.equal(p.votes.get(8),'Анна');
 // Restart intentionally loses reservations and ignores old poll callbacks.
 const restarted=f.service();await restarted.receive(command());assert.equal(f.calls.length,2);
 await restarted.receive({update_type:'message_callback',callback:{callback_id:'old',payload:`poll:${p.id}:yes`,user:{user_id:9,first_name:'Ольга'}},message:{recipient:{chat_id:CHAT},body:{mid:p.mid}}});
 assert.equal(restarted.polls.get('2026-10-24').votes.size,0);
});
test('foreign chat, missing admin, bot sender, malformed command, send denied',async t=>{
 const f=await fixture(t);
 for(const mutate of [u=>u.message.recipient.chat_id='-1',u=>u.message.sender.user_id=43,u=>u.message.sender.is_bot=true,u=>delete u.message.body.mid,u=>u.message.body.text='/тестопрос 2026-02-30']){const u=command();mutate(u);await f.service().receive(u);}
 f.c.admins=[];await f.service().receive(command());f.c.admins=['42'];f.c.send=false;await f.service().receive(command());assert.equal(f.calls.length,0);
});
test('ambiguous send reserves date and event until restart without disk storage',async t=>{
 const f=await fixture(t),s=f.service();f.api.send=async()=>{f.calls.push([]);throw Error('timeout');};
 await s.receive(command());await s.receive(command('/тестопрос','new'));
 await s.receive(command('/тестопрос 2026-10-25','event1'));assert.equal(f.calls.length,1);
 await f.service().receive(command());assert.equal(f.calls.length,2);
});
test('concurrent reservations protect dates and replayed events; fresh memory resets both',async()=>{
 const attempts=new TestPublicationAttempts();
 assert.deepEqual(await Promise.all([attempts.reserve('2026-10-24','a'),attempts.reserve('2026-10-24','b')]),[true,false]);
 assert.equal(await attempts.reserve('2026-10-25','a'),false);
 assert.equal(await attempts.reserve('2026-10-25','c'),true);
 assert.equal(await new TestPublicationAttempts().reserve('2026-10-24','a'),true);
});
test('manual mode does not auto-publish and configuration ignores obsolete disk settings',async t=>{
 const {config}=require('../src/memory-training-test');
 const env={BOT_MODE:'test',CHAT_IDS:CHAT,TEST_BOT_TOKEN:'offline',TEST_EXPECTED_BOT_ID:'123',WEBHOOK_SECRET:'offline_secret_123',TEST_ADMIN_IDS:'42',TEST_ALLOW_SEND:'true',AUTO_PUBLISH:'false'};
 const c=config(env);assert.equal(c.auto,false);assert.deepEqual(c.admins,['42']);
 assert.deepEqual(config({...env,TEST_ATTEMPT_DIR:'/nonexistent/unused'}),c);
 assert.throws(()=>config({...env,TEST_ADMIN_IDS:'username'}));
 const f=await fixture(t),s=f.service();await s.tick();assert.equal(f.calls.length,0);
 await s.receive(command());await s.tick();assert.equal(f.calls.length,1);
});
