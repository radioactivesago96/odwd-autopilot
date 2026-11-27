const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../src/core/duty');
const { importFile } = require('../src/core/import');
const { parseShift } = require('../src/core/import/shared');

const S = D.defaultSettings();
const fixture = path.join(__dirname, 'fixtures', 'sample.csv');

test('sample CSV', () => {
  const r = importFile({ name: 'sample.csv', text: fs.readFileSync(fixture, 'utf8') }, S);
  assert.equal(r.duties.length, 10);
  assert.equal(r.skipped.length, 5);
  const a = r.duties[0].activities;
  assert.equal(r.duties[0].date, '2026-10-01');
  assert.deepEqual([a.counts.hema, a.counts.micro, a.counts.chem, a.counts.phleb, a.counts.ihomis, a.counts.admission, a.counts.serology], [18, 9, 14, 22, 31, 3, 4]);
  assert.deepEqual([a.from, a.to, a.qc, a.cleaning], ['Ms. Santos', 'Ms. Peña', true, true]);
  assert.equal(a.admissionTests, 'CBC; Urinalysis; FBS');
});

test('CSV time in and out set the first start and last end', () => {
  const r = importFile({ name: 't.csv', text: 'Date,Shift,Hematology,Time In,Time Out\n2026-10-01,11 PM – 7 AM,3,10:40 PM,7:20 AM' }, S);
  assert.equal(r.duties[0].entries[0].start, 1360);
  assert.equal(r.duties[0].entries[4].end, 1880);
  assert.equal(r.duties[0].activities.qc, false);
  assert.equal(r.duties[0].activities.cleaning, false);
});

test('rows without work or with an unreadable shift are skipped with a reason', () => {
  const r = importFile({ name: 't.csv', text: 'Date,Shift,Hematology\n2026-10-01,7 AM – 3 PM,\n2026-10-02,noon,4\nxx,7-3,2' }, S);
  assert.equal(r.duties.length, 0);
  assert.deepEqual(r.skipped.map((s) => s.reason), ['no activities recorded', 'shift "noon" could not be read', 'unreadable date "xx"']);
});

test('shifts', () => {
  assert.equal(parseShift('7 PM – 7 AM').shift, '7p-7a');
  assert.equal(parseShift('6:00 PM - 6:00 AM').shift, '6p-6a');
  assert.equal(parseShift('7 AM – 7 PM').shift, '7a-7p');
  assert.equal(parseShift('11-7').shift, '11-7');
  assert.equal(parseShift('3 PM – 7 AM (double duty)').shift, '3p-7a');
  assert.deepEqual(parseShift('8 AM – 5 PM'), { shift: 'custom', start: 480, end: 1020 });
  assert.equal(parseShift('6:00 AM – 12:00 PM / 3:30 PM – 5:30 PM'), null);
  assert.equal(parseShift(''), null);
});

test('app Daily CSV explains missing counts', () => assert.throws(
  () => importFile({ name: 'd.csv', text: 'Date,Duty Status,Shift,Activities\n2026-10-01,Working Day,7 AM – 3 PM,Hematology' }, S),
  /no patient counts.*PDF report or the JSON backup/s));

test('CSV without Date and Shift is refused', () => assert.throws(
  () => importFile({ name: 'd.csv', text: 'Name,Hematology\nx,1' }, S), /"Date" and "Shift"/));

test('backup: drafts and days off skipped with reasons', () => {
  const r = importFile({ name: 'b.json', text: JSON.stringify({ activities: [{ id: 'x1', name: 'Gram Stain' }], entries: [
    { date: '2026-10-01', dutyStatus: 'Working Day', shift: '7 PM – 7 AM', manualActivities: [{ targetText: 'Attend meeting', outputText: 'Attended the meeting' }],
      outputs: [{ activityId: 'hematology', selected: true, count: 5 }, { activityId: 'qc', selected: true }, { activityId: 'x1', selected: true, count: 2 }, { activityId: 'serology', selected: false, count: 9 }] },
    { date: '2026-10-02', dutyStatus: 'Day Off', shift: '', outputs: [] },
    { date: '2026-10-03', dutyStatus: 'Working Day', shift: '7 AM – 3 PM', draft: true, outputs: [] }
  ] }) }, S);
  assert.equal(r.duties.length, 1);
  const a = r.duties[0].activities;
  assert.equal(a.counts.hema, 5);
  assert.equal(a.counts.serology, undefined);
  assert.equal(a.qc, true);
  assert.equal(a.cleaning, false);
  assert.deepEqual(a.otherTests, [{ name: 'Gram Stain', count: 2 }]);
  assert.deepEqual(a.extraLines, ['Attended the meeting']);
  assert.deepEqual(r.skipped.map((s) => s.reason), ['Day Off', 'still a draft']);
});

test('files that are not a backup are refused', () => {
  assert.throws(() => importFile({ name: 'b.json', text: '{oops' }, S), /not a CDH Accomplishment Report backup/);
  assert.throws(() => importFile({ name: 'b.json', text: '{"a":1}' }, S), /not a CDH Accomplishment Report backup/);
});
