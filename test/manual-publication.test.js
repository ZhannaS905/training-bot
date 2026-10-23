const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {CHAT,MemoryTrainingTest,trainingDate,body}=require('../src/memory-training-test');
const {TestPublicationAttempts}=require('../src/test-publication-attempts');
const command=(text='/тестопрос',mid='event1')=>({update_type:'message_created',message:{recipient:{chat_id:CHAT},sender:{user_id:42,is_bot:false},body:{mid,text}}});
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'test-attempts-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'scope'),`training-test:${CHAT}:123`);
 await fs.writeFile(path.join(dir,'attempts.jsonl'),'');
 const calls=[];const api={async send(...args){calls.push(args);return 'owned';},async edit(){},async remove(){}};
 const c={send:true,auto:false,admins:['42'],expectedId:'123',attemptDirectory:dir};
 const service=()=>new MemoryTrainingTest(api,c,()=>new Date('2026-10-23T09:00:00Z'));
 return {dir,c,calls,api,service};
}
test('Friday selects Saturday; invalid, past and Friday dates rejected, no null body',()=>{
 const now=new Date('2026-10-23T09:00:00Z');
 assert.equal(trainingDate(undefined,now),'2026-10-24');
 for(const date of ['2026-10-23','2026-02-30','2026-10-22','bad'])assert.equal(trainingDate(date,now),null);
 assert.throws(()=>body({date:'2026-10-23',votes:new Map()}));
});
test('manual command, duplicate events, new events, restart, names on future poll',async t=>{
 const f=await fixture(t),s=f.service();await Promise.all([s.receive(command()),s.receive(command())]);
 await s.receive(command('/тестопрос 2026-10-24','event2'));await f.service().receive(command());
 assert.equal(f.calls.length,1);assert.match(f.calls[0][1].text,/18:00/);assert.match(f.calls[0][1].text,/онлайн/);
 const p=s.polls.get('2026-10-24');await s.receive({update_type:'message_callback',callback:{callback_id:'cb',payload:`poll:${p.id}:yes`,user:{user_id:8,first_name:'Анна'}},message:{recipient:{chat_id:CHAT},body:{mid:p.mid}}});
 assert.equal(p.votes.get(8),'Анна');
 // Replayed command cannot choose a different training after a restart/date change.
 const later=new MemoryTrainingTest(f.api,f.c,()=>new Date('2026-10-25T09:00:00Z'));await later.receive(command());assert.equal(f.calls.length,1);
});
test('foreign chat, missing admin, bot sender, malformed command, send denied',async t=>{
 const f=await fixture(t);
 for(const mutate of [u=>u.message.recipient.chat_id='-1',u=>u.message.sender.user_id=43,u=>u.message.sender.is_bot=true,u=>delete u.message.body.mid,u=>u.message.body.text='/тестопрос 2026-02-30']){const u=command();mutate(u);await f.service().receive(u);}
 f.c.admins=[];await f.service().receive(command());f.c.admins=['42'];f.c.send=false;await f.service().receive(command());assert.equal(f.calls.length,0);
});
test('ambiguous send persists reservation; missing/corrupt store and stale lock fail closed',async t=>{
 const f=await fixture(t);f.api.send=async()=>{f.calls.push([]);throw Error('timeout');};await f.service().receive(command());await f.service().receive(command('/тестопрос','new'));assert.equal(f.calls.length,1);
 await fs.writeFile(path.join(f.dir,'attempts.jsonl'),'broken');await assert.rejects(f.service().receive(command('/тестопрос 2026-10-25','new2')));
 await assert.rejects(f.service().receive(command('/тестопрос 2026-10-25','new3')));assert.equal(f.calls.length,1);
 const missing=new TestPublicationAttempts(path.join(f.dir,'missing'),'123');await assert.rejects(missing.reserve('2026-10-25','a'));
});
test('two processes sharing store cannot both reserve a date',async t=>{
 const f=await fixture(t);const results=await Promise.allSettled([new TestPublicationAttempts(f.dir,'123').reserve('2026-10-24','a'),new TestPublicationAttempts(f.dir,'123').reserve('2026-10-24','b')]);assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value).length,1);
 const rows=(await fs.readFile(path.join(f.dir,'attempts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]),['date','event']);
});
