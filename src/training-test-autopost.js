'use strict';
// Dedicated capability; general MAX write flags and Firebase adapters stay unchanged.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Store}=require('./store'),{MaxApi}=require('./api');
const {CHAT,config,body}=require('./memory-training-test');
const {checkTestBotIdentity,identityAccepted}=require('./test-bot-identity');
const {moscow,times}=require('./schedule');
const {POLL}=require('../direct-core/src/pilot-policy.cjs');
const MID=/^mid\.[a-zA-Z0-9]+$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function settings(env){
 if(env.TRAINING_TEST_AUTOPOST_ENABLED===undefined||env.TRAINING_TEST_AUTOPOST_ENABLED==='false')return null;
 if(env.TRAINING_TEST_AUTOPOST_ENABLED!=='true')throw Error('AUTOPOST_FLAG_REFUSED');
 const c=config(env),dir=env.TRAINING_TEST_AUTOPOST_STATE_DIR;
 if(['AUTO_PUBLISH','TEST_ALLOW_SEND','TEST_ALLOW_EDIT','TEST_ALLOW_DELETE'].some(k=>env[k]!=='false'))throw Error('AUTOPOST_GENERAL_WRITES_REFUSED');
 if(!dir||!path.isAbsolute(dir)||path.resolve(dir)!==dir||dir==='/'||dir===env.STATE_DIR||env.TRAINING_TEST_AUTOPOST_DURABLE_VOLUME!=='true')throw Error('AUTOPOST_DURABLE_VOLUME_REQUIRED');
 return {...c,dir};
}
function training(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const d=new Date(date+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===date&&!!times[d.getUTCDay()];
}
function closesAt(date){const day=new Date(date+'T12:00:00Z').getUTCDay();return Date.parse(date+'T'+times[day]+':00+03:00')+60*60000}
function initialize(dir,startDate){
 if(!path.isAbsolute(dir)||!training(startDate))throw Error('AUTOPOST_INIT_REFUSED');
 // Only create a NEW directory. Never overwrite a ledger or silently lose receipts.
 fs.mkdirSync(dir,{mode:0o700});const store=new Store(dir);
 try{
  store.state.autopost={chat:CHAT,startDate};
  // Existing real direct pilot must block a second poll for its date.
  store.state.polls[POLL.date]={date:POLL.date,id:POLL.uuid,mid:POLL.mid,status:'external',votes:[],done:[],last:[]};
  store.save();
 }finally{store.close()}
}
function open(c){
 for(let current=c.dir;current!==path.dirname(current);current=path.dirname(current))if(!fs.lstatSync(current).isDirectory()||fs.lstatSync(current).isSymbolicLink())throw Error('AUTOPOST_PATH_REFUSED');
 for(const name of fs.readdirSync(c.dir)){const stat=fs.lstatSync(path.join(c.dir,name));if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink!==1))throw Error('AUTOPOST_PATH_REFUSED')}
 if(!fs.lstatSync(path.join(c.dir,'state.json')).isFile())throw Error('AUTOPOST_STATE_REQUIRED');
 const store=new Store(c.dir);
 try{
  const s=store.state;
  if(s.autopost?.chat!==CHAT||!training(s.autopost.startDate)||!s.polls||Array.isArray(s.polls))throw Error('AUTOPOST_STATE_REFUSED');
  for(const [date,p]of Object.entries(s.polls)){
   if(!p||!training(date)||p.date!==date||!UUID.test(p.id)||!['reserved','published','uncertain','external'].includes(p.status)||!Array.isArray(p.votes)||!Array.isArray(p.done)||!Array.isArray(p.last)||(['published','external'].includes(p.status)&&!MID.test(p.mid)))throw Error('AUTOPOST_STATE_REFUSED');
   if(p.status==='external'&&(date!==POLL.date||p.mid!==POLL.mid||p.id!==POLL.uuid))throw Error('AUTOPOST_STATE_REFUSED');
   if(p.votes.some(v=>!Array.isArray(v)||!Number.isSafeInteger(v[0])||v[0]<=0||typeof v[1]!=='string')||p.done.some(id=>typeof id!=='string')||p.last.some(v=>!Array.isArray(v)||!Number.isSafeInteger(v[0])||!Number.isSafeInteger(v[1])))throw Error('AUTOPOST_STATE_REFUSED');
  }
  if(s.polls[POLL.date]?.status!=='external'||s.polls[POLL.date]?.mid!==POLL.mid)throw Error('AUTOPOST_EXISTING_POLL_REQUIRED');
  return store;
 }catch(error){store.close();throw error}
}
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
  await verify();return raw.send(CHAT,body({...p,votes:new Map(p.votes)}),{disableLinkPreview:[0,6].includes(new Date(p.date+'T12:00:00Z').getUTCDay())});
 },async edit(p){
  if(p.status!=='published'||!MID.test(p.mid))throw Error('AUTOPOST_EDIT_REFUSED');
  await verify();const m=await raw.request('GET','/messages/'+encodeURIComponent(p.mid));
  const keyboards=(m?.body?.attachments||[]).filter(a=>a.type==='inline_keyboard'),buttons=keyboards.flatMap(a=>(a.payload?.buttons||[]).flat());
  if(m?.body?.mid!==p.mid||String(m?.recipient?.chat_id)!==CHAT||m?.sender?.user_id!==Number(c.expectedId)||m?.sender?.is_bot!==true||keyboards.length!==1||buttons.length!==2||!['yes','cancel'].every(action=>buttons.filter(b=>b.type==='callback'&&b.payload===`poll:${p.id}:${action}`).length===1))throw Error('AUTOPOST_EDIT_SCOPE_REFUSED');
  const b=body({...p,votes:new Map(p.votes)});await raw.edit(p.mid,{text:b.text,format:b.format,notify:false});
 }};
}
class Autopost{
 constructor({store,api,admins=[],now=()=>new Date(),log=console.error}){
  Object.assign(this,{store,api,admins,now,log});this.tail=Promise.resolve();this.stopped=false;this.startedAt=+now();this.lastTick=this.startedAt;
 }
 run(job){const next=this.tail.then(()=>{if(!this.stopped)return job()});this.tail=next.catch(()=>{});return next}
 async publish(date){
  const t=moscow(this.now());
  if(!training(date)||date!==t.date||date<this.store.state.autopost.startDate||t.clock>=times[t.day]||this.store.state.polls[date])return;
  await this.api.verify();
  const p={date,id:randomUUID(),status:'reserved',mid:null,votes:[],done:[],last:[]};
  // Fsync before dispatch. Never retry POST after an ambiguous result or a crash.
  this.store.state.polls[date]=p;this.store.save();
  try{const mid=await this.api.send(p);if(!MID.test(mid))throw Error('AUTOPOST_MID_REQUIRED');p.mid=mid;p.status='published';this.store.save();this.log('Training Test: scheduled poll published.')}
  catch{p.status='uncertain';this.store.save();this.log('Training Test: publication uncertain; automatic retry blocked; inspect MAX and ledger.')}
 }
 tick(){return this.run(async()=>{
  if(this.store.failed)throw Error('AUTOPOST_STORAGE_FAILED');
  const now=this.now(),t=moscow(now),due=Date.parse(t.date+'T10:00:00+03:00'),previous=this.lastTick;this.lastTick=+now;
  // Deadline crossing in this process only, within one minute; no startup catch-up.
  if(times[t.day]&&this.startedAt<=due&&previous<=due&&+now>=due&&+now<due+60000)await this.publish(t.date);
  for(const p of Object.values(this.store.state.polls))if(p.status==='published'&&p.dirty&&p.date===t.date&&+this.now()<closesAt(p.date)){
   try{await this.api.edit(p);p.dirty=false;this.store.save()}
   catch{this.log('Training Test: PUT /messages failed; edit will retry.');if(this.store.failed)throw Error('AUTOPOST_STORAGE_FAILED')}
  }
 })}
 // true consumes our polls; false keeps the existing exact FitPP route intact.
 receive(u){
  // Unrelated FitPP/contact traffic never waits for this publication queue.
  const message=u?.message,uuid=u?.callback?.payload?.split(':')[1];
  if(String(message?.recipient?.chat_id)!==CHAT||message.recipient.chat_type!=='chat')return Promise.resolve(false);
  if(message?.body?.text!=='/тестопрос-сегодня'&&!Object.values(this.store.state.polls).some(p=>p.id===uuid&&p.status!=='external'))return Promise.resolve(false);
  return this.run(async()=>{
  if(this.store.failed)throw Error('AUTOPOST_STORAGE_FAILED');
  const m=u?.message,t=moscow(this.now());
  if(String(m?.recipient?.chat_id)!==CHAT||m.recipient.chat_type!=='chat')return false;
  if(u.update_type==='message_created'&&m.sender?.is_bot===false&&Number.isSafeInteger(m.sender.user_id)&&this.admins.includes(String(m.sender.user_id))&&typeof m.body?.mid==='string'&&m.body.mid&&m.body.text==='/тестопрос-сегодня'){
   const at=m.timestamp??u.timestamp;if(!Number.isSafeInteger(at)||Math.abs(+this.now()-at)>60000)return true;
   await this.publish(t.date);return true;
  }
  const cb=u?.callback,match=/^poll:([a-f0-9-]{36}):(yes|cancel)$/.exec(cb?.payload||'');
  const p=match&&Object.values(this.store.state.polls).find(p=>p.id===match[1]&&p.status!=='external');if(!p)return false;
  if(u.update_type!=='message_callback'||p.status!=='published'||m.body?.mid!==p.mid||p.date!==t.date||+this.now()>=closesAt(p.date)||cb?.user?.is_bot!==false||!Number.isSafeInteger(cb.user.user_id)||cb.user.user_id<=0||typeof cb.callback_id!=='string'||!cb.callback_id||cb.callback_id.length>256)return true;
  const at=cb.timestamp??u.timestamp;if(!Number.isSafeInteger(at)||Math.abs(+this.now()-at)>86400000||at>+this.now()+30000||p.done.includes(cb.callback_id))return true;
  const last=new Map(p.last),votes=new Map(p.votes),uid=cb.user.user_id;if(at<=(last.get(uid)??-1))return true;
  if(match[2]==='cancel')votes.delete(uid);
  else{const name=[cb.user.first_name,cb.user.last_name].filter(x=>typeof x==='string').join(' ').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,100);votes.set(uid,name||`Участник ${uid}`)}
  if(Array.from(body({...p,votes}).text).length>4000)return true;
  last.set(uid,at);p.last=[...last];p.votes=[...votes];p.done.push(cb.callback_id);p.dirty=true;this.store.save();return true;
 })}
 close(){if(!this.closeFlight)this.closeFlight=(async()=>{await this.tail;this.stopped=true;this.store.close()})();return this.closeFlight}
}
async function prepare({env=process.env,now,raw}={}){
 const c=settings(env);if(!c)return null;const store=open(c);
 try{return new Autopost({store,api:await capability(c,{raw}),admins:c.admins,now})}catch(error){store.close();throw error}
}
function attach(service,{schedule=setInterval,cancel=clearInterval}={}){
 let busy=false;const tick=()=>{if(busy)return;busy=true;void service.tick().catch(()=>service.log('Training Test: autopost tick refused.')).finally(()=>{busy=false})};
 const timer=schedule(tick,1000);tick();return async()=>{cancel(timer);await service.close()};
}
module.exports={settings,training,initialize,open,capability,Autopost,prepare,attach};
