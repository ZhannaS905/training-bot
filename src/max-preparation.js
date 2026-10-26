'use strict';
// Stage 3 only. No API, SDK, environment reads, persistence or background work.
// Verification is a future adapter's responsibility, never inferred from an ID.
const STATES=Object.freeze({DISABLED:'disabled',MISSING:'missing_configuration',
  VERIFY:'awaiting_verification',PREPARED:'test_prepared',ERROR:'error'});
function connection(config={}) {
  const result=(state,reason)=>Object.freeze({state,reason,sendAllowed:false,clientBindingAllowed:false});
  if(config.enabled===false||config.enabled===undefined)return result(STATES.DISABLED,'Preparation disabled');
  if(config.enabled!==true||config.mode!=='test'||config.projectId!=='fitpp-test'||config.datasetId!=='synthetic-v1')
    return result(STATES.ERROR,'Test scope required');
  // Dedicated fields only: never fall back to CHAT_IDS, poll chat or recipient ID.
  if(!config.testBotId||!config.ownerPrivateChatId||!config.tokenConfigured)
    return result(STATES.MISSING,'Dedicated test bot, token and owner private chat required');
  if(!/^[1-9]\d*$/.test(config.testBotId)||! /^-?[1-9]\d*$/.test(config.ownerPrivateChatId)||config.tokenConfigured!==true)
    return result(STATES.ERROR,'Invalid configuration');
  const v=config.verification;
  if(!v)return result(STATES.VERIFY,'Bot identity and owner private dialog must be verified');
  if(v.botId!==config.testBotId||v.chatId!==config.ownerPrivateChatId||v.chatType!=='dialog'||v.ownerConfirmed!==true)
    return result(STATES.ERROR,'Verification does not match the owner private dialog');
  return result(STATES.PREPARED,'Configuration prepared; transport and client binding remain disabled');
}
function bindingDraft(clientId) {
  if(typeof clientId!=='string'||!/^demo-client-[1-4]$/.test(clientId))throw Error('SYNTHETIC_CLIENT_REQUIRED');
  return Object.freeze({version:1,projectId:'fitpp-test',datasetId:'synthetic-v1',clientId,
    state:'unlinked',maxUserId:null,linkingAllowed:false});
}
function bindClient() { throw Error('CLIENT_BINDING_DISABLED'); }
function prepareNotification(config,event) {
  const state=connection(config);
  // No recipient may ever come from an attendance event/client binding.
  if(!event||Object.keys(event).some(k=>!['status','subscriptionDebited','remaining','workoutDate'].includes(k)))
    return Object.freeze({allowed:false,reason:'EVENT_REJECTED',connectionState:state.state});
  if(!['attended','missed'].includes(event.status)||event.subscriptionDebited!==true)
    return Object.freeze({allowed:false,reason:'NO_SUBSCRIPTION_DEBIT',connectionState:state.state});
  return Object.freeze({allowed:false,reason:'PREPARATION_ONLY',connectionState:state.state});
}
module.exports={STATES,connection,bindingDraft,bindClient,prepareNotification};
