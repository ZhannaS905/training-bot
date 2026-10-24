const { loadConfig } = require('./config');
const { Store } = require('./src/store');
const { MaxApi } = require('./src/api');
const { Service } = require('./src/service');
const { createWebhook } = require('./src/webhook');
function main() {
  const config = loadConfig();
  const store = new Store(config.stateDir);
  const service = new Service(store, new MaxApi(config.token), config);
  const server = createWebhook(service, config.secret);
  let stopping = false;
  const tick = async () => {
    if (stopping) return;
    try { await service.run(() => service.tick()); }
    catch { console.error('Processing failed; inspect local state without exposing secrets.'); if (store.failed) stop(); }
    if (!stopping) timer = setTimeout(tick, 1000);
  };
  let timer;
  server.listen(config.port, '127.0.0.1', tick);
  const stop = () => {
    if (stopping) return;
    stopping = true; clearTimeout(timer);
    server.close(async () => { await service.queue; store.close(); });
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  server.on('error', () => { console.error('Webhook listener failed'); stop(); });
}
if (require.main === module) main();
module.exports = { main };
