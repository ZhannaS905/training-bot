const {test}=require('node:test');
const assert=require('node:assert/strict');
const {checkTestBotIdentity,identityAccepted}=require('../src/test-bot-identity');
const valid={user_id:123,username:'id623401053090_1_bot',is_bot:true};
test('identity accepts only all verified fields; optional @ retains existing behavior',()=>{
  for(const username of [valid.username,'@'+valid.username]) {
    const checks=checkTestBotIdentity({...valid,username},'123');
    assert.equal(identityAccepted(checks),true);
    assert(Object.values(checks).every(v=>v===true));
  }
});
test('null, arrays, primitives and nested responses fail closed without throwing',()=>{
  for(const value of [null,undefined,[],true,42,'private-response',{user:valid},{data:valid}]) {
    const checks=checkTestBotIdentity(value,'123');
    assert.equal(checks.structureValid,false);assert.equal(identityAccepted(checks),false);
    assert(Object.values(checks).every(v=>typeof v==='boolean'));
  }
});
test('missing fields and invalid types are distinguished independently',()=>{
  for(const [field,present,type] of [['user_id','idPresent','idTypeValid'],['username','usernamePresent','usernameTypeValid'],['is_bot','isBotPresent','isBotTypeValid']]) {
    const value={...valid};delete value[field];
    let checks=checkTestBotIdentity(value,'123');
    assert.equal(checks[present],false);assert.equal(checks[type],false);assert.equal(identityAccepted(checks),false);
    for(const invalid of [null,undefined,{},[]]) {
      checks=checkTestBotIdentity({...valid,[field]:invalid},'123');
      assert.equal(checks[present],true);assert.equal(checks[type],false);assert.equal(identityAccepted(checks),false);
    }
  }
});
test('ID mismatch does not mask username and bot flag checks',()=>{
  for(const user_id of [124,'123',0,-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
    const checks=checkTestBotIdentity({...valid,user_id},'123');
    assert.equal(checks.idMatches,false);assert.equal(checks.usernameMatches,true);assert.equal(checks.isBotTrue,true);assert.equal(identityAccepted(checks),false);
  }
});
test('absent or invalid trusted ID never falls back to returned ID or username',()=>{
  for(const expected of [undefined,null,'','0','-1','123.0','0123','9007199254740992',123]) {
    const checks=checkTestBotIdentity(valid,expected);
    assert.equal(checks.expectedIdValid,false);assert.equal(checks.idMatches,false);assert.equal(identityAccepted(checks),false);
  }
});
test('is_bot presence, boolean type and true value have separate results',()=>{
  for(const is_bot of [false,'true',1,'false']) {
    const checks=checkTestBotIdentity({...valid,is_bot},'123');
    assert.equal(checks.isBotPresent,true);assert.equal(checks.isBotTypeValid,typeof is_bot==='boolean');
    assert.equal(checks.isBotTrue,false);assert.equal(identityAccepted(checks),false);
  }
});
test('username mismatch, malformed username and inherited fields are rejected',()=>{
  for(const username of ['other','@@'+valid.username,valid.username+' ',42]) {
    assert.equal(identityAccepted(checkTestBotIdentity({...valid,username},'123')),false);
  }
  assert.equal(identityAccepted(checkTestBotIdentity(Object.create(valid),'123')),false);
});
test('diagnostic results contain booleans only and never copy response fields',()=>{
  const value={user_id:987654321,username:'PRIVATE_USERNAME',is_bot:'PRIVATE_FLAG',token:'PRIVATE_TOKEN'};
  const checks=checkTestBotIdentity(value,'123');
  assert(Object.values(checks).every(v=>typeof v==='boolean'));
  const json=JSON.stringify(checks);
  for(const secret of ['987654321','PRIVATE_USERNAME','PRIVATE_FLAG','PRIVATE_TOKEN']) assert.equal(json.includes(secret),false);
});
