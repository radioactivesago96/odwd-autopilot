const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/duty');
const T = require('../src/core/time');
const { createRunner } = require('../src/core/runner');

// Time in, the work and the endorsement: three entries are enough to exercise the runner.
const three = (date) => {
  const duty = D.createDuty({ date, shift: '11-7', counts: { hema: 2 } }, D.defaultSettings());
  return D.siteEntries({ ...duty, entries: duty.entries.filter((e) => e.kind !== 'received' && e.kind !== 'timeout') });
};
const items = () => three('2026-11-26');
const HEADER = ['Start Time', 'End Time', 'Time Spent', 'Task Description'];
const asRow = (e) => [T.time12(T.parseClock(e.start)), T.time12(T.parseClock(e.end)), 'x', e.description];

// An in-memory stand-in for the diary page.
function fakeDriver(options = {}) {
  const driver = {
    rows: {}, count: { fill: 0, clickSave: 0 }, form: null, onFill: null, ...options,
    async fresh() { driver.freshCalls = (driver.freshCalls || 0) + 1; },
    async savePressed() { return !!driver.pressed; },
    async probe() {
      if (driver.loggedOut) return { ok: false, missing: [], loggedOut: true };
      return { ok: !driver.missing, missing: driver.missing || [], loggedOut: false };
    },
    async readLogs(dates) { return Object.fromEntries(dates.map((d) => [d, driver.rows[d] ? [HEADER, ...driver.rows[d]] : []])); },
    async fill(entry) { driver.count.fill++; driver.form = entry; return driver.onFill ? driver.onFill(entry) : true; },
    abortFill() {},
    async matches() { return !driver.mismatch; },
    async clickSave() { driver.count.clickSave++; },
    async waitSaved(timeout) {
      driver.lastTimeout = timeout;
      if (driver.alertOnSave) return { result: 'alert', message: 'Error saving task: nope' };
      if (driver.silentFail) return { result: 'timeout' };
      const listed = driver.listByDuty ? driver.form.dutyDate : driver.form.date;
      (driver.rows[listed] = driver.rows[listed] || []).push(asRow(driver.form));
      return { result: driver.reloadOnSave ? 'gone' : 'cleared' };
    },
    cancelWait() {}
  };
  return driver;
}

const runner = (driver, list = items(), now = () => new Date(2027, 0, 1), extra = {}) =>
  createRunner({ driver, items: list, now, msPerChar: 0, gapMs: 0, sleep: async () => {}, onEvent: () => {}, ...extra });

test('saves all, then a rerun saves nothing', async () => {
  const driver = fakeDriver();
  const list = items();
  const first = await runner(driver, list).autopilot();
  assert.equal(first.state, 'done');
  assert.equal(first.saved.length, 3);
  assert.deepEqual(first.missing, []);
  assert.equal(driver.lastTimeout, 20000);
  const second = await runner(driver, list, undefined, { listing: 'calendar' }).autopilot();
  assert.deepEqual(second.saved, []);
  assert.deepEqual(second.skipped.map((s) => s.reason), ['logged', 'logged', 'logged']);
  assert.equal(driver.count.clickSave, 3);
});

test('possible duplicate skipped unless allowed', async () => {
  const list = items();
  const driver = fakeDriver();
  driver.rows['2026-11-27'] = [['06:50 AM', '07:10 AM', 'x', 'older']];
  const result = await runner(driver, list).autopilot();
  assert.deepEqual(result.skipped, [{ key: list[2].key, reason: 'possible' }]);
  assert.equal(result.saved.length, 2);
  assert.deepEqual(result.missing, []);
  const allowed = await runner(driver, [{ ...list[2], allowPossible: true }]).autopilot();
  assert.equal(allowed.saved.length, 1);
});

test('site error stops, nothing else is sent', async () => {
  const driver = fakeDriver({ alertOnSave: true });
  const result = await runner(driver).autopilot();
  assert.equal(result.state, 'stopped');
  assert.match(result.message, /The site says: "Error saving task: nope"/);
  assert.equal(driver.count.clickSave, 1);
  assert.equal(result.missing.length, 3);
});

test('reload after save that did save counts as saved', async () => {
  const result = await runner(fakeDriver({ reloadOnSave: true })).autopilot();
  assert.equal(result.state, 'done');
  assert.equal(result.saved.length, 3);
});

test('no confirmation stops without resending', async () => {
  const driver = fakeDriver({ silentFail: true });
  const result = await runner(driver).autopilot();
  assert.equal(result.state, 'stopped');
  assert.match(result.message, /did not confirm saving/);
  assert.equal(driver.count.clickSave, 1);
});

test('logged out stops before typing', async () => {
  const driver = fakeDriver({ loggedOut: true });
  const result = await runner(driver).autopilot();
  assert.match(result.message, /logged out/);
  assert.equal(driver.count.fill, 0);
});

test('logged out while reading the logs stops before typing', async () => {
  const driver = fakeDriver();
  driver.readLogs = async () => { throw new Error('logged out'); };
  const result = await runner(driver).autopilot();
  assert.equal(result.state, 'stopped');
  assert.match(result.message, /logged out/);
  assert.equal(driver.count.fill, 0);
});

test('missing field stops and names it', async () => {
  const result = await runner(fakeDriver({ missing: ['Task Description'] })).autopilot();
  assert.match(result.message, /Task Description/);
});

test('form mismatch stops before Save', async () => {
  const driver = fakeDriver({ mismatch: true });
  const result = await runner(driver).autopilot();
  assert.equal(result.state, 'stopped');
  assert.equal(driver.count.clickSave, 0);
});

test('future entry is never sent', async () => {
  const driver = fakeDriver();
  const result = await runner(driver, items(), () => new Date(2026, 10, 26, 22, 40)).autopilot();
  assert.match(result.message, /has not ended yet/);
  assert.equal(driver.count.fill, 0);
});

test('pause during typing then resume saves once', async () => {
  const driver = fakeDriver();
  let run;
  driver.onFill = () => {
    if (driver.count.fill !== 1) return true;
    run.pause();
    setTimeout(() => run.resume(), 5);
    return false;
  };
  run = runner(driver);
  const result = await run.autopilot();
  assert.equal(result.state, 'done');
  assert.equal(driver.count.clickSave, 3);
  assert.equal(driver.count.fill, 4);
});

test('pause and resume before typing returns still saves once', async () => {
  const driver = fakeDriver();
  let run;
  driver.onFill = () => {
    if (driver.count.fill !== 1) return true;
    run.pause();
    run.resume();
    return false;
  };
  run = runner(driver);
  assert.equal((await run.autopilot()).state, 'done');
  assert.equal(driver.count.clickSave, 3);
});

test('stop during typing sends nothing more', async () => {
  const driver = fakeDriver();
  let run;
  driver.onFill = () => { run.stop(); return false; };
  run = runner(driver);
  const result = await run.autopilot();
  assert.equal(result.state, 'stopped');
  assert.equal(driver.count.clickSave, 0);
  assert.equal(driver.count.fill, 1);
});

test('stop while paused ends the run', async () => {
  const driver = fakeDriver();
  let run;
  driver.onFill = () => { run.pause(); setTimeout(() => run.stop(), 5); return false; };
  run = runner(driver);
  const result = await run.autopilot();
  assert.equal(result.state, 'stopped');
  assert.equal(driver.count.clickSave, 0);
});

test('stop after Save was clicked still records what was saved', async () => {
  const driver = fakeDriver();
  let run;
  const wait = driver.waitSaved;
  driver.waitSaved = async (t) => { await wait(t); run.stop(); return { result: 'aborted' }; };
  run = runner(driver);
  const result = await run.autopilot();
  assert.equal(result.state, 'stopped');
  assert.equal(result.saved.length, 1);
  assert.equal(driver.count.clickSave, 1);
});

test('fill one never clicks Save', async () => {
  const driver = fakeDriver();
  const list = items();
  driver.rows[list[0].date] = [asRow(list[0])];
  const result = await runner(driver, list).fillNext();
  assert.equal(result.state, 'done');
  assert.deepEqual(result.saved, [list[1].key]);
  assert.equal(driver.count.clickSave, 0);
  assert.equal(driver.count.fill, 1);
  assert.equal(driver.lastTimeout, 0);
});

const held = () => {
  const marks = new Map();
  return { marks, onHold: (item, value) => marks.set(item.key, value) };
};
const night = three;

test('each run starts on a fresh form', async () => {
  const driver = fakeDriver();
  await runner(driver).autopilot();
  assert.equal(driver.freshCalls, 1);
});

test('back-to-back night duties: nothing is mistaken for the night before', async () => {
  const learned = [];
  const driver = fakeDriver();
  const result = await runner(driver, [...night('2026-11-26'), ...night('2026-11-27')], undefined,
    { onListing: (value) => learned.push(value) }).autopilot();
  assert.equal(result.saved.length, 6, result.message);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(learned, ['calendar']);
});

test('a site that lists night entries under the duty date is learned and confirmed', async () => {
  const learned = [];
  const result = await runner(fakeDriver({ listByDuty: true }), [...night('2026-11-26'), ...night('2026-11-27')], undefined,
    { onListing: (value) => learned.push(value) }).autopilot();
  assert.equal(result.saved.length, 6, result.message);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(learned, ['duty']);
});

test('Save pressed by hand while typing stops the run without pressing it again', async () => {
  const driver = fakeDriver();
  const marks = held();
  driver.onFill = () => 'user-saved';
  const list = items();
  const result = await runner(driver, list, undefined, marks).autopilot();
  assert.match(result.message, /pressed Save/);
  assert.equal(driver.count.clickSave, 0);
  assert.equal(marks.marks.get(list[0].key), true);
});

test('Save pressed by hand while paused stops instead of typing again', async () => {
  const driver = fakeDriver();
  let run;
  driver.onFill = () => {
    if (driver.count.fill !== 1) return true;
    run.pause();
    setTimeout(() => { driver.pressed = true; run.resume(); }, 5);
    return false;
  };
  run = runner(driver);
  const result = await run.autopilot();
  assert.match(result.message, /pressed Save/);
  assert.equal(driver.count.fill, 1);
  assert.equal(driver.count.clickSave, 0);
});

test('an unconfirmed save is remembered and not sent again by itself', async () => {
  const list = items();
  const marks = held();
  const driver = fakeDriver({ silentFail: true });
  await runner(driver, list, undefined, marks).autopilot();
  assert.equal(marks.marks.get(list[0].key), true);

  driver.silentFail = false;
  const again = await runner(driver, [{ ...list[0], unconfirmed: true }], undefined, marks).autopilot();
  assert.deepEqual(again.skipped, [{ key: list[0].key, reason: 'unconfirmed' }]);
  assert.equal(driver.count.clickSave, 1);
  assert.deepEqual(again.missing, [list[0].key]);

  const allowed = await runner(driver, [{ ...list[0], unconfirmed: true, allowPossible: true }], undefined, marks).autopilot();
  assert.equal(allowed.saved.length, 1);
  assert.equal(marks.marks.get(list[0].key), false);
});

test('the mark is removed once the logs show the entry', async () => {
  const list = items();
  const marks = held();
  const driver = fakeDriver();
  driver.rows[list[0].date] = [asRow(list[0])];
  await runner(driver, [{ ...list[0], unconfirmed: true }], undefined, marks).autopilot();
  assert.equal(marks.marks.get(list[0].key), false);
});

test('a site error or a stop before the user pressed Save leaves no mark', async () => {
  const list = items();
  const marks = held();
  await runner(fakeDriver({ alertOnSave: true }), list, undefined, marks).autopilot();
  assert.equal(marks.marks.get(list[0].key), false);

  const driver = fakeDriver();
  let run;
  driver.waitSaved = async () => { run.stop(); return { result: 'aborted', pressed: false }; };
  run = runner(driver, list, undefined, marks);
  await run.fillNext();
  assert.equal(marks.marks.get(list[0].key), false);
});
