const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { assertNodeVersion, safeStartupReason } = require('../src/bothost-test-config');
test('Node.js 20.20.2 and malformed versions are rejected; supported runtimes remain valid', () => {
  for (const version of ['20.20.2', '18.20.0', '', undefined, '22', 'PRIVATE_TOKEN']) assert.throws(() => assertNodeVersion(version));
  for (const version of ['22.0.0', '22.20.0', '24.0.0']) assert.doesNotThrow(() => assertNodeVersion(version));
});
test('startup diagnostics expose only fixed reasons or HTTP status and never raw exceptions', () => {
  assert.equal(safeStartupReason(Error('NODE_VERSION_REQUIRED')), 'NODE_VERSION_REQUIRED');
  assert.equal(safeStartupReason(Error('EXPECTED_STATE_REQUIRED')), 'EXPECTED_STATE_REQUIRED');
  assert.equal(safeStartupReason(Error('STATE_HASH_REFUSED')), 'STATE_HASH_REFUSED');
  assert.equal(safeStartupReason(Error('MAX HTTP 401')), 'MAX HTTP 401');
  for (const message of ['PRIVATE_TOKEN', 'Authorization: PRIVATE_TOKEN', '/private/personal-state.json', 'MAX HTTP 401 PRIVATE_TOKEN']) {
    assert.equal(safeStartupReason(Error(message)), 'STARTUP_REFUSED');
  }
});
test('Dockerfile selects Node 22, explicit safe entrypoint and code outside /app', () => {
  const text = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(text, /^FROM node:22-bookworm-slim$/m);
  assert.match(text, /^WORKDIR \/opt\/training-test$/m);
  assert.match(text, /^CMD \["node", "\/opt\/training-test\/bothost-test.cjs"\]$/m);
  assert.match(text, /^USER node$/m); assert.match(text, /^EXPOSE 3000$/m);
  assert(!text.includes('http-wrapper.js')); assert(!/^COPY \.\s/m.test(text));
  for (const setting of ['STATE_DIR=/app/data/training-test/live', 'TEST_ALLOW_DELETE=false', 'TEST_ALLOW_SEND=false',
    'TEST_ALLOW_EDIT=false', 'AUTO_PUBLISH=false', 'NODE_TLS_REJECT_UNAUTHORIZED=1']) assert(text.includes(setting));
  assert(!/\b(?:ARG|ENV)\s+(?:BOT_TOKEN|TEST_BOT_TOKEN|WEBHOOK_SECRET)\b/.test(text));
  assert(!text.includes('chmod 777'));
});
function copiedFiles() {
  const text = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  return text.split('\n').filter(line => line.startsWith('COPY ')).flatMap(line => line.split(/\s+/).slice(1, -1));
}
test('Docker context and COPY rules include all relative runtime dependencies and no data or secrets', () => {
  const files = copiedFiles(), allowed = new Set(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n').filter(x => x.startsWith('!')).map(x => x.slice(1)));
  assert(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n').includes('**'));
  for (const file of files) {
    assert(allowed.has(file), file); assert(fs.statSync(path.join(root, file)).isFile());
    assert(!/(^|\/)(\.env|\.test-state|logs|data)(\/|$)/.test(file));
    if (!/\.(js|cjs)$/.test(file)) continue;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, relative] of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative));
      assert(files.includes(target) || files.includes(target + '.js') || files.includes(target + '.cjs'), `${file} -> ${target}`);
    }
  }
  assert(!files.includes('bot.js')); assert(!files.includes('config.js')); assert(!files.includes('src/service.js'));
});
test('relocated files stay usable with a separate empty /app mount; no wrapper is required', t => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bothost-container-layout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const code = path.join(dir, 'opt/training-test'), app = path.join(dir, 'app');
  fs.mkdirSync(app, { recursive: true });
  for (const file of copiedFiles()) {
    const target = path.join(code, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const result = cp.spawnSync(process.execPath, [path.join(code, 'bothost-test.cjs')], {
    cwd: app, env: { BOT_MODE: 'test', CHAT_IDS: '-1' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1); assert(result.stderr.includes('TEST_CONFIG'));
  assert(!result.stderr.includes('MODULE_NOT_FOUND')); assert(!result.stderr.includes('PRIVATE_TOKEN'));
  const check = cp.spawnSync(process.execPath, ['-e', `const c=require(${JSON.stringify(path.join(code, 'src/bothost-test-config.js'))});if(!c.CA_PATH.startsWith(${JSON.stringify(code)}))process.exit(1);require(${JSON.stringify(path.join(code, 'src/bothost-test-tls.js'))}).validateCertificate();`], { cwd: app, env: {}, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(fs.readdirSync(app), []);
});
