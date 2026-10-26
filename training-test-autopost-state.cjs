'use strict';
// Offline provisioning/inspection only: imports do not connect to MAX or Firebase.
const {initialize}=require('./src/training-test-autopost');
const fs=require('node:fs'),path=require('node:path');
function main(args=process.argv.slice(2)){
 const [action,dir,date]=args;
 if(action==='init'&&args.length===3){initialize(dir,date);console.log('Autopost ledger initialized; no network requests.');return}
 if(action==='status'&&args.length===2&&path.isAbsolute(dir)){
  const s=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));
  // No participant names, user IDs, credentials or full state in output.
  console.log(JSON.stringify({startDate:s.autopost?.startDate,polls:Object.values(s.polls||{}).map(p=>({date:p.date,status:p.status,mid:p.mid||null}))},null,2));return;
 }
 throw Error('Usage: training-test-autopost-state.cjs init ABSOLUTE_NEW_DIRECTORY YYYY-MM-DD | status ABSOLUTE_DIRECTORY');
}
if(require.main===module)try{main()}catch{console.error('AUTOPOST_STATE_COMMAND_REFUSED');process.exitCode=1}
module.exports={main};
