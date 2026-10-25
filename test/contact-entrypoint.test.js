'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('deployed Docker entrypoint starts poll runtime with contact enabled through the same bridge',async()=>{
 const calls=[],sdk={};const env={CONTACT_LINK_ENABLED:'true'};
 const fakeRequire=id=>{
  if(id==='node:module')return {createRequire:()=>name=>{calls.push(name);return sdk}};
  if(id==='node:path')return path;
  if(id==='./src/fitpp-direct-session')return {settings:()=>calls.push('settings')};
  if(id==='./src/fitpp-direct-runtime')return {prepare:async options=>{a.equal(options.env,env);calls.push('prepare');return {contact:{},close:async()=>{}}}};
  if(id==='./src/fitpp-test-bridge')return {main:async options=>{a.ok(options.contact);calls.push('bridge');return {once:()=>{}}}};
  throw Error('Unexpected runtime: '+id);
 };
 const context={require:fakeRequire,module:{exports:{}},__dirname:path.resolve('.'),process:{env},console};
 vm.runInNewContext(fs.readFileSync('direct-training-test.cjs','utf8'),context);
 a.ok(await context.module.exports.main({env}));
 a.deepEqual(calls,['settings','firebase/app','firebase/auth','firebase/firestore','prepare','bridge']);
 a.match(fs.readFileSync('Dockerfile','utf8'),/CMD \["node", "\/opt\/training-test\/direct-training-test.cjs"\]/);
});
