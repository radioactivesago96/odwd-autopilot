'use strict';
// Sends entries to the diary one at a time through a driver. It never presses Save twice
// for one entry: after anything unclear it stops, and the next run reads the logs first.
const T = require('./time');
const { rowsToLogs, datesToCheck, classify, confirmation } = require('./logs');

const LOGGED_OUT = 'You are logged out of the site. Log in, then try again.';
const CONFIRM_MS = 20000;
const PRESSED = 'You pressed Save, or left the page, while the app was working on this entry. ' +
  'Check it on the site before sending it again.';

const label = (item) => item.date + ' ' + T.time12(T.parseClock(item.start)) + ' – ' + T.time12(T.parseClock(item.end));

function endsAt(item) {
  const [year, month, day] = item.date.split('-').map(Number);
  const start = T.parseClock(item.start);
  const end = T.parseClock(item.end);
  return new Date(year, month - 1, day, 0, end <= start ? end + 1440 : end);
}

class Stop extends Error {}

// onHold(item, true) marks an entry whose Save may have reached the site; false removes the mark.
function createRunner({ driver, items, now, msPerChar, gapMs, sleep, onEvent, listing = '', onListing = () => {}, onHold = () => {} }) {
  let nightListing = listing;
  let typedKey = null;
  let paused = false;
  let stopped = false;
  let pauses = 0;
  let wake = null;
  let started = false;
  const report = { state: 'done', saved: [], skipped: [], missing: [], message: '' };

  const emit = (type, index, extra = {}) => onEvent({ type, index, total: items.length, ...extra });

  const halt = () => { if (stopped) throw new Stop('Stopped by you.'); };

  async function logsFor(list) {
    const raw = await driver.readLogs(datesToCheck(list));
    return Object.fromEntries(Object.entries(raw).map(([date, rows]) => [date, rowsToLogs(rows)]));
  }

  async function waitWhilePaused(index) {
    while (paused && !stopped) {
      emit('paused', index);
      await new Promise((resolve) => { wake = resolve; });
    }
    halt();
  }

  // Resolves to 'saved', 'skipped', or 'retry' when a pause interrupted before Save.
  async function send(item, index, mode) {
    const key = item.key;
    // Typing the same entry again after a pause: not if Save was pressed in the meantime.
    if (typedKey === key && (await driver.savePressed())) {
      onHold(item, true);
      throw new Stop(PRESSED);
    }
    const page = await driver.probe();
    if (!page.ok) {
      throw new Stop(page.loggedOut ? LOGGED_OUT
        : 'The diary form is not complete on this page. Missing: ' + page.missing.join(', ') + '. Open the Dashboard.');
    }
    emit('checking', index, { key });
    const before = await logsFor([item]);
    const status = classify(item, before, nightListing);
    let reason = '';
    if (status === 'logged') {
      reason = 'logged';
      if (item.unconfirmed) onHold(item, false);
    } else if (!item.allowPossible) {
      if (item.unconfirmed) reason = 'unconfirmed';
      else if (status === 'possible') reason = 'possible';
    }
    if (reason) {
      report.skipped.push({ key, reason });
      emit('skipped', index, { key, message: reason });
      return 'skipped';
    }
    if (endsAt(item) > now()) throw new Stop(label(item) + ' has not ended yet.');

    halt();
    if (paused) return 'retry';
    const pausesBefore = pauses;
    const interrupted = () => { halt(); return paused || pauses !== pausesBefore; };

    emit('typing', index, { key });
    typedKey = key;
    const typed = await driver.fill(item, msPerChar);
    if (typed === 'user-saved') {
      onHold(item, true);
      throw new Stop(PRESSED);
    }
    if (interrupted()) return 'retry';
    if (!typed) throw new Stop('Typing was interrupted at ' + label(item) + '.');
    if (!(await driver.matches(item))) throw new Stop('The form did not keep the typed values for ' + label(item) + '.');
    if (interrupted()) return 'retry';

    // Marked before Save, so that even a crash cannot lead to a silent second send.
    onHold(item, true);
    let outcome;
    if (mode === 'auto') {
      await driver.clickSave();
      outcome = await driver.waitSaved(CONFIRM_MS);
    } else {
      emit('waiting', index, { key, message: 'Check the form, then click Save Task.' });
      outcome = await driver.waitSaved(0);
    }
    if (outcome.result === 'alert') {
      onHold(item, false);
      throw new Stop('The site says: "' + String(outcome.message || '').slice(0, 200) + '"');
    }

    const result = confirmation(item, before, await logsFor([item]));
    if (!result.saved) {
      // In fill-one, stopping before the user pressed Save sent nothing.
      if (mode === 'one' && outcome.result === 'aborted' && !outcome.pressed) onHold(item, false);
      halt();
      throw new Stop('The site did not confirm saving ' + label(item) + '. Check your logs before sending it again.');
    }
    onHold(item, false);
    if (result.listing && result.listing !== nightListing) {
      nightListing = result.listing;
      onListing(nightListing);
    }
    report.saved.push(key);
    emit('saved', index, { key });
    return 'saved';
  }

  async function findMissing() {
    const found = await logsFor(items);
    const ignored = new Set(report.skipped.filter((s) => s.reason === 'possible').map((s) => s.key));
    return items.filter((item) => !ignored.has(item.key) && classify(item, found, nightListing) !== 'logged').map((item) => item.key);
  }

  async function run(mode) {
    if (started) throw new Error('This run has already started.');
    started = true;
    try {
      await driver.fresh(); // never type into a form left over from editing something
      for (let i = 0; i < items.length; i++) {
        await waitWhilePaused(i);
        const step = await send(items[i], i, mode);
        if (step === 'retry') { i--; continue; }
        if (mode === 'one' && step === 'saved') break;
        if (step === 'saved' && i < items.length - 1) await sleep(gapMs);
        halt();
      }
    } catch (error) {
      report.state = 'stopped';
      report.message = error.message === 'logged out' ? LOGGED_OUT : error.message;
    }
    if (mode === 'auto') {
      try {
        report.missing = await findMissing();
      } catch (error) {
        report.message = report.message || 'The logs could not be read again. Check them on the site.';
      }
    }
    emit(report.state === 'done' ? 'done' : 'stopped', report.saved.length, { message: report.message });
    return report;
  }

  const wakeUp = () => { if (wake) { wake(); wake = null; } };

  return {
    autopilot: () => run('auto'),
    fillNext: () => run('one'),
    pause() { if (stopped) return; paused = true; pauses++; driver.abortFill(); },
    resume() { paused = false; wakeUp(); },
    stop() { stopped = true; paused = false; driver.abortFill(); driver.cancelWait(); wakeUp(); }
  };
}

module.exports = { createRunner };
