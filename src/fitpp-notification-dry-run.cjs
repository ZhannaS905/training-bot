'use strict';

// Pure, side-effect-free preview of a *new* confirmed subscription deduction.
// No Firestore writes, MAX calls, or bot-runtime imports.
const { isDeepStrictEqual } = require('node:util');
const TEST_BOT_ID = 131384398;
const CLIENT_ID = 'demo-client-1';
const EXPECTED_CHAT_ID = 126619382;
const EXPECTED_USER_ID = 5819064;

const OWNER_UID = 'lLlMAetSG1aEeJSeBl4F4ypydEh2';
const map = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function validateState(state) {
  if (!map(state) || state.ownerUid !== OWNER_UID || state.datasetId !== 'synthetic-v1' ||
      state.schemaVersion !== 1 || !Number.isSafeInteger(state._fitppRevision) || state._fitppRevision < 0 ||
      !Array.isArray(state.clients) || !['visits','visitOps','attendanceOps','workouts'].every(k => map(state[k])))
    throw Error('STATE_REFUSED');
  const ids = new Set();
  for (const c of state.clients) {
    if (!map(c) || typeof c.id !== 'string' || ids.has(c.id) ||
        (c.subscriptions !== undefined && !Array.isArray(c.subscriptions))) throw Error('STATE_REFUSED');
    ids.add(c.id);
  }
  for (const k of ['visits','visitOps','attendanceOps']) {
    for (const entries of Object.values(state[k])) {
      if (!map(entries)) throw Error('STATE_REFUSED');
      for (const v of Object.values(entries)) {
        if (k === 'visits' ? !['attended','missed','razov','excused'].includes(v) : !map(v))
          throw Error('STATE_REFUSED');
      }
    }
  }
  return state;
}
function operationIds(state) {
  const result = [];
  for (const k of ['visitOps','attendanceOps']) for (const entries of Object.values(state[k]))
    for (const op of Object.values(entries)) if (typeof op.operationId === 'string') result.push(op.operationId);
  return result;
}
function findSubscription(state, clientId, subscriptionId) {
  const clients = state?.clients;
  if (!Array.isArray(clients)) return null;
  const matches = clients.filter(c => c?.id === clientId);
  if (matches.length !== 1 || matches[0].archivedAt) return null;
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

function previewDeductions(before, after, binding, diagnostics) {
  const reject = reason => { if (diagnostics) diagnostics.reasons[reason] = (diagnostics.reasons[reason] || 0) + 1; };
  // First read is only a baseline; no historical operation may trigger a preview.
  if (!before || !after) { reject('BASELINE_ONLY'); return []; }
  const bindingOK = validBinding(binding, CLIENT_ID);
  if (!bindingOK) { reject('BINDING_NOT_APPROVED'); if (!diagnostics) return []; }
  validateState(before); validateState(after);
  const revisionOK = after._fitppRevision === before._fitppRevision + 1;
  if (!revisionOK) { reject('REVISION_NOT_PLUS_ONE'); if (!diagnostics) return []; }
  const prior = before.visitOps;
  const next = after.visitOps || {};
  // Prevent a moved/copied historical operation from being interpreted as new.
  const priorIds = new Set(operationIds(before));
  const nextIds = operationIds(after);
  const candidates = [];
  for (const [workoutId, clients] of Object.entries(next)) {
    if (!clients || typeof clients !== 'object' || Array.isArray(clients)) continue;
    const op = clients[CLIENT_ID];
    if (!op) continue;
    if (op.status !== 'attended' || after.visits?.[workoutId]?.[CLIENT_ID] !== 'attended') { reject('NOT_ATTENDED'); continue; }
    if (typeof op.operationId !== 'string' || !/^[a-zA-Z0-9-]{8,128}$/.test(op.operationId) ||
        typeof op.subscriptionId !== 'string' || !op.subscriptionId) { reject('OPERATION_FIELDS_INVALID'); continue; }
    // An existing operation is not new, including after restart or unrelated edits.
    if (priorIds.has(op.operationId)) { reject('OPERATION_ALREADY_IN_BEFORE'); continue; }
    if (nextIds.filter(id => id === op.operationId).length !== 1) { reject('DUPLICATE_OPERATION_ID'); continue; }
    // Corrections, cancellation/replacement and migrated legacy visits are not new attendance.
    if (before.visits[workoutId]?.[CLIENT_ID] != null || prior[workoutId]?.[CLIENT_ID] != null) { reject('EXISTING_VISIT_OR_CORRECTION'); continue; }
    if (op.moneyChargeId) { reject('MONEY_CHARGE'); continue; }
    const workout = after.workouts[workoutId];
    if (!map(workout) || workout.id !== workoutId || workout.cancelled !== false ||
        op.workoutId !== workoutId || op.location !== workout.location ||
        !['zarya','pole','online'].includes(op.location) ||
        typeof workout.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(workout.date) ||
        !Number.isFinite(Date.parse(workout.date + 'T00:00:00Z')) ||
        new Date(workout.date + 'T00:00:00Z').toISOString().slice(0,10) !== workout.date) { reject('WORKOUT_MISMATCH'); continue; }
    const oldSub = findSubscription(before, CLIENT_ID, op.subscriptionId);
    const newSub = findSubscription(after, CLIENT_ID, op.subscriptionId);
    if (!oldSub || !newSub) { reject('SUBSCRIPTION_MISSING_AMBIGUOUS_OR_ARCHIVED'); continue; }
    const oldTerms = {...oldSub}, newTerms = {...newSub};
    delete oldTerms.left; delete newTerms.left;
    // The reducer may consume an existing booking thaw alongside the decrement.
    if (oldTerms.bookingThaw && newTerms.bookingThaw) {
      oldTerms.bookingThaw = {...oldTerms.bookingThaw, consumed:true};
    }
    if (!isDeepStrictEqual(oldTerms,newTerms)) { reject('SUBSCRIPTION_TERMS_CHANGED'); continue; }
    // No other visit or operation for this client may change in this transition.
    const withoutTarget = state => {
      const maps = {};
      for (const k of ['visits','visitOps','attendanceOps']) {
        maps[k] = Object.fromEntries(Object.entries(state[k]).flatMap(([wid, entries]) =>
          (wid === workoutId && k !== 'attendanceOps') || entries[CLIENT_ID] === undefined ? [] : [[wid,entries[CLIENT_ID]]]));
      }
      return maps;
    };
    if (!isDeepStrictEqual(withoutTarget(before),withoutTarget(after))) { reject('OTHER_CLIENT_VISITS_CHANGED'); continue; }
    candidates.push({ operationId: op.operationId, workoutId, clientId: CLIENT_ID,
      subscriptionId: op.subscriptionId, remaining: newSub.left, previous: oldSub.left,
      maxChatId: binding?.bindings?.[0]?.maxChatId });
  }
  // One operation per subscription per observed transition. Ambiguous batches
  // are deliberately not previewed until a separate ordering design exists.
  const counts = new Map();
  for (const item of candidates) counts.set(item.subscriptionId, (counts.get(item.subscriptionId) || 0) + 1);
  const eligible = candidates.filter(item => {
    if (counts.get(item.subscriptionId) !== 1) { reject('AMBIGUOUS_SUBSCRIPTION_BATCH'); return false; }
    if (item.previous !== item.remaining + 1) { reject('BALANCE_NOT_MINUS_ONE'); return false; }
    return true;
  });
  return bindingOK && revisionOK ? eligible : [];
}

function createPreviewSession({ diagnose = false } = {}) {
  let previous = null;
  const seen = new Set();
  return { check(state,binding) {
    validateState(state);
    if (!map(binding) || binding.version !== 1 || binding.botId !== TEST_BOT_ID ||
        !Array.isArray(binding.bindings) || binding.bindings.some(row => !map(row) ||
          typeof row.clientId !== 'string' || !Number.isSafeInteger(row.maxChatId) || row.maxChatId === 0 ||
          !Number.isSafeInteger(row.maxUserId) || row.maxUserId <= 0 || typeof row.notificationsEnabled !== 'boolean'))
      throw Error('BINDING_REFUSED');
    const baseline = previous === null;
    // Only numbers, booleans and fixed reason codes leave the detector. Never IDs or document values.
    const count = (snapshot, key, pilotOnly = false) => snapshot ? Object.values(snapshot[key])
      .reduce((n, entries) => n + (pilotOnly ? Number(entries[CLIENT_ID] !== undefined) : Object.keys(entries).length), 0) : 0;
    const diagnostics = diagnose ? {
      beforeRevision: previous?._fitppRevision ?? null, afterRevision: state._fitppRevision,
      bindingApproved: validBinding(binding, CLIENT_ID),
      beforeVisitOps: count(previous,'visitOps'), afterVisitOps: count(state,'visitOps'),
      beforeAttendanceOps: count(previous,'attendanceOps'), afterAttendanceOps: count(state,'attendanceOps'),
      beforePilotVisitOps: count(previous,'visitOps',true), afterPilotVisitOps: count(state,'visitOps',true),
      reasons: {}
    } : undefined;
    const candidates = previewDeductions(previous,state,binding,diagnostics).filter(item => {
      if (!seen.has(item.operationId)) return true;
      if (diagnostics) diagnostics.reasons.OPERATION_SEEN_IN_SESSION = (diagnostics.reasons.OPERATION_SEEN_IN_SESSION || 0) + 1;
      return false;
    });
    if (diagnostics && !baseline && diagnostics.afterPilotVisitOps === 0) diagnostics.reasons.NO_PILOT_VISIT_OPS = 1;
    for (const id of operationIds(state)) seen.add(id);
    previous = structuredClone(state);
    return {baseline,candidates,...(diagnostics ? {diagnostics} : {})};
  }};
}
module.exports = { previewDeductions, validBinding, validateState, createPreviewSession };
