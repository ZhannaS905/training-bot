'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash,timingSafeEqual,randomUUID}=require('node:crypto');
const id=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const chatId=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v!==0;
const digest=v=>createHash('sha256').update(v).digest();
// Only called after guardedApi has verified Training Test, behind the authenticated webhook.
function ownerDialog(env,verifiedBotId,{now=Date.now}={}){
 if(env.OWNER_DIALOG_ENABLED===undefined||env.OWNER_DIALOG_ENABLED==='false')return {receive:async()=>{}};
 if(env.OWNER_DIALOG_ENABLED!=='true'||env.BOT_MODE!=='test'||env.OWNER_DIALOG_APPROVAL!=='fitpp-test-owner-approved'||
    env.TEST_EXPECTED_BOT_ID!==verifiedBotId||!id(Number(verifiedBotId))||
    !/^[1-9]\d*$/.test(env.OWNER_DIALOG_USER_ID||'')||!id(Number(env.OWNER_DIALOG_USER_ID))||
    !/^[a-f0-9]{64}$/.test(env.OWNER_DIALOG_CODE_SHA256||'')||
    !Number.isSafeInteger(Number(env.OWNER_DIALOG_EXPIRES_AT))||Number(env.OWNER_DIALOG_EXPIRES_AT)<=0||Number(env.OWNER_DIALOG_EXPIRES_AT)>now()+600000||
    !path.isAbsolute(env.OWNER_DIALOG_STATE_DIR||''))throw Error('OWNER_DIALOG_CONFIG_REFUSED');
 const directory=env.OWNER_DIALOG_STATE_DIR;
 // Provision a dedicated persistent directory; refuse links and shared access.
 const stat=fs.lstatSync(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)||fs.realpathSync(directory)!==directory)throw Error('OWNER_DIALOG_STORAGE_REFUSED');
 const target=path.join(directory,'owner-dialog.json');
 const owner=Number(env.OWNER_DIALOG_USER_ID),expires=Number(env.OWNER_DIALOG_EXPIRES_AT);
 const expected=Buffer.from(env.OWNER_DIALOG_CODE_SHA256,'hex');let pending=null,attempts=0;
 function persist(value){
  const temp=path.join(directory,'.'+randomUUID());let fd;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   try{fs.linkSync(temp,target)}catch(e){if(e.code!=='EEXIST')throw e;
    const st=fs.lstatSync(target);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw Error('OWNER_DIALOG_STATE_REFUSED');
    const old=JSON.parse(fs.readFileSync(target,'utf8'));
    if(JSON.stringify(old)!==JSON.stringify(value))throw Error('OWNER_DIALOG_ALREADY_BOUND');
   }
   const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
  }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temp,{force:true})}
 }
 return {async receive(u){
  const time=now();if(time>=expires||!Number.isSafeInteger(u?.timestamp)||u.timestamp>time+30000||u.timestamp<time-300000)return;
  if(u.update_type==='bot_started'){
   if(u.user?.user_id===owner&&u.user.is_bot===false&&chatId(u.chat_id))pending={chat:u.chat_id,at:u.timestamp};
   return; // payload is deliberately ignored, including supposed authorization tokens.
  }
  if(u.update_type!=='message_created'||!pending||attempts>=5)return;
  const m=u.message,r=m?.recipient;
  if(m?.sender?.user_id!==owner||m.sender.is_bot!==false||r?.chat_type!=='dialog'||r.chat_id!==pending.chat||r.user_id!==Number(verifiedBotId)||m.link!=null||u.timestamp<pending.at||!Number.isSafeInteger(m.timestamp)||m.timestamp<pending.at||Math.abs(time-m.timestamp)>300000)return;
  const match=/^\/confirm-owner ([a-f0-9]{32})$/.exec(m.body?.text||'');if(!match)return;
  attempts++;if(!timingSafeEqual(digest(match[1]),expected))return;
  persist({version:1,botId:verifiedBotId,userId:String(owner),chatId:String(pending.chat),chatType:'dialog',ownerApproved:true,subscriptionNotifications:false});
 }};
}
module.exports={ownerDialog};
