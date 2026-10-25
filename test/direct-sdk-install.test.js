'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');

test('root production install locks the same SDK graph as the isolated Docker install', () => {
  const manifest = require('../package.json');
  const lock = require('../package-lock.json');
  const nested = require('../direct-sdk/package-lock.json');
  assert.deepEqual(manifest.dependencies, nested.packages[''].dependencies);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  for (const [name, pkg] of Object.entries(nested.packages)) {
    if (name) assert.deepEqual(lock.packages[name], pkg, name);
  }
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(manifest.scripts[hook], undefined);
  }
});

test('existing nested loader finds root SDK with missing or empty nested node_modules', t => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sdk-resolution-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'app');
  const nested = path.join(app, 'direct-sdk');
  fs.mkdirSync(nested, { recursive: true });
  fs.copyFileSync(path.join(root, 'direct-sdk/package.json'), path.join(nested, 'package.json'));
  const pkg = path.join(app, 'node_modules/firebase');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ exports: {
    './app': './app.cjs', './auth': './auth.cjs', './firestore': './firestore.cjs'
  } }));
  for (const name of ['app', 'auth', 'firestore']) fs.writeFileSync(path.join(pkg, name + '.cjs'), `module.exports = '${name}';`);
  const load = createRequire(path.join(nested, 'package.json'));
  for (const emptyNested of [false, true]) {
    if (emptyNested) fs.mkdirSync(path.join(nested, 'node_modules'));
    for (const name of ['app', 'auth', 'firestore']) {
      assert.equal(load('firebase/' + name), name);
      assert.equal(load.resolve('firebase/' + name), path.join(pkg, name + '.cjs'));
    }
  }
});
