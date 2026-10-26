'use strict';
// Linux abstract socket: kernel releases ownership on exit, no stale files or journal edits.
async function acquire(role='watcher') {
 if(!['watcher','supervisor'].includes(role))throw Error('LOCK_SCOPE_REFUSED');
 if(process.platform!=='linux')throw Error('WATCHER_LOCK_REQUIRES_LINUX');
 const server=require('node:net').createServer(socket=>socket.destroy());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen('\0fitpp-test-synthetic-v1-training-test-'+role,resolve)});
 return server;
}
module.exports={acquire};
