'use strict';
const http=require('node:http');
const {ownerDialog}=require('./owner-dialog');
const {at,format}=require('./training-startup-diagnostic');
const {createHmac}=require('node:crypto');
const {createWebhook}=require('./memory-test-webhook');
const {config,guardedApi}=require('./memory-training-test');
const {createRam}=require('./fitpp-ram');
function settings(env){
 if(env.BOT_MODE!=='test'||env.FITPP_BRIDGE_ENABLED!=='true')throw Error('TEST_BRIDGE_DISABLED');
 if(['AUTO_PUBLISH','TEST_ALLOW_SEND','TEST_ALLOW_EDIT','TEST_ALLOW_DELETE'].some(k=>env[k]!=='false'))throw Error('POLL_WRITES_MUST_BE_DISABLED');
 const key=env.FITPP_BRIDGE_HMAC_KEY,url=new URL(env.FITPP_BRIDGE_URL);
 if(!/^[a-f0-9]{64}$/.test(key||'')||url.protocol!=='https:'||url.pathname!=='/bot/update'||url.search||url.hash||url.username||url.password)throw Error('BRIDGE_SETTINGS_REJECTED');
 const scope=JSON.parse(env.FITPP_BRIDGE_SCOPE||'{}');
 if(typeof scope.chat!=='string'||scope.chat!==env.CHAT_IDS||!/^-[1-9]\d*$/.test(scope.chat)||!Number.isSafeInteger(Number(scope.user))||Number(scope.user)<=0||!/^mid\.[a-zA-Z0-9]+$/.test(scope.mid||'')||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(scope.uuid||''))throw Error('EXACT_SCOPE_REQUIRED');
 if(env.FITPP_POLL_SYNC_ENABLED!==undefined&&!['true','false'].includes(env.FITPP_POLL_SYNC_ENABLED))throw Error('POLL_SYNC_FLAG_REJECTED');
 return {key,url:url.href,scope,pollSync:env.FITPP_POLL_SYNC_ENABLED==='true'};
}
async function signedPost(s,path,payload,{transport=fetch,now=Date.now}={}){
 const target=new URL(s.url);target.pathname=path;const body=JSON.stringify(payload),time=String(now());
 const signature=createHmac('sha256',s.key).update([time,'POST',path,body].join(String.fromCharCode(10))).digest('hex');
 const r=await transport(target.href,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-time':time,'x-signature':signature},body,signal:AbortSignal.timeout(20000)});
 if(!r.ok){const error=Error('FITPP_BRIDGE_REJECTED');error.status=r.status;throw error}return r.json();
}
function receiver(s,{transport=fetch,now=Date.now,log=console.log,sync,optimistic,clock=()=>performance.now()}={}){
 return {async receive(u,receivedAt=clock()){
 const p=s.scope;
 if(u?.update_type!=='message_callback'||String(u.message?.recipient?.chat_id)!==p.chat||u.message?.recipient?.chat_type!=='chat'||u.message?.body?.mid!==p.mid||String(u.callback?.user?.user_id)!==String(p.user)||u.callback?.user?.is_bot!==false||!['poll:'+p.uuid+':yes','poll:'+p.uuid+':cancel'].includes(u.callback.payload))return;
 if(typeof u.callback.callback_id!=='string'||!u.callback.callback_id||u.callback.callback_id.length>256)throw Error('CALLBACK_ID_REQUIRED');
 const at=u.callback.timestamp??u.timestamp;if(!Number.isSafeInteger(at)||Math.abs(now()-at)>86400000||at>now()+30000)throw Error('EVENT_TIME_REJECTED');
 const event={update_type:'message_callback',timestamp:u.timestamp,callback:{callback_id:u.callback.callback_id,user:{user_id:Number(p.user),is_bot:false},payload:u.callback.payload,...(u.callback.timestamp===undefined?{}:{timestamp:u.callback.timestamp})},message:{recipient:{chat_type:'chat',chat_id:p.chat},body:{mid:p.mid}}};
 const started=clock();
 let committed,commitStarted;const commit=async()=>{commitStarted=clock();const result=await signedPost(s,'/bot/update',event,{transport,now});committed=clock();return result};
 if(!optimistic)log(JSON.stringify({event:'fitpp_ram_fast_path',used:false,reason:s.pollSync?'controller_unavailable':'poll_sync_disabled'}));
 const d=optimistic?await optimistic.run(event,commit,receivedAt):await commit();

 // Never render from d.booked: a duplicate may refer to an older revision.
 if(sync&&!optimistic)await sync();
 log(JSON.stringify({event:'fitpp_test_booking',applied:d.applied===true,duplicate:d.duplicate===true,booked:d.booked===true,queueWaitMs:Math.round(started-receivedAt),bridgeUpdateMs:Math.round(committed-commitStarted),syncMs:Math.round(clock()-committed),totalMs:Math.round(clock()-receivedAt)}));
 }};
}
// One queue covers callback writes and projection reads; timer ticks never build a backlog.
function startReconciliation(sync,{schedule=setInterval,cancel=clearInterval,onError=()=>{}}={}){
 let tail=Promise.resolve(),pending=0,stopped=false;
 const run=job=>{pending++;const next=tail.then(job);tail=next.catch(()=>{}).finally(()=>{pending--});return next};
 const retry=()=>{if(!stopped&&sync&&pending===0)void run(sync).catch(onError)};
 const timer=sync?schedule(retry,30000):null;if(sync)retry();
 return {run,stop(){stopped=true;if(timer!==null)cancel(timer)}};
}
async function main({env=process.env,verify=guardedApi,post=signedPost,makeServer=http.createServer,reconcile=startReconciliation,callbackTransport}={}){
 const {s,c}=await at('CONFIG',()=>({s:settings(env),c:config(env)}));
 const api=await at('MAX_IDENTITY',()=>verify(c,undefined,s.pollSync?{pollScope:s.scope}:{}));
 const owner=ownerDialog(env,c.expectedId);
 const optimistic=s.pollSync?createRam({scope:s.scope,api:{...api,syncPollText:(...args)=>at('MAX_POLL',()=>api.syncPollText(...args))},
  loadView:()=>post(s,'/bot/poll-view',{chat:s.scope.chat,mid:s.scope.mid,uuid:s.scope.uuid,optimistic:true}),
  log:entry=>console.log(JSON.stringify(entry))}):null;
 // Listen independently of the bridge. A cold controller never invents an empty poll.
 // Reconciliation primes the binding in the background and retries after failure.
 const loop=reconcile(optimistic?()=>at('BRIDGE_SNAPSHOT',()=>optimistic.refresh()):null,{onError:error=>console.error(format(error).replace('startup refused','reconciliation pending'))});
 const callbacks=receiver(s,{optimistic,...(callbackTransport?{transport:callbackTransport}:{})});
 // Each request awaits its durable mediator result. A crash leaves delivery unacknowledged.
 const handler=createWebhook({receive:async u=>{await owner.receive(u);await callbacks.receive(u,performance.now())}},c.secret).listeners('request')[0];
 const server=makeServer((req,res)=>{if(req.method==='GET'&&req.url==='/health')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ready:true,mode:'fitpp-test-exact-poll-bridge',callbacksOnly:env.OWNER_DIALOG_ENABLED!=='true',pollDisplaySync:s.pollSync,pollDisplayReady:optimistic?optimistic.status().ready:null}));void handler(req,res)});
 await at('LISTEN',()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3000,'0.0.0.0',resolve)})).catch(error=>{loop.stop();throw error});
 const stop=()=>{loop.stop();server.close();server.closeIdleConnections?.()};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 console.log('Training Test: verified identity/chat; exact-poll bridge ready; poll display sync '+(s.pollSync?'enabled':'disabled')+'; no poll publication.');return server;
}
module.exports={settings,receiver,signedPost,startReconciliation,main};
