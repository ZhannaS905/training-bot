'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('deployed Docker entrypoint dispatches contact mode before booking settings without owner flow',async()=>{
 const calls=[],sdk={};const env={CONTACT_LINK_ENABLED:'true'};
 const fakeRequire=id=>{
  if(id==='node:module')return {createRequire:()=>name=>{calls.push(name);return sdk}};
  if(id==='node:path')return path;
  if(id==='./src/contact-linking-runtime')return {main:options=>{a.equal(options.env,env);calls.push('contact');return 'server'}};
  throw Error('Unexpected runtime: '+id);
 };
 const context={require:fakeRequire,module:{exports:{}},__dirname:path.resolve('.'),process:{env},console};
 vm.runInNewContext(fs.readFileSync('direct-training-test.cjs','utf8'),context);
 a.equal(await context.module.exports.main({env}),'server');
 a.deepEqual(calls,['firebase/app','firebase/auth','firebase/firestore','contact']);
 a.match(fs.readFileSync('Dockerfile','utf8'),/CMD \["node", "\/opt\/training-test\/direct-training-test.cjs"\]/);
});
