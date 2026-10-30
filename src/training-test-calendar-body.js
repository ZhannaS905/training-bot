'use strict';
const {payload}=require('./training-test-calendar-callbacks');
const LABELS={zarya:'Заря',pole:'Поле чудес',online:'Онлайн'};
const LINK='https://telemost.yandex.ru/j/35289250295816';
const escape=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function calendarPollBody(p){
 if(!p?.workout||!LABELS[p.workout.location]||!Array.isArray(p.order)||!p.votes)throw Error('CALENDAR_POLL_BODY_REFUSED');
 const w=p.workout;
 const date=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Moscow'}).format(new Date(w.date+'T12:00:00Z'));
 const place=w.location==='online'?'<b>Яндекс Телемост</b>':'<b>'+LABELS[w.location]+'</b>';
 const details=w.location==='online'?'🎥 Платформа: '+place+'\n🔗 <a href="'+LINK+'">Ссылка для подключения</a>':'📍 Место: '+place;
 const names=p.order.map((uid,i)=>(i+1)+'. '+escape(p.votes[uid]));
 const participants=names.length?'✅ Записано ('+names.length+'):\n'+names.join('\n'):'🤨 Пока никто не записался!';
 return {text:'📅 <b>'+date+'</b>\n\n'+details+'\n⏰ Время: <b>'+escape(w.time)+' (МСК)</b>\n\n'+participants,format:'html',
  attachments:[{type:'inline_keyboard',payload:{buttons:[[
   {type:'callback',text:'✅ Приду',payload:payload(p,'yes')},
   {type:'callback',text:'↩️ Отменить',payload:payload(p,'cancel')}
  ]]}}]};
}
module.exports={calendarPollBody};
