const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../src/core/time');
const { resolveDataDir, createStore } = require('../src/main/store');
const { isAllowed } = require('../src/main/guard');
const { createController } = require('../src/main/controller');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'odwd-test-'));

test('data goes beside the exe when that folder can be written', () => {
  const r = resolveDataDir({ portableDir: 'E:\\usb', appData: 'C:\\app', canWrite: () => true });
  assert.equal(r.dir, path.join('E:\\usb', 'ODWD-Autopilot-data'));
  assert.equal(r.warning, '');
});

test('a read-only folder falls back and says where', () => {
  const r = resolveDataDir({ portableDir: 'E:\\usb', appData: 'C:\\app', canWrite: () => false });
  assert.equal(r.dir, path.join('C:\\app', 'ODWD-Autopilot'));
  assert.ok(r.warning.includes(r.dir));
  assert.equal(resolveDataDir({ appData: 'C:\\app', canWrite: () => true }).warning, '');
});

test('a broken data file is kept and defaults are used', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'data.json'), '{broken');
  const loaded = createStore(dir).load();
  assert.deepEqual(loaded.duties, []);
  assert.equal(loaded.settings.minutesEarly, 30);
  assert.match(loaded.warning, /could not be read/);
  const kept = fs.readdirSync(dir).find((f) => /^data\.corrupt-.*\.json$/.test(f));
  assert.equal(fs.readFileSync(path.join(dir, kept), 'utf8'), '{broken');
});

test('save and load keep the text, and old settings get new defaults', () => {
  const dir = path.join(temp(), 'new');
  const store = createStore(dir);
  assert.equal(store.load().warning, '');
  store.save({ settings: { format: 2, minutesEarly: 20, wording: { prep: 'Hi' } }, duties: [{ id: 'a', from: 'Ms. Peña', entries: [] }] });
  const loaded = createStore(dir).load();
  assert.equal(loaded.duties[0].from, 'Ms. Peña');
  assert.equal(loaded.settings.minutesEarly, 20);
  assert.equal(loaded.settings.endAfter, 15);
  assert.equal(loaded.settings.wording.prep, 'Hi');
  assert.match(loaded.settings.wording.endorse, /Endorsed/);
  assert.deepEqual(fs.readdirSync(dir), ['data.json']);
});

test('only the diary site and its style and script hosts are allowed', () => {
  const ok = (url, resourceType) => isAllowed({ url, resourceType });
  assert.equal(ok('http://www.misocc-hrmis.net/odwd/index.php', 'mainFrame'), true);
  assert.equal(ok('https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css', 'stylesheet'), true);
  assert.equal(ok('https://example.com/', 'mainFrame'), false);
  assert.equal(ok('http://misocc-hrmis.net.evil.com/', 'mainFrame'), false);
  assert.equal(ok('https://cdn.jsdelivr.net/x', 'xhr'), false);
  assert.equal(ok('https://cdn.jsdelivr.net/x', 'mainFrame'), false);
  assert.equal(ok('file:///C:/secret.txt', 'mainFrame'), false);
  assert.equal(ok('not a url', 'script'), false);
  assert.equal(isAllowed({ url: 'http://127.0.0.1:5000/odwd/', resourceType: 'mainFrame' }, '127.0.0.1'), true);
});

function setup(now = () => new Date(2027, 5, 1)) {
  const calls = [];
  const rows = {};
  let form;
  let release = null;
  const driver = {
    hold: false,
    async fresh() {},
    async savePressed() { return false; },
    async peek() { calls.push('peek'); return { ok: true, missing: [], loggedOut: false }; },
    async probe() { calls.push('probe'); return { ok: true, missing: [], loggedOut: false }; },
    async readLogs(dates) { calls.push('readLogs'); return Object.fromEntries(dates.map((d) => [d, rows[d] ? [['Start Time', 'End Time', 'Time Spent', 'Task Description'], ...rows[d]] : []])); },
    async fill(entry) { calls.push('fill'); form = entry; if (driver.hold) await new Promise((r) => { release = r; }); return true; },
    abortFill() { if (release) release(); },
    async matches() { return true; },
    async clickSave() { calls.push('clickSave'); },
    async waitSaved() {
      if (driver.silentFail) return { result: 'timeout' };
      (rows[form.date] = rows[form.date] || []).push([T.time12(T.parseClock(form.start)), T.time12(T.parseClock(form.end)), 'x', form.description]);
      return { result: 'cleared' };
    },
    cancelWait() {}
  };
  const dir = temp();
  const controller = createController({ store: createStore(dir), driver, now, emit: () => {}, sleep: async () => {} });
  return { controller, driver, calls, rows, dir };
}

const csv = 'Date,Shift,Hematology\n2026-11-01,11 PM – 7 AM,2\n2026-11-02,Day Off,\n';
const add = (c, date = '2026-11-01') => c.dispatch({ type: 'addDuty', input: { date, shift: '11-7', counts: { hema: 2 } } });

test('importing never touches the site and is saved', async () => {
  const { controller, calls, dir } = setup();
  const state = await controller.dispatch({ type: 'import', name: 'a.csv', text: csv });
  assert.equal(state.duties.length, 1);
  assert.equal(state.skipped.length, 1);
  assert.deepEqual(calls, []);
  assert.equal(createStore(dir).load().duties.length, 1);
});

test('a file that cannot be read gives a message', async () => {
  const { controller } = setup();
  const state = await controller.dispatch({ type: 'import', name: 'a.json', text: '{x' });
  assert.match(state.warning, /not a CDH Accomplishment Report backup/);
});

test('importing the same duty again replaces it, unless it is saved', async () => {
  const { controller } = setup();
  await add(controller);
  let state = await add(controller);
  assert.equal(state.duties.length, 1);
  await controller.dispatch({ type: 'autopilot' });
  await controller.idle();
  const id = controller.state().duties[0].id;
  state = await add(controller);
  assert.equal(state.duties[0].id, id);
  assert.match(state.skipped[0].reason, /saved on the site/);
});

test('autopilot saves the selected duties and marks them', async () => {
  const { controller, calls } = setup();
  await add(controller, '2026-11-03');
  await add(controller, '2026-11-01');
  const other = (await add(controller, '2026-11-05')).duties.find((d) => d.date === '2026-11-05');
  await controller.dispatch({ type: 'select', id: other.id, value: false });
  await controller.dispatch({ type: 'autopilot' });
  await controller.idle();
  const state = controller.state();
  assert.equal(calls.filter((c) => c === 'clickSave').length, 10);
  assert.deepEqual(state.duties.map((d) => d.date), ['2026-11-01', '2026-11-03', '2026-11-05']);
  assert.deepEqual(Object.values(state.duties[0].marks), Array(5).fill('logged'));
  assert.equal(state.running, false);
  assert.match(state.run.event.message, /Saved 10/);
});

test('the Human speed is kept and used for the run', async () => {
  const { controller, driver, dir } = setup();
  const paces = [];
  const fill = driver.fill;
  driver.fill = (entry, pace) => { paces.push(pace); return fill(entry); };
  await add(controller);
  const state = await controller.dispatch({ type: 'settings', patch: { speed: 'human' } });
  assert.equal(state.settings.speed, 'human');
  assert.equal(createStore(dir).load().settings.speed, 'human');
  await controller.dispatch({ type: 'autopilot' });
  await controller.idle();
  assert.deepEqual(paces, Array(5).fill('human'));
});

test('the section chosen is used for new duties, and each section keeps its own layout', async () => {
  const { controller, dir } = setup();
  let state = controller.state();
  assert.equal(state.settings.category, 'lab');
  assert.deepEqual(state.settings.layouts, { lab: 'intervals', nurse: 'whole', attendant: 'whole' });
  state = await controller.dispatch({ type: 'settings', patch: { category: 'nurse' } });
  assert.equal(createStore(dir).load().settings.category, 'nurse');
  state = await controller.dispatch({ type: 'addDuty', input: { date: '2026-11-01', shift: '3-11', counts: { censusIn: 3 } } });
  assert.equal(state.duties[0].category, 'nurse');
  assert.equal(state.duties[0].entries.length, 1);
  state = await controller.dispatch({ type: 'settings', patch: { category: 'pharmacy' } });
  assert.equal(state.settings.category, 'nurse');
  state = await controller.dispatch({ type: 'settings', patch: { layouts: { lab: 'whole', nurse: 'sideways' } } });
  assert.deepEqual(state.settings.layouts, { lab: 'whole', nurse: 'whole', attendant: 'whole' });
  state = await controller.dispatch({ type: 'settings', patch: { category: 'attendant' } });
  assert.equal(state.settings.category, 'attendant');
  state = await controller.dispatch({ type: 'settings', patch: { category: 'nurse' } });
  state = await controller.dispatch({ type: 'import', name: 'a.csv', text: csv.replace('2026-11-01', '2026-11-04') });
  const imported = state.duties.find((d) => d.date === '2026-11-04');
  assert.deepEqual([imported.category, imported.entries.length], ['lab', 1]);
});

test('autopilot sends only the entries that were previewed', async () => {
  const { controller, calls, rows } = setup();
  const state = await add(controller);
  const shown = state.duties[0].entries.slice(0, 2).map((e) => e.id);
  await controller.dispatch({ type: 'autopilot', only: shown });
  await controller.idle();
  assert.equal(calls.filter((c) => c === 'clickSave').length, 2);
  assert.equal(Object.values(rows).flat().length, 2);
  assert.match(controller.state().run.event.message, /Saved 2/);
});

test('an empty preview sends nothing', async () => {
  const { controller, calls } = setup();
  await add(controller);
  const state = await controller.dispatch({ type: 'autopilot', only: [] });
  assert.ok(!calls.includes('fill'));
  assert.match(state.warning, /Nothing to send/);
});

test('changing the layout of a duty says when typed text was replaced', async () => {
  const { controller } = setup();
  let state = await add(controller);
  const duty = state.duties[0];
  await controller.dispatch({ type: 'setText', dutyId: duty.id, entryId: duty.entries[0].id, text: 'My words.' });
  state = await controller.dispatch({ type: 'updateActivities', dutyId: duty.id, patch: { counts: { hema: 7 } }, layout: 'whole' });
  assert.equal(state.duties[0].entries.length, 1);
  assert.match(state.duties[0].entries[0].description, /7 patients/);
  assert.match(state.warning, /typed.*replaced/);
  state = await controller.dispatch({ type: 'updateActivities', dutyId: duty.id, patch: { counts: { hema: 8 } }, layout: 'whole' });
  assert.equal(state.warning, '');
});

test('check marks entries without typing', async () => {
  const { controller, calls, rows } = setup();
  await add(controller);
  rows['2026-11-01'] = [['10:30 PM', '10:50 PM', 'x', 'anything']];
  const state = await controller.dispatch({ type: 'check' });
  assert.deepEqual(Object.values(state.duties[0].marks), ['logged', 'new', 'new', 'new', 'new']);
  assert.equal(state.checkOk, true);
  assert.ok(!calls.includes('fill'));
});

test('a check that fails says why', async () => {
  const { controller, driver } = setup();
  driver.probe = async () => ({ ok: false, missing: [], loggedOut: true });
  const state = await controller.dispatch({ type: 'check' });
  assert.equal(state.checkOk, false);
  assert.match(state.warning, /logged out/);
});

test('edits and imports are refused during a run', async () => {
  const { controller, driver } = setup();
  const duty = (await add(controller)).duties[0];
  driver.hold = true;
  await controller.dispatch({ type: 'autopilot' });
  await new Promise((r) => setImmediate(r));
  const during = await controller.dispatch({ type: 'setText', dutyId: duty.id, entryId: duty.entries[0].id, text: 'changed' });
  assert.equal(during.running, true);
  assert.notEqual(during.duties[0].entries[0].description, 'changed');
  assert.equal((await controller.dispatch({ type: 'deleteDuty', id: duty.id })).duties.length, 1);
  driver.hold = false;
  await controller.dispatch({ type: 'stop' });
  await controller.idle();
  assert.equal(controller.state().running, false);
});

test('a duty with a problem blocks the run', async () => {
  const { controller, calls } = setup();
  const duty = (await add(controller)).duties[0];
  await controller.dispatch({ type: 'setText', dutyId: duty.id, entryId: duty.entries[0].id, text: '' });
  const state = await controller.dispatch({ type: 'autopilot' });
  await controller.idle();
  assert.match(state.warning, /no description/);
  assert.deepEqual(calls, []);
});

test('entries that have not ended are left out and listed', async () => {
  const { controller, calls } = setup(() => new Date(2026, 10, 1, 23, 30));
  await add(controller);
  await controller.dispatch({ type: 'autopilot' });
  await controller.idle();
  assert.equal(calls.filter((c) => c === 'clickSave').length, 2);
  assert.match(controller.state().run.event.message, /3 not ended yet/);
});

test('editing actions change the duty', async () => {
  const { controller } = setup();
  let duty = (await add(controller)).duties[0];
  let state = await controller.dispatch({ type: 'setTimes', dutyId: duty.id, entryId: duty.entries[4].id, start: '07:00', end: '07:20' });
  assert.equal(state.duties[0].entries[4].endClock, '07:20');
  assert.equal(state.duties[0].entries[4].date, '2026-11-02');
  state = await controller.dispatch({ type: 'splitWork', dutyId: duty.id, entryId: duty.entries[2].id, at: '00:00' });
  duty = state.duties[0];
  assert.deepEqual(duty.entries.slice(2, 4).map((e) => [e.startClock, e.endClock]), [['23:00', '00:00'], ['00:00', '06:50']]);
  assert.equal(duty.problems.some((p) => p.code === 'empty'), true);
  state = await controller.dispatch({ type: 'moveLine', dutyId: duty.id, lineKey: 'hema', entryId: duty.entries[3].id });
  assert.deepEqual(state.duties[0].problems.map((p) => p.entryId), [duty.entries[2].id], 'the entry left without lines is reported');
  state = await controller.dispatch({ type: 'setText', dutyId: duty.id, entryId: duty.entries[2].id, text: 'Waiting for requests.' });
  assert.deepEqual(state.duties[0].problems, []);
  state = await controller.dispatch({ type: 'resetTimes', dutyId: duty.id });
  assert.equal(state.duties[0].entries.length, 5);
  state = await controller.dispatch({ type: 'splitWork', dutyId: duty.id, entryId: state.duties[0].entries[2].id });
  assert.equal(state.duties[0].entries.length, 6);
});

test('write, rewrite and split a count', async () => {
  const { controller } = setup();
  let duty = (await add(controller)).duties[0];
  assert.deepEqual(duty.entries.map((e) => e.rewritable), [true, false, true, false, false]);
  const work = duty.entries[2];
  let state = await controller.dispatch({ type: 'rewriteEntry', dutyId: duty.id, entryId: work.id });
  assert.equal(state.duties[0].entries[2].description, 'Performed Hematology tests for 2 patients.');
  await controller.dispatch({ type: 'setText', dutyId: duty.id, entryId: duty.entries[0].id, text: 'Mine.' });
  state = await controller.dispatch({ type: 'writeEntries', dutyId: duty.id });
  assert.equal(state.duties[0].entries[0].description, 'Mine.');
  assert.match(state.warning, /Kept 1 entry you wrote by hand/);
  assert.equal(state.duties[0].entries[2].description, 'Processed Hematology requests for 2 patients.');

  duty = (await controller.dispatch({ type: 'splitWork', dutyId: duty.id, entryId: work.id })).duties[0];
  const other = duty.entries[3];
  state = await controller.dispatch({ type: 'splitCount', dutyId: duty.id, entryId: work.id, lineKey: 'hema', amount: 5, toEntryId: other.id });
  assert.match(state.warning, /from 1 to 1/);
  state = await controller.dispatch({ type: 'splitCount', dutyId: duty.id, entryId: work.id, lineKey: 'hema', amount: 1, toEntryId: other.id });
  assert.equal(state.warning, '');
  assert.deepEqual(state.duties[0].activities.splits, { hema: [1, 1] });
});

test('settings are limited to sensible values', async () => {
  const { controller } = setup();
  const state = await controller.dispatch({ type: 'settings', patch: { minutesEarly: -5, receiveLead: 0, endorseLead: 0, endAfter: 0, speed: 'warp', wording: { prep: 'Ready.' } } });
  assert.equal(state.settings.minutesEarly, 5);
  assert.equal(state.settings.receiveLead, 1);
  assert.equal(state.settings.endorseLead, 1);
  assert.equal(state.settings.endAfter, 5);
  assert.equal(state.settings.speed, 'fast');
  assert.equal(state.settings.wording.prep, 'Ready.');
  assert.match(state.settings.wording.endorse, /Endorsed/);
});

test('a data file that cannot be read is never overwritten', () => {
  const dir = temp();
  fs.mkdirSync(path.join(dir, 'data.json')); // reading it fails
  const store = createStore(dir);
  assert.match(store.load().warning, /Saving is off/);
  assert.throws(() => store.save({ settings: {}, duties: [] }), /Saving is off/);
  assert.ok(fs.statSync(path.join(dir, 'data.json')).isDirectory());
});

test('a broken file that cannot be moved aside is left alone', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'data.json'), '{broken');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('locked'); };
  let store;
  try {
    store = createStore(dir);
    assert.match(store.load().warning, /Saving is off/);
  } finally {
    fs.renameSync = rename;
  }
  assert.throws(() => store.save({ settings: {}, duties: [] }), /Saving is off/);
  assert.equal(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'), '{broken');
});

test('an unconfirmed save is stored, shown, and protects the duty from re-import', async () => {
  const { controller, driver, dir } = setup();
  await add(controller);
  driver.silentFail = true;
  await controller.dispatch({ type: 'autopilot' });
  await controller.idle();
  const duty = controller.state().duties[0];
  assert.equal(duty.marks[duty.entries[0].id], 'unconfirmed');
  assert.equal(createStore(dir).load().duties[0].entries[0].unconfirmed, true);
  assert.match(controller.state().run.event.message, /Not found in the logs: .*Nov 1 10:30 PM/);
  const state = await add(controller);
  assert.equal(state.duties[0].id, duty.id);
});

test('wording and the old early start from an older version are replaced', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ settings: { minutesEarly: 15, endAfter: 20, templates: { prep: 'Mine {name}' } }, duties: [] }));
  const { settings } = createStore(dir).load();
  assert.equal(settings.templates, undefined);
  assert.equal(settings.minutesEarly, 30);
  assert.equal(settings.endAfter, 20);
  assert.equal(settings.format, 2);
  assert.match(settings.wording.prep, /Timed in/);
});

test('an early start the user chose is kept', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ settings: { minutesEarly: 40 }, duties: [] }));
  assert.equal(createStore(dir).load().settings.minutesEarly, 40);
});

test('where the site lists night entries is remembered', async () => {
  const { controller, dir } = setup();
  await add(controller);
  await controller.dispatch({ type: 'autopilot' });
  await controller.idle();
  assert.equal(createStore(dir).load().settings.nightListing, 'calendar');
  assert.deepEqual(Object.values(controller.state().duties[0].marks), Array(5).fill('logged'));
});

test('writing a duty from an earlier version says its times were planned again', async () => {
  const dir = temp();
  const old = {
    id: 'o', date: '2026-11-01', shift: '7-3', start: 420, end: 900, selected: true, activities: { counts: { hema: 2 } },
    entries: [{ id: 'b', kind: 'work', start: 420, end: 890, text: null, lines: [{ key: 'hema', text: 'Old line.' }] }]
  };
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ settings: {}, duties: [old] }));
  const controller = createController({ store: createStore(dir), driver: {}, now: () => new Date(2027, 5, 1), emit: () => {}, sleep: async () => {} });
  const state = await controller.dispatch({ type: 'writeEntries', dutyId: 'o' });
  assert.match(state.warning, /times were planned again/);
  assert.equal(state.duties[0].entries.length, 5);
});
