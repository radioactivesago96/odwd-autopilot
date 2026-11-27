'use strict';
// The waits of a person typing, for the "Human" speed. Only the timing varies: the text is
// typed exactly as written, with no mistakes added.

const between = (random, low, high) => Math.round(low + random() * (high - low));
const needsShift = (c) => /[A-Z!@#$%^&*()_+{}|:"<>?~]/.test(c || '');

// keys[i] is the wait in milliseconds after character i; fields are the waits after the date,
// start time and end time.
function humanPace(text, random = Math.random) {
  const chars = Array.from(String(text));
  const keys = chars.map((c, i) => {
    const next = chars[i + 1];
    let ms = between(random, 90, 210);
    if (c === ' ') {
      ms += between(random, 30, 130);
      if (random() < 0.08) ms += between(random, 300, 900); // stops to think
    }
    if (/[,;:]/.test(c)) ms += between(random, 150, 350);
    if (c === '\n' || (/[.!?]/.test(c) && /^\s?$/.test(next || ''))) ms += between(random, 350, 800);
    if (needsShift(next)) ms += between(random, 40, 120);
    return ms;
  });
  const fields = [0, 1, 2].map(() => between(random, 500, 1100));
  return { keys, fields };
}

module.exports = { humanPace };
