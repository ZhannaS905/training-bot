'use strict';
const http=require('node:http');
const {createHmac}=require('node:crypto');
const {createWebhook}=require('./memory-test-webhook');
const {config,guardedApi}=require('./memory-training-test');
function settings(env){
 if(env.BOT_MODE!=='test'||env.FITPP_BRIDGE_ENABLED!=='true')throw Error('TEST_BRIDGE_DISABLED');
 if(['AUTO_PUBLISH','TEST_ALLOW_SEND','TEST_ALLOW_EDIT','TEST_ALLOW_DELETE'].some(k=>env[k]!=='false'))throw Error('POLL_WRITES_MUST_BE_DISABLED');
 const key=env.FITPP_BRIDGE_HMAC_KEY,url=new URL(env.FITPP_BRIDGE_URL);
 if(!/^[a-f0-9]{64}$/.test(key||'')||url.protocol!=='https:'||url.pathname!=='/bot/update'||url.search||url.hash||url.username||url.password)throw Error('BRIDGE_SETTINGS_REJECTED');
 const scope=JSON.parse(env.FITPP_BRIDGE_SCOPE||'{}');
 if(typeof scope.chat!=='string'||scope.chat!==env.CHAT_IDS||!/^-[1-9]\d*$/.test(scope.chat)||!Number.isSafeInteger(Number(scope.user))||Number(scope.user)<=0||!/^mid\.[a-zA-Z0-9]+$/.test(scope.mid||'')||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(scope.uuid||''))throw Error('EXACT_SCOPE_REQUIRED');
 return {key,url:url.href,scope};
}
function receiver(s,{transport=fetch,now=Date.now,log=console.log}={}){
 return {async receive(u){
 const p=s.scope;
 if(u?.update_type!=='message_callback'||String(u.message?.recipient?.chat_id)!==p.chat||u.message?.recipient?.chat_type!=='chat'||u.message?.body?.mid!==p.mid||String(u.callback?.user?.user_id)!==String(p.user)||u.callback?.user?.is_bot!==false||!['poll:'+p.uuid+':yes','poll:'+p.uuid+':cancel'].includes(u.callback.payload))return;
 if(typeof u.callback.callback_id!=='string'||!u.callback.callback_id||u.callback.callback_id.length>256)throw Error('CALLBACK_ID_REQUIRED');
 const at=u.callback.timestamp??u.timestamp;if(!Number.isSafeInteger(at)||Math.abs(now()-at)>86400000||at>now()+30000)throw Error('EVENT_TIME_REJECTED');
 const event={update_type:'message_callback',timestamp:u.timestamp,callback:{callback_id:u.callback.callback_id,user:{user_id:Number(p.user),is_bot:false},payload:u.callback.payload,...(u.callback.timestamp===undefined?{}:{timestamp:u.callback.timestamp})},message:{recipient:{chat_type:'chat',chat_id:p.chat},body:{mid:p.mid}}};
 const body=JSON.stringify(event),time=String(now()),signature=createHmac('sha256',s.key).update(time+'\nPOST\n/bot/update\n'+body).digest('hex');
 const r=await transport(s.url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-time':time,'x-signature':signature},body,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('FITPP_BRIDGE_REJECTED');const d=await r.json();log(JSON.stringify({event:'fitpp_test_booking',applied:d.applied===true,duplicate:d.duplicate===true,booked:d.booked===true}));
 }};
}
async function main(){
 const s=settings(process.env),c=config(process.env);await guardedApi(c);
 const handler=createWebhook(receiver(s),c.secret).listeners('request')[0];
 const server=http.createServer((req,res)=>{if(req.method==='GET'&&req.url==='/health')return res.writeHead(200,{'Content-Type':'application/json'}).end('{"ready":true,"mode":"fitpp-test-exact-poll-bridge","callbacksOnly":true}');void handler(req,res)});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3000,'0.0.0.0',resolve)});
 const stop=()=>{server.close();server.closeIdleConnections?.()};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 console.log('Training Test: verified identity/chat; exact-poll bridge ready; no scheduler or poll publication.');return server;
}
module.exports={settings,receiver,main};
