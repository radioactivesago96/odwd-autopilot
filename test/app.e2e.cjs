// The whole app against the imitation site. Window is placed off screen.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mock = require('./mock-site/server');
const { splitSentences } = require('../src/core/duty');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(label, check, limit = 20000) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error('Timed out waiting for: ' + label);
}

const shots = process.env.ODWD_SHOTS;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'odwd-app-'));
const deadline = setTimeout(() => { console.error('app e2e: timed out'); app.exit(1); }, 150000);

async function main() {
  const server = await mock.start();
  process.env.ODWD_URL = server.url + '/odwd/index.php';
  process.env.ODWD_DATA = data;
  process.env.ODWD_OFFSCREEN = '1';
  const created = new Promise((resolve) => app.once('browser-window-created', (event, win) => resolve(win)));
  require('../src/main/main');
  const win = await created;
  const panel = win.webContents;
  const errors = [];
  panel.on('console-message', (event, level, message) => { if (level >= 3) errors.push(message); });

  const ui = (code) => panel.executeJavaScript('(() => {' + code + '})()', true);
  const count = (selector) => ui('return document.querySelectorAll(' + JSON.stringify(selector) + ').length');
  const click = (selector) => ui('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const text = (selector) => ui('const el = document.querySelector(' + JSON.stringify(selector) + '); return el ? el.textContent : ""');
  const key = (code) => { panel.sendInputEvent({ type: 'keyDown', keyCode: code }); panel.sendInputEvent({ type: 'keyUp', keyCode: code }); };
  const shot = async (name) => { if (shots) { await sleep(400); fs.writeFileSync(path.join(shots, name), (await panel.capturePage()).toPNG()); } };

  console.log('start screen');
  await until('panel', async () => !panel.isLoading() && (await ui('return !!window.keygenFont').catch(() => false)));
  assert.equal(win.getBrowserViews().length, 0, 'the site waits behind the start screen');
  assert.equal(await ui('return document.querySelector("#disclaimer").hidden && document.querySelector("#app").inert'), true);
  const splashDots = () => ui('const c = document.querySelector("#splash"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 70 && d[i + 1] > 150 && d[i + 2] > 230) n++; return n');
  await sleep(700);
  await shot('0a-splash-flying.png');
  await sleep(1500);
  assert.ok((await splashDots()) > 100, 'the logo has arrived');
  await shot('0b-splash.png');
  await until('reminder', () => ui('return !document.querySelector("#disclaimer").hidden'), 5000);
  assert.match(await text('#disclaimer'), /not an excuse to get lazy/);
  await until('button wakes', () => ui('return !document.querySelector("#agree").disabled'), 3000);
  key('F8');
  await sleep(400);
  assert.equal(await count('#preview:not([hidden])'), 0, 'keys do nothing behind the reminder');
  assert.equal(win.getBrowserViews().length, 0);
  await shot('0c-reminder.png');
  await click('#agree');
  console.log('section question');
  await until('question', () => ui('return !document.querySelector("#chooser").hidden && !document.querySelector("#chooser button").disabled'), 3000);
  assert.match(await text('#chooser'), /What section are you\?/);
  assert.equal(await text('#chooser button.chosen'), 'Laboratory');
  assert.deepEqual(await ui('return [...document.querySelectorAll("#chooser button")].map((b) => b.textContent)'), ['Laboratory', 'Nurse', 'Nurse Attendant']);
  assert.equal(win.getBrowserViews().length, 0);
  await shot('0d-section.png');
  await click('#chooser button[data-section="lab"]');
  await until('site view', async () => win.getBrowserViews().length === 1);
  assert.equal(await ui('return document.querySelector("#intro").hidden && !document.querySelector("#app").inert'), true);
  const view = win.getBrowserViews()[0].webContents;
  await until('login page', () => view.executeJavaScript('!!document.querySelector("#password")').catch(() => false));
  await until('status says log in', async () => /log in/i.test(await text('#site')));
  // The page must really have the size of the space it is drawn in (a 0×0 page shows nothing).
  const siteFillsItsSpace = (label) => until('site page sized (' + label + ')', async () => {
    const { width, height } = win.getBrowserViews()[0].getBounds();
    const page = await view.executeJavaScript('({ w: innerWidth, h: innerHeight })');
    return width > 500 && page.w === width && page.h === height;
  }, 5000);
  await siteFillsItsSpace('first load');

  await view.executeJavaScript('document.querySelector("form").submit()');
  await until('status ready', async () => /ready/i.test(await text('#site')));

  async function choose(file) {
    if (!panel.debugger.isAttached()) panel.debugger.attach('1.3');
    const { root } = await panel.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await panel.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' });
    await panel.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [file] });
  }

  console.log('keygen banner');
  const painted = () => ui('const c = document.querySelector("#banner"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) n++; return n');
  await until('banner drawn', async () => (await painted()) > 200);
  assert.match(await text('#marquee'), /F8 AUTOPILOT/);
  // The starting position follows the Windows "reduce motion" setting, so test both directions.
  const fxOff = () => ui('return document.body.classList.contains("fx-off")');
  const startedOff = await fxOff();
  console.log('effects start ' + (startedOff ? 'off (this PC asks for less motion)' : 'on'));
  for (const expected of [!startedOff, startedOff]) {
    await click('#fx');
    await until('effects switched', async () => (await fxOff()) === expected);
    assert.ok((await painted()) > 200, 'the logo stays whether effects are on or off');
  }

  console.log('import the sample CSV');
  await shot('1-empty.png');
  await choose(path.join(__dirname, 'fixtures', 'sample.csv'));
  await until('10 duties', async () => (await count('.duty')) === 10);
  assert.match(await text('#skipped summary'), /5 skipped/);
  assert.equal(await count('.duty img, .duty script'), 0);
  await shot('2-list.png');

  console.log('select one duty and change its last end time');
  await click('#select-none');
  await until('none selected', async () => (await count('.duty input.pick:checked')) === 0);
  await click('.duty input.pick');
  await until('one selected', async () => (await count('.duty input.pick:checked')) === 1);
  await click('.duty .title');
  // time in, endorsement received, seven intervals, endorsement, time out
  await until('entries shown', async () => (await count('.duty.open .entry')) === 11);
  await shot('3-open.png');

  console.log('write and rewrite');
  const desc = (n) => ui('return document.querySelectorAll(".duty.open textarea.desc")[' + n + '].value');
  assert.equal(await desc(0), 'Timed in and prepared the laboratory work area.');
  await click('.duty.open button.write');
  await until('written again', async () => (await desc(0)) === 'Timed in, set up the work area, and readied the materials for the shift.');
  await click('.duty.open .entry button.rewrite');
  await until('rewritten', async () => (await desc(0)) === 'Timed in and prepared the laboratory work area.');

  console.log('split a count');
  await ui(`const entries = document.querySelectorAll(".duty.open .entry");
    const from = entries[5]; from.querySelector("details.move").open = true;
    const row = [...from.querySelectorAll(".line.split")].find((r) => r.textContent.includes("Move some of 18"));
    row.querySelector("input.amount").value = "6";
    const times = entries[6].querySelector("input.start").value + "–" + entries[6].querySelector("input.end").value;
    const target = row.querySelector("select.target");
    target.value = [...target.options].find((o) => o.textContent === times).value;
    row.querySelector("button.split-count").click();`);
  await until('count split', async () => /Hematology[^.]* 12 patients/.test(await desc(5)) && /Hematology[^.]* 6 patients/.test(await desc(6)));
  assert.equal(await ui('return document.querySelectorAll(".duty.open .entry")[5].querySelector("details.move").open'), true, 'the list stays open');
  await ui('document.querySelectorAll(".duty.open .entry")[5].scrollIntoView()');
  await shot('3b-split.png');
  // Leaving the field is signalled directly: real focus events need the window to have the focus.
  await ui('const ends = document.querySelectorAll(".duty.open input.end"); const el = ends[ends.length - 1]; el.value = "15:20"; el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));');
  await until('time kept', () => ui('const e = document.querySelectorAll(".duty.open input.end"); return e[e.length - 1].value === "15:20" && e[e.length - 1].dataset.saved === "15:20"'));

  console.log('choose the Human speed');
  await click('.speed button[data-speed="human"]');
  await until('Human chosen', () => ui('return document.querySelector(\'.speed button[data-speed="human"]\').getAttribute("aria-checked") === "true"'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'data.json'), 'utf8')).settings.speed, 'human');
  const buttonsFit = () => ui('const all = [...document.querySelectorAll(".speed button")]; return all.length === 4 && all.every((b) => b.scrollWidth <= b.clientWidth && b.getBoundingClientRect().right <= 340 && b.offsetTop === all[0].offsetTop)');
  assert.equal(await buttonsFit(), true, 'four speed buttons fit on one row');
  await shot('3c-speed.png');
  await click('.speed button[data-speed="fast"]');
  await until('Fast again', () => ui('return document.querySelector(\'.speed button[data-speed="fast"]\').getAttribute("aria-checked") === "true"'));

  console.log('preview one duty');
  const previewOpen = (open) => until('preview ' + (open ? 'open' : 'closed'), async () =>
    (await count('#preview:not([hidden])')) === (open ? 1 : 0) && win.getBrowserViews().length === (open ? 0 : 1));
  await click('.duty.open button.preview');
  await previewOpen(true);
  assert.equal(await count('#preview tbody tr'), 11);
  assert.equal(await ui('return document.querySelector("#preview-start").hidden'), true, 'nothing can be sent from here');
  assert.match(await text('#preview tfoot'), /8 hr 50 min/);
  await shot('4a-preview-duty.png');
  key('Escape');
  await previewOpen(false);
  await siteFillsItsSpace('after a preview');

  console.log('autopilot with F8');
  key('F8');
  await previewOpen(true);
  assert.match(await text('#preview-note'), /11 entries from 1 duty will be saved/);
  assert.equal(await count('#preview tbody tr'), 11);
  const shown = await ui('return [...document.querySelectorAll("#preview tbody .what span")].map((el) => el.textContent)');
  assert.equal(server.saved().length, 0, 'nothing is sent before Start');
  await shot('4-preview.png');
  await click('#preview-start');
  await previewOpen(false);
  await until('11 saved', async () => server.saved().length === 11, 60000);
  const sent = server.saved();
  assert.deepEqual(sent.map((e) => e.description), shown, 'what was saved is what the preview showed');
  assert.deepEqual([sent[0].start, sent[0].end, sent[10].start, sent[10].end], ['06:30', '06:50', '15:00', '15:20']);
  assert.ok(sent.every((e) => e.date === '2026-10-01' && !e.night));
  for (let i = 1; i < sent.length; i++) assert.equal(sent[i].start, sent[i - 1].end);
  assert.match(sent[3].description, /Performed CBC for 3 newly admitted patients/);
  assert.match(sent[4].description, /chemistry tests \(FBS\) for 3 newly admitted patients/);
  for (const e of sent) assert.ok(splitSentences(e.description).length <= 2 && !e.description.includes('•'), e.description);
  await until('badge saved', async () => (await text('.duty .badge')) === 'SAVED');
  await until('run finished', async () => /Saved 11/.test(await text('#progress')));
  await shot('5-saved.png');

  console.log('F8 again sends nothing');
  key('F8');
  await until('nothing to send', async () => /already saved/i.test(await text('#notice')));
  assert.equal(await count('#preview:not([hidden])'), 0);
  assert.equal(server.saved().length, 11);

  console.log('add a duty by hand');
  await click('#add');
  await ui('document.querySelector("#f-date").value = "2026-11-20"; document.querySelector("#f-shift").value = "7p-7a"; document.querySelector("#f-shift").dispatchEvent(new Event("change")); document.querySelector("#f-hema").value = "4"; document.querySelector("#f-qc").checked = true;');
  assert.equal(await count('input[id^="f-r-"]'), 6);
  assert.equal(await count('input[id^="f-r-"]:checked'), 0, 'routine tasks start switched off');
  await shot('6-form.png');
  await click('#form-save');
  await until('11 duties', async () => (await count('.duty')) === 11);

  console.log('a nurse duty, whole');
  const formState = () => ui('return [document.querySelector("#sheet h2").textContent, document.querySelector("#f-layout").value, document.querySelector("#f-lab").hidden, document.querySelector("#f-nurse").hidden]');
  async function chooseSection(key, name) {
    await click('#section');
    assert.match(await text('#sheet h2'), /What section are you\?/);
    if (shots && key === 'nurse') await shot('6a-section.png');
    await click('#sheet button[data-section="' + key + '"]');
    await until(name + ' chosen', async () => (await text('#section')) === name);
  }
  await click('#add');
  assert.deepEqual(await formState(), ['NEW DUTY · Laboratory', 'intervals', false, true]);
  assert.equal(await count('#f-category'), 0);
  await click('#form-cancel');
  await chooseSection('nurse', 'Nurse');
  assert.equal(await ui('return document.querySelector("#import").disabled'), true);
  await click('#add');
  assert.deepEqual(await formState(), ['NEW DUTY · Nurse', 'whole', true, false]);
  const photo = { censusIn: 39, ivfRegulated: 26, ivfFollowed: 5, ivReinserted: 2, ivRemoved: 3, nebulized: 4, labResults: 5, oxygen: 2, medications: 30, skinTest: 0, complaints: 5, healthTeaching: 39, newAdmissions: 2, discharges: 3, censusOut: 38 };
  await ui('document.querySelector("#f-date").value = "2026-11-18"; document.querySelector("#f-shift").value = "3-11"; for (const [k, v] of Object.entries(' + JSON.stringify(photo) + ')) document.querySelector("#f-" + k).value = v;');
  await shot('6b-nurse-form.png');
  await click('#form-save');
  await until('12 duties', async () => (await count('.duty')) === 12);
  const nurseDuty = '[...document.querySelectorAll(".duty")].find((li) => li.querySelector(".title small").textContent.startsWith("Nurse"))';
  assert.equal(await ui('return ' + nurseDuty + '.querySelector(".title small").textContent'), 'Nurse · 3 PM – 11 PM · Whole');
  await ui(nurseDuty + '.querySelector(".title").click()');
  await until('nurse entry', () => ui('return ' + nurseDuty + '.querySelectorAll(".entry").length === 1'));
  const written = await ui('return ' + nurseDuty + '.querySelector("textarea.desc").value');
  assert.match(written, /^BIOMETRIC LOG-IN @ CDH LOBBY\. BED TO BED ENDORSEMENT TO 39 PATIENTS\./);
  assert.match(written, /SKIN TESTING FOR IVTT MEDS TO 0 PATIENTS\./);
  assert.match(written, /TO 38 PATIENTS TO NEXT SHIFT NOD\. BIOMETRIC LOGGED OUT AT CDH LOBBY\.$/);
  await ui(nurseDuty + '.scrollIntoView()');
  assert.equal(await ui('return ' + nurseDuty + '.querySelector("textarea.desc").rows'), 16);
  await shot('6c-nurse-whole.png');
  await ui('[...' + nurseDuty + '.querySelectorAll("button")].find((b) => b.textContent === "Preview").click()');
  await previewOpen(true);
  assert.equal(await count('#preview tbody tr'), 1);
  assert.equal(await text('#preview tbody .what span'), written);
  await shot('6e-preview-nurse.png');
  await click('#preview-close');
  await previewOpen(false);

  console.log('the same duty in intervals');
  await ui('[...' + nurseDuty + '.querySelectorAll("button")].find((b) => b.textContent === "Activities").click()');
  assert.equal(await ui('return document.querySelector("#f-skinTest").value'), '0', 'a typed 0 is shown again');
  await ui('document.querySelector("#f-layout").value = "intervals"');
  await click('#form-save');
  await until('intervals', () => ui('return ' + nurseDuty + '.querySelectorAll(".entry").length === 11'));
  await ui(nurseDuty + '.scrollIntoView()');
  await shot('6d-nurse-intervals.png');
  console.log('a nurse attendant duty');
  await chooseSection('attendant', 'NA');
  assert.equal(await ui('return document.querySelector("#import").disabled'), true);
  await click('#add');
  assert.deepEqual(await ui('return [document.querySelector("#sheet h2").textContent, document.querySelector("#f-layout").value, document.querySelector("#f-lab").hidden, document.querySelector("#f-nurse").hidden, document.querySelector("#f-attendant").hidden]'),
    ['NEW DUTY · Nurse Attendant', 'whole', true, true, false]);
  const aide = { censusIn: 29, aVs1: 29, aBottles: 2, aSpecimens: 3, aLabRequests: 3, aDiet: 29, aIvfAssist: 1, aIvFollowed: 1, aVs2: 29, aIvTerminated: 2, aNewAdmit: 4, aDietNew: 4, aRequests: 3, aVs3: 33, aHeplock: 1, aNewborn: 2, aVsEncoded: 33 };
  await ui('document.querySelector("#f-date").value = "2026-11-12"; document.querySelector("#f-shift").value = "7p-7a"; ["8pm", "12am", "4am"].forEach((t, i) => { document.querySelector("#f-vt" + i).value = t; }); for (const [k, v] of Object.entries(' + JSON.stringify(aide) + ')) document.querySelector("#f-" + k).value = v;');
  await shot('6g-attendant-form.png');
  await click('#form-save');
  await until('13 duties', async () => (await count('.duty')) === 13);
  const aideDuty = '[...document.querySelectorAll(".duty")].find((li) => li.querySelector(".title small").textContent.startsWith("Nurse Attendant"))';
  await ui(aideDuty + '.querySelector(".title").click()');
  await until('attendant entry', () => ui('return ' + aideDuty + '.querySelectorAll(".entry").length === 1'));
  await ui('const li = ' + aideDuty + '; const start = li.querySelector("input.start"); start.value = "18:50"; start.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));');
  const aideText = () => ui('return ' + aideDuty + '.querySelector("textarea.desc").value');
  await until('time at the front', async () => (await aideText()).startsWith('6:50 pm) *Biometric logged in.'));
  assert.match(await aideText(), /\*Took vital signs \(4am\) of 33 admitted patients\..*\*Biometric logged out\.$/);
  await ui('[...' + aideDuty + '.querySelectorAll("button")].find((b) => b.textContent === "Preview").click()');
  await previewOpen(true);
  assert.match(await text('#preview tfoot'), /12 hr 25 min/);
  assert.equal(await text('#preview tbody .what span'), await aideText());
  await shot('6h-preview-attendant.png');
  await click('#preview-close');
  await previewOpen(false);
  await ui('[...' + aideDuty + '.querySelectorAll("button")].find((b) => b.textContent === "Activities").click()');
  assert.deepEqual(await ui('return [0, 1, 2].map((i) => document.querySelector("#f-vt" + i).value)'), ['8pm', '12am', '4am']);
  await click('#form-cancel');

  await chooseSection('lab', 'Lab');
  assert.equal(await ui('return document.querySelector("#import").disabled'), false);

  console.log('about');
  await click('#about');
  await until('logo', () => ui('const img = document.querySelector("#logo"); return !!img && img.complete && img.naturalWidth === 480'), 3000);
  assert.match(await text('#sheet'), /ODWD Autopilot 1\.6\.0/);
  assert.match(await text('#sheet'), /Made by sago/);
  await shot('6f-about.png');
  await click('#about-close');
  assert.equal(await count('#sheet:not([hidden])'), 0);

  console.log('settings');
  await click('#open-settings');
  assert.equal(await ui('return document.querySelector("#s-layout-nurse").value'), 'whole');
  assert.equal(await ui('return document.querySelector("#s-layout-attendant").value'), 'whole');
  await ui('document.querySelector("#s-endAfter").value = "20";');
  await shot('7-settings.png');
  await click('#settings-save');
  await until('settings stored', async () => JSON.parse(fs.readFileSync(path.join(data, 'data.json'), 'utf8')).settings.endAfter === 20);

  const downloads = path.join(os.homedir(), 'Downloads');
  const pdf = fs.readdirSync(downloads).find((f) => /^Accomplishment_Report_.*\.pdf$/i.test(f));
  if (pdf) {
    console.log('import a PDF report');
    const before = await count('.duty');
    await choose(path.join(downloads, pdf));
    await until('PDF duties', async () => (await count('.duty')) > before, 40000);
  }

  console.log('other websites are blocked');
  let refusal = '';
  await view.loadURL('https://example.com/').catch((error) => { refusal = error.message; });
  assert.match(refusal, /ERR_BLOCKED_BY_CLIENT/);
  await until('blocked host named', async () => /Blocked: example\.com/.test(await text('#notice')));
  await click('#home');
  await until('back on the diary', async () => view.getURL().startsWith(server.url) && !view.isLoading());
  await siteFillsItsSpace('after a blocked page');

  console.log('smallest window');
  win.setSize(1000, 640);
  await sleep(300);
  assert.equal(await ui('return document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
  assert.equal(await ui('return [...document.querySelectorAll(".bar button, .tools button")].every((b) => b.scrollWidth <= b.clientWidth && b.getBoundingClientRect().right <= 340)'), true, 'top buttons fit');
  assert.equal(await ui('const r = document.querySelector("#auto").getBoundingClientRect(); return r.bottom <= window.innerHeight && r.right <= 340'), true);
  await shot('8-small.png');
  await siteFillsItsSpace('smallest window');

  console.log('skipping the splash');
  panel.reload();
  await sleep(200);
  await until('start screen again', () => ui('return !!window.keygenFont && !document.querySelector("#intro").hidden').catch(() => false));
  assert.equal(await ui('return document.querySelector("#disclaimer").hidden'), true);
  const pressedAt = Date.now();
  key('Space');
  await until('reminder at once', () => ui('return !document.querySelector("#disclaimer").hidden'), 1500);
  assert.ok(Date.now() - pressedAt < 1500);
  assert.equal(await ui('return document.querySelector("#agree").disabled && !document.querySelector("#intro").hidden'), true, 'the same key press does not accept it');

  assert.deepEqual(errors, []);
  server.close();
}

app.whenReady().then(main).then(
  () => { clearTimeout(deadline); console.log('app e2e: OK'); app.exit(0); },
  (error) => { console.error(error); app.exit(1); }
);
