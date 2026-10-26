'use strict';
const CHAT='-80345864298680',USER='5819064';
const POLL=Object.freeze({confirmed:true,chat:CHAT,mid:'mid.ffffb6ed054c9f4801a169a000563611',uuid:'99732d34-b609-4266-9418-f12de9b3fe62',date:'2026-10-26',location:'zarya',time:'20:00',timezone:'Europe/Moscow',workoutId:'zarya_2026-10-26',closesAt:Date.parse('2026-10-26T18:00:00Z')});
function assertPoll(p){if(!p||p.confirmed!==true||Object.keys(POLL).some(k=>p[k]!==POLL[k]))throw Error('EXACT_POLL_REQUIRED');return p}
function validate(u,poll){
assertPoll(poll);
if(u?.update_type!=='message_callback'||String(u.callback?.user?.user_id)!==USER||u.callback.user.is_bot!==false||u.message?.recipient?.chat_type!=='chat'||String(u.message.recipient.chat_id)!==CHAT||u.message?.body?.mid!==POLL.mid||!['poll:'+POLL.uuid+':yes','poll:'+POLL.uuid+':cancel'].includes(u.callback.payload))throw Error('PILOT_SCOPE_REJECTED');
if(typeof u.callback.callback_id!=='string'||!u.callback.callback_id||u.callback.callback_id.length>256)throw Error('CALLBACK_ID_REQUIRED');
return u;
}
function normalize(u,poll){validate(u,poll);return {...u,callback:{...u.callback,payload:u.callback.payload.endsWith(':yes')?'poll_yes':'poll_cancel'},pilotPollUuid:POLL.uuid}}
module.exports={validate,normalize,assertPoll,CHAT,USER,POLL};
