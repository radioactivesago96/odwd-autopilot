const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/duty');
const T = require('../src/core/time');

const S = D.defaultSettings();
const later = new Date(2027, 5, 1);

// The numbers and vital-sign times of the user's photo.
const PHOTO = {
  censusIn: 29, aVs1: 29, aBottles: 2, aSpecimens: 3, aLabRequests: 3, aDiet: 29, aIvfAssist: 1, aIvFollowed: 1,
  aVs2: 29, aIvTerminated: 2, aNewAdmit: 4, aDietNew: 4, aRequests: 3, aVs3: 33, aHeplock: 1, aNewborn: 2, aVsEncoded: 33
};
const TIMES = ['8pm', '12am', '4am'];
const PHOTO_TEXT = '6:50 pm) *Biometric logged in. *Received and reviewed 29 patients from outgoing shift. ' +
  '*Took vital signs (8pm) of 29 admitted patients. *Provided specimen bottle to 2 patients. ' +
  '*Sent 3 specimens to laboratory for examination. *Encoded 3 laboratory requests to IHOMIS. ' +
  '*Updated diet list of 29 admitted patients. *Assisted nurses for IVF insertion of 1 patient. *Followed up IV fluid to 1 patient. ' +
  '*Took vital signs (12am) of 29 admitted patients. *Terminated dislodged IV of 2 patients. ' +
  '*Received and took vital signs of 4 newly admitted patients. *Updated diet list of 4 newly admitted patients. ' +
  '*Responded to 3 patient requests. *Took vital signs (4am) of 33 admitted patients. *Changed 1 IVF line to heplock. ' +
  '*Bathed 2 newborns. *Encoded vital signs of 33 admitted patients to IHOMIS. *Endorsement to incoming shift. *Biometric logged out.';

const aide = (counts = PHOTO, extra = {}) =>
  D.createDuty({ date: '2026-11-12', shift: '7p-7a', category: 'attendant', counts, vitalTimes: TIMES, ...extra }, S);
const timedIn = (d) => D.setTimes(d, d.entries[0].id, '18:50', T.hhmm(d.entries[0].end));
const kinds = (d) => d.entries.map((e) => e.kind);
const all = (d) => d.entries.map((e) => D.describe(e)).join(' ');

test('a nurse attendant duty is one whole entry, written like the photo', () => {
  let d = aide();
  assert.deepEqual([d.category, d.layout], ['attendant', 'whole']);
  assert.deepEqual(kinds(d), ['whole']);
  assert.deepEqual([T.hhmm(d.entries[0].start), T.hhmm(d.entries[0].end)], ['18:30', '07:15']);
  d = timedIn(d);
  assert.equal(D.describe(d.entries[0]), PHOTO_TEXT);
  assert.deepEqual(D.validate(d, later), []);
  assert.equal(D.siteEntries(d)[0].description, PHOTO_TEXT);
});

test('the time at the front follows the entry, and typed text is left alone', () => {
  const d = aide();
  assert.match(D.describe(d.entries[0]), /^6:30 pm\) \*Biometric logged in\./);
  const moved = D.setTimes(d, d.entries[0].id, '07:05', '19:00');
  assert.match(D.describe(moved.entries[0]), /^7:05 am\) /);
  const typed = D.setText(d, d.entries[0].id, 'My own {in} words.');
  assert.equal(D.describe(typed.entries[0]), 'My own {in} words.');
});

test('blank leaves a sentence out, 0 is written, one is singular, and a missing time is not made up', () => {
  const text = D.describe(aide({ aVs1: 1, aBottles: 0, aSpecimens: 1, aNewborn: 1, aRequests: 1 }, { vitalTimes: [] }).entries[0]);
  assert.equal(text, '6:30 pm) *Biometric logged in. *Took vital signs of 1 admitted patient. *Provided specimen bottle to 0 patients. ' +
    '*Sent 1 specimen to laboratory for examination. *Responded to 1 patient request. *Bathed 1 newborn. ' +
    '*Endorsement to incoming shift. *Biometric logged out.');
});

test('attendant intervals keep the order, with two sentences at most', () => {
  const d = aide(PHOTO, { layout: 'intervals' });
  assert.deepEqual(kinds(d).slice(0, 2), ['prep', 'received']);
  assert.deepEqual(kinds(d).slice(-2), ['endorse', 'timeout']);
  assert.equal(all(d), PHOTO_TEXT.replace('6:50 pm', '6:30 pm'));
  d.entries.forEach((e, i) => {
    assert.ok(D.splitSentences(D.describe(e)).length <= 2, D.describe(e));
    if (i) assert.equal(e.start, d.entries[i - 1].end);
  });
  assert.deepEqual(D.validate(d, later), []);
});

test('typed tasks come before the endorsement', () => {
  const text = D.describe(aide({ aVs1: 2 }, { extraLines: ['Assisted with bed making'] }).entries[0]);
  assert.match(text, /patients\. Assisted with bed making\. \*Endorsement to incoming shift\./);
});

test('changing a vital-sign time or number rewrites the entry', () => {
  let d = timedIn(aide());
  d = D.updateActivities(d, { vitalTimes: ['9pm', '12am', '4am'], counts: { ...PHOTO, aHeplock: 2 } }, S);
  assert.match(D.describe(d.entries[0]), /vital signs \(9pm\) of 29/);
  assert.match(D.describe(d.entries[0]), /Changed 2 IVF lines to heplock\./);
  assert.match(D.describe(d.entries[0]), /^6:50 pm\)/);
});

test('switching between whole and intervals', () => {
  const split = D.setLayout(aide(), 'intervals', S);
  assert.ok(split.entries.length > 8);
  assert.deepEqual(kinds(D.setLayout(split, 'whole', S)), ['whole']);
});

test('the other sections are unchanged', () => {
  assert.deepEqual(D.CATEGORIES, ['lab', 'nurse', 'attendant']);
  const nurse = D.createDuty({ date: '2026-11-12', shift: '3-11', category: 'nurse', counts: { censusIn: 3, aVs1: 9 } }, S);
  assert.doesNotMatch(D.describe(nurse.entries[0]), /vital signs|\{/);
});
