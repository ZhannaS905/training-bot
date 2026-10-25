'use strict';
// Offline candidate. Deliberately not selected by the deployed entrypoint.
const {verify}=require('../direct-core/src/ingress.cjs');
const {normalize,assertPoll,POLL}=require('../direct-core/src/pilot-policy.cjs');
const {handle}=require('../direct-core/src/max-adapter.cjs');
const {readPollView}=require('../direct-core/src/poll-view.cjs');
const {Service}=require('../direct-core/src/service.cjs');
function createDirectTransport({db,key,poll,verifiedTestIdentity=false,enabled=false,now=Date.now}) {
 if(!enabled||verifiedTestIdentity!==true)throw Error('DIRECT_DISABLED');
 if(!/^[a-f0-9]{64}$/.test(key||''))throw Error('DIRECT_KEY_REQUIRED');
 assertPoll(poll);
 if(!Number.isSafeInteger(poll.openedAt)||poll.openedAt>=poll.closesAt)throw Error('POLL_OPEN_TIME_REQUIRED');
 const svc=new Service(db,{now});
 return async function transport(url,options) {
  const target=new URL(url);
  // A non-network capability endpoint, never a configurable cloud/bridge URL.
  if(target.href!=='https://direct.invalid/bot/update'&&target.href!=='https://direct.invalid/bot/poll-view')throw Error('DIRECT_ROUTE_REJECTED');
  if(options?.method!=='POST'||typeof options.body!=='string'||Buffer.byteLength(options.body)>16000)throw Error('DIRECT_REQUEST_REJECTED');
  verify(key,options.headers?.['x-time'],target.pathname,options.body,options.headers?.['x-signature'],now());
  const payload=JSON.parse(options.body);
  let result;
  if(target.pathname==='/bot/update') result=await handle(svc,normalize(payload,poll));
  else {
   if(payload.chat!==POLL.chat||payload.mid!==POLL.mid||payload.uuid!==POLL.uuid)throw Error('POLL_SCOPE_REJECTED');
   result=await readPollView(db,poll,{optimistic:payload.optimistic===true});
  }
  // Only resolve after transaction commit. Errors propagate to webhook retry.
  return {ok:true,status:200,json:async()=>result};
 };
}
module.exports={createDirectTransport};
