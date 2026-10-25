'use strict';
const {createHmac,timingSafeEqual}=require('node:crypto');
const signature=(key,time,path,body)=>createHmac('sha256',key).update(`${time}\nPOST\n${path}\n${body}`).digest('hex');
function verify(key,time,path,body,supplied,now=Date.now()){
if(typeof key!=='string'||key.length<32||!/^\d{13}$/.test(time||'')||Math.abs(now-Number(time))>60000||typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied))throw Error('INGRESS_AUTH');const expected=signature(key,time,path,body);if(!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))throw Error('INGRESS_AUTH');}
module.exports={signature,verify};
