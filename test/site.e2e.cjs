// Real Electron, real driver and runner, imitation site.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const D = require('../src/core/duty');
const { createRunner } = require('../src/core/runner');
const { createDriver } = require('../src/main/driver');
const mock = require('./mock-site/server');

const duty = (date, extra = {}) => D.createDuty({ date, shift: '11-7', counts: { hema: 2 }, ...extra }, D.defaultSettings());

async function main() {
  const server = await mock.start();
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const web = win.webContents;
  const home = server.url + '/odwd/index.php';
  const loaded = () => new Promise((resolve) => web.once('did-stop-loading', resolve));

  async function login() {
    server.set({ logout: false });
    await win.loadURL(home);
    if (await web.executeJavaScript('!!document.querySelector("#password")')) {
      const done = loaded();
      await web.executeJavaScript('document.querySelector("form").submit()');
      await done;
    }
  }

  const driver = createDriver(web);
  const run = (items, mode = 'autopilot', onEvent = () => {}) => createRunner({
    driver, items, now: () => new Date(2027, 5, 1), msPerChar: 0, gapMs: 0,
    sleep: async () => {}, onEvent
  })[mode]();

  await login();
  const text = '• Ms. Peña "A" \\ B – C\n• line 2 </textarea><b>x</b>';
  const base = duty('2026-11-01');
  const items = D.siteEntries(D.setText(base, base.entries[2].id, text));

  console.log('save a whole duty');
  let result = await run(items);
  assert.equal(result.state, 'done', result.message);
  assert.equal(result.saved.length, 5);
  assert.deepEqual(server.saved(), items.map((e) => ({ date: e.date, start: e.start, end: e.end, night: true, description: e.description })));

  console.log('a second run saves nothing');
  result = await run(items);
  assert.equal(result.saved.length, 0, result.message);
  assert.equal(server.saved().length, 5);

  console.log('slow typing keeps the text');
  server.clear();
  result = await createRunner({ driver, items: [items[2]], now: () => new Date(2027, 5, 1), msPerChar: 6, gapMs: 0, sleep: async () => {}, onEvent: () => {} }).autopilot();
  assert.equal(result.saved.length, 1, result.message);
  assert.equal(server.saved()[0].description, text);

  console.log('human typing: one key at a time, uneven, same text');
  await win.loadURL(home);
  await web.executeJavaScript(`window.__keys = [];
    const box = document.querySelector("#task_description");
    for (const type of ["keydown", "input", "keyup"]) box.addEventListener(type, (e) => window.__keys.push({ type, key: e.key, length: box.value.length, at: performance.now() }));`);
  const short = { ...items[0], description: 'Ran QC, done.\nOk' };
  assert.equal(await driver.fill(short, 'human'), true);
  assert.equal(await driver.matches(short), true);
  const pressed = await web.executeJavaScript('window.__keys');
  const downs = pressed.filter((e) => e.type === 'keydown');
  assert.deepEqual(downs.map((e) => e.key), Array.from(short.description, (c) => (c === '\n' ? 'Enter' : c)));
  assert.deepEqual(pressed.filter((e) => e.type === 'input').map((e) => e.length), downs.map((e, i) => i + 1));
  assert.equal(pressed.filter((e) => e.type === 'keyup').length, downs.length);
  const gaps = downs.slice(1).map((e, i) => e.at - downs[i].at);
  assert.ok(Math.min(...gaps) >= 55, 'no key follows faster than a person types: ' + Math.min(...gaps));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 100, 'the gaps differ');

  console.log('human typing stops when told to');
  await win.loadURL(home);
  setTimeout(() => driver.abortFill(), 2500);
  assert.equal(await driver.fill(items[0], 'human'), false);
  const partly = await web.executeJavaScript('document.querySelector("#task_description").value');
  assert.ok(partly.length < items[0].description.length);

  console.log('site error');
  server.set({ failNext: true });
  result = await run(D.siteEntries(duty('2026-11-03')));
  assert.equal(result.state, 'stopped');
  assert.match(result.message, /Error saving task: Database is down/);
  assert.equal(await web.executeJavaScript('1 + 1'), 2, 'no dialog is blocking the page');

  console.log('reload after saving');
  server.set({ reloadOnSave: true });
  await win.loadURL(home);
  result = await run(D.siteEntries(duty('2026-11-05')));
  assert.equal(result.state, 'done', result.message);
  assert.equal(result.saved.length, 5);
  server.set({ reloadOnSave: false });
  await win.loadURL(home);

  console.log('no confirmation');
  server.set({ dropSave: true });
  const before = server.saved().length;
  result = await run(D.siteEntries(duty('2026-11-07')));
  assert.equal(result.state, 'stopped');
  assert.match(result.message, /did not confirm saving/);
  assert.equal(server.saved().length, before);
  server.set({ dropSave: false });

  console.log('logged out');
  server.set({ logout: true });
  result = await run(D.siteEntries(duty('2026-11-09')));
  assert.equal(result.state, 'stopped');
  assert.match(result.message, /logged out/);
  await login();

  console.log('another page: goes to the Dashboard');
  await win.loadURL(server.url + '/odwd/daily.php');
  assert.equal((await driver.probe()).ok, true);

  console.log('missing field');
  server.set({ noNight: true });
  await win.loadURL(home);
  result = await run(D.siteEntries(duty('2026-11-11')));
  assert.match(result.message, /Night shift box/);
  server.set({ noNight: false });
  await win.loadURL(home);

  console.log('fill one waits for the user');
  let count = server.saved().length;
  result = await run(D.siteEntries(duty('2026-11-13')), 'fillNext', (event) => {
    if (event.type !== 'waiting') return;
    setTimeout(() => web.executeJavaScript('document.querySelector("#task button[type=submit]").click()'), 300);
  });
  assert.equal(result.saved.length, 1, result.message);
  assert.equal(server.saved().length, count + 1);

  console.log('a form left editing an old entry is refreshed first');
  await win.loadURL(home);
  await web.executeJavaScript(`document.querySelector("#task").insertAdjacentHTML("afterbegin", '<input type="hidden" name="task_id" value="9">')`);
  result = await run(D.siteEntries(duty('2026-11-19')));
  assert.equal(result.state, 'done', result.message);

  console.log('a form that stays in editing mode is refused');
  server.set({ editing: true });
  const untouched = server.saved().length;
  result = await run(D.siteEntries(duty('2026-11-21')));
  assert.match(result.message, /editing another entry/);
  assert.equal(server.saved().length, untouched);
  server.set({ editing: false });
  await win.loadURL(home);

  console.log('Save pressed by hand while the app types');
  server.clear();
  const slow = createRunner({ driver, items: [D.siteEntries(duty('2026-11-23'))[0]], now: () => new Date(2027, 5, 1), msPerChar: 35, gapMs: 0, sleep: async () => {},
    onEvent: (event) => { if (event.type === 'typing') setTimeout(() => web.executeJavaScript('document.querySelector("#task button[type=submit]").click()'), 1600); } });
  result = await slow.autopilot();
  assert.match(result.message, /pressed Save/);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(server.saved().length, 1, 'the app must not press Save again');

  console.log('stop while waiting for the user');
  count = server.saved().length;
  let fillOne;
  fillOne = createRunner({ driver, items: D.siteEntries(duty('2026-11-15')), now: () => new Date(2027, 5, 1), msPerChar: 0, gapMs: 0, sleep: async () => {},
    onEvent: (event) => { if (event.type === 'waiting') setTimeout(() => fillOne.stop(), 300); } });
  result = await fillOne.fillNext();
  assert.equal(result.state, 'stopped');
  assert.equal(server.saved().length, count, 'stopping sends nothing');

  server.close();
}

const deadline = setTimeout(() => { console.error('site e2e: timed out'); app.exit(1); }, 90000);
app.whenReady().then(main).then(
  () => { clearTimeout(deadline); console.log('site e2e: OK'); app.exit(0); },
  (error) => { console.error(error); app.exit(1); }
);
