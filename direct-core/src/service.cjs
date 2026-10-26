'use strict';
const {createHash}=require('node:crypto');
const E=require('../FitPP-Test/persistence.js').createProductionPricingModel();
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
const PREFIX='fitppTestWorkspaces/synthetic-v1/',MAIN=PREFIX+'states/main',BOOKINGS=PREFIX+'states/bookings';
const requireValue=(ok,code)=>{if(!ok)throw Error(code)};
function userId(v){requireValue((typeof v==='string'&&/^[1-9]\d{0,15}$/.test(v))||(Number.isSafeInteger(v)&&v>0),'USER_ID_REJECTED');return String(v)}
function bookingKey(cid,date,hall){requireValue(typeof cid==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(cid)&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&['zarya','pole','online'].includes(hall),'TARGET_REJECTED');return JSON.stringify([cid,date,hall])}
class Service{
 constructor(db,{now=Date.now}={}){this.db=db;this.now=now}
 ref(kind,id){return this.db.doc(PREFIX+kind+'/'+hash(id))}
 async readMain(tx){const s=await (tx?tx.get(this.db.doc(MAIN)):this.db.doc(MAIN).get());requireValue(s.exists,'MAIN_MISSING');const d=s.data();requireValue(d.ownerUid==='lLlMAetSG1aEeJSeBl4F4ypydEh2'&&d.datasetId==='synthetic-v1'&&d.schemaVersion===1,'MAIN_METADATA');return d}
 async bind(uid,cid){uid=userId(uid);requireValue(/^demo-client-[1-4]$/.test(cid),'CLIENT_REJECTED');return this.db.runTransaction(async tx=>{const main=await this.readMain(tx),ur=this.ref('maxBindings',uid),cr=this.ref('maxClientBindings',cid);const [u,c]=await Promise.all([tx.get(ur),tx.get(cr)]);requireValue(main.clients.some(c=>c.id===cid&&!c.archivedAt),'CLIENT_REJECTED');if(u.exists||c.exists){requireValue(u.exists&&c.exists&&u.data().clientId===cid&&c.data().userHash===hash(uid),'ALREADY_BOUND');return {linked:true,duplicate:true}}tx.create(ur,{clientId:cid,active:true});tx.create(cr,{userHash:hash(uid)});return {linked:true}})}
 async registerPoll({chat,mid,workoutId,date,location,openedAt,closesAt}){requireValue(typeof chat==='string'&&chat&&typeof mid==='string'&&mid&&Number.isSafeInteger(openedAt)&&Number.isSafeInteger(closesAt)&&openedAt<closesAt,'POLL_INVALID');bookingKey('demo-client-1',date,location);const data={chat,mid,workoutId,date,location,openedAt,closesAt,open:true};return this.db.runTransaction(async tx=>{const main=await this.readMain(tx),r=this.ref('maxPolls',[chat,mid]),s=await tx.get(r);requireValue(E.workoutsOn(main,location,date).some(w=>w.id===workoutId&&!w.cancelled),'WORKOUT_MISMATCH');if(s.exists){requireValue(hash(s.data())===hash(data),'POLL_ALREADY_REGISTERED');return {registered:true,duplicate:true}}tx.create(r,data);return {registered:true}})}
 async view(keys=[]){requireValue(Array.isArray(keys)&&keys.length<=500,'KEYS_INVALID');for(const key of keys)requireValue(bookingKey(...JSON.parse(key))===key,'KEY_INVALID');return this.db.runTransaction(async tx=>{const b=await tx.get(this.db.doc(BOOKINGS));requireValue(b.exists,'BOOKINGS_MISSING');const data=b.data(),versions={};for(const key of keys){const v=await tx.get(this.ref('bookingVersions',key));requireValue(!v.exists||v.data().booked===(data.entries[key]===true),'EXTERNAL_WRITER_DESYNC');versions[key]=v.exists?v.data().revision:0;}return {...data,versions}})}
 async observe(key){const tuple=JSON.parse(key);requireValue(bookingKey(...tuple)===key,'KEY_INVALID');return this.db.runTransaction(async tx=>{const b=await tx.get(this.db.doc(BOOKINGS)),v=await tx.get(this.ref('bookingVersions',key));requireValue(b.exists,'BOOKINGS_MISSING');const booked=b.data().entries[key]===true;requireValue(!v.exists||v.data().booked===booked,'EXTERNAL_WRITER_DESYNC');return {booked,revision:v.exists?v.data().revision:0}})}
 async apply({source,eventId,uid,key,desired,at,expectedRevision,pollIdentity,pollUuid}){
 requireValue(['max','fitpp'].includes(source)&&typeof eventId==='string'&&eventId.length>0&&eventId.length<=256&&typeof desired==='boolean','EVENT_INVALID');
 const digest=hash({source,eventId,uid:uid||null,key:key||null,desired,at:source==='max'?at:null,expectedRevision:expectedRevision??null,pollIdentity:pollIdentity||null,pollUuid:pollUuid||null});
 return this.db.runTransaction(async tx=>{
 const er=this.ref('maxEvents',[source,eventId]),es=await tx.get(er);if(es.exists){requireValue(es.data().digest===digest,'EVENT_ID_CONFLICT');return {...es.data().result,duplicate:true}}
 requireValue(Number.isSafeInteger(at)&&at<=this.now()+30000&&at>=this.now()-86400000,'EVENT_TIME');
 const main=await this.readMain(tx);let targetKey=key;
 if(source==='max'){
 const [binding,pollSnap]=await Promise.all([tx.get(this.ref('maxBindings',userId(uid))),tx.get(this.ref('maxPolls',pollIdentity))]);requireValue(binding.exists&&binding.data().active&&pollSnap.exists,'UNBOUND_OR_UNKNOWN_POLL');const p=pollSnap.data();requireValue(!p.uuid||p.uuid===pollUuid,'POLL_UUID_MISMATCH');requireValue(p.open&&at>=p.openedAt&&this.now()<p.closesAt,'POLL_CLOSED');targetKey=bookingKey(binding.data().clientId,p.date,p.location);requireValue(E.workoutsOn(main,p.location,p.date).some(w=>w.id===p.workoutId&&(!desired||!w.cancelled)),'WORKOUT_CHANGED');
 }
 let tuple;try{tuple=JSON.parse(targetKey)}catch{throw Error('KEY_INVALID')}requireValue(bookingKey(...tuple)===targetKey,'KEY_INVALID');const [cid,date,hall]=tuple,c=main.clients.find(c=>c.id===cid&&!c.archivedAt);requireValue(c&&c.locations.includes(hall),'CLIENT_REJECTED');if(desired)requireValue(E.workoutsOn(main,hall,date).some(w=>!w.cancelled),'WORKOUT_CANCELLED');
 const br=this.db.doc(BOOKINGS),vr=this.ref('bookingVersions',targetKey),bs=await tx.get(br),vs=await tx.get(vr);requireValue(bs.exists,'BOOKINGS_MISSING');const clockRef=this.db.doc(PREFIX+'states/bookingClock'),clockSnap=await tx.get(clockRef);requireValue(clockSnap.exists,'CLOCK_MISSING');const raw=bs.data(),old=vs.exists?vs.data():{revision:0,eventAt:0,booked:raw.entries[targetKey]===true};requireValue(old.booked===(raw.entries[targetKey]===true),'EXTERNAL_WRITER_DESYNC');
 let result;if(source==='fitpp'&&expectedRevision!==old.revision)throw Error('UI_REVISION_CONFLICT');
 const actionAt=source==='fitpp'?Math.max(at,old.eventAt+1):at;
 if(actionAt<old.eventAt)result={applied:false,reason:'stale',booked:old.booked,revision:old.revision};
 else {
   requireValue(actionAt!==old.eventAt,'AMBIGUOUS_EVENT_ORDER');
   const revision=old.revision+1,next={...raw,entries:{...raw.entries}};
   if(desired)next.entries[targetKey]=true;else delete next.entries[targetKey];
   requireValue(Object.keys(next.entries).length<=500,'BOOKING_LIMIT');
   if(desired!==old.booked) {
     const freezeNotices=[];
     const thawed=E.bookingFreeze(main,targetKey,desired,next.entries,freezeNotices);
     if(freezeNotices.length)result={freezeNotice:freezeNotices.join(" ")};
     if(thawed) {
       const receiptId='booking-'+hash([source,eventId]);
       requireValue(!main.mutationReceipts?.[receiptId],'OPERATION_ID_CONFLICT');
       const mutationReceipts={...(main.mutationReceipts||{}),[receiptId]:{signature:digest,at:this.now(),type:'bookingFreeze'}};
       requireValue(Object.keys(mutationReceipts).length<=500,'RECEIPT_LIMIT');
       // The booking and its freeze change commit together, with the existing main revision/receipt rules.
       tx.set(this.db.doc(MAIN),{...main,...thawed,mutationReceipts});
     }
   }
   tx.set(br,next);
   tx.set(clockRef,{revision:clockSnap.data().revision+1,key:targetKey,booked:desired});
   tx.set(vr,{revision,eventAt:actionAt,booked:desired,source});
   result={...result,applied:true,booked:desired,revision};
 }
 tx.create(er,{digest,result});return result;
 })
 }
 async callback(e){requireValue(['poll_yes','poll_cancel'].includes(e.payload),'PAYLOAD_REJECTED');return this.apply({source:'max',eventId:e.id,uid:userId(e.uid),desired:e.payload==='poll_yes',at:e.at,pollIdentity:[String(e.chat),String(e.mid)],pollUuid:e.pollUuid})}
 async ui({key,desired,eventId,expectedRevision}){return this.apply({source:'fitpp',key,desired,eventId,expectedRevision,at:this.now()})}
 async balance(uid){const main=await this.readMain(),b=await this.ref('maxBindings',userId(uid)).get();requireValue(b.exists&&b.data().active,'NOT_LINKED');const c=main.clients.find(c=>c.id===b.data().clientId&&!c.archivedAt);requireValue(c,'CLIENT_REJECTED');const day=new Date(this.now()+3*3600000).toISOString().slice(0,10);const subs=(c.subscriptions||[]).filter(s=>!s.cancelledAt&&s.startDate<=day&&s.expires>=day);requireValue(subs.length===1,'SUBSCRIPTION_SELECTION_REQUIRED');const s=subs[0];requireValue(Number.isSafeInteger(s.left)&&s.left>=0,'BALANCE_INVALID');return {left:s.left,expires:s.expires}}
}
module.exports={Service,hash,userId,bookingKey,MAIN,BOOKINGS};
