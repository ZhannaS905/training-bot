const http = require('node:http');
const { createWebhook } = require('./src/memory-test-webhook');
const { config, guardedApi, MemoryTrainingTest } = require('./src/memory-training-test');
async function main() {
  const c=config(process.env), api=await guardedApi(c), service=new MemoryTrainingTest(api,c);
  // The shared HTTP handler expects synchronous receipt. Handle the authenticated
  // callback fully before acknowledgment, with serialized, memory-only updates.
  const handler=createWebhook(service,c.secret).listeners('request')[0];
  const server=http.createServer((req,res)=> {
    if(req.method==='GET' && req.url==='/health') return res.writeHead(200).end('{"ready":true,"mode":"test-memory"}');
    void handler(req,res);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3000,'0.0.0.0',resolve);});
  const tick=()=>void service.tick().catch(()=>console.error('Training Test: scheduler error'));
  const timer=setInterval(tick,15000); tick();
  const stop=()=>{clearInterval(timer);server.close();server.closeIdleConnections?.();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  console.log('Training Test: verified test identity/chat; memory storage ready.');
}
if(require.main===module) main().catch(()=>{console.error('Training Test startup refused. Check test settings; secrets hidden.');process.exitCode=1;});
module.exports={main};
