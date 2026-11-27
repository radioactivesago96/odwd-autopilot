const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../src/core/duty');
const T = require('../src/core/time');
const { importFile } = require('../src/core/import');

const S = D.defaultSettings();
const later = new Date(2027, 5, 1);
const duty = (extra, shift = '11-7') => D.createDuty({ date: '2026-11-26', shift, ...extra }, S);
const rows = (d) => d.entries.map((e) => [T.hhmm(e.start), T.hhmm(e.end), D.describe(e)]);
const work = (d) => d.entries.filter((e) => e.kind === 'work');
const texts = (d) => work(d).map((e) => D.describe(e));

const sample = () => duty({ qc: true, cleaning: true, counts: { phleb: 3, hema: 5, chem: 4, micro: 3, ihomis: 6 } });

test('the night sample the user approved, exactly', () => {
  assert.deepEqual(rows(sample()), [
    ['22:30', '22:50', 'Timed in and prepared the laboratory work area.'],
    ['22:50', '23:00', 'Received endorsement from the outgoing staff. Reviewed pending requests, specimens, and analyzer status.'],
    ['23:00', '00:35', 'Ran daily QC on the Hematology and Chemistry analyzers.'],
    ['00:35', '02:10', 'Drew blood samples from 3 patients. Ran Hematology tests for 5 patients.'],
    ['02:10', '03:40', 'Performed Clinical Chemistry tests for 4 patients.'],
    ['03:40', '05:15', 'Examined urinalysis and fecalysis samples of 3 patients.'],
    ['05:15', '06:50', 'Encoded 6 charge slips in iHOMIS. Cleaned and disinfected the work area.'],
    ['06:50', '07:00', 'Endorsed pending requests, specimens, and analyzer status to the incoming staff.'],
    ['07:00', '07:15', 'Finished the remaining documentation and timed out.']
  ]);
  assert.deepEqual(sample().entries.map((e) => e.kind),
    ['prep', 'received', 'work', 'work', 'work', 'work', 'work', 'endorse', 'timeout']);
  assert.deepEqual(D.validate(sample(), later), []);
  const sent = D.siteEntries(sample());
  assert.ok(sent.every((e) => e.night));
  assert.deepEqual([sent[2].date, sent[3].date], ['2026-11-26', '2026-11-27']);
});

test('names and singular counts', () => {
  const d = duty({ counts: { hema: 1, ihomis: 1 }, from: 'Ms. Peña', to: 'Mr. Cruz.' }, '7-3');
  assert.equal(D.describe(d.entries[1]), 'Received endorsement from Ms. Peña. Reviewed pending requests, specimens, and analyzer status.');
  assert.deepEqual(texts(d), ['Ran Hematology tests for 1 patient.', 'Encoded 1 charge slip in iHOMIS.']);
  assert.equal(D.describe(d.entries[d.entries.length - 2]), 'Endorsed pending requests, specimens, and analyzer status to Mr. Cruz.');
});

test('no generated entry has more than two sentences, however busy the duty', () => {
  const counts = Object.fromEntries(['admission', 'phleb', 'hema', 'chem', 'electrolytes', 'immunoassay', 'crossmatch', 'micro', 'serology', 'ihomis'].map((k) => [k, 7]));
  const d = duty({
    counts, admissionTests: 'CBC; FBS; Urinalysis', qc: true, cleaning: true,
    routine: ['supplies', 'reagents', 'analyzer', 'workarea', 'logbooks', 'results'],
    otherTests: [{ name: 'Gram Stain', count: 2 }, { name: 'H. pylori', count: 1 }],
    extraLines: ['Attended the meeting with Dr. Cruz. Gave the report. Signed the attendance. Returned to work.']
  }, '7-3');
  for (const item of d.entries) assert.ok(D.splitSentences(D.describe(item)).length <= 2, D.describe(item));
  const all = texts(d).join(' ');
  assert.match(all, /Attended the meeting with Dr\. Cruz\. Gave the report\./);
  assert.match(all, /Signed the attendance\. Returned to work\./);
  assert.match(all, /Performed H\. pylori for 1 patient\./);
  assert.deepEqual(D.validate(d, later), []);
});

test('imported duties use the same format', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.csv'), 'utf8');
  const result = importFile({ name: 'sample.csv', text }, S);
  for (const d of result.duties) {
    assert.deepEqual([d.entries[0].kind, d.entries[1].kind], ['prep', 'received']);
    assert.deepEqual(d.entries.slice(-2).map((e) => e.kind), ['endorse', 'timeout']);
    for (const item of d.entries) {
      assert.ok(D.splitSentences(D.describe(item)).length <= 2, D.describe(item));
      assert.doesNotMatch(D.describe(item), /•|\n|\{/);
    }
    assert.deepEqual(D.validate(d, later), []);
  }
});

test('routine tasks appear only when switched on', () => {
  const plain = texts(duty({ counts: { hema: 2 } })).join(' ');
  assert.doesNotMatch(plain, /supplies|reagent|analyzer|workstation|logbook|results|QC|Cleaned/i);
  assert.deepEqual(texts(duty({ counts: {}, routine: ['reagents', 'supplies'] })),
    ['Checked and arranged the laboratory supplies. Checked reagent levels and expiry dates.']);
});

test('Write entries uses the next phrasing in order and keeps times and counts', () => {
  const first = sample();
  const second = D.rewrite(first, S);
  assert.deepEqual(second.entries.map((e) => [e.start, e.end]), first.entries.map((e) => [e.start, e.end]));
  assert.equal(D.describe(second.entries[0]), 'Timed in, set up the work area, and readied the materials for the shift.');
  assert.equal(D.describe(second.entries[3]), 'Performed phlebotomy for 3 patients. Performed Hematology tests for 5 patients.');
  assert.deepEqual(D.rewrite(first, S), second, 'nothing is random');
  let again = first;
  for (let i = 0; i < 6; i++) again = D.rewrite(again, S);
  assert.equal(D.describe(again.entries[0]), D.describe(first.entries[0]), 'the phrasings go round');
});

test('Rewrite changes one entry; the duty button leaves hand-written text alone', () => {
  let d = sample();
  const one = D.rewrite(d, S, d.entries[3].id);
  assert.equal(D.describe(one.entries[0]), D.describe(d.entries[0]));
  assert.notEqual(D.describe(one.entries[3]), D.describe(d.entries[3]));
  d = D.setText(d, d.entries[0].id, 'My own words.');
  assert.equal(D.describe(D.rewrite(d, S).entries[0]), 'My own words.');
  assert.equal(D.canRewrite(sample().entries[3], S.wording), true);
  assert.equal(D.canRewrite(duty({ counts: { admission: 2 } }).entries[2], S.wording), false);
});

test('a count is spread only by the amount the user types', () => {
  let d = sample();
  const [blood, chem] = [work(d)[1], work(d)[2]];
  d = D.splitCount(d, blood.id, 'hema', 2, chem.id, S);
  assert.equal(D.describe(work(d)[1]), 'Drew blood samples from 3 patients. Ran Hematology tests for 3 patients.');
  assert.match(D.describe(work(d)[2]), /Hematology tests for 2 patients\./);
  assert.match(D.describe(work(d)[2]), /Clinical Chemistry tests for 4 patients\./);
  assert.deepEqual(d.activities.splits, { hema: [3, 2] });
  assert.equal(d.activities.counts.hema, 5);

  // Kept through a rewrite and a re-plan.
  assert.match(texts(D.rewrite(d, S)).join(' '), /Hematology[^.]* 3 patients\..*Hematology[^.]* 2 patients\./);
  assert.match(texts(D.resetTimes(d, S)).join(' '), /Hematology[^.]* 3 patients\..*Hematology[^.]* 2 patients\./);

  // Moving the part back joins it again.
  const moved = D.moveLine(d, 'hema#1', blood.id, S);
  assert.match(D.describe(work(moved)[1]), /Hematology tests for 5 patients\./);
  assert.equal(moved.activities.splits.hema, undefined);

  // A new total replaces the split.
  const changed = D.updateActivities(d, { counts: { ...d.activities.counts, hema: 9 } }, S);
  const all = texts(changed).join(' ');
  assert.equal(all.match(/Hematology (tests|requests)/g).length, 1);
  assert.match(all, /for 9 patients/);
});

test('a split that is not possible is refused', () => {
  const d = sample();
  const [qc, blood, chem] = work(d);
  for (const amount of [0, 5, 6, 1.5, NaN]) assert.throws(() => D.splitCount(d, blood.id, 'hema', amount, chem.id, S), /1 to 4/);
  assert.throws(() => D.splitCount(d, qc.id, 'qc', 1, chem.id, S), /no count/);
  const edited = D.setText(d, chem.id, 'Mine.');
  assert.throws(() => D.splitCount(edited, blood.id, 'hema', 2, chem.id, S), /automatic text/);
});

test('an added activity never overfills an interval', () => {
  let d = sample();
  d = D.updateActivities(d, { routine: ['supplies', 'reagents', 'analyzer'], counts: { ...d.activities.counts, electrolytes: 1, serology: 2 } }, S);
  for (const item of d.entries) assert.ok(D.splitSentences(D.describe(item)).length <= 2, D.describe(item));
  const all = texts(d).join(' ');
  for (const word of [/supplies/i, /reagent/i, /analyzers? and equipment/i, /electrolyte/i, /Serology/]) assert.match(all, word);
  assert.deepEqual(D.validate(d, later), []);
});

test('a duty from an older version changes only when asked, then uses the new format', () => {
  const old = {
    id: 'o', date: '2026-11-26', shift: '7-3', start: 420, end: 900, selected: true, activities: { counts: { hema: 2 } },
    entries: [
      { id: 'a', kind: 'prep', start: 405, end: 420, text: null, lines: [{ key: 'prep', text: 'Prepared.' }] },
      { id: 'b', kind: 'work', start: 420, end: 890, text: null, lines: [{ key: 'hema', text: 'Old line.' }] },
      { id: 'c', kind: 'endorse', start: 890, end: 915, text: null, lines: [{ key: 'endorse', text: 'Endorsed.' }] }
    ]
  };
  assert.equal(D.describe(old.entries[1]), 'Old line.');
  for (const next of [D.rewrite(old, S), D.updateActivities(old, { counts: { hema: 3 } }, S), D.resetTimes(old, S)]) {
    assert.deepEqual(next.entries.map((e) => e.kind), ['prep', 'received', 'work', 'endorse', 'timeout']);
    assert.match(D.describe(next.entries[2]), /Hematology/);
  }
});

test('re-planning keeps the two parts of a split count in separate entries', () => {
  let d = duty({ counts: { hema: 5, chem: 4 } });
  const [hema, chem] = work(d);
  d = D.splitCount(d, hema.id, 'hema', 2, chem.id, S);
  const planned = D.resetTimes(d, S);
  assert.deepEqual(work(planned).map((e) => e.lines.map((l) => l.key).join(' ')), ['hema', 'hema#1', 'chem']);
});
