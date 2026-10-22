const http = require('node:http');
const { createWebhook } = require('./webhook');
const { createBothostTestApi } = require('./bothost-test-api');
const { openBothostStorage } = require('./bothost-test-storage');
const { CHAT, markStartup } = require('./bothost-test-config');
async function startBothostTest(config, { fetchImpl = fetch, createServer = handler => http.createServer(handler) } = {}) {
  const api = await createBothostTestApi(config, fetchImpl);
  const store = openBothostStorage(config);
  let server;
  try {
    // No Service, scheduler, inbox drain or accelerated clock is constructed.
    // Return 503 for real events so delivery is not falsely acknowledged.
    const receiver = { receive(update) {
      if (String(update?.message?.recipient?.chat_id) !== CHAT) throw Error('FOREIGN_CHAT_REFUSED');
      throw Error('EVENT_PROCESSING_NOT_AUTHORIZED');
    } };
    const webhookHandler = createWebhook(receiver, config.secret).listeners('request')[0];
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ready":true,"mode":"test-read-only"}');
      } else void webhookHandler(req, res);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) {
    markStartup(error, 'HTTP_LISTEN');
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    store.close(); throw error;
  }
  let stopping;
  const stop = () => stopping ||= (async () => {
    if (server.listening) {
      await new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); });
    }
    store.close();
  })();
  return { stop, server, api };
}
module.exports = { startBothostTest };
