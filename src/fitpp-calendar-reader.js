'use strict';
// Read-only calendar view for Training Test. No implicit weekday fallback.
const {MAIN}=require('../direct-core/src/service.cjs');
const LOCATIONS=new Set(['zarya','pole','online']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
function validDate(date) {
 return typeof date==='string'&&DATE.test(date)&&!Number.isNaN(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
}
function calendarDay(main,date) {
 if(!validDate(date))throw Error('CALENDAR_DATE_REFUSED');
 if(!main||main.datasetId!=='synthetic-v1'||main.schemaVersion!==1||!main.workouts||typeof main.workouts!=='object'||Array.isArray(main.workouts))throw Error('CALENDAR_MAIN_REFUSED');
 const result=[];
 for(const [id,w] of Object.entries(main.workouts)){
  if(!w||w.date!==date)continue;
  if(w.id!==id||!LOCATIONS.has(w.location)||!TIME.test(w.time)||typeof w.cancelled!=='boolean')throw Error('CALENDAR_WORKOUT_REFUSED');
  if(!w.cancelled)result.push({id,date,location:w.location,time:w.time});
 }
 result.sort((a,b)=>a.time.localeCompare(b.time)||a.location.localeCompare(b.location)||a.id.localeCompare(b.id));
 const seen=new Set();
 for(const w of result){const key=w.location+'|'+w.date;if(seen.has(key))throw Error('CALENDAR_AMBIGUOUS_LOCATION');seen.add(key)}
 return result;
}
function createCalendar({db}){
 if(!db||typeof db.doc!=='function')throw Error('CALENDAR_DB_REQUIRED');
 return {async day(date){
  if(!validDate(date))throw Error('CALENDAR_DATE_REFUSED');
  const snap=await db.doc(MAIN).get();
  if(!snap.exists)throw Error('CALENDAR_MAIN_MISSING');
  return calendarDay(snap.data(),date);
 }};
}

// The live 8846 group calendar is stored in trainers/{ownerUid}.groupScheduleV1,
// not in states/main. Do not treat missing group periods as recurring sessions.
function groupCalendarDay(schedule,date){
 if(!validDate(date))throw Error('CALENDAR_DATE_REFUSED');
 if(!schedule||schedule.schemaVersion!==1||schedule.projectId!=='fitpp-test'||!Array.isArray(schedule.workouts)||!Array.isArray(schedule.groups)||!Array.isArray(schedule.periods))throw Error('GROUP_CALENDAR_REFUSED');
 const groups=new Map(schedule.groups.map(g=>[g.id,g]));
 const result=[];
 for(const w of schedule.workouts){
  if(w.date!==date||w.cancelled===true)continue;
  const group=groups.get(w.groupId||w.location);
  if(!group||group.location!==w.location||!TIME.test(w.time)||typeof w.id!=='string'||!w.id||typeof w.periodId!=='string'||!schedule.periods.some(p=>p.id===w.periodId&&p.group===group.id))throw Error('GROUP_WORKOUT_REFUSED');
  result.push({id:w.id,date,location:w.location,time:w.time,groupId:group.id});
 }
 result.sort((a,b)=>a.time.localeCompare(b.time)||a.location.localeCompare(b.location)||a.id.localeCompare(b.id));
 if(new Set(result.map(w=>w.id)).size!==result.length)throw Error('GROUP_WORKOUT_DUPLICATE');
 return result;
}

function createGroupCalendar({store}){
 if(!store||typeof store.read!=='function')throw Error('GROUP_CALENDAR_STORE_REQUIRED');
 return {async day(date){
  if(!validDate(date))throw Error('CALENDAR_DATE_REFUSED');
  // Always fetch fresh state. Missing or inaccessible calendar fails closed.
  const schedule=await store.read();
  return groupCalendarDay(schedule,date);
 }};
}
module.exports={calendarDay,groupCalendarDay,createCalendar,createGroupCalendar,validDate};
