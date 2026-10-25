'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const {combinedReceiver}=require('../src/fitpp-test-bridge');
test('all group poll actions route exclusively to original callback receiver',async()=>{
 const calls=[];const r=combinedReceiver({callbacks:{receive:async u=>calls.push(u.callback.payload)},contact:{receive:()=>a.fail('group reached contacts')},owner:{receive:()=>a.fail('owner reached')}});
 for(const action of ['yes','no','maybe','cancel'])await r.receive({update_type:'message_callback',message:{recipient:{chat_type:'chat'}},callback:{payload:'poll:id:'+action}});
 a.deepEqual(calls,['poll:id:yes','poll:id:no','poll:id:maybe','poll:id:cancel']);
});
test('private start/contact cannot reach polls; slow contact does not delay group',async()=>{
 let release;const blocked=new Promise(r=>release=r),calls=[];
 const r=combinedReceiver({callbacks:{receive:async()=>calls.push('poll')},contact:{receive:async()=>{calls.push('contact');await blocked}},owner:{receive:()=>a.fail('owner reached')}});
 const pending=r.receive({update_type:'bot_started'});
 await r.receive({update_type:'message_callback',message:{recipient:{chat_type:'chat'}}});
 a.deepEqual(calls,['contact','poll']);release();await pending;
 await r.receive({update_type:'message_created',message:{recipient:{chat_type:'dialog'}}});
 a.deepEqual(calls,['contact','poll','contact']);
});
test('durable callback errors propagate for webhook retry; foreign updates ignored',async()=>{
 const r=combinedReceiver({callbacks:{receive:async()=>{throw Error('retry')}},contact:{receive:()=>a.fail()},owner:{receive:()=>a.fail()}});
 await a.rejects(r.receive({update_type:'message_callback',message:{recipient:{chat_type:'chat'}}}),/retry/);
 await r.receive({update_type:'message_created',message:{recipient:{chat_type:'chat'}}});
 await r.receive({update_type:'unknown'});
});
