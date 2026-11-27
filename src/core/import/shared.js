'use strict';
// Parsing helpers shared by the three readers (ported from the CDH Diary Importer userscript).
const T = require('../time');
const { SHIFTS } = require('../duty');

const norm = (value) => String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');

function joinList(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return list[0] + ' and ' + list[1];
  return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
}

// "Ms. Reyes; Ms. Santos" → "Ms. Reyes and Ms. Santos"
const joinNames = (value) => joinList(String(value || '').split(/\s*(?:;|\/|\||&|\band\b)\s*/i).map((s) => s.trim()));

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function parseDateValue(value) {
  const s = String(value || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + T.pad(+m[2]) + '-' + T.pad(+m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return m[3] + '-' + T.pad(+m[1]) + '-' + T.pad(+m[2]);
  if ((m = s.match(/^([A-Za-z]+)\.?\s*(\d{1,2})\s*,?\s*(\d{4})$/))) {
    const index = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3)));
    if (index >= 0) return m[3] + '-' + T.pad(index + 1) + '-' + T.pad(+m[2]);
  }
  return null;
}

const SHIFT_CODES = { 73: '7-3', 311: '3-11', 117: '11-7', 37: '3p-7a', 711: '7a-11p' };
const CLOCK = '(\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM))';
const RANGE = new RegExp('^' + CLOCK + '\\s*(?:-|TO)\\s*' + CLOCK + '$', 'i');

// "7 PM – 7 AM" → {shift:'7p-7a'}; another single pair → custom; split shifts and the rest → null.
function parseShift(value) {
  const text = String(value || '').replace(/\([^)]*\)/g, '').replace(/[–—]/g, '-').replace(/\b([ap])\.m\./gi, '$1M').trim();
  if (/^[\d\s-]+$/.test(text)) {
    const code = SHIFT_CODES[norm(text).replace(/^0/, '')];
    return code ? { shift: code } : null;
  }
  const match = text.match(RANGE);
  if (!match) return null;
  const start = T.parseClock(match[1]);
  const end = T.parseClock(match[2]);
  if (start === null || end === null) return null;
  const total = end <= start ? end + 1440 : end;
  const key = Object.keys(SHIFTS).find((k) => SHIFTS[k].start === start && SHIFTS[k].end === total);
  return key ? { shift: key } : { shift: 'custom', start, end };
}

function parseCount(value) {
  const n = parseInt(String(value == null ? '' : value).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const parseBool = (value) => /^(y|yes|true|1|x|✓|done|completed|achieved)$/i.test(String(value || '').trim());

function sentence(text) {
  let t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(t) ? t : t + '.';
}

const blankInput = () => ({ counts: {}, admissionTests: '', qc: false, cleaning: false, otherTests: [], extraLines: [], from: '', to: '' });

const hasWork = (input) => Object.values(input.counts).some((n) => n > 0) || input.qc || input.cleaning ||
  input.otherTests.length > 0 || input.extraLines.length > 0;

// A finished row: either a duty the app can build, or the reason it is skipped.
const result = (source, date, input) => (hasWork(input)
  ? { source, date, input: { ...input, date } }
  : { source, date, skip: 'no activities recorded' });

module.exports = { norm, joinNames, parseDateValue, parseShift, parseCount, parseBool, sentence, blankInput, result };
