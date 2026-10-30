'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {resolveClient} = require('../src/fitpp-calendar-booking-link');

const registry = {
  version: 1,
  botId: 131384398,
  bindings: [
    {
      clientId: 'demo-client-1',
      maxUserId: 80,
      maxChatId: 70,
      notificationsEnabled: true
    }
  ]
};

test('MAX user resolves to existing FitPP client', () => {
  assert.equal(resolveClient(registry, '80', '131384398'), 'demo-client-1');
});

test('unlinked MAX user does not create a booking', () => {
  assert.equal(resolveClient(registry, '81', '131384398'), null);
});

test('foreign bot registry is refused', () => {
  assert.throws(
    () => resolveClient(registry, '80', '999'),
    /REFUSED/
  );
});

test('duplicate MAX bindings are refused', () => {
  const duplicate = structuredClone(registry);
  duplicate.bindings.push({
    clientId: 'demo-client-2',
    maxUserId: 80,
    maxChatId: 71,
    notificationsEnabled: true
  });

  assert.throws(
    () => resolveClient(duplicate, '80', '131384398'),
    /REFUSED/
  );
});
