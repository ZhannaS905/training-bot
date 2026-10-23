const http = require('node:http');
const { createWebhook } = require('./src/memory-test-webhook');
const { config, guardedApi, MemoryTrainingTest } = require('./src/memory-training-test');
const { randomBytes, createHmac } = require('node:crypto');
// Per-process pseudonyms only; never log the update, headers or raw identifiers.
function diagnosticReceiver(service, log = console.log) {
  const key = randomBytes(32);
  const tag = value => typeof value === 'string' && value.length > 0 && value.length <= 256
    ? createHmac('sha256', key).update(value).digest('hex').slice(0,24) : null;
  return { async receive(update) {
    if (update?.update_type === 'message_callback') {
      try {
        const cb = update.callback;
        const validUser = Number.isSafeInteger(cb?.user?.user_id) && cb.user.user_id > 0;
        const match = /^poll:([a-f0-9-]{36}):(yes|cancel)$/.exec(cb?.payload || '');
        log(JSON.stringify({event:'training_test_callback_received', at:new Date().toISOString(),
          user_id_present:validUser, user_ref:validUser ? tag(String(cb.user.user_id)) : null,
          callback_ref:tag(cb?.callback_id), message_ref:tag(update.message?.body?.mid),
          test_chat_matches:String(update.message?.recipient?.chat_id) === '-80345864298680',
          poll_ref:match ? tag(match[1]) : null, choice:match ? match[2] : 'unknown'}));
      } catch { /* Diagnostics must not interfere with event processing. */ }
    }
    return service.receive(update);
  }};
}
async function main() {
  const c=config(process.env), api=await guardedApi(c), service=new MemoryTrainingTest(api,c);
  // The shared HTTP handler expects synchronous receipt. Handle the authenticated
  // update fully before acknowledgment; all state stays in process memory.
  const handler=createWebhook(diagnosticReceiver(service),c.secret).listeners('request')[0];
  const server=http.createServer((req,res)=> {
    if(req.method==='GET' && req.url==='/health') return res.writeHead(200).end('{"ready":true,"mode":"test-memory"}');
    void handler(req,res);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3000,'0.0.0.0',resolve);});
  const tick=()=>void service.tick().catch(()=>console.error('Training Test: scheduler error'));
  const timer=setInterval(tick,1000); tick();
  const stop=()=>{clearInterval(timer);server.close();server.closeIdleConnections?.();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  console.log('Training Test: verified test identity/chat; memory storage ready.');
}
if(require.main===module) main().catch(()=>{console.error('Training Test startup refused. Check test settings; secrets hidden.');process.exitCode=1;});
module.exports={main,diagnosticReceiver};
