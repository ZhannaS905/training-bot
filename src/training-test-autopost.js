'use strict';
// Dedicated capability; general MAX write flags and Firebase adapters stay unchanged.
const {randomUUID}=require('node:crypto');
const {MaxApi}=require('./api');
const {CHAT,config,body}=require('./memory-training-test');
const {checkTestBotIdentity,identityAccepted}=require('./test-bot-identity');
const {moscow,times}=require('./schedule');
const {POLL}=require('../direct-core/src/pilot-policy.cjs');
const MID=/^mid\.[a-zA-Z0-9]+$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function settings(env){
 if(env.TRAINING_TEST_AUTOPOST_ENABLED===undefined||env.TRAINING_TEST_AUTOPOST_ENABLED==='false')return null;
 if(env.TRAINING_TEST_AUTOPOST_ENABLED!=='true')throw Error('AUTOPOST_FLAG_REFUSED');
 const c=config(env);
 if(env.FIREBASE_PROJECT_ID!=='fitpp-test')throw Error('AUTOPOST_TEST_PROJECT_REQUIRED');
 if(env.TRAINING_TEST_AUTOPOST_STORAGE&&env.TRAINING_TEST_AUTOPOST_STORAGE!=='firestore')throw Error('AUTOPOST_STORAGE_REFUSED');
 if(['AUTO_PUBLISH','TEST_ALLOW_SEND','TEST_ALLOW_EDIT','TEST_ALLOW_DELETE'].some(k=>env[k]!=='false'))throw Error('AUTOPOST_GENERAL_WRITES_REFUSED');
 return c;
}
function training(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const d=new Date(date+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===date&&!!times[d.getUTCDay()];
}
function closesAt(date){const day=new Date(date+'T12:00:00Z').getUTCDay();return Date.parse(date+'T'+times[day]+':00+03:00')+60*60000}
async function capability(c,{raw=new MaxApi(c.token)}={}){
 async function verify(){
  if(!identityAccepted(checkTestBotIdentity(await raw.request('GET','/me'),c.expectedId)))throw Error('AUTOPOST_IDENTITY_REFUSED');
  const chat=await raw.request('GET',`/chats/${CHAT}`);
  if(String(chat.chat_id)!==CHAT||chat.title!=='Тест тренировок')throw Error('AUTOPOST_CHAT_REFUSED');
  const member=await raw.request('GET',`/chats/${CHAT}/members/me`);
  if(member.user_id!==Number(c.expectedId)||member.is_bot!==true)throw Error('AUTOPOST_MEMBERSHIP_REFUSED');
 }
 await verify();
 return {verify,async send(p){
  await verify();return raw.send(CHAT,pollBody(p),{disableLinkPreview:[0,6].includes(new Date(p.date+'T12:00:00Z').getUTCDay())});
 },async edit(p,{beforePut=async()=>{}}={}){
  if(p.status!=='published'||!MID.test(p.mid))throw Error('AUTOPOST_EDIT_REFUSED');
  await verify();const m=await raw.request('GET','/messages/'+encodeURIComponent(p.mid));
  const keyboards=(m?.body?.attachments||[]).filter(a=>a.type==='inline_keyboard'),buttons=keyboards.flatMap(a=>(a.payload?.buttons||[]).flat());
  if(m?.body?.mid!==p.mid||String(m?.recipient?.chat_id)!==CHAT||m?.sender?.user_id!==Number(c.expectedId)||m?.sender?.is_bot!==true||keyboards.length!==1||buttons.length!==2||!['yes','cancel'].every(action=>buttons.filter(b=>b.type==='callback'&&b.payload===`poll:${p.id}:${action}`).length===1))throw Error('AUTOPOST_EDIT_SCOPE_REFUSED');
  const b=pollBody(p);await beforePut();await raw.edit(p.mid,{text:b.text,format:b.format,notify:false});
 }};
}
function pollBody(p){return body({...p,votes:new Map(p.order.map(uid=>[uid,p.votes[uid]]))})}
class Autopost{
 constructor({store,api,admins=[],now=()=>new Date(),log=console.error}){
  Object.assign(this,{store,api,admins,now,log});this.tail=Promise.resolve();this.stopped=false;this.startedAt=+now();this.lastTick=this.startedAt;
 }
 run(job){const next=this.tail.then(()=>{if(!this.stopped)return job()});this.tail=next.catch(()=>{});return next}
 async publish(date){
  const t=moscow(this.now());
  // Existing exact FitPP pilot remains untouched, including its duplicate guard.
  if(!training(date)||date!==t.date||date===POLL.date||t.clock>=times[t.day])return;
  await this.api.verify();
  const candidate={id:randomUUID(),createdAt:+this.now()};
  // Only the confirmed winner may dispatch. SDK transaction retries contain NO MAX calls.
  // Lost transaction acknowledgement => no send, even if a reservation was committed.
  if(!await this.store.reserve(date,candidate))return;
  const p=await this.store.read(date);
  if(p?.id!==candidate.id||p.status!=='reserved')throw Error('AUTOPOST_RESERVATION_REFUSED');
  try{const mid=await this.api.send(p);await this.store.finish(date,p.id,mid);this.log('Training Test: scheduled poll published.')}
  catch{await this.store.uncertain(date,p.id);this.log('Training Test: publication uncertain; automatic retry blocked; inspect MAX and Firestore.')}
 }
 tick(){return this.run(async()=>{
  const now=this.now(),t=moscow(now),due=Date.parse(t.date+'T10:00:00+03:00'),previous=this.lastTick;this.lastTick=+now;
  if(times[t.day]&&this.startedAt<=due&&previous<=due&&+now>=due&&+now<due+60000)await this.publish(t.date);
  if(!times[t.day]||t.date===POLL.date||+this.now()>=closesAt(t.date))return;
  const p=await this.store.read(t.date);
  if(p?.status!=='published'||p.revision===p.displayedRevision)return;
  const claimed=await this.store.claimEdit(t.date);if(!claimed)return;
  const token=claimed.editLease.token;
  try{
   await this.api.edit(claimed,{beforePut:()=>this.store.checkEdit(t.date,token)});
   await this.store.finishEdit(t.date,token,claimed.revision);
  }catch{
   this.log('Training Test: PUT /messages failed; edit will retry.');
   await this.store.releaseEdit(t.date,token);
  }
 })}
 receive(u){
  const m=u?.message,cb=u?.callback;
  if(String(m?.recipient?.chat_id)!==CHAT||m.recipient.chat_type!=='chat')return Promise.resolve(false);
  const match=/^poll:([a-f0-9-]{36}):(yes|cancel)$/.exec(cb?.payload||'');
  // The exact old pilot and private/contact traffic never wait on our queue or database.
  if(match?.[1]===POLL.uuid)return Promise.resolve(false);
  if(m?.body?.text!=='/тестопрос-сегодня'&&!match)return Promise.resolve(false);
  return this.run(async()=>{
   const t=moscow(this.now());
   if(u.update_type==='message_created'&&m.sender?.is_bot===false&&Number.isSafeInteger(m.sender.user_id)&&this.admins.includes(String(m.sender.user_id))&&typeof m.body?.mid==='string'&&m.body.mid&&m.body.text==='/тестопрос-сегодня'){
    const at=m.timestamp??u.timestamp;if(!Number.isSafeInteger(at)||Math.abs(+this.now()-at)>60000)return true;
    await this.publish(t.date);return true;
   }
   if(!match||u.update_type!=='message_callback'||t.date===POLL.date||+this.now()>=closesAt(t.date)||cb?.user?.is_bot!==false||!Number.isSafeInteger(cb.user.user_id)||cb.user.user_id<=0||typeof cb.callback_id!=='string'||!cb.callback_id||cb.callback_id.length>256)return false;
   const at=cb.timestamp??u.timestamp;if(!Number.isSafeInteger(at)||Math.abs(+this.now()-at)>86400000||at>+this.now()+30000)return true;
   const p=await this.store.read(t.date);
   if(!p||p.id!==match[1]||p.mid!==m.body?.mid)return false;
   const name=[cb.user.first_name,cb.user.last_name].filter(x=>typeof x==='string').join(' ').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,100)||`Участник ${cb.user.user_id}`;
   await this.store.vote(t.date,{id:cb.callback_id,uuid:match[1],mid:m.body.mid,uid:String(cb.user.user_id),at,action:match[2],name},pollBody);return true;
  })
 }
 close(){if(!this.closeFlight)this.closeFlight=(async()=>{await this.tail;this.stopped=true;await this.store.close()})();return this.closeFlight}
}
async function prepare({env=process.env,storeFactory,now,raw}={}){
 const c=settings(env);if(!c)return null;
 if(typeof storeFactory!=='function')throw Error('AUTOPOST_FIRESTORE_REQUIRED');
 const api=await capability(c,{raw});
 const store=storeFactory(c.expectedId,{writeEnabled:()=>env.TRAINING_TEST_AUTOPOST_ENABLED==='true'});
 // Server-only read, no local cache fallback and no startup writes.
 await store.read(moscow(now?now():new Date()).date);
 return new Autopost({store,api,admins:c.admins,now});
}
function attach(service,{schedule=setInterval,cancel=clearInterval}={}){
 let busy=false;const tick=()=>{if(busy)return;busy=true;void service.tick().catch(()=>service.log('Training Test: autopost tick refused.')).finally(()=>{busy=false})};
 const timer=schedule(tick,1000);tick();return async()=>{cancel(timer);await service.close()};
}
module.exports={settings,training,capability,pollBody,Autopost,prepare,attach};
