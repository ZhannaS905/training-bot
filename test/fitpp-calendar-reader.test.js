'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {calendarDay,groupCalendarDay}=require('../src/fitpp-calendar-reader');
const date='2026-11-02';
const w=(id,location,time,cancelled=false)=>({id,date,location,time,cancelled});
test('calendar uses persisted sessions rather than weekdays',()=>{
 const main={datasetId:'synthetic-v1',schemaVersion:1,workouts:{a:w('a','zarya','20:00'),b:w('b','online','18:00',true)}};
 assert.deepEqual(calendarDay(main,date),[{id:'a',date,location:'zarya',time:'20:00'}]);
 assert.deepEqual(calendarDay(main,'2026-11-03'),[]);
});
test('ambiguous sessions are refused',()=>{
 const main={datasetId:'synthetic-v1',schemaVersion:1,workouts:{a:w('a','zarya','20:00'),b:w('b','zarya','21:00')}};
 assert.throws(()=>calendarDay(main,date),/CALENDAR_AMBIGUOUS_LOCATION/);
});

test('group calendar reads persisted period sessions and skips cancellation',()=>{
 const s={schemaVersion:1,projectId:'fitpp-test',groups:[{id:'zarya',location:'zarya'}],periods:[{id:'period-1',group:'zarya'}],workouts:[
  {id:'session-1',groupId:'zarya',location:'zarya',periodId:'period-1',date,time:'20:00',cancelled:false},
  {id:'session-2',groupId:'zarya',location:'zarya',periodId:'period-1',date,time:'21:00',cancelled:true}
 ]};
 assert.deepEqual(groupCalendarDay(s,date),[{id:'session-1',date,location:'zarya',time:'20:00',groupId:'zarya'}]);
 assert.deepEqual(groupCalendarDay({...s,periods:[],workouts:[]},date),[]);
 assert.throws(()=>groupCalendarDay({...s,periods:[]},date),/GROUP_WORKOUT_REFUSED/);
});
