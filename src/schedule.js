const times = ['18:00', '20:00', '18:30', '20:00', '18:30', null, '18:00'];
function moscow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, clock: `${parts.hour}:${parts.minute}`, day: new Date(`${date}T12:00:00Z`).getUTCDay() };
}
const scheduleText = 'Расписание (Europe/Moscow)\nПонедельник, среда — 20:00, мкр. Заря\nВторник, четверг — 18:30, Поле чудес\nСуббота, воскресенье — 18:00, Яндекс Телемост\nПятница — без тренировки\nДлительность — 60 минут';
module.exports = { times, moscow, scheduleText };
