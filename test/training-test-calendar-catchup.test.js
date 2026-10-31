const test = require('node:test');
const assert = require('node:assert/strict');
const {Autopost} = require('../src/training-test-autopost');
const {workoutKey} = require('../src/fitpp-calendar-poll-plan');

test('calendar autopost catches up at 10:05, avoids duplicates and stops after workout start', async () => {
  const workout = {
    id: 'regular-online',
    date: '2026-10-31',
    time: '18:00',
    location: 'online',
    cancelled: false
  };

  const records = new Map();
  const sent = [];

  let currentTime = '2026-10-31T10:05:00+03:00';

  const calendar = {
    async day() { return [workout]; },
    async findById(id) { return id === workout.id ? workout : null; }
  };

  const calendarPollStore = {
    async reserve(w, candidate) {
      const key = workoutKey(w);
      if (records.has(key)) return false;
      records.set(key, {
        ...candidate,
        key,
        workout: w,
        order: [],
        votes: {},
        status: 'reserved'
      });
      return true;
    },
    async read(key) { return records.get(key) || null; },
    async finish(key, id, messageId) {
      const record = records.get(key);
      assert.equal(record.id, id);
      records.set(key, {...record, status: 'published', messageId});
    },
    async uncertain() {
      throw Error('Unexpected uncertain publication');
    },
    async listPublished() { return []; }
  };

  const api = {
    async verify() {},
    async sendCalendar() {
      sent.push(currentTime);
      return 'message-' + sent.length;
    }
  };

  function service() {
    return new Autopost({
      store: {},
      api,
      calendar,
      calendarPollStore,
      calendarMode: true,
      now: () => new Date(currentTime),
      log: () => {}
    });
  }

  const first = service();
  await first.tick();
  assert.equal(sent.length, 1, '10:05 must publish the missed poll');

  await first.tick();
  assert.equal(sent.length, 1, 'repeated tick must not duplicate');

  const restarted = service();
  await restarted.tick();
  assert.equal(sent.length, 1, 'restart must not duplicate');

  currentTime = '2026-10-31T18:01:00+03:00';
  const afterStart = service();
  await afterStart.tick();
  assert.equal(sent.length, 1, 'after workout start must not publish');

  console.log('ОК: 10:05, повторная проверка, перезапуск и окончание окна');
});
