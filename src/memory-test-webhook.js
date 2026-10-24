const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
function createWebhook(service, secret) {
  return http.createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers['x-max-bot-api-secret'] || '');
    const expected = Buffer.from(secret);
    if (req.method !== 'POST' || req.url !== '/webhook') { res.writeHead(404).end(); return; }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(403).end(); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      let update;
      try { update = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { res.writeHead(400).end(); return; }
      // Await serialized handling, including durable reservation for manual publication.
      await service.receive(update);
      res.writeHead(200).end();
    } catch { res.writeHead(503).end(); }
  });
}
module.exports = { createWebhook };
