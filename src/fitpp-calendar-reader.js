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
module.exports={calendarDay,createCalendar,validDate};
