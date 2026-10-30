'use strict';
const {at}=require('./fitpp-direct-diagnostic');
const {settings,connect}=require('./fitpp-direct-session');
const {createDirectTransport}=require('./fitpp-direct');
const bridge=require('./fitpp-test-bridge');
const {POLL}=require('../direct-core/src/pilot-policy.cjs');
// Explicit composition candidate; deployed entrypoint deliberately unchanged.
async function prepare({env=process.env,sdk,now=Date.now}) {
 await at('SETTINGS',()=>settings(env));
 const directEnv={...env,FITPP_BRIDGE_URL:'https://direct.invalid/bot/update'};
 const s=await at('BRIDGE_SETTINGS',()=>bridge.settings(directEnv));
 // The historical pilot still rejects late votes in its service. Daily test polls
 // must not inherit that single pilot's startup expiry. No booking scope is widened.
 const autopost=require('./training-test-autopost').settings(env);
 const checkTime=()=>{if(!autopost&&now()>=POLL.closesAt)throw Error('POLL_CLOSED')};
 const openedAt=Number(env.FITPP_DIRECT_POLL_OPENED_AT);
 await at('POLL_TIME',()=>{if(!/^\d+$/.test(env.FITPP_DIRECT_POLL_OPENED_AT||'')||!Number.isSafeInteger(openedAt)||openedAt>=POLL.closesAt||openedAt>now())throw Error('POLL_OPEN_TIME_REQUIRED')});
 await at('SCOPE',()=>{if(s.scope.chat!==POLL.chat||s.scope.mid!==POLL.mid||s.scope.uuid!==POLL.uuid||String(s.scope.user)!=='5819064')throw Error('EXACT_SCOPE_REQUIRED')});
 await at('POLL_TIME',checkTime);
 const session=await at('CONNECT',()=>connect({env,sdk}));
 try {
  await at('POLL_TIME',checkTime);
  const transport=await at('TRANSPORT',()=>createDirectTransport({db:session.db,key:s.key,poll:{...POLL,openedAt},enabled:true,verifiedTestIdentity:true,now}));
  // Read-only capability check, no MAX requests and no booking writes.
  await at('POLL_VIEW',()=>bridge.signedPost(s,'/bot/poll-view',{chat:s.scope.chat,mid:s.scope.mid,uuid:s.scope.uuid},{transport,now}));
  await at('POLL_TIME',checkTime);
  const contact=env.CONTACT_LINK_ENABLED==='true'
   ?await at('CONTACT_CONFIG',()=>require('./contact-linking-runtime').prepare({env,sdk,now,session})):null;
  const dailyBooking=autopost?require('./fitpp-daily-booking').createDailyBooking({db:session.db,botId:env.TEST_EXPECTED_BOT_ID,now}):null;
  return {contact,dailyBooking,autopostStore:session.autopostStore,calendarPollStore:session.calendarPollStore,calendarStore:session.calendarStore,calendarDb:session.db,env:directEnv,callbackTransport:transport,post:(a,p,b)=>bridge.signedPost(a,p,b,{transport,now}),close:session.close};
 } catch(error){await session.close();throw error}
}
module.exports={prepare};
