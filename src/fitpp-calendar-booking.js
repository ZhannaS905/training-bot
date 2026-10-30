'use strict';

const {createHash} = require('node:crypto');

function bookingId(workoutId, clientId) {
  if (typeof workoutId !== 'string' || !workoutId.trim() ||
      typeof clientId !== 'string' || !/^demo-client-[a-zA-Z0-9_-]+$/.test(clientId)) {
    throw Error('CALENDAR_BOOKING_ID_REFUSED');
  }

  return createHash('sha256')
    .update(JSON.stringify(['fitpp-calendar-booking-v1', workoutId, clientId]))
    .digest('hex');
}

function bookingRecord(workout, clientId, booked) {
  if (!workout || typeof workout.id !== 'string' ||
      typeof workout.date !== 'string' ||
      typeof workout.location !== 'string' ||
      typeof booked !== 'boolean') {
    throw Error('CALENDAR_BOOKING_REFUSED');
  }

  return {
    version: 1,
    workoutId: workout.id,
    clientId,
    date: workout.date,
    location: workout.location,
    booked,
    source: 'max-training-test'
  };
}

module.exports = {bookingId, bookingRecord};
