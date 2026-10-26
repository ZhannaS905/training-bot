'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const {STATES,connection,bindingDraft,bindClient,prepareNotification}=require('../src/max-preparation');
// These values exist only in this isolated unit test; example configuration has no IDs.
const cfg={enabled:true,mode:'test',projectId:'fitpp-test',datasetId:'synthetic-v1',
  testBotId:'999001',ownerPrivateChatId:'999002',tokenConfigured:true};
const verified={...cfg,verification:{botId:cfg.testBotId,chatId:cfg.ownerPrivateChatId,chatType:'dialog',ownerConfirmed:true}};
test('connection states never authorize sending or binding',()=>{
  for(const [config,state] of [[{},STATES.DISABLED],[{...cfg,ownerPrivateChatId:null},STATES.MISSING],
    [cfg,STATES.VERIFY],[verified,STATES.PREPARED],[{...cfg,projectId:'production'},STATES.ERROR],
    [{...verified,verification:{...verified.verification,chatType:'chat'}},STATES.ERROR],
    [{...verified,verification:{...verified.verification,botId:'other'}},STATES.ERROR],
    [{...verified,verification:{...verified.verification,ownerConfirmed:false}},STATES.ERROR],
    [{...cfg,enabled:'true'},STATES.ERROR]]){
    a.deepEqual([connection(config).state,connection(config).sendAllowed,connection(config).clientBindingAllowed],[state,false,false]);
  }
});
test('group and poll configuration cannot supply missing private dialog',()=>{
  a.equal(connection({...cfg,ownerPrivateChatId:null,CHAT_IDS:'-999003',chat:'-999003'}).state,STATES.MISSING);
});
test('future binding draft cannot contain a MAX ID or modify a client',()=>{
  a.equal(bindingDraft('demo-client-1').maxUserId,null);
  a.equal(bindingDraft('demo-client-1').linkingAllowed,false);
  a.throws(()=>bindingDraft('real-client'),/SYNTHETIC_CLIENT_REQUIRED/);
  a.throws(()=>bindClient('demo-client-1','999004'),/CLIENT_BINDING_DISABLED/);
});
test('all notifications blocked including verified config, client targets and cancellations',()=>{
  const e={status:'attended',subscriptionDebited:true,remaining:4,workoutDate:'2026-10-24'};
  for(const config of [{},cfg,verified])for(const event of [e,{...e,status:'missed'},
    {...e,status:null},{...e,subscriptionDebited:false},{...e,recipient:'999004'},
    {...e,maxUserId:'999004'}, {...e,chatId:'-999003'}]){
    const before=JSON.stringify([config,event]);a.equal(prepareNotification(config,event).allowed,false);
    a.equal(JSON.stringify([config,event]),before);
  }
});
