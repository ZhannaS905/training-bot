'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {workoutKey,planDay}=require('../src/fitpp-calendar-poll-plan');
const w={id:'group-session-42',date:'2026-11-02',location:'zarya',time:'20:00'};
const at=new Date('2026-11-02T07:00:15Z'); // 10:00 Moscow
test('same workout keeps poll identity after moving date and time',()=>{
 assert.equal(workoutKey(w),workoutKey({...w,date:'2026-11-03',time:'19:00'}));
 assert.notEqual(workoutKey(w),workoutKey({...w,id:'another-workout'}));
});
test('additional sessions on the same day receive separate keys',()=>{
 const planned=planDay([w,{...w,id:'extra-2',location:'pole',time:'18:30'}],at);
 assert.equal(planned.length,2);
 assert.notEqual(planned[0].key,planned[1].key);
 assert(planned.every(p=>p.publishDue));
});
test('late session cannot be auto-published after it begins',()=>{
 assert.equal(planDay([w],new Date('2026-11-02T17:01:00Z'))[0].publishDue,false);
});
test('calendar absence, mismatched date and duplicate workout fail closed',()=>{
 assert.throws(()=>planDay(null,at),/CALENDAR_NOT_AVAILABLE/);
 assert.throws(()=>planDay([{...w,date:'2026-11-03'}],at),/CALENDAR_DAY_MISMATCH/);
 assert.throws(()=>planDay([w,w],at),/CALENDAR_DUPLICATE_WORKOUT/);
});
