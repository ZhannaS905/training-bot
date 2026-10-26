'use strict';

// Pure, side-effect-free preview of a *new* confirmed subscription deduction.
// No Firestore writes, MAX calls, or bot-runtime imports.
const TEST_BOT_ID = 131384398;
const CLIENT_ID = 'demo-client-1';
const EXPECTED_CHAT_ID = 126619382;
const EXPECTED_USER_ID = 5819064;

function findSubscription(state, clientId, subscriptionId) {
  const clients = state?.clients;
  if (!Array.isArray(clients)) return null;
  const matches = clients.filter(c => c?.id === clientId);
  if (matches.length !== 1) return null;
  const subscriptions = matches[0]?.subscriptions;
  if (!Array.isArray(subscriptions)) return null;
  const found = subscriptions.filter(s => s?.id === subscriptionId);
  return found.length === 1 && Number.isSafeInteger(found[0].left) && found[0].left >= 0
    ? found[0] : null;
}

function validBinding(binding, clientId) {
  if (binding?.version !== 1 || binding?.botId !== TEST_BOT_ID ||
      !Array.isArray(binding.bindings) || binding.bindings.length !== 1) return false;
  const row = binding.bindings[0];
  return row?.clientId === clientId && row.notificationsEnabled === true &&
    row.maxChatId === EXPECTED_CHAT_ID && row.maxUserId === EXPECTED_USER_ID;
}

function previewDeductions(before, after, binding) {
  // First read is only a baseline; no historical operation may trigger a preview.
  if (!before || !after || !validBinding(binding, CLIENT_ID)) return [];
  const prior = before.visitOps || {};
  const next = after.visitOps || {};
  const seen = new Set();
  // Prevent a moved/copied historical operation from being interpreted as new.
  const priorIds = new Set();
  for (const clients of Object.values(prior)) {
    const id = clients?.[CLIENT_ID]?.operationId;
    if (typeof id === 'string') priorIds.add(id);
  }
  const candidates = [];
  for (const [workoutId, clients] of Object.entries(next)) {
    if (!clients || typeof clients !== 'object' || Array.isArray(clients)) continue;
    const op = clients[CLIENT_ID];
    if (op?.status !== 'attended' || after.visits?.[workoutId]?.[CLIENT_ID] !== 'attended') continue;
    if (typeof op.operationId !== 'string' || !/^[a-zA-Z0-9-]{8,128}$/.test(op.operationId) ||
        typeof op.subscriptionId !== 'string' || !op.subscriptionId) continue;
    // An existing operation is not new, including after restart or unrelated edits.
    if (priorIds.has(op.operationId)) continue;
    if (seen.has(op.operationId)) return []; // ambiguous IDs: fail closed
    seen.add(op.operationId);
    const oldSub = findSubscription(before, CLIENT_ID, op.subscriptionId);
    const newSub = findSubscription(after, CLIENT_ID, op.subscriptionId);
    if (!oldSub || !newSub) continue;
    candidates.push({ operationId: op.operationId, workoutId, clientId: CLIENT_ID,
      subscriptionId: op.subscriptionId, remaining: newSub.left, previous: oldSub.left,
      maxChatId: binding.bindings[0].maxChatId });
  }
  // One operation per subscription per observed transition. Ambiguous batches
  // are deliberately not previewed until a separate ordering design exists.
  const counts = new Map();
  for (const item of candidates) counts.set(item.subscriptionId, (counts.get(item.subscriptionId) || 0) + 1);
  return candidates.filter(item => counts.get(item.subscriptionId) === 1 &&
    item.previous === item.remaining + 1);
}

module.exports = { previewDeductions, validBinding };
