const {test}=require('node:test'),assert=require('node:assert/strict');
const {diagnostic}=require('../integration/fitpp-mediator/request-diagnostic.cjs');
test('mediator diagnostics distinguish fixed failures without exposing external data',()=>{
 const secret='secret token URL private profile\nforged';
 for(const [error,code] of [[Error('PILOT_DISABLED'),'PILOT_DISABLED'],[Error('BUSY'),'BUSY'],[Object.assign(Error(secret),{code:'permission-denied'}),'FIREBASE_PERMISSION_DENIED'],[Object.assign(Error(secret),{code:secret,stack:secret}),'UNKNOWN']]){
  const entry=diagnostic(error,'/bot/poll-view');assert.equal(entry.code,code);assert.equal(entry.route,'snapshot');assert.ok(!JSON.stringify(entry).includes(secret));
 }
 assert.equal(diagnostic(Error(secret),secret).route,'unknown');
});
