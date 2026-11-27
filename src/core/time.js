'use strict';
// Clock and date arithmetic. "Minutes" are counted from midnight and may fall outside one day.

const pad = (n) => String(n).padStart(2, '0');

function parseClock(text) {
  const match = String(text == null ? '' : text).trim().toUpperCase().match(/^(\d{1,2})(?::(\d{2})(?::\d{2})?)?\s*(AM|PM)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3] === 'PM' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

const ofDay = (minutes) => ((minutes % 1440) + 1440) % 1440;

function hhmm(minutes) {
  const m = ofDay(minutes);
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

function time12(minutes) {
  const m = ofDay(minutes);
  const hour = Math.floor(m / 60);
  return (hour % 12 || 12) + ':' + pad(m % 60) + ' ' + (hour >= 12 ? 'PM' : 'AM');
}

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
}

// The reading of a clock time (on any day) that lies closest to `near`.
function resolveMinute(clock, near) {
  let best = null;
  for (let k = -1; k <= 2; k++) {
    const candidate = ofDay(clock) + k * 1440;
    if (best === null || Math.abs(candidate - near) < Math.abs(best - near)) best = candidate;
  }
  return best;
}

module.exports = { pad, parseClock, hhmm, time12, addDays, resolveMinute };
