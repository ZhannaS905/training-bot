'use strict';
const {hash,bookingKey}=require('./service.cjs');
const {USER,POLL}=require('./pilot-policy.cjs');
const E=require('../FitPP-Test/persistence.js').createProductionPricingModel();
// Read-only, in the same SDK snapshot as the participant list. No profile-derived names.
async function optimisticContext(tx,db,main,bookings,scope){
 const prefix='fitppTestWorkspaces/synthetic-v1/';
 const [binding,poll]=await Promise.all([tx.get(db.doc(prefix+'maxBindings/'+hash(USER))),tx.get(db.doc(prefix+'maxPolls/'+hash([POLL.chat,POLL.mid])))]);
 if(!binding.exists||!poll.exists)return null;
 const b=binding.data(),p=poll.data(),clients=main.clients.filter(c=>c.id===b.clientId&&!c.archivedAt),client=clients.length===1?clients[0]:null;
 if(b.active!==true||!client||!/^demo-client-[1-4]$/.test(client.id)||!client.locations?.includes(POLL.location))return null;
 if(['chat','mid','uuid','date','location','workoutId','closesAt'].some(k=>p[k]!==POLL[k])||p.open!==true||p.openedAt!==scope.openedAt||!Number.isSafeInteger(p.openedAt)||!E.workoutsOn(main,POLL.location,POLL.date).some(w=>w.id===POLL.workoutId&&!w.cancelled))return null;
 const key=bookingKey(client.id,POLL.date,POLL.location);
 const [reverse,version]=await Promise.all([tx.get(db.doc(prefix+'maxClientBindings/'+hash(client.id))),tx.get(db.doc(prefix+'bookingVersions/'+hash(key)))]);
 if(!reverse.exists||reverse.data().userHash!==hash(USER))return null;
 const v=version.exists?version.data():{eventAt:0,booked:bookings.entries?.[key]===true};
 if(!Number.isSafeInteger(v.eventAt)||v.eventAt<0||v.booked!==(bookings.entries?.[key]===true))return null;
 const name=String(client.name||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,100);if(!name)return null;
 return {userId:USER,clientId:client.id,name,lastEventAt:v.eventAt,openedAt:p.openedAt,closesAt:p.closesAt};
}
module.exports={optimisticContext};
