const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Store } = require('./store');
const { CHAT, markStartup } = require('./bothost-test-config');
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function inspectStorage(dir, expectedHash) {
  try { return inspectStorageContents(dir, expectedHash); }
  catch (error) { throw markStartup(error, 'STATE_READ'); }
}
function inspectStorageContents(dir, expectedHash) {
  let current = path.parse(dir).root;
  for (const part of dir.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink()) throw Error('STORAGE_PATH_REFUSED');
  }
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.lstatSync(path.join(dir, name));
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw Error('LINKED_STORAGE_REFUSED');
  }
  const file = path.join(dir, 'state.json'), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1) throw Error('STATE_FILE_REFUSED');
  const bytes = fs.readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw Error('STATE_HASH_REFUSED');
  let state;
  try { state = JSON.parse(bytes); }
  catch (error) { throw markStartup(error, 'STATE_JSON'); }
  if (state?.version !== 1 || !record(state.polls) || !record(state.done) || !record(state.inbox) ||
      Object.keys(state.polls).length === 0 || Object.keys(state.done).length === 0 || Object.keys(state.inbox).length !== 0) throw Error('EXPECTED_HISTORY_REQUIRED');
  for (const [key, poll] of Object.entries(state.polls)) {
    if (!record(poll) || poll.chat !== CHAT || key !== `${CHAT}/${poll.date}` ||
        !/^\d{4}-\d{2}-\d{2}$/.test(poll.date) || !/^[a-f0-9-]{36}$/.test(poll.id || '') ||
        !['pending', 'published', 'uncertain', 'deleting', 'deleted'].includes(poll.status) ||
        !record(poll.votes) || (poll.names !== undefined && !record(poll.names))) throw Error('STATE_POLL_REFUSED');
    if (['published', 'deleting', 'deleted'].includes(poll.status) &&
        (typeof poll.mid !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(poll.mid))) throw Error('STATE_MESSAGE_REFUSED');
    for (const [user, vote] of Object.entries(poll.votes)) {
      if (!/^[1-9]\d*$/.test(user) || !['yes', 'no', 'maybe'].includes(vote) || typeof poll.names?.[user] !== 'string') throw Error('STATE_VOTE_REFUSED');
    }
  }
  if (Object.values(state.done).some(value => value !== true)) throw Error('STATE_HISTORY_REFUSED');
  return bytes;
}
function openBothostStorage(config) {
  // Never mkdir an empty STATE_DIR, never generate state, never break a lock.
  inspectStorage(config.stateDir, config.expectedStateHash);
  let store;
  try { store = new Store(config.stateDir); }
  catch (error) { throw markStartup(error, error instanceof SyntaxError ? 'STATE_JSON' : 'STATE_LOCK'); }
  try { inspectStorage(config.stateDir, config.expectedStateHash); }
  catch (error) { store.close(); throw error; }
  return store;
}
module.exports = { inspectStorage, openBothostStorage };
