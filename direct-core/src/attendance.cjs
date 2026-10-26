"use strict";
const {Service,MAIN,BOOKINGS,bookingKey,hash}=require('./service.cjs');
const E=require('../FitPP-Test/persistence.js').createProductionPricingModel();
const UID='lLlMAetSG1aEeJSeBl4F4ypydEh2';
const ensure=(v,e)=>{if(!v)throw Error(e)};
function availableAt(w,now){return Number.isFinite(w.actualEndedAt)&&now>=w.actualEndedAt+600000}
class Attendance {
 constructor(db,{now=Date.now,testTimeBypass=false}={}){this.db=db;this.now=now;this.testTimeBypass=testTimeBypass}
 async confirm(r,uid){
 ensure(uid===UID,'TRAINER_REQUIRED');ensure(r.trainerConfirmed===true,'EXPLICIT_CONFIRMATION_REQUIRED');
 ensure(typeof r.operationId==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(r.operationId)&&Array.isArray(r.marks)&&r.marks.length>0&&r.marks.length<=4,'INVALID_REQUEST');
 const signature=hash({workoutId:r.workoutId,date:r.date,marks:r.marks,expectedRevision:r.expectedRevision});
 return this.db.runTransaction(async tx=>{
 const raw=await new Service(this.db).readMain(tx),bs=await tx.get(this.db.doc(BOOKINGS));
 ensure(bs.exists&&bs.data().ownerUid===UID&&bs.data().datasetId==='synthetic-v1','BOOKINGS_METADATA');
 const priorReceipt=raw.attendanceReceipts?.[r.operationId];if(priorReceipt){ensure(priorReceipt.signature===signature,'OPERATION_ID_REUSED');return {duplicate:true,revision:priorReceipt.revision}}
 const revision=raw.attendanceRevision||0;ensure(r.expectedRevision===revision,'REVISION_CONFLICT');
 let next=E.read(raw);E.migrate(next);const w=Object.values(next.workouts).find(w=>w.id===r.workoutId)||['zarya','pole','online'].flatMap(h=>E.workoutsOn(next,h,r.date||'')).find(w=>w.id===r.workoutId);
 ensure(w&&!w.cancelled&&w.date===r.date,'WORKOUT_REQUIRED');
 const bypass=this.testTimeBypass===true&&raw.datasetId==='synthetic-v1';
 
 const seen=new Set();for(const m of r.marks){
 ensure(typeof m.clientId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(m.clientId)&&!seen.has(m.clientId),'CLIENT_REQUIRED');seen.add(m.clientId);
 ensure(['attended','missed','razov',null].includes(m.status),'STATUS_REJECTED');
 ensure(next.clients.some(c=>c.id===m.clientId&&!c.archivedAt),'CLIENT_REQUIRED');
 const source=m.source??'max';ensure(['manual','max'].includes(source),'SOURCE_REJECTED');
 ensure(source==='manual'||bypass||availableAt(w,this.now()),'WAIT_FOR_ACTUAL_END_PLUS_10_MINUTES');
 // Legacy rows already consumed a lesson/payment. Require the existing explicit link workflow.
 ensure(!Object.hasOwn(next.attendance[w.date]||{},m.clientId)||next.legacyLinks[w.date+'/'+m.clientId],'LEGACY_ATTENDANCE_REQUIRES_LINK');
 const before=next.visits[w.id]?.[m.clientId]||null;
 if(source==='max'&&m.status!==null)ensure(bs.data().entries[bookingKey(m.clientId,w.date,w.location)]===true,'BOOKING_REQUIRED');
 if(before===m.status)continue;
 const action={type:'attendance',workoutId:w.id,clientId:m.clientId,status:m.status===null?before:m.status,date:w.date,location:w.location};
 if(m.subscriptionKey!==undefined){ensure(typeof m.subscriptionKey==='string','SUBSCRIPTION_REQUIRED');action.subscriptionKey=m.subscriptionKey}
 if(m.status==='razov'){ensure(m.payment&&['cash','transfer'].includes(m.payment.method),'PAYMENT_REQUIRED');Object.assign(action,{method:m.payment.method,received:m.payment.received,paymentDate:m.payment.date||new Date(this.now()+10800000).toISOString().slice(0,10)})}
 next=E.reduce(next,action,new Date(this.now()+10800000).toISOString().slice(0,10));
 }
 const receipt={signature,revision:revision+1,trainerUid:uid,at:this.now(),workoutId:w.id,marks:r.marks,timeBypass:bypass};
 const receipts={...(raw.attendanceReceipts||{}),[r.operationId]:receipt};ensure(Object.keys(receipts).length<=500,'RECEIPT_LIMIT');
 // Attendance rules permit attendanceRevision, not the mutation-only _fitppRevision.
 // Keep the receipt and lesson change atomic; do not cross the two write contracts.
 tx.set(this.db.doc(MAIN),{...raw,...next,attendanceRevision:revision+1,attendanceReceipts:receipts});
 return {duplicate:false,revision:revision+1};
 })
 }
}
module.exports={Attendance,availableAt};
