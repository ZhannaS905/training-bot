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
  assert.match(text, /^CMD \["node", "\/opt\/training-test\/memory-training-test.cjs"\]$/m);
  assert.match(text, /^USER node$/m); assert.match(text, /^EXPOSE 3000$/m);
  assert(!text.includes('http-wrapper.js')); assert(!/^COPY \.\s/m.test(text));
  for (const setting of ['TEST_ALLOW_DELETE=false', 'TEST_ALLOW_SEND=false',
    'TEST_ALLOW_EDIT=false', 'AUTO_PUBLISH=false']) assert(text.includes(setting));
  assert(!/\b(?:ARG|ENV)\s+(?:BOT_TOKEN|TEST_BOT_TOKEN|WEBHOOK_SECRET)\b/.test(text));
  assert(!text.includes('STATE_DIR')); assert(!text.includes('src/store.js')); assert(!text.includes('chmod 777'));
});
function copiedFiles() {
  const text = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const sources = text.split('\n').filter(line => line.startsWith('COPY ')).flatMap(line => line.split(/\s+/).slice(1, -1));
  function expand(file) {
    const absolute = path.join(root, file);
    return fs.statSync(absolute).isDirectory()
      ? fs.readdirSync(absolute).flatMap(name => expand(path.posix.join(file, name))) : [file];
  }
  return sources.flatMap(expand);
}
test('Docker context and COPY rules include all relative runtime dependencies and no data or secrets', () => {
  const files = copiedFiles(), allowed = new Set(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n').filter(x => x.startsWith('!')).map(x => x.slice(1)));
  assert(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n').includes('**'));
  for (const file of files) {
    assert(allowed.has(file) || [...allowed].some(rule => rule.endsWith('/**') && file.startsWith(rule.slice(0, -2))), file); assert(fs.statSync(path.join(root, file)).isFile());
    assert(!/(^|\/)(\.env|\.test-state|logs|data)(\/|$)/.test(file));

  }
  assert(!files.includes('bot.js')); assert(!files.includes('config.js'));
  for (const file of ['direct-core/FitPP-Test/persistence.js', 'direct-sdk/package-lock.json', 'direct-preflight.cjs', 'direct-training-test.cjs']) assert(files.includes(file), file);
  // Check the reachable runtime graph, including files copied as directories.
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, relative] of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative));
      const resolved = [target, target + '.js', target + '.cjs'].find(name => files.includes(name));
      assert(resolved, `${file} -> ${target}`);
      if (/\.(js|cjs)$/.test(resolved)) visit(resolved);
    }
  }
  for (const entry of ['memory-training-test.cjs', 'direct-preflight.cjs', 'direct-training-test.cjs']) visit(entry);
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  for (const setting of ['FITPP_DIRECT_ENABLED=false', 'FITPP_DIRECT_WRITES_ENABLED=false', 'OWNER_DIALOG_ENABLED=false']) assert(dockerfile.includes(setting));
  assert(dockerfile.includes('npm ci --prefix direct-sdk --omit=dev --ignore-scripts --no-audit --no-fund'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'direct-sdk/package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'direct-sdk/package-lock.json')));
  assert.equal(manifest.dependencies.firebase, '12.19.0');
  assert.equal(lock.packages['node_modules/firebase'].version, manifest.dependencies.firebase);
  for (const [name, pkg] of Object.entries(lock.packages)) if (name) assert(pkg.integrity && pkg.resolved.startsWith('https://registry.npmjs.org/'), name);
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
  const result = cp.spawnSync(process.execPath, [path.join(code, 'memory-training-test.cjs')], {
    cwd: app, env: { BOT_MODE: 'test', CHAT_IDS: '-1' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1); assert(result.stderr.includes('startup refused'));
  assert(!result.stderr.includes('MODULE_NOT_FOUND')); assert(!result.stderr.includes('PRIVATE_TOKEN'));
  for (const entry of ['direct-preflight.cjs', 'direct-training-test.cjs']) {
    const disabled = cp.spawnSync(process.execPath, [path.join(code, entry)], {
      cwd: app, env: { BOT_MODE: 'test', FITPP_DIRECT_ENABLED: 'false', FITPP_DIRECT_WRITES_ENABLED: 'false' }, encoding: 'utf8'
    });
    assert.equal(disabled.status, 1);
    assert.equal(disabled.stderr.trim(), entry === 'direct-preflight.cjs' ? 'DIRECT_READ_PREFLIGHT_REJECTED stage=SETTINGS reason=DIRECT_DISABLED' : 'DIRECT_STARTUP_REJECTED');
    assert.equal(disabled.stdout, '');
  }
  assert.deepEqual(fs.readdirSync(app), []);
});
