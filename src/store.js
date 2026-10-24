const fs = require('node:fs');
const path = require('node:path');
class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.dir = dir;
    this.lock = path.join(dir, '.lock');
    fs.mkdirSync(this.lock); // Exclusive writer; never automatically break a stale lock.
    try {
      const file = path.join(dir, 'state.json');
      this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) :
        { version: 1, polls: {}, inbox: {}, done: {} };
      if (this.state.version !== 1 || !this.state.polls || !this.state.inbox || !this.state.done) throw new Error('Invalid state');
    } catch (error) { this.close(); throw error; }
  }
  save() {
    if (this.failed) throw new Error('Storage failed; restart after inspection');
    try { this.write(); }
    catch (error) { this.failed = true; throw error; }
  }
  write() {
    const temp = path.join(this.dir, 'state.tmp');
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(this.state)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, path.join(this.dir, 'state.json'));
    const directory = fs.openSync(this.dir, 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  }
  close() { fs.rmdirSync(this.lock); }
}
module.exports = { Store };
