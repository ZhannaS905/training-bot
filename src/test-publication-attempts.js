const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
// Operator-provisioned persistent volume only. Never initialize a missing store.
class TestPublicationAttempts {
  constructor(directory, botId) { this.directory = directory; this.botId = botId; }
  async reserve(date, eventId) {
    if (!path.isAbsolute(this.directory || '')) throw Error('ATTEMPT_STORE_REQUIRED');
    const scope = `training-test:-80345864298680:${this.botId}`;
    if ((await fs.readFile(path.join(this.directory, 'scope'), 'utf8')).trim() !== scope) throw Error('ATTEMPT_SCOPE_REFUSED');
    const lock = path.join(this.directory, 'lock');
    const handle = await fs.open(lock, 'wx', 0o600); // Stale lock deliberately requires operator review.
    let complete = false;
    try {
      const file = await fs.open(path.join(this.directory, 'attempts.jsonl'), 'r+');
      try {
        const raw = await file.readFile('utf8');
        const rows = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
        if (rows.some(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^[a-f0-9]{64}$/.test(row.event))) throw Error('ATTEMPT_STORE_CORRUPT');
        const event = createHash('sha256').update(scope + ':' + eventId).digest('hex');
        if (rows.some(row => row.date === date || row.event === event)) { complete = true; return false; }
        await file.writeFile(JSON.stringify({ date, event }) + '\n');
        await file.sync(); // Persist reservation before any network write.
        complete = true;
        return true;
      } finally { await file.close(); }
    } finally {
      await handle.close();
      if (complete) await fs.unlink(lock);
    }
  }
}
module.exports = { TestPublicationAttempts };
