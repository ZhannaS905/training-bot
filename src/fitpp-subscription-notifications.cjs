'use strict';
// Local-only policy engine. No transport, credentials, Firebase or runtime imports.
// Receipt purchase/extension detection lives in fitpp-receipt-notifications.cjs.
const {validateState, validBinding} = require('./fitpp-notification-dry-run.cjs');
const {frozenOn}=require('../direct-core/FitPP-Test/persistence.js');
const CLIENT = 'demo-client-1';
const MAX_GAP = 45000; // 30s polling + 15s scheduling tolerance; larger gaps skip.
function expiryTime(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const midnight = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0,10) !== date) return NaN;
  // Europe/Moscow is UTC+03:00. Next calendar day at 10:00 = +31h UTC.
  return midnight + 31 * 3600000;
}
function subscriptions(state) {
  validateState(state);
  const result = new Map(), ids = new Set();
  for (const client of state.clients) for (const sub of client.subscriptions || []) {
    if (typeof sub.id !== 'string' || !sub.id || ids.has(sub.id)) throw Error('SUBSCRIPTION_ID_REFUSED');
    ids.add(sub.id);
    if (client.id !== CLIENT || client.archivedAt || sub.cancelledAt) continue;
    if (!Number.isSafeInteger(sub.left) || sub.left < 0 || !Number.isFinite(expiryTime(sub.expires))) continue;
    try { frozenOn(sub,sub.expires); } catch {continue;}
    result.set(sub.id, structuredClone(sub));
  }
  return result;
}
// caller must durably reserve eventKey before any attempted send. Baseline and gaps
// consume deadlines without candidates. Never use this engine to replay history.
function createExpirySession() {
  let previous, previousTime;
  const cycles = new Map(), consumed = new Set(), highWater = new Map();
  return {check(state, binding, now) {
    if (!Number.isSafeInteger(now)) throw Error('CLOCK_REFUSED');
    const current = subscriptions(state), candidates = [];
    const continuous = previous && now > previousTime && now - previousTime <= MAX_GAP;
    for (const [id, sub] of current) {
      const before = previous?.get(id);
      const highest = highWater.get(id);
      if (highest && sub.expires < highest) continue;
      highWater.set(id, sub.expires);
      let cycle = cycles.get(id) || 0;
      // Only an observed extension before its next deadline creates a new cycle.
      // Deletion/reappearance cannot create one; consumed events stay consumed.
      if (before && sub.expires > before.expires && now < expiryTime(sub.expires)) cycle++;
      cycles.set(id, cycle);
      const key = JSON.stringify(['expiry-v1',CLIENT,id,cycle,sub.expires]);
      const due = expiryTime(sub.expires);
      if (now < due) continue;
      if (consumed.has(key)) continue;
      consumed.add(key);
      if (!continuous || !before || before.expires !== sub.expires || previousTime >= due || sub.left === 0 ||
          !validBinding(binding,CLIENT)) continue;
      candidates.push({kind:'expiry',clientId:CLIENT,subscriptionId:id,expires:sub.expires,
        remaining:sub.left,eventKey:key,maxChatId:binding.bindings.find(b=>b.clientId===CLIENT).maxChatId});
    }
    previous = current; previousTime = now;
    return candidates;
  }};
}
const displayDate = value => {
  if (!Number.isFinite(expiryTime(value))) throw Error('DATE_REFUSED');
  return value.split('-').reverse().join('.');
};
function formatPurchase({sessions,expires}) {
  if (!Number.isSafeInteger(sessions) || sessions < 1) throw Error('SESSIONS_REFUSED');
  return `💳 Покупка абонемента\n\n🎟 ${sessions} ${sessions % 100 >= 11 && sessions % 100 <= 14 ? 'занятий' : sessions % 10 === 1 ? 'занятие' : sessions % 10 >= 2 && sessions % 10 <= 4 ? 'занятия' : 'занятий'}\n📅 Действует до ${displayDate(expires)}`;
}
function formatExpiry({expires,remaining}) {
  if (!Number.isSafeInteger(remaining) || remaining < 1) throw Error('REMAINING_REFUSED');
  return `⏳ Срок абонемента истёк\n\n📅 Действовал до: ${displayDate(expires)}\nОсталось неиспользованных занятий: ${remaining}\n\n🫶 Ждём на следующей тренировке!`;
}
function stillCurrent(item,state,binding) {
  const sub=subscriptions(state).get(item.subscriptionId);
  return validBinding(binding,CLIENT) && !!sub && sub.expires===item.expires &&
    sub.left===item.remaining && sub.left>0;
}
module.exports = {stillCurrent,expiryTime,createExpirySession,formatPurchase,formatExpiry,MAX_GAP};
