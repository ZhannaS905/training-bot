'use strict';

// Standalone read-only Firestore preview for Training Test.
// Explicit command only; never imported by bot.js or direct-training-test.cjs.
// Makes one Firebase Auth POST (sign-in) and Firestore GET requests. No MAX API.
const { createPreviewSession } = require('./src/fitpp-notification-dry-run.cjs');
const PROJECT = 'fitpp-test';
const MAIN = 'fitppTestWorkspaces/synthetic-v1/states/main';
const BINDING = 'fitppTestWorkspaces/synthetic-v1/notificationBindings/training-test';
const EXPECTED_UID = 'lLlMAetSG1aEeJSeBl4F4ypydEh2';

function decode(value) {
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.integerValue !== undefined) {
    const n = Number(value.integerValue);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (value?.doubleValue !== undefined) return value.doubleValue;
  if (value?.booleanValue !== undefined) return value.booleanValue;
  if (value?.nullValue !== undefined) return null;
  if (value?.mapValue) return decodeFields(value.mapValue.fields || {});
  if (value?.arrayValue) return (value.arrayValue.values || []).map(decode);
  throw Error('STATE_REFUSED');
}
function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}
function config(env) {
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_PROJECT_ID !== PROJECT) throw Error('PROJECT_REFUSED');
  for (const key of ['FIREBASE_API_KEY', 'FIREBASE_BOT_EMAIL', 'FIREBASE_BOT_PASSWORD']) {
    if (typeof env[key] !== 'string' || !env[key]) throw Error('CONFIG_MISSING');
  }
  return env;
}
async function getJson(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('HTTP_' + response.status);
  return response.json();
}
async function signIn(env) {
  const response = await getJson(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(env.FIREBASE_API_KEY),
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.FIREBASE_BOT_EMAIL, password: env.FIREBASE_BOT_PASSWORD, returnSecureToken: true }) }
  );
  if (response.localId !== EXPECTED_UID || typeof response.idToken !== 'string') throw Error('UID_REFUSED');
  // Firebase verifies this token on GET; inspect scope before ever using it.
  let claims;
  try { claims = JSON.parse(Buffer.from(response.idToken.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw Error('TOKEN_REFUSED'); }
  if (claims.aud !== PROJECT || claims.iss !== 'https://securetoken.google.com/' + PROJECT ||
      claims.sub !== EXPECTED_UID || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw Error('TOKEN_REFUSED');
  return response.idToken;
}
async function readDocument(token, path) {
  const data = await getJson(
    'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/' + path,
    { method: 'GET', headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-store' } }
  );
  if (typeof data.name !== 'string' || data.name !== 'projects/' + PROJECT + '/databases/(default)/documents/' + path) throw Error('PATH_REFUSED');
  return decodeFields(data.fields || {});
}
async function readBoth(token) {
  // Both paths are hardcoded to the test project. No collection list permission needed.
  const main = await readDocument(token, MAIN);
  const binding = await readDocument(token, BINDING);
  return { main, binding };
}
async function main(env = process.env, args = process.argv.slice(2), {
  wait = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  let checks = 1;
  const watch = args.length === 1 && args[0] === '--watch';
  if (watch) checks = Infinity;
  else if (args.length === 2 && args[0] === '--checks' && /^[1-9][0-9]*$/.test(args[1])) {
    checks = Number(args[1]);
    if (!Number.isSafeInteger(checks)) throw Error('ARGUMENT_REFUSED');
  } else if (args.length !== 0) throw Error('ARGUMENT_REFUSED');
  config(env);
  let token = await signIn(env);
  let expires = Date.now() + 45 * 60 * 1000;
  const session = createPreviewSession();
  const check = async () => {
    if (Date.now() >= expires) {
      token = await signIn(env);
      expires = Date.now() + 45 * 60 * 1000;
    }
    const { main, binding } = await readBoth(token);
    const {baseline,candidates} = session.check(main,binding);
    if (baseline) {
      console.log('FITPP_DRY_RUN_BASELINE_OK');
    } else {
      console.log('FITPP_DRY_RUN_CHECK_OK previews=' + candidates.length);
      for (const item of candidates) console.log('FITPP_PREVIEW_ONLY remaining=' + item.remaining);
    }
    // Session retains historical IDs even after cancellation; baseline stays in memory only.
  };
  await check();
  if (checks === 1) return;
  if (watch) console.log('FITPP_DRY_RUN_WATCH_ACTIVE no_max_send no_firestore_write');
  // Serialized checks, no overlap, no external side effects.
  for (let completed = 1; completed < checks; completed++) {
    await wait(30000);
    await check();
  }
}
if (require.main === module) {
  main().catch(error => {
    const safe = /^(PROJECT_REFUSED|CONFIG_MISSING|UID_REFUSED|TOKEN_REFUSED|STATE_REFUSED|BINDING_REFUSED|PATH_REFUSED|ARGUMENT_REFUSED|HTTP_[1-5][0-9][0-9])$/.test(error?.message || '')
      ? error.message : 'CHECK_FAILED';
    console.error('FITPP_DRY_RUN_FAILED ' + safe);
    process.exitCode = 1;
  });
}
module.exports = { decode, decodeFields, config, main };
