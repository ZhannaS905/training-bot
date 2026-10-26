'use strict';
// Derived from the existing isolated MAX adapter. No SDK startup, token or new bot.
async function handle(service,u){
if(u?.update_type==='message_callback'){
 if(u.message?.recipient?.chat_type!=='chat'||u.callback?.user?.is_bot!==false)throw Error('GROUP_HUMAN_CALLBACK_REQUIRED');
 if(!['poll_yes','poll_cancel'].includes(u.callback.payload))throw Error('PAYLOAD_REJECTED');
 const at=u.callback.timestamp??u.timestamp;if(u.callback.timestamp!==undefined&&u.timestamp!==undefined&&u.callback.timestamp!==u.timestamp)throw Error('TIMESTAMP_MISMATCH');
 return service.callback({pollUuid:u.pilotPollUuid,id:u.callback.callback_id,uid:u.callback.user.user_id,at,chat:String(u.message.recipient.chat_id),mid:u.message.body.mid,payload:u.callback.payload});
}
if(u?.update_type!=='message_created'||u.message?.recipient?.chat_type!=='dialog'||u.message?.sender?.is_bot!==false||u.message?.link||u.message?.body?.text!=='Мой абонемент')throw Error('PRIVATE_ORIGINAL_COMMAND_REQUIRED');
const b=await service.balance(u.message.sender.user_id);return {text:`Остаток занятий: ${b.left}\nСрок действия: ${b.expires}`};
}module.exports={handle};
