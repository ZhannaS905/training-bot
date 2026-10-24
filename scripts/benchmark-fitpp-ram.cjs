'use strict';
// Offline only. No credentials, MAX or Firebase calls.
const {setTimeout:delay}=require('node:timers/promises');
const {createRam}=require('../src/fitpp-ram');
const {createOptimistic}=require('../src/fitpp-optimistic');
const {createPollSync}=require('../src/fitpp-poll-sync');
const scope={chat:'-1',mid:'mid.mock',uuid:'11111111-2222-4333-8444-555555555555',user:'1'};
async function sample(kind){
 let booked=false,revision=0,text='',started,first=null,reads=0,readsBeforePut=null;
 const person={clientId:'demo-client-1',name:'Synthetic'};
 const view=async()=>{reads++;await delay(80);return {...scope,date:'2026-10-26',location:'zarya',time:'20:00',revision,participants:booked?[person]:[],optimistic:{userId:'1',...person,lastEventAt:booked?100000:0,openedAt:1,closesAt:200000}}};
 const api={syncPollText:async value=>{await delay(7);if(text===value)return {edited:false,maxVerifyMs:7,maxPutMs:0};await delay(55);text=value;if(started!==undefined&&first===null){first=performance.now()-started;readsBeforePut=reads}return {edited:true,maxVerifyMs:7,maxPutMs:55}}};
 const sync=createPollSync({scope,api,loadView:view});
 const controller=kind==='ram'?createRam({scope,api,loadView:view,now:()=>100000}):createOptimistic({scope,api,loadView:view,now:()=>100000,reconcile:o=>sync.sync(o)});
 if(kind==='ram')await controller.refresh();reads=0;
 const event={timestamp:100000,callback:{callback_id:'one',payload:`poll:${scope.uuid}:yes`,user:{user_id:1}},message:{recipient:{chat_id:scope.chat},body:{mid:scope.mid}}};
 started=performance.now();await controller.run(event,async()=>{await delay(180);booked=true;revision++;return {applied:true}},started);
 return {firstSuccessfulPutMs:Math.round(first),readsBeforePut,totalMs:Math.round(performance.now()-started)};
}
(async()=>{const results={simulation:{firebaseReadMs:80,firebaseWriteMs:180,maxVerifyMs:7,maxPutMs:55},legacy:[],ram:[]};for(const kind of ['legacy','ram'])for(let i=0;i<5;i++)results[kind].push(await sample(kind));console.log(JSON.stringify(results,null,2))})().catch(e=>{console.error(e);process.exitCode=1});
