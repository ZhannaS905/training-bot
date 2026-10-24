const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function checkTestBotIdentity(value, expectedId) {
  const object = value !== null && typeof value === 'object' && !Array.isArray(value);
  const idPresent = object && own(value,'user_id');
  const idTypeValid = idPresent && Number.isSafeInteger(value.user_id) && value.user_id > 0;
  const usernamePresent = object && own(value,'username');
  const usernameTypeValid = usernamePresent && typeof value.username === 'string';
  const isBotPresent = object && own(value,'is_bot');
  const isBotTypeValid = isBotPresent && typeof value.is_bot === 'boolean';
  const expectedIdValid = typeof expectedId === 'string' && /^[1-9]\d*$/.test(expectedId) && Number.isSafeInteger(Number(expectedId));
  return {
    structureValid: object && idTypeValid && usernameTypeValid && isBotTypeValid,
    expectedIdValid,
    idPresent, idTypeValid,
    idMatches: idTypeValid && expectedIdValid && value.user_id === Number(expectedId),
    usernamePresent, usernameTypeValid,
    usernameMatches: usernameTypeValid && value.username.replace(/^@/,'') === 'id623401053090_1_bot',
    isBotPresent, isBotTypeValid,
    isBotTrue: isBotTypeValid && value.is_bot === true
  };
}
function identityAccepted(checks) {
  return checks.structureValid && checks.idMatches && checks.usernameMatches && checks.isBotTrue;
}
module.exports = { checkTestBotIdentity, identityAccepted };
