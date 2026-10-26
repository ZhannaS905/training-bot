'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { previewDeductions } = require('../src/fitpp-notification-dry-run.cjs');
const { decodeFields, config } = require('../fitpp-notification-preview.cjs');

const CLIENT = 'demo-client-1';
const SUB = 'subscription-demo-sale-demo-client-1';
const WORKOUT = 'online_2026-10-24';
const binding = { version: 1, botId: 131384398, bindings: [{
  clientId: CLIENT, maxChatId: 126619382, maxUserId: 5819064, notificationsEnabled: true
}] };
function state(left, ops = {}, visits = {}) {
  return { clients: [{ id: CLIENT, subscriptions: [{ id: SUB, left }] }], visitOps: ops, visits };
}
function mark(operationId, status = 'attended') {
  return { [WORKOUT]: { [CLIENT]: { operationId, subscriptionId: SUB, status, location: 'online' } } };
}
function visits(status = 'attended') { return { [WORKOUT]: { [CLIENT]: status } }; }

test('first read is baseline and cannot notify historical operations', () => {
  assert.deepEqual(previewDeductions(null, state(5, mark('old-operation'), visits()), binding), []);
});
test('new attended operation with one confirmed decrement previews once', () => {
  const result = previewDeductions(state(6), state(5, mark('new-operation'), visits()), binding);
  assert.equal(result.length, 1);
  assert.equal(result[0].remaining, 5);
  assert.equal(result[0].operationId, 'new-operation');
});
test('unchanged operation is not previewed after unrelated edits', () => {
  const before = state(5, mark('old-operation'), visits());
  assert.deepEqual(previewDeductions(before, state(5, mark('old-operation'), visits()), binding), []);
});
test('reverted or unpaid marks do not produce a deduction preview', () => {
  assert.deepEqual(previewDeductions(state(5, mark('old-operation'), visits()), state(6), binding), []);
  assert.deepEqual(previewDeductions(state(6), state(6, mark('new-operation'), visits()), binding), []);
  assert.deepEqual(previewDeductions(state(6), state(5, mark('new-operation', 'razov'), visits('razov')), binding), []);
  assert.deepEqual(previewDeductions(state(6), state(5, mark('new-operation', 'missed'), visits('missed')), binding), []);
});
test('no preview without explicit enabled test-client binding', () => {
  assert.deepEqual(previewDeductions(state(6), state(5, mark('new-operation'), visits()),
    { ...binding, bindings: [{ ...binding.bindings[0], notificationsEnabled: false }] }), []);
  assert.deepEqual(previewDeductions(state(6), state(5, mark('new-operation'), visits()),
    { ...binding, botId: 123 }), []);
});
test('ambiguous multi-operation transition fails closed', () => {
  const second = 'zarya_2026-10-26';
  const after = state(4, { ...mark('first-op'), [second]: { [CLIENT]: {
    operationId: 'second-op', subscriptionId: SUB, status: 'attended'
  } } }, { ...visits(), [second]: { [CLIENT]: 'attended' } });
  assert.deepEqual(previewDeductions(state(6), after, binding), []);
});
test('Firestore REST values decode without leaking unrelated fields', () => {
  const decoded = decodeFields({ left: { integerValue: '5' },
    enabled: { booleanValue: true },
    rows: { arrayValue: { values: [{ mapValue: { fields: { status: { stringValue: 'attended' } } } }] } } });
  assert.deepEqual(decoded, { left: 5, enabled: true, rows: [{ status: 'attended' }] });
});
test('preview configuration refuses any non-test project', () => {
  assert.throws(() => config({ FIREBASE_PROJECT_ID: 'fitpp-165a2' }), /PROJECT_REFUSED/);
});
