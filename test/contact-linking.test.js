'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {phone,ownPhone,firebaseStore,contactLinking,MAIN,LINKS}=require('../src/contact-linking');
const token='fake-test-token',time=1000000;
function payload(number='79990000000',uid=80){const vcf_info=`BEGIN:VCARD\r\nVERSION:3.0\r\nTEL;TYPE=cell:${number}\r\nFN:Test\r\nEND:VCARD\r\n`;return {vcf_info,max_info:{user_id:uid},hash:createHmac('sha256',token).update(vcf_info).digest('hex')};}
function setup(clients=[{id:'demo-client-1',phone:'+7 (999) 000-00-00'}]){
 let clock=time,registry,writes=0,reads=0;const paths=[];
 const sdk={doc:(_,p)=>{paths.push(p);return p;},runTransaction:async(_,fn)=>fn({get:async p=>{reads++;return {exists:()=>p===MAIN||registry!==undefined,data:()=>structuredClone(p===MAIN?{clients}:registry)}},set:(p,v)=>{a.equal(p,LINKS);registry=structuredClone(v);writes++;}})};
 const store=firebaseStore({sdk,db:{app:{options:{projectId:'fitpp-test'}}},botId:90});
 const service=contactLinking({botId:90,token,allowedUserIds:[80,81],store,now:()=>clock});
 const start={update_type:'bot_started',timestamp:time,chat_id:70,user:{user_id:80,is_bot:false}};
 const msg=(body,uid=80,cid=70)=>({update_type:'message_created',timestamp:clock,message:{timestamp:clock,sender:{user_id:uid,is_bot:false},recipient:{chat_type:'dialog',chat_id:cid,user_id:90},body}});
 const contact=()=>msg({attachments:[{type:'contact',payload:payload()}]});
 const confirm=d=>({update_type:'message_callback',timestamp:clock,callback:{timestamp:clock,user:{user_id:80,is_bot:false},payload:d.body.attachments[0].payload.buttons[0][0].payload},message:{timestamp:clock,sender:{user_id:90,is_bot:true},recipient:{chat_type:'dialog',chat_id:70,user_id:80}}});
 return {service,start,msg,contact,confirm,store,clients,paths,setClock:v=>clock=v,get registry(){return registry},get writes(){return writes},get reads(){return reads},setRegistry:v=>registry=v};
}
test('start -> signed contact -> immediate binding and private confirmation; idempotent',async()=>{
 const f=setup();const welcome=await f.service.receive(f.start);
 a.equal(welcome.body.attachments[0].payload.buttons[0][0].type,'request_contact');
 const reply=await f.service.receive(f.contact());a.equal(f.writes,1);
 a.equal(reply.body.attachments.length,0);a.equal(JSON.stringify(reply).includes('79990000000'),false);
 a.deepEqual(f.registry.bindings,[{clientId:'demo-client-1',maxUserId:80,maxChatId:70,notificationsEnabled:false}]);
 await f.service.receive(f.contact());a.equal(f.writes,1);
 await f.service.receive(f.start);await f.service.receive(f.contact());a.equal(f.writes,1);
 a.deepEqual(f.paths,[MAIN,LINKS]);
});
test('signature, self identity and strict vCard validation reject foreign and unsigned contacts',()=>{
 a.equal(phone('8 (999) 000-00-00'),'79990000000');a.equal(phone('abc79990000000'),null);
 for(const mutate of [p=>delete p.hash,p=>p.hash='a'.repeat(64),p=>p.max_info.user_id=81,p=>delete p.max_info,p=>p.vcf_info+='TEL:79990000001\r\n']){
 const p=payload();mutate(p);a.equal(ownPhone(p,80,token),null);
 }
 const p=payload();p.vcf_info=p.vcf_info.replace('FN:Test','TEL:79990000001');p.hash=createHmac('sha256',token).update(p.vcf_info).digest('hex');a.equal(ownPhone(p,80,token),null);
});
test('zero matches and duplicate normalized phone never offer confirmation',async()=>{
 for(const clients of [[],[{id:'demo-client-1',phone:'79990000000'},{id:'demo-client-2',phone:'89990000000'}]]){
 const f=setup(clients);await f.service.receive(f.start);const d=await f.service.receive(f.contact());a.equal(d.body.attachments.length,0);a.equal(f.writes,0);
 }
});
test('private envelope, start, test allowlist, TTL and non-forwarded contact are mandatory',async()=>{
 for(const mutate of [u=>u.message.recipient.chat_type='chat',u=>u.message.recipient.user_id=91,u=>u.message.sender.user_id=82,u=>u.message.link={},u=>u.timestamp=time-300001,u=>u.message.timestamp=time+31000,u=>u.message.recipient.chat_id=71]){
 const f=setup();await f.service.receive(f.start);const u=f.contact();mutate(u);a.equal(await f.service.receive(u),undefined);a.equal(f.reads,0);
 }
 const f=setup();a.equal(await f.service.receive(f.contact()),undefined);await f.service.receive(f.start);f.setClock(time+300000);a.equal(await f.service.receive(f.contact()),undefined);
});
test('transaction rechecks phone and conflicts in both directions, never overwrites',async()=>{
 const f=setup();f.clients[0].phone='79990000001';
 a.equal((await f.store.bind('79990000000',{clientId:'demo-client-1',maxUserId:80,maxChatId:70})).status,'refused');a.equal(f.writes,0);
 for(const b of [{clientId:'demo-client-2',maxUserId:81,maxChatId:70,notificationsEnabled:false},{clientId:'demo-client-1',maxUserId:81,maxChatId:71,notificationsEnabled:false},{clientId:'demo-client-2',maxUserId:80,maxChatId:70,notificationsEnabled:false}]){
 const q=setup();q.setRegistry({version:1,botId:90,bindings:[b]});await q.service.receive(q.start);await q.service.receive(q.contact());a.equal(q.writes,0);
 }
});
test('production scope, real clients and corrupt registries fail closed',async()=>{
 a.throws(()=>firebaseStore({sdk:{},db:{app:{options:{projectId:'fitpp-crm'}}},botId:90}),/TEST_SCOPE/);
 const f=setup([{id:'real-client',phone:'79990000000'}]);await a.rejects(f.store.find('79990000000'),/STORAGE_REFUSED/);
 const q=setup();q.setRegistry({version:1,botId:90,bindings:[{}]});await a.rejects(q.store.find('79990000000'),/STORAGE_REFUSED/);
});
test('duplicate numbers and invalid binding writes are refused; errors hide PII',async()=>{
 const f=setup();f.clients.push({id:'demo-client-2',phone:'79990000000'});
 a.equal((await f.store.bind('79990000000',{clientId:'demo-client-1',maxUserId:80,maxChatId:70})).status,'refused');a.equal(f.writes,0);
 const q=setup();await a.rejects(q.store.bind('79990000000',{clientId:'demo-client-1',maxUserId:NaN,maxChatId:70}),/STORAGE_REFUSED/);
 const store=firebaseStore({botId:90,db:{app:{options:{projectId:'fitpp-test'}}},sdk:{doc:(_,p)=>p,runTransaction:async()=>{throw Error('secret phone and token')}}});await a.rejects(store.find('79990000000'),/^Error: CONTACT_LINK_STORAGE_REFUSED$/);
});
test('composition verifies Training Test identity before accessing SDK',()=>{
 const {prepareTestContactLinking}=require('../src/contact-linking');
 for(const identity of [{user_id:90,is_bot:true,username:'production'},null])a.throws(()=>prepareTestContactLinking({identity,expectedBotId:'90'}),/IDENTITY_REFUSED/);
});
test('callbacks and plain phone text cannot create a binding',async()=>{
 const f=setup();await f.service.receive(f.start);
 await f.service.receive(f.msg({text:'79990000000'}));
 await f.service.receive({update_type:'message_callback',timestamp:time});a.equal(f.writes,0);
});
