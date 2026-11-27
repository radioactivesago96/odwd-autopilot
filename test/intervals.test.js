const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/duty');

const S = D.defaultSettings();
const duty = (extra, shift = '3-11') => D.createDuty({ date: '2026-11-26', shift, ...extra }, S);
const work = (d) => d.entries.filter((e) => e.kind === 'work');
const keys = (d) => work(d).map((e) => e.lines.map((l) => l.key).join(' '));
const plan = (d) => work(d).map((e) => [e.start, e.end, e.lines.map((l) => l.key).join(' ')]);
const text = (d) => work(d).map((e) => D.describe(e));
const later = new Date(2027, 5, 1);

const full = () => duty({
  admissionTests: 'CBC; FBS', qc: true, cleaning: true,
  counts: { admission: 3, hema: 5, chem: 4, micro: 2, serology: 1, ihomis: 6 }
});

test('the shift is shared among the work done, QC and new admissions first', () => {
  assert.deepEqual(plan(full()), [
    [900, 965, 'qc'],
    [965, 1035, 'admission-cbc'],
    [1035, 1100, 'admission-chem'],
    [1100, 1170, 'hema'],
    [1170, 1235, 'chem'],
    [1235, 1305, 'micro serology'],
    [1305, 1370, 'ihomis cleaning']
  ]);
  assert.deepEqual(D.validate(full(), later), []);
});

test('each count appears once, in full', () => {
  const all = text(full()).join(' ');
  assert.equal(all.match(/ for 5 patients/g).length, 1);
  assert.equal(all.match(/ for 4 patients/g).length, 1);
});

test('the same data always gives the same times and words', () => {
  assert.deepEqual(plan(full()), plan(full()));
  assert.deepEqual(text(full()), text(full()));
});

test('new admissions: CBC first, then the chemistry tests', () => {
  const d = duty({ counts: { admission: 3 }, admissionTests: 'FBS; CBC; Creatinine' });
  assert.deepEqual(text(d), [
    'Performed CBC for 3 newly admitted patients.',
    'Performed chemistry tests (FBS, Creatinine) for 3 newly admitted patients.'
  ]);
});

test('other admission tests join the second interval', () => {
  const d = duty({ counts: { admission: 1 }, admissionTests: 'CBC, Urinalysis, Na' });
  assert.deepEqual(text(d), [
    'Performed CBC for 1 newly admitted patient.',
    'Performed chemistry tests (Na) for 1 newly admitted patient. Performed Urinalysis for 1 newly admitted patient.'
  ]);
});

test('only listed tests are written; with none listed, only the CBC', () => {
  assert.deepEqual(text(duty({ counts: { admission: 2 } })), ['Performed CBC for 2 newly admitted patients.']);
  assert.deepEqual(text(duty({ counts: { admission: 2 }, admissionTests: 'Creatinine; Sodium' })),
    ['Performed chemistry tests (Creatinine, Sodium) for 2 newly admitted patients.']);
});

test('night and 12-hour duties follow the same pattern', () => {
  for (const shift of ['11-7', '7p-7a', '7-3']) {
    const d = duty({ counts: { hema: 1, chem: 1, micro: 1 } }, shift);
    const w = work(d);
    assert.equal(w.length, 3);
    assert.equal(w[0].start, d.start);
    assert.equal(w[2].end, d.end - 10);
    for (let i = 1; i < w.length; i++) assert.equal(w[i].start, w[i - 1].end);
    assert.ok(w.every((e) => e.start % 5 === 0));
  }
});

test('a duty too short for 5 minutes each puts the rest together', () => {
  const d = D.createDuty({ date: '2026-11-26', shift: 'custom', start: 420, end: 440, counts: { phleb: 1, chem: 1, micro: 1 } }, S);
  assert.equal(work(d).length, 2); // 10 minutes of work
  assert.deepEqual(keys(d), ['phleb', 'chem micro']);
  assert.deepEqual(D.validate(d, later), []);
});

test('a duty with no activities has one empty work entry to fill in', () => {
  const d = duty({ counts: {} });
  assert.equal(work(d).length, 1);
  assert.ok(D.validate(d, later).some((p) => p.code === 'empty'));
});

test('an added activity joins its own group', () => {
  let d = duty({ counts: { chem: 1, micro: 1 } });
  d = D.updateActivities(d, { counts: { chem: 1, micro: 1, serology: 2, electrolytes: 1 } }, S);
  assert.deepEqual(keys(d), ['chem electrolytes', 'micro serology']);
});

test('when there is no room, an interval is cut in half for the new line', () => {
  let d = duty({ counts: { chem: 1, electrolytes: 1 } });
  d = D.updateActivities(d, { counts: { chem: 1, electrolytes: 1, hema: 2 } }, S);
  assert.deepEqual(plan(d), [[900, 1135, 'chem electrolytes'], [1135, 1370, 'hema']]);
});

test('an interval left empty is removed and its time goes to the one before', () => {
  let d = duty({ counts: { hema: 1, chem: 1, micro: 1 } });
  const before = work(d);
  d = D.updateActivities(d, { counts: { hema: 1, micro: 1 } }, S);
  assert.deepEqual(plan(d), [[before[0].start, before[1].end, 'hema'], [before[2].start, before[2].end, 'micro']]);
});

test('re-planning shares the time again, with a new id for every work entry', () => {
  let d = full();
  const old = new Set(work(d).map((e) => e.id));
  d = D.setTimes(d, d.entries[2].id, '15:00', '15:30');
  d = D.resetTimes(d, S);
  assert.deepEqual(plan(d), plan(full()));
  assert.ok(work(d).every((e) => !old.has(e.id)));
  assert.equal(new Set(d.entries.map((e) => e.id)).size, d.entries.length);
});
