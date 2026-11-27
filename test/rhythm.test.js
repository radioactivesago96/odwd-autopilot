const test = require('node:test');
const assert = require('node:assert/strict');
const { humanPace } = require('../src/core/rhythm');

const steady = () => 0.5;
// A fixed series of numbers between 0 and 1, so the test gives the same result every time.
const series = () => { let n = 7; return () => { n = (n * 16807) % 2147483647; return n / 2147483647; }; };

const SENTENCE = 'Drew blood samples from 3 patients. Ran Hematology tests for 5 patients.';

test('every key and every field has its own wait', () => {
  const pace = humanPace(SENTENCE, series());
  assert.equal(pace.keys.length, SENTENCE.length);
  assert.equal(pace.fields.length, 3);
  for (const ms of pace.keys) assert.ok(Number.isInteger(ms) && ms >= 60 && ms <= 2000, String(ms));
  for (const ms of pace.fields) assert.ok(Number.isInteger(ms) && ms >= 400 && ms <= 1500, String(ms));
});

test('the rhythm is uneven', () => {
  assert.ok(new Set(humanPace(SENTENCE, series()).keys).size > 20);
  assert.notDeepEqual(humanPace(SENTENCE).keys, humanPace(SENTENCE).keys);
});

test('it pauses after words, commas, sentences and lines', () => {
  const text = 'ab cd, ef. gh 7.5 ij\nkl';
  const { keys } = humanPace(text, steady);
  const after = (piece) => keys[text.indexOf(piece) + piece.length - 1];
  const letter = keys[0];
  assert.ok(after('ab ') > letter);
  assert.ok(after('cd,') >= letter + 150);
  assert.ok(after('ef.') >= letter + 350);
  assert.ok(after('ij\n') >= letter + 350);
  assert.equal(after('7.'), letter, 'a decimal point is not the end of a sentence');
});

test('a capital letter takes a little longer to reach', () => {
  const { keys } = humanPace('abCd', steady);
  assert.ok(keys[1] > keys[0], 'the wait before the capital includes the Shift key');
  assert.equal(keys[2], keys[0]);
});

test('the overall speed is that of a person', () => {
  const { keys } = humanPace(SENTENCE.repeat(5), series());
  const average = keys.reduce((a, b) => a + b, 0) / keys.length;
  assert.ok(average > 150 && average < 260, String(average));
});

test('a character made of two code units is one key', () => {
  assert.equal(humanPace('a😀b', steady).keys.length, 3);
});
