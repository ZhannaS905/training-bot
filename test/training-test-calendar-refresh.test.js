const test = require('node:test');
const assert = require('node:assert/strict');
const {Autopost} = require('../src/training-test-autopost');

test('published calendar poll updates after move and cancellation', async () => {
  const calls = [];
  const original = {
    id: 'workout-1',
    date: '2026-11-05',
    location: 'zarya',
    time: '20:00',
    cancelled: false
  };

  let workout = {...original};
  let poll = {
    key: 'test-key',
    id: 'poll-1',
    status: 'published',
    workout: {...original},
    cancelled: false,
    revision: 1,
    displayedRevision: 1
  };

  const calendar = {
    async day(date) {
      return workout.date === date && !workout.cancelled
        ? [{id:workout.id,date:workout.date,location:workout.location,time:workout.time}]
        : [];
    },
    async findById(id) {
      return id === workout.id ? {...workout} : null;
    }
  };

  const calendarPollStore = {
    async listPublished() { return [{...poll}]; },
    async syncWorkout(key, updated) {
      assert.equal(key, poll.key);
      poll = {
        ...poll,
        workout: {...updated},
        cancelled: updated.cancelled,
        revision: poll.revision + 1
      };
    },
    async read() { return {...poll}; },
    async claimEdit() {
      return {...poll, editLease: {token: 'test-token'}};
    },
    async checkEdit() { return true; },
    async finishEdit(key, token, revision) {
      assert.equal(key, poll.key);
      assert.equal(token, 'test-token');
      poll.displayedRevision = revision;
    },
    async releaseEdit() {
      throw Error('Unexpected edit failure');
    }
  };

  const api = {
    async editCalendar(p, {beforePut}) {
      await beforePut();
      calls.push(['edit', p.workout.date, p.workout.time]);
    },
    async cancelCalendar(p, {beforePut}) {
      await beforePut();
      calls.push(['cancel', p.workout.date]);
    }
  };

  const service = new Autopost({
    store: {},
    api,
    calendar,
    calendarPollStore,
    calendarMode: true,
    now: () => new Date('2026-11-05T10:00:00+03:00'),
    log: () => {}
  });

  workout = {...workout, date: '2026-11-06', time: '22:30'};
  await service.refreshCalendarPolls();

  assert.deepEqual(calls, [['edit', '2026-11-06', '22:30']]);

  workout = {...workout, cancelled: true};
  await service.refreshCalendarPolls();

  assert.deepEqual(calls, [
    ['edit', '2026-11-06', '22:30'],
    ['cancel', '2026-11-06']
  ]);
});
