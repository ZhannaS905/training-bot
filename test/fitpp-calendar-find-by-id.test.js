'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createGroupCalendar} = require('../src/fitpp-calendar-reader');

function fixture(workout) {
  const schedule = {
    schemaVersion: 1,
    projectId: 'fitpp-test',
    workouts: [],
    links: [{
      workoutId: 'training-1',
      source: 'trainers',
      periodId: 'period-1'
    }]
  };

  const store = {
    async read() {
      return schedule;
    },
    async readTrainerWorkouts() {
      return {'training-1': workout};
    }
  };

  return createGroupCalendar({store});
}

test('findById finds a workout moved to another date', async () => {
  const calendar = fixture({
    id: 'training-1',
    date: '2026-11-04',
    time: '19:30',
    location: 'zarya',
    cancelled: false
  });

  assert.deepEqual(await calendar.findById('training-1'), {
    id: 'training-1',
    date: '2026-11-04',
    time: '19:30',
    location: 'zarya',
    cancelled: false
  });
});

test('findById detects a cancelled workout', async () => {
  const calendar = fixture({
    id: 'training-1',
    date: '2026-11-02',
    time: '20:00',
    location: 'zarya',
    cancelled: true
  });

  const workout = await calendar.findById('training-1');

  assert.equal(workout.cancelled, true);
});

test('findById does not treat an unknown ID as cancellation', async () => {
  const calendar = fixture({
    id: 'training-1',
    date: '2026-11-02',
    time: '20:00',
    location: 'zarya',
    cancelled: false
  });

  assert.equal(await calendar.findById('unknown-id'), null);
});
