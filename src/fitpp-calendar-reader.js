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
function groupCalendarDay(schedule,date,main){
 if(!validDate(date))throw Error('CALENDAR_DATE_REFUSED');
 if(!schedule||schedule.schemaVersion!==1||schedule.projectId!=='fitpp-test'||!Array.isArray(schedule.workouts)||!Array.isArray(schedule.groups)||!Array.isArray(schedule.periods)||!Array.isArray(schedule.links))throw Error('GROUP_CALENDAR_REFUSED');
 const groups=new Map(schedule.groups.map(g=>[g.id,g]));
 if(groups.size!==schedule.groups.length)throw Error('GROUP_CALENDAR_REFUSED');
 const periods=new Map(schedule.periods.map(p=>[p.id,p]));
 if(periods.size!==schedule.periods.length)throw Error('GROUP_CALENDAR_REFUSED');
 const result=[],seen=new Set();
 function add(w,groupId){
  if(!w||!validDate(w.date)||typeof w.id!=='string'||!w.id||!TIME.test(w.time)||typeof w.cancelled!=='boolean')throw Error('GROUP_WORKOUT_REFUSED');
  if(w.cancelled||w.date!==date)return;
  const g=groups.get(groupId);
  if(!g||g.location!==w.location||seen.has(w.id))throw Error('GROUP_WORKOUT_REFUSED');
  seen.add(w.id);result.push({id:w.id,date,location:w.location,time:w.time,groupId:g.id});
 }
 for(const w of schedule.workouts){
  const p=periods.get(w.periodId);
  if(!p||p.group!==w.groupId||w.groupId!==w.location)throw Error('GROUP_WORKOUT_REFUSED');
  add(w,w.groupId);
 }
 // Links are persisted calendar sessions pointing to pre-existing journal workouts.
 // A moved linked workout is resolved by its current date, not scheduledDate.
 if(schedule.links.length){
  if(!main||!main.workouts||typeof main.workouts!=='object')throw Error('GROUP_CALENDAR_MAIN_REQUIRED');
  for(const link of schedule.links){
   const p=periods.get(link.periodId);
   if(!p||p.group!==link.groupId&&link.groupId!==undefined||!['main','trainers'].includes(link.source))throw Error('GROUP_CALENDAR_LINK_REFUSED');
   if(link.source!=='main')throw Error('GROUP_CALENDAR_TRAINER_LINK_UNSUPPORTED');
   const w=main.workouts[link.workoutId];
   if(!w||w.id!==link.workoutId)throw Error('GROUP_CALENDAR_LINK_MISSING');
   add(w,p.group);
  }
 }
 result.sort((a,b)=>a.time.localeCompare(b.time)||a.location.localeCompare(b.location)||a.id.localeCompare(b.id));
 return result;
}
function createGroupCalendar({store,mainDb}){
 if(!store||typeof store.read!=='function')throw Error('GROUP_CALENDAR_STORE_REQUIRED');
 return {async day(date){
  if(!validDate(date))throw Error('CALENDAR_DATE_REFUSED');
  const schedule=await store.read();
  let main;
  if(schedule?.links?.length){
   if(!mainDb||typeof mainDb.doc!=='function')throw Error('GROUP_CALENDAR_MAIN_REQUIRED');
   const snap=await mainDb.doc(MAIN).get();
   if(!snap.exists)throw Error('GROUP_CALENDAR_MAIN_REQUIRED');
   main=snap.data();
  }
  return groupCalendarDay(schedule,date,main);
 }};
}

module.exports={calendarDay,groupCalendarDay,createCalendar,createGroupCalendar,validDate};
