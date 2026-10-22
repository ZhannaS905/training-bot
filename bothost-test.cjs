// Dedicated BotHost entry point. Never loads .env, bot.js or test-launch.cjs.
const { loadBothostTestConfig, workerEnvironment, CA_PATH, assertNodeVersion, safeStartupReason } = require('./src/bothost-test-config');
const { validateCertificate } = require('./src/bothost-test-tls');
async function main() {
  assertNodeVersion(process.versions.node);
  const config = loadBothostTestConfig(process.env);
  validateCertificate();
  if (process.argv.length === 2) {
    // NODE_EXTRA_CA_CERTS is consumed when Node starts, not after startup.
    // A clean child also removes BotHost token aliases and preload settings.
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, [__filename, '--worker'], { env: workerEnvironment(config), stdio: 'inherit' });
    const forward = signal => { if (!child.killed) child.kill(signal); };
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => { process.exitCode = code ?? 1; resolve(); });
    });
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  } else {
    if (process.argv.length !== 3 || process.argv[2] !== '--worker' ||
        process.env.NODE_EXTRA_CA_CERTS !== CA_PATH || process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '1') throw Error('WORKER_CONFIG');
    const runtime = await require('./src/bothost-test-runtime').startBothostTest(config);
    const stop = () => { void runtime.stop().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.log('Training Test: identity and expected storage verified; read-only mode, publication and API writes blocked.');
  }
}
if (require.main === module) main().catch(error => {
  console.error(`Training Test BotHost startup refused: ${safeStartupReason(error)}. Secrets hidden.`);
  process.exitCode = 1;
});
module.exports = { main };
