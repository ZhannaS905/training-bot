'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bookingId,
  bookingRecord
} = require('../src/fitpp-calendar-booking');

const workout = {
  id: 'workout-123',
  date: '2026-11-02',
  location: 'zarya',
  time: '20:00'
};

test('creates booking for the exact workout and client', () => {
  const record = bookingRecord(workout, 'demo-client-1', true, '80', 1);

  assert.equal(record.workoutId, 'workout-123');
  assert.equal(record.clientId, 'demo-client-1');
  assert.equal(record.booked, true);
  assert.equal(record.source, 'max-training-test');
});

test('cancelling changes booking status to false', () => {
  const record = bookingRecord(workout, 'demo-client-1', false, '80', 2);

  assert.equal(record.booked, false);
});

test('two workouts on the same day have different booking IDs', () => {
  const first = bookingId('workout-123', 'demo-client-1');
  const second = bookingId('workout-456', 'demo-client-1');

  assert.notEqual(first, second);
});

test('repeated booking uses the same ID', () => {
  const first = bookingId('workout-123', 'demo-client-1');
  const second = bookingId('workout-123', 'demo-client-1');

  assert.equal(first, second);
});

test('invalid client IDs are refused', () => {
  assert.throws(
    () => bookingId('workout-123', 'invalid client!'),
    /REFUSED/
  );
});

test('booking records identify the MAX voter and poll revision', () => {
  const record = bookingRecord(
    workout,
    'demo-client-1',
    true,
    '80',
    2
  );

  assert.equal(record.maxUserId, '80');
  assert.equal(record.pollRevision, 2);
  assert.equal(record.workoutId, workout.id);
  assert.equal(record.booked, true);
});

test('booking without MAX user ID is refused', () => {
  assert.throws(
    () => bookingRecord(workout, 'demo-client-1', true, undefined, 1),
    /CALENDAR_BOOKING_REFUSED/
  );
});

test('booking without poll revision is refused', () => {
  assert.throws(
    () => bookingRecord(workout, 'demo-client-1', true, '80', undefined),
    /CALENDAR_BOOKING_REFUSED/
  );
});
