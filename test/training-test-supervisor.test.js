'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {supervise,manualWatchers}=require('../training-test-supervisor.cjs');
function fixture(enabled=true){
 const children=[],timers=[],codes=[];
 const runtime=supervise({enabled,launch:(file,args)=>{const child=new EventEmitter();Object.assign(child,{file,args,signals:[],kill(s){this.signals.push(s)}});children.push(child);return child},schedule:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer},cancel:t=>t.cancelled=true,log:()=>{},finish:c=>codes.push(c)});
 return {children,timers,codes,runtime};
}
test('default runs only existing bridge; enabled starts one watcher with exact arguments',()=>{
 assert.equal(fixture(false).children.length,1);const f=fixture();assert.equal(f.children.length,2);
 assert.deepEqual(f.children[1].args,['--send','--watch']);
 f.children[1].emit('exit',1);f.children[1].emit('error',Error());assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,5000);
 f.timers[0].fn();assert.equal(f.children.length,3);assert.equal(f.children[0].signals.length,0);
 f.children[2].emit('exit',0);assert.equal(f.timers[1].ms,10000);
});
test('stop cancels retry, drains both processes, escalates after grace and exits',()=>{
 const f=fixture();f.runtime.stop();assert.deepEqual(f.children.map(c=>c.signals),[['SIGTERM'],['SIGTERM']]);
 f.timers[0].fn();assert.deepEqual(f.children[1].signals,['SIGTERM','SIGKILL']);
 for(const c of f.children)c.emit('exit',0);assert.deepEqual(f.codes,[0]);assert.equal(f.timers[0].cancelled,true);
});
test('bridge failure stops watcher and reports failure; shutdown cancels pending retry',()=>{
 const f=fixture();f.children[0].emit('exit',1);assert.deepEqual(f.children[1].signals,['SIGTERM']);f.children[1].emit('exit',0);assert.deepEqual(f.codes,[1]);
 const g=fixture();g.children[1].emit('exit',1);g.runtime.stop();assert.equal(g.timers[0].cancelled,true);
});
test('proc scan identifies old manual entrypoints without ps; unreadable proc fails closed',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'watcher-proc-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const [pid,cmd] of [['98','node\0/opt/training-test/fitpp-notification-test.cjs\0--send\0--watch\0'],['99','node\0direct-training-test.cjs\0']]){fs.mkdirSync(path.join(dir,pid));fs.writeFileSync(path.join(dir,pid,'cmdline'),cmd)}
 assert.deepEqual(manualWatchers(dir),['98']);assert.throws(()=>manualWatchers(path.join(dir,'missing')));
});
test('kernel lock refuses a second live watcher and releases after close',async t=>{
 if(process.platform!=='linux')return t.skip('Linux abstract socket, production platform');
 const {acquire}=require('../src/fitpp-notification-lock.cjs');const first=await acquire();
 try{await assert.rejects(acquire(),{code:'EADDRINUSE'})}finally{await new Promise(r=>first.close(r))}
 const next=await acquire();await new Promise(r=>next.close(r));
});
