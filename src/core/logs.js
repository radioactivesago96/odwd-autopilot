'use strict';
// What is already in the diary, and whether an entry would duplicate it.
//
// Nobody has confirmed where the site lists an entry that starts after midnight: under the date
// typed into it ("calendar") or under the date the duty began ("duty"). Night duties repeat the
// same times and wording every night, so guessing wrong would either skip an entry or send it
// twice. Until the app has seen one of its own saves appear, a match is only "possible".
const T = require('./time');
const { norm } = require('./import/shared');

const descKey = (text) => norm(text).slice(0, 60);
const UNREADABLE = 'The logs page could not be read, so duplicates cannot be checked. Nothing more was sent.';

// rows: cell texts of the Daily Logs table → [{ start, end, desc }]. Columns are found by their
// headings; anything unexpected is an error, never "nothing logged".
function rowsToLogs(rows) {
  if (!rows || !rows.length) return [];
  const heading = (name) => (cell) => new RegExp('^' + name + '$', 'i').test(cell.trim());
  const isStart = heading('start\\s*time');
  const isEnd = heading('end\\s*time');
  const at = rows.findIndex((cells) => cells.some(isStart) && cells.some(isEnd));
  if (at < 0) throw new Error(UNREADABLE);

  const header = rows[at];
  const startColumn = header.findIndex(isStart);
  const endColumn = header.findIndex(isEnd);
  const described = header.findIndex((cell) => /description/i.test(cell));

  const logs = [];
  for (const cells of rows.slice(at + 1)) {
    if (cells.length <= 1 || /^total/i.test(cells[0]) || cells.some(isStart)) continue;
    const start = T.parseClock(cells[startColumn]);
    const end = T.parseClock(cells[endColumn]);
    if (start === null || end === null) throw new Error(UNREADABLE);
    logs.push({ start, end, desc: descKey(cells[described >= 0 ? described : cells.length - 1]) });
  }
  return logs;
}

function datesToCheck(entries) {
  const dates = new Set();
  for (const e of entries) {
    dates.add(e.date);
    dates.add(e.dutyDate);
    dates.add(T.addDays(e.date, -1));
  }
  return [...dates].sort();
}

// Minutes since 1970 for the start of a calendar date.
const dayStart = (iso) => Date.parse(iso + 'T00:00:00Z') / 60000;

function interval(date, start, end) {
  const base = dayStart(date);
  return [base + start, base + (end <= start ? end + 1440 : end)];
}

function matchers(entry) {
  const start = T.parseClock(entry.start);
  const end = T.parseClock(entry.end);
  const times = (log) => log.start === start && log.end === end;
  const twin = (log) => times(log) && log.desc === descKey(entry.description);
  return { start, end, times, twin };
}

// 'logged' (it is there), 'possible' (it may be there) or 'new'.
function classify(entry, logsByDate, listing = '') {
  const { start, end, times, twin } = matchers(entry);
  const at = (date) => logsByDate[date] || [];
  const [from, to] = interval(entry.date, start, end);
  const overlaps = (date, logs) => logs.some((log) => {
    const [a, b] = interval(date, log.start, log.end);
    return from < b && a < to;
  });
  const overlapsCalendar = () => Object.entries(logsByDate).some(([date, logs]) => overlaps(date, logs));
  const afterMidnight = entry.date !== entry.dutyDate;

  if (!afterMidnight || listing === 'calendar') {
    if (at(entry.date).some(times)) return 'logged';
    return overlapsCalendar() ? 'possible' : 'new';
  }

  // Rows listed under the duty date whose early hours really belong to the following morning.
  const underDuty = at(entry.dutyDate);
  const movedOn = () => overlaps(T.addDays(entry.dutyDate, 1), underDuty.filter((log) => log.start < 720));

  if (listing === 'duty') {
    if (underDuty.some(twin)) return 'logged';
    return underDuty.some(times) || movedOn() || overlaps(entry.dutyDate, underDuty) ? 'possible' : 'new';
  }
  return at(entry.date).some(times) || underDuty.some(twin) || movedOn() || overlapsCalendar() ? 'possible' : 'new';
}

// After Save: only a row that was not there before proves the entry was stored. For an entry
// after midnight, where that row appears shows how the site lists such entries.
function confirmation(entry, before, after) {
  const { times, twin } = matchers(entry);
  const gained = (date, match) => (after[date] || []).filter(match).length > (before[date] || []).filter(match).length;
  const afterMidnight = entry.date !== entry.dutyDate;
  if (gained(entry.date, times)) return { saved: true, listing: afterMidnight ? 'calendar' : '' };
  if (afterMidnight && gained(entry.dutyDate, twin)) return { saved: true, listing: 'duty' };
  return { saved: false, listing: '' };
}

module.exports = { descKey, rowsToLogs, datesToCheck, classify, confirmation };
