'use strict';
// Read-only: no Store lock, no Firebase import, no POST/PUT/DELETE capability.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const ROOT='/opt/training-test';
async function inspect({root=ROOT,env=process.env,log=console.log}={}){
 const {POLL}=require(path.join(root,'direct-core/src/pilot-policy.cjs'));
 if(POLL.date!=='2026-10-26'||POLL.chat!=='-80345864298680'||POLL.mid!=='mid.ffffb6ed054c9f4801a169a000563611'||POLL.uuid!=='99732d34-b609-4266-9418-f12de9b3fe62')throw Error('EXPECTED_PILOT_REFUSED');
 const {config}=require(path.join(root,'src/memory-training-test.js'));
 const {MaxApi}=require(path.join(root,'src/api.js'));
 const {checkTestBotIdentity,identityAccepted}=require(path.join(root,'src/test-bot-identity.js'));
 const c=config(env),client=new MaxApi(c.token);
 // Only expose GET to this diagnostic, including all identity checks.
 const get=(endpoint,query)=>client.request('GET',endpoint,query);
 const me=await get('/me');
 if(!identityAccepted(checkTestBotIdentity(me,c.expectedId)))throw Error('TEST_IDENTITY_REFUSED');
 const chat=await get('/chats/'+POLL.chat),member=await get('/chats/'+POLL.chat+'/members/me');
 if(String(chat.chat_id)!==POLL.chat||chat.title!=='Тест тренировок'||member.user_id!==me.user_id||member.is_bot!==true)throw Error('TEST_CHAT_REFUSED');
 const m=await get('/messages/'+encodeURIComponent(POLL.mid));
 const keyboards=(m?.body?.attachments||[]).filter(a=>a.type==='inline_keyboard');
 const buttons=keyboards.flatMap(a=>(a.payload?.buttons||[]).flat());
 const expected=['yes','cancel'].map(a=>`poll:${POLL.uuid}:${a}`);
 const checks={midMatches:m?.body?.mid===POLL.mid,chatMatches:String(m?.recipient?.chat_id)===POLL.chat&&m.recipient.chat_type==='chat',authorMatches:m?.sender?.user_id===me.user_id&&m.sender.is_bot===true,
  buttonsMatch:keyboards.length===1&&buttons.length===2&&expected.every(p=>buttons.filter(b=>b.type==='callback'&&b.payload===p).length===1),
  dateMatches:typeof m?.body?.text==='string'&&m.body.text.includes('26 октября'),placeMatches:typeof m?.body?.text==='string'&&m.body.text.includes('Заря'),timeMatches:typeof m?.body?.text==='string'&&m.body.text.includes('20:00')};
 if(!Object.values(checks).every(v=>v===true))throw Error('TODAY_MESSAGE_REFUSED');
 const list=await get('/messages',{chat_id:POLL.chat,count:100});
 if(!Array.isArray(list.messages)||list.messages.length>=100)throw Error('COMPLETE_HISTORY_REQUIRED');
 const matching=list.messages.filter(item=>String(item?.recipient?.chat_id)===POLL.chat&&typeof item?.body?.text==='string'&&item.body.text.includes('26 октября')&&item.body.text.includes('Заря')&&item.body.text.includes('20:00')&&(item.body.attachments||[]).some(a=>a.type==='inline_keyboard'));
 if(matching.length!==1||matching[0].body.mid!==POLL.mid)throw Error('TODAY_HISTORY_AMBIGUOUS');
 let ledger={checked:false,reason:'state_dir_not_configured'};
 const dir=env.TRAINING_TEST_AUTOPOST_STATE_DIR;
 if(dir){
  if(!path.isAbsolute(dir))throw Error('LEDGER_PATH_REFUSED');
  const file=path.join(dir,'state.json');
  if(fs.existsSync(file)){
   const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('LEDGER_PATH_REFUSED');
   const bytes=fs.readFileSync(file),s=JSON.parse(bytes),p=s.polls?.[POLL.date];
   if(s.autopost?.chat!==POLL.chat)throw Error('LEDGER_CHAT_REFUSED');
   ledger={checked:true,status:p?.status??null,mid:p?.mid??null,midMatches:p?.mid===POLL.mid,sha256:createHash('sha256').update(bytes).digest('hex')};
  }else ledger={checked:false,reason:'ledger_missing'};
 }
 const report={checkedAt:new Date().toISOString(),date:POLL.date,chat:POLL.chat,mid:POLL.mid,uuid:POLL.uuid,checks,matchingPolls:matching.length,messageSha256:createHash('sha256').update(JSON.stringify(m)).digest('hex'),ledger};
 log(JSON.stringify(report,null,2));return report;
}
if(require.main===module)inspect().catch(error=>{console.error(/^MAX HTTP [1-5]\d\d$/.test(error?.message||'')?error.message:'TODAY_INSPECTION_REFUSED');process.exitCode=1});
module.exports={inspect};
