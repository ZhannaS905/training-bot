'use strict';
// Daily polls follow the persisted journal, never the legacy recurring projection.
function confirmedDailyWorkouts(main, location, date, time) {
 return Object.entries(main.workouts || {}).filter(([id,w]) =>
  w && w.id===id && w.location===location && w.date===date &&
  w.time===time && w.cancelled===false
 ).map(([,w])=>w);
}
module.exports={confirmedDailyWorkouts};
