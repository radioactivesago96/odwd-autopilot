const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/duty');
const T = require('../src/core/time');

const S = D.defaultSettings();
const later = new Date(2027, 5, 1);

// The numbers in the user's two photos.
const PHOTO = {
  censusIn: 39, ivfRegulated: 26, ivfFollowed: 5, ivReinserted: 2, ivRemoved: 3, nebulized: 4, labResults: 5, oxygen: 2,
  medications: 30, skinTest: 0, complaints: 5, healthTeaching: 39, newAdmissions: 2, discharges: 3, censusOut: 38
};
const PHOTO_TEXT = 'BIOMETRIC LOG-IN @ CDH LOBBY. BED TO BED ENDORSEMENT TO 39 PATIENTS. REGULATED IVF OF 26 PATIENTS. ' +
  'IVF FOLLOWED UP TO 5 PATIENTS. IV REINSERTION DONE TO 2 PATIENTS. IV REMOVAL TO 3 PATIENTS. ' +
  'ASSISTED NEBULIZATION TO 4 PATIENTS. RECEIVED LABORATORY RESULTS FROM LABORATORY AND RELAYED RESULTS TO ATTENDING PHYSICIAN - 5 PATIENTS. ' +
  'ASSISTED O2 INHALATION TO 2 PATIENTS. ADMINISTERED ORAL AND IVTT MEDICATIONS TO 30 PATIENTS. ' +
  'PERFORMED SKIN TESTING FOR IVTT MEDS TO 0 PATIENTS. RESPONDED TO 5 PATIENT COMPLAINTS. HEALTH TEACHING IMPARTED TO 39 PATIENTS. ' +
  'CARRIED OUT 2 NEW ADMISSIONS. CARRIED OUT 3 PTS FOR DISCHARGE. BED TO BED ENDORSEMENT TO 38 PATIENTS TO NEXT SHIFT NOD. ' +
  'BIOMETRIC LOGGED OUT AT CDH LOBBY.';

const nurse = (counts = PHOTO, extra = {}) => D.createDuty({ date: '2026-11-26', shift: '3-11', category: 'nurse', counts, ...extra }, S);
const lab = (extra = {}) => D.createDuty({ date: '2026-11-26', shift: '7-3', counts: { hema: 5, chem: 4 }, ...extra }, S);
const kinds = (d) => d.entries.map((e) => e.kind);
const spans = (d) => d.entries.map((e) => T.hhmm(e.start) + '-' + T.hhmm(e.end));
const all = (d) => d.entries.map((e) => D.describe(e)).join(' ');
const back = (d) => d.entries.forEach((e, i) => i && assert.equal(e.start, d.entries[i - 1].end, 'no gap before ' + D.describe(e)));

test('a nurse duty is one whole entry, written like the photo', () => {
  const d = nurse();
  assert.equal(d.category, 'nurse');
  assert.equal(d.layout, 'whole');
  assert.deepEqual(kinds(d), ['whole']);
  assert.deepEqual(spans(d), ['14:30-23:15']);
  assert.equal(D.describe(d.entries[0]), PHOTO_TEXT);
  assert.deepEqual(D.validate(d, later), []);
});

test('the actual times typed from the diary are kept', () => {
  let d = nurse();
  d = D.setTimes(d, d.entries[0].id, '14:47', '23:06');
  assert.deepEqual(spans(d), ['14:47-23:06']);
});

test('a blank number leaves its sentence out, a typed 0 is written, and one is singular', () => {
  const text = D.describe(nurse({ censusIn: 1, newAdmissions: 1, discharges: 1, complaints: 1, skinTest: 0 }).entries[0]);
  assert.equal(text, 'BIOMETRIC LOG-IN @ CDH LOBBY. BED TO BED ENDORSEMENT TO 1 PATIENT. PERFORMED SKIN TESTING FOR IVTT MEDS TO 0 PATIENTS. ' +
    'RESPONDED TO 1 PATIENT COMPLAINT. CARRIED OUT 1 NEW ADMISSION. CARRIED OUT 1 PT FOR DISCHARGE. BIOMETRIC LOGGED OUT AT CDH LOBBY.');
});

test('typed tasks come before the endorsement to the next shift, as typed', () => {
  const text = D.describe(nurse({ censusOut: 4 }, { extraLines: ['Attended CPR to bed 3'] }).entries[0]);
  assert.match(text, /Attended CPR to bed 3\. BED TO BED ENDORSEMENT TO 4 PATIENTS TO NEXT SHIFT NOD\./);
});

test('nurse intervals say the same things in the same order, two sentences at most', () => {
  const d = nurse(PHOTO, { layout: 'intervals' });
  assert.deepEqual(kinds(d).slice(0, 2), ['prep', 'received']);
  assert.deepEqual(kinds(d).slice(-2), ['endorse', 'timeout']);
  assert.ok(d.entries.length > 8);
  assert.equal(all(d), PHOTO_TEXT);
  for (const e of d.entries) assert.ok(D.splitSentences(D.describe(e)).length <= 2, D.describe(e));
  back(d);
  assert.deepEqual(D.validate(d, later), []);
});

test('without the endorsement numbers there are no endorsement entries and no gaps', () => {
  const d = nurse({ ivfRegulated: 3, medications: 9 }, { layout: 'intervals' });
  assert.deepEqual(kinds(d), ['prep', 'work', 'work', 'timeout']);
  assert.deepEqual([spans(d)[0], spans(d)[3]], ['14:30-15:00', '23:00-23:15']);
  back(d);
  assert.deepEqual(D.validate(d, later), []);
});

test('adding an endorsement number later adds its entry', () => {
  let d = nurse({ medications: 9 }, { layout: 'intervals' });
  d = D.updateActivities(d, { counts: { medications: 9, censusIn: 20 } }, S);
  assert.deepEqual(kinds(d), ['prep', 'received', 'work', 'timeout']);
  assert.match(D.describe(d.entries[1]), /20 PATIENTS/);
});

test('changing a number keeps the times', () => {
  let d = nurse(PHOTO, { layout: 'intervals' });
  d = D.setTimes(d, d.entries[0].id, '14:47', '15:00');
  const before = spans(d);
  d = D.updateActivities(d, { counts: { ...PHOTO, medications: 31, censusIn: 40 } }, S);
  assert.deepEqual(spans(d), before);
  assert.match(all(d), /ENDORSEMENT TO 40 PATIENTS\./);
  assert.match(all(d), /MEDICATIONS TO 31 PATIENTS\./);

  let whole = nurse();
  whole = D.setTimes(whole, whole.entries[0].id, '14:47', '23:06');
  whole = D.updateActivities(whole, { counts: { ...PHOTO, medications: 31 } }, S);
  assert.deepEqual(spans(whole), ['14:47-23:06']);
  assert.match(D.describe(whole.entries[0]), /MEDICATIONS TO 31 PATIENTS\./);
});

test('a nurse count can be split over intervals', () => {
  let d = nurse({ medications: 30, oxygen: 2, complaints: 5 }, { layout: 'intervals' });
  const [first, second] = d.entries.filter((e) => e.kind === 'work');
  d = D.splitCount(d, first.id, 'medications', 10, second.id, S);
  assert.match(all(d), /TO 20 PATIENTS\..*MEDICATIONS TO 10 PATIENTS\./);
});

test('a laboratory duty can be whole too', () => {
  let d = lab({ layout: 'whole', qc: true });
  assert.deepEqual(kinds(d), ['whole']);
  assert.deepEqual(spans(d), ['06:30-15:15']);
  assert.equal(D.describe(d.entries[0]), 'Timed in and prepared the laboratory work area. ' +
    'Received endorsement from the outgoing staff. Reviewed pending requests, specimens, and analyzer status. ' +
    'Ran daily QC on the Hematology and Chemistry analyzers. Ran Hematology tests for 5 patients. ' +
    'Performed Clinical Chemistry tests for 4 patients. Endorsed pending requests, specimens, and analyzer status to the incoming staff. ' +
    'Finished the remaining documentation and timed out.');
  const next = D.rewrite(d, S);
  assert.notEqual(D.describe(next.entries[0]), D.describe(d.entries[0]));
  assert.equal(D.canRewrite(d.entries[0], S.wording), true);
  d = D.updateActivities(next, { counts: { hema: 6 } }, S);
  assert.match(D.describe(d.entries[0]), /Hematology tests for 6 patients\./);
  assert.doesNotMatch(D.describe(d.entries[0]), /Chemistry tests/);
});

test('switching the layout rebuilds the entries and a split count is joined in a whole entry', () => {
  let d = lab();
  const [hema, chem] = d.entries.filter((e) => e.kind === 'work');
  d = D.splitCount(d, hema.id, 'hema', 2, chem.id, S);
  const whole = D.setLayout(d, 'whole', S);
  assert.deepEqual(kinds(whole), ['whole']);
  assert.match(D.describe(whole.entries[0]), /Hematology tests for 5 patients\./);
  const again = D.setLayout(whole, 'intervals', S);
  assert.match(all(again), /for 3 patients\..*for 2 patients\./);
  assert.equal(D.setLayout(d, 'intervals', S), d);
  assert.equal(D.setLayout(d, 'sideways', S), d);
});

test('an entry not yet confirmed stays marked when the layout changes', () => {
  const marked = (d, i) => ({ ...d, entries: d.entries.map((e, n) => (n === i ? { ...e, unconfirmed: true } : e)) });
  assert.equal(D.setLayout(marked(lab(), 2), 'whole', S).entries[0].unconfirmed, true);
  const split = D.setLayout(marked(nurse(), 0), 'intervals', S);
  assert.ok(split.entries.every((e) => e.unconfirmed));
  assert.ok(D.setLayout(lab(), 'whole', S).entries.every((e) => !e.unconfirmed));
});

test('a whole night entry is marked as night shift', () => {
  const d = D.createDuty({ date: '2026-11-26', shift: '11-7', category: 'nurse', counts: { censusIn: 5 } }, S);
  const [sent] = D.siteEntries(d);
  assert.deepEqual([sent.date, sent.start, sent.end, sent.night], ['2026-11-26', '22:30', '07:15', true]);
});

test('settings choose the layout of new duties, and older duties stay laboratory intervals', () => {
  const settings = { ...S, layouts: { lab: 'whole', nurse: 'intervals' } };
  assert.deepEqual(kinds(D.createDuty({ date: '2026-11-26', shift: '7-3', counts: { hema: 1 } }, settings)), ['whole']);
  assert.ok(D.createDuty({ date: '2026-11-26', shift: '7-3', category: 'nurse', counts: PHOTO }, settings).entries.length > 1);

  const { category, layout, ...old } = lab();
  assert.deepEqual([D.categoryOf(old), D.layoutOf(old)], ['lab', 'intervals']);
  assert.deepEqual(kinds(D.resetTimes(old, settings)), kinds(lab()));
});
