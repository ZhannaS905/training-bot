'use strict';
// Training Test calendar-driven publication plan. This module does not send MAX
// messages or write Firebase; existing daily poll storage remains untouched.
const {createHash}=require('node:crypto');
const {moscow}=require('./schedule');
const DATE=/^\d{4}-\d{2}-\d{2}$/, TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const LOCATIONS=new Set(['zarya','pole','online']);
function workoutKey(w){
 if(!w||typeof w.id!=='string'||!w.id||!DATE.test(w.date)||!TIME.test(w.time)||!LOCATIONS.has(w.location))throw Error('CALENDAR_WORKOUT_REFUSED');
 return createHash('sha256').update(JSON.stringify(['training-test-workout-v1',w.id])).digest('hex');
}
function planDay(workouts,now=new Date()){
 if(!Array.isArray(workouts))throw Error('CALENDAR_NOT_AVAILABLE');
 const t=moscow(now),seen=new Set(),result=[];
 for(const w of workouts){
  if(!w||w.date!==t.date)throw Error('CALENDAR_DAY_MISMATCH');
  const key=workoutKey(w);
  if(seen.has(key))throw Error('CALENDAR_DUPLICATE_WORKOUT');
  seen.add(key);
  const starts=Date.parse(w.date+'T'+w.time+':00+03:00');
  if(!Number.isFinite(starts))throw Error('CALENDAR_WORKOUT_REFUSED');
  result.push({key,workoutId:w.id,date:w.date,location:w.location,time:w.time,startsAt:starts,closesAt:starts+3600000,
   publishDue:t.clock>='10:00'&&+now<starts});
 }
 return result.sort((a,b)=>a.startsAt-b.startsAt||a.key.localeCompare(b.key));
}
module.exports={workoutKey,planDay};
