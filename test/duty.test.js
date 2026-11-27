const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/core/time');
const D = require('../src/core/duty');

const S = D.defaultSettings();
const night = (date = '2026-11-26') => D.createDuty({ date, shift: '11-7', counts: { hema: 10 } }, S);
// Two lines that belong to the same interval.
const pair = () => D.createDuty({ date: '2026-11-26', shift: '11-7', counts: { chem: 10, electrolytes: 2 } }, S);
const times = (d) => d.entries.map((e) => [e.kind, e.start, e.end]);
const work = (d) => d.entries.filter((e) => e.kind === 'work');
const later = new Date(2027, 5, 1);

test('clock parsing and formatting', () => {
  assert.equal(T.parseClock('22:45'), 1365);
  assert.equal(T.parseClock('10:45 PM'), 1365);
  assert.equal(T.parseClock('12 AM'), 0);
  assert.equal(T.parseClock('25:00'), null);
  assert.equal(T.hhmm(1850), '06:50');
  assert.equal(T.time12(1365), '10:45 PM');
  assert.equal(T.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(T.resolveMinute(410, 1850), 1850);
});

test('11-7 default entries', () => {
  assert.deepEqual(times(night()),
    [['prep', 1350, 1370], ['received', 1370, 1380], ['work', 1380, 1850], ['endorse', 1850, 1860], ['timeout', 1860, 1875]]);
  assert.equal(D.describe(pair().entries[2]),
    'Performed Clinical Chemistry tests for 10 patients. Ran electrolyte tests (Na, K, Ca) for 2 patients.');
});

test('a 12-hour duty stays 12 hours, with the usual names when none are given', () => {
  const d = D.createDuty({ date: '2026-11-26', shift: '7p-7a', counts: { hema: 1 } }, S);
  assert.match(D.describe(d.entries[1]), /from the outgoing staff\./);
  assert.match(D.describe(d.entries[3]), /to the incoming staff\.$/);
  assert.equal(d.end - d.start, 720);
});

test('all activity lines in order with exact wording', () => {
  const d = D.createDuty({
    date: '2026-11-26', shift: '7-3', admissionTests: 'CBC; FBS', qc: true, cleaning: true,
    counts: { ihomis: 4, phleb: 3, admission: 2, hema: 0 },
    otherTests: [{ name: 'Gram Stain', count: 1 }], extraLines: ['Attended the staff meeting'], from: 'Ms. Peña'
  }, S);
  assert.deepEqual(work(d).flatMap((e) => e.lines.map((l) => l.text)), [
    'Ran daily QC on the Hematology and Chemistry analyzers.',
    'Performed CBC for 2 newly admitted patients.',
    'Performed chemistry tests (FBS) for 2 newly admitted patients.',
    'Drew blood samples from 3 patients.',
    'Performed Gram Stain for 1 patient.',
    'Attended the staff meeting.',
    'Encoded 4 charge slips in iHOMIS.',
    'Cleaned and disinfected the work area.'
  ]);
  assert.equal(D.describe(d.entries[1]), 'Received endorsement from Ms. Peña. Reviewed pending requests, specimens, and analyzer status.');
});

test('year rollover and night flag', () => {
  const s = D.siteEntries(night('2026-12-31'));
  assert.deepEqual(s.map((e) => [e.date, e.start, e.end, e.night]), [
    ['2026-12-31', '22:30', '22:50', true], ['2026-12-31', '22:50', '23:00', true], ['2026-12-31', '23:00', '06:50', true],
    ['2027-01-01', '06:50', '07:00', true], ['2027-01-01', '07:00', '07:15', true]
  ]);
  assert.equal(s[4].dutyDate, '2026-12-31');
  assert.equal(D.siteEntries(D.createDuty({ date: '2026-11-26', shift: '7-3', counts: { hema: 1 } }, S))[0].night, false);
});

test('custom shift crossing midnight', () => {
  const d = D.createDuty({ date: '2026-11-26', shift: 'custom', start: 1200, end: 240, counts: { hema: 1 } }, S);
  assert.equal(d.end, 1680);
});

test('chosen end time', () => {
  const d = night();
  assert.equal(D.setTimes(d, d.entries[4].id, '07:00', '07:20').entries[4].end, 1880);
  assert.equal(d.entries[4].end, 1875, 'original duty is not changed');
});

test('timeIn and timeOut from data are used exactly', () => {
  const d = D.createDuty({ date: '2026-11-26', shift: '11-7', counts: { hema: 1 }, timeIn: 1341, timeOut: 437 }, S);
  assert.equal(d.entries[0].start, 1341);
  assert.equal(d.entries[4].end, 1877);
  assert.deepEqual(D.validate(d, later), []);
});

test('late timeIn and early timeOut keep entries in order', () => {
  const d = D.createDuty({ date: '2026-11-26', shift: '7-3', counts: { hema: 1 }, timeIn: 430, timeOut: 880 }, S);
  assert.deepEqual(times(d),
    [['prep', 430, 435], ['received', 435, 440], ['work', 440, 870], ['endorse', 870, 875], ['timeout', 875, 880]]);
  assert.deepEqual(D.validate(d, later), []);
});

test('a very small early start or late finish still gives proper entries', () => {
  const d = D.createDuty({ date: '2026-11-26', shift: '7-3', counts: { hema: 1 } }, { ...S, minutesEarly: 0, endAfter: 0 });
  assert.deepEqual(times(d),
    [['prep', 405, 410], ['received', 410, 420], ['work', 420, 890], ['endorse', 890, 900], ['timeout', 900, 905]]);
});

test('split at midnight and move a line', () => {
  let d = pair();
  d = D.splitWork(d, d.entries[2].id, 1440);
  assert.deepEqual(times(d).slice(2, 4), [['work', 1380, 1440], ['work', 1440, 1850]]);
  assert.ok(D.validate(d, later).some((p) => p.code === 'empty'));
  d = D.moveLine(d, 'chem', d.entries[3].id);
  assert.deepEqual(D.validate(d, later), []);
  assert.equal(D.siteEntries(d)[3].date, '2026-11-27');
});

test('empty work entry can be removed and its time returns to the one before', () => {
  let d = night();
  d = D.splitWork(d, d.entries[2].id, 1440);
  d = D.removeEmptyWork(d, d.entries[3].id);
  assert.deepEqual(times(d), times(night()));
});

test('future, order and overlap are reported', () => {
  const codes = (d, now) => D.validate(d, now).map((p) => p.code);
  assert.deepEqual(codes(night(), new Date(2026, 10, 26, 23, 30)), ['future', 'future', 'future']);
  const d = night();
  assert.ok(codes(D.setTimes(d, d.entries[3].id, '06:50', '06:40'), later).includes('order'));
  assert.ok(codes(D.setTimes(d, d.entries[3].id, '06:00', '07:00'), later).includes('overlap'));
  assert.ok(codes(D.setText(d, d.entries[0].id, '  '), later).includes('empty'));
});

test('updating counts keeps times and edited text', () => {
  let d = night();
  d = D.setTimes(d, d.entries[4].id, '07:00', '07:10');
  d = D.setText(d, d.entries[0].id, 'My prep.');
  d = D.updateActivities(d, { counts: { hema: 12 } }, S);
  assert.equal(d.entries[4].end, 1870);
  assert.equal(D.describe(d.entries[0]), 'My prep.');
  assert.match(D.describe(d.entries[2]), /12 patients/);
});

test('updating keeps moved lines and drops removed ones', () => {
  let d = pair();
  d = D.splitWork(d, d.entries[2].id, 1440);
  d = D.moveLine(d, 'chem', d.entries[3].id);
  d = D.updateActivities(d, { counts: { chem: 11, electrolytes: 2 }, from: 'Ana' }, S);
  assert.deepEqual(d.entries[2].lines.map((l) => l.key), ['electrolytes']);
  assert.deepEqual(d.entries[3].lines.map((l) => l.key), ['chem']);
  assert.match(D.describe(d.entries[3]), /11 patients/);
  assert.match(D.describe(d.entries[1]), /from Ana\./);
});

test('reset times restores defaults and a single work entry', () => {
  let d = night();
  d = D.splitWork(d, d.entries[2].id, 1440);
  d = D.setTimes(d, d.entries[5].id, '07:00', '07:30');
  assert.deepEqual(times(D.resetTimes(d, S)), times(night()));
});

test('an entry that crosses midnight ticks the night box for the whole duty', () => {
  let d = D.createDuty({ date: '2026-11-26', shift: '3-11', counts: { hema: 1 } }, S);
  assert.equal(D.siteEntries(d)[0].night, false);
  d = D.setTimes(d, d.entries[4].id, '23:00', '00:10');
  assert.ok(D.siteEntries(d).every((e) => e.night));
});

test('changing times withdraws "send it anyway"', () => {
  const allow = (d) => ({ ...d, entries: d.entries.map((e) => ({ ...e, allowPossible: true })) });
  let d = allow(night());
  assert.equal(D.setTimes(d, d.entries[4].id, '07:00', '07:30').entries[4].allowPossible, false);
  d = D.splitWork(d, d.entries[2].id, 1440);
  assert.deepEqual(d.entries.slice(2, 4).map((e) => e.allowPossible), [false, false]);
});

test('reset times keeps the "not confirmed" mark', () => {
  const d = night();
  const marked = { ...d, entries: d.entries.map((e, i) => ({ ...e, unconfirmed: i === 2 })) };
  assert.deepEqual(D.resetTimes(marked, S).entries.map((e) => !!e.unconfirmed), [false, false, true, false, false]);
});
