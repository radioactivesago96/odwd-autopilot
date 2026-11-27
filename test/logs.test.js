const test = require('node:test');
const assert = require('node:assert/strict');
const { rowsToLogs, classify, confirmation, datesToCheck } = require('../src/core/logs');

const HEADER = ['Start Time', 'End Time', 'Time Spent', 'Task Description'];
// The 6:50 AM endorsement of the night duty of 31 December.
const e = { date: '2027-01-01', dutyDate: '2026-12-31', start: '06:50', end: '07:15', night: true, description: 'Endorsed all.' };
const day = { date: '2027-01-01', dutyDate: '2027-01-01', start: '06:50', end: '07:15', night: false, description: 'Endorsed all.' };
const row = (a, b, t = 'Endorsed all.') => rowsToLogs([HEADER, [a, b, '25 min', t]]);
const same = row('06:50 AM', '07:15 AM');

test('an ordinary entry with the same date, start and end is logged', () => {
  assert.equal(classify(day, { '2027-01-01': row('06:50 AM', '07:15 AM', 'other text') }), 'logged');
});

test('calendar listing: only the typed date counts', () => {
  assert.equal(classify(e, { '2027-01-01': same }, 'calendar'), 'logged');
  assert.equal(classify(e, { '2026-12-31': same }, 'calendar'), 'new', "the previous night's identical entry is not this one");
  assert.equal(classify(e, { '2027-01-01': row('06:50 AM', '07:10 AM') }, 'calendar'), 'possible');
});

test('duty-date listing: only the duty date counts, and a changed time is a possible duplicate', () => {
  assert.equal(classify(e, { '2026-12-31': same }, 'duty'), 'logged');
  assert.equal(classify(e, { '2026-12-31': row('06:50 AM', '07:15 AM', 'different') }, 'duty'), 'possible');
  assert.equal(classify({ ...e, end: '07:20' }, { '2026-12-31': same }, 'duty'), 'possible');
  assert.equal(classify(e, { '2027-01-01': same }, 'duty'), 'new', "the next night's identical entry is not this one");
});

test('listing not known yet: a match on either date is only a possible duplicate', () => {
  assert.equal(classify(e, { '2027-01-01': same }), 'possible');
  assert.equal(classify(e, { '2026-12-31': same }), 'possible');
  assert.equal(classify({ ...e, end: '07:20' }, { '2026-12-31': same }), 'possible');
  assert.equal(classify(e, { '2026-12-31': row('10:45 PM', '11:00 PM') }), 'new');
});

test('a long row over midnight overlaps, touching rows do not', () => {
  assert.equal(classify(e, { '2026-12-31': row('10:45 PM', '07:15 AM') }, 'calendar'), 'possible');
  assert.equal(classify(day, { '2027-01-01': row('07:15 AM', '08:00 AM') }), 'new');
  assert.equal(classify(day, {}), 'new');
});

test('a save is confirmed only by a new row, and shows where the site lists it', () => {
  const none = { '2026-12-31': [], '2027-01-01': [] };
  assert.deepEqual(confirmation(e, none, { ...none, '2027-01-01': same }), { saved: true, listing: 'calendar' });
  assert.deepEqual(confirmation(e, none, { ...none, '2026-12-31': same }), { saved: true, listing: 'duty' });
  assert.deepEqual(confirmation(day, none, { ...none, '2027-01-01': same }), { saved: true, listing: '' });
  const old = { ...none, '2026-12-31': same };
  assert.equal(confirmation(e, old, old).saved, false, 'a row that was there before proves nothing');
});

test('description compare ignores spacing, case and punctuation', () => {
  const long = { ...e, description: '• Performed Hematology - 3 patients processed.\n• Laboratory Cleaning done.' };
  const seen = row('06:50 AM', '07:15 AM', '• Performed Hematology - 3 patients processed. • Laboratory Cleaning done.');
  assert.equal(classify(long, { '2026-12-31': seen }, 'duty'), 'logged');
});

test('columns are found by their headings', () => {
  assert.deepEqual(rowsToLogs([['#', 'Date', 'Start Time', 'End Time', 'Task Description', 'Action'], ['1', 'x', '22:45:00', '07:15:00', 'Done.', 'Edit']]),
    [{ start: 1365, end: 435, desc: 'done' }]);
  assert.deepEqual(rowsToLogs([HEADER, ['10:45 PM', '07:15 AM', 'x', 'Done.'], ['Total Time Spent', '8 hr 30 min']]),
    [{ start: 1365, end: 435, desc: 'done' }]);
  assert.deepEqual(rowsToLogs([]), []);
});

test('a logs table that cannot be understood is an error, never "nothing logged"', () => {
  assert.throws(() => rowsToLogs([['From', 'Until', 'Task'], ['10:45 PM', '07:15 AM', 'x']]), /logs page could not be read/);
  assert.throws(() => rowsToLogs([HEADER, ['late', '07:15 AM', 'x', 'Done.']]), /logs page could not be read/);
});

test('dates to check cover the entry, the duty and the day before', () => {
  assert.deepEqual(datesToCheck([e]), ['2026-12-31', '2027-01-01']);
  assert.deepEqual(datesToCheck([{ date: '2026-03-01', dutyDate: '2026-03-01' }]), ['2026-02-28', '2026-03-01']);
});
