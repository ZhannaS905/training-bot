'use strict';

const {createHash} = require('node:crypto');
const {workoutKey} = require('./fitpp-calendar-poll-plan');

function bookingId(workoutId, clientId) {
  if (typeof workoutId !== 'string' || !workoutId.trim() ||
      typeof clientId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(clientId)) {
    throw Error('CALENDAR_BOOKING_ID_REFUSED');
  }

  const key = createHash('sha256')
    .update(JSON.stringify(['training-test-workout-v1', workoutId]))
    .digest('hex');

  return key + '_' + clientId;
}

function bookingRecord(workout, clientId, booked, maxUserId, pollRevision) {
  if (!workout || typeof workout.id !== 'string' ||
      typeof workout.date !== 'string' ||
      typeof workout.location !== 'string' ||
      typeof booked !== 'boolean' ||
      typeof maxUserId !== 'string' ||
      !/^[1-9]\d*$/.test(maxUserId) ||
      !Number.isSafeInteger(pollRevision) ||
      pollRevision < 1) {
    throw Error('CALENDAR_BOOKING_REFUSED');
  }

  return {
    version: 1,
    workoutId: workout.id,
    workoutKey: workoutKey(workout),
    clientId,
    date: workout.date,
    location: workout.location,
    booked,
    maxUserId,
    pollRevision,
    source: 'max-training-test'
  };
}

module.exports = {bookingId, bookingRecord};
