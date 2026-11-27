'use strict';
// Holds the app's state and carries out what the panel asks for.
const D = require('../core/duty');
const T = require('../core/time');
const { importFile } = require('../core/import');
const { rowsToLogs, datesToCheck, classify } = require('../core/logs');
const { createRunner } = require('../core/runner');

const SPEEDS = { instant: 0, fast: 6, slow: 35, human: 'human' };
const GAP_MS = 1500;
const LIMITS = { minutesEarly: [5, 180], receiveLead: [1, 60], endorseLead: [1, 120], endAfter: [5, 240] };
const RUN_ACTIONS = new Set(['pause', 'resume', 'stop', 'siteStatus']);

function createController({ store, driver, now, emit, sleep, warning = '' }) {
  const loaded = store.load();
  let settings = loaded.settings;
  let duties = loaded.duties;
  let skipped = [];
  let message = [warning, loaded.warning].filter(Boolean).join(' ');
  let site = 'unknown';
  let run = null; // { mode, paused, event }
  let runner = null;
  let busy = false;
  let checkOk = false; // did the last "check" read the site successfully
  let finished = Promise.resolve();
  const logs = {}; // date → rows already in the diary, as last read

  // Every read of the logs also refreshes the NEW / SAVED badges.
  const watched = Object.create(driver);
  watched.readLogs = async (dates) => {
    const found = await driver.readLogs(dates);
    for (const [date, rows] of Object.entries(found)) logs[date] = rowsToLogs(rows);
    return found;
  };

  function marksFor(duty) {
    const marks = {};
    for (const item of D.siteEntries(duty)) {
      if (datesToCheck([item]).every((date) => logs[date])) marks[item.entryId] = classify(item, logs, settings.nightListing);
    }
    return marks;
  }

  // An unconfirmed save is shown until the logs prove the entry is there.
  function shownMarks(duty) {
    const marks = marksFor(duty);
    for (const item of duty.entries) if (item.unconfirmed && marks[item.id] !== 'logged') marks[item.id] = 'unconfirmed';
    return marks;
  }

  const view = (duty) => ({
    ...duty,
    problems: D.validate(duty, now()),
    marks: shownMarks(duty),
    entries: duty.entries.map((item) => ({
      ...item,
      date: T.addDays(duty.date, Math.floor(item.start / 1440)),
      startClock: T.hhmm(item.start),
      endClock: T.hhmm(item.end),
      description: D.describe(item),
      rewritable: D.canRewrite(item, settings.wording)
    }))
  });

  const state = () => ({ settings, duties: duties.map(view), skipped, warning: message, site, run, running: !!runner || busy, checkOk, dataDir: store.dir });
  const publish = () => emit(state());

  function save() {
    try {
      store.save({ settings, duties });
    } catch (error) {
      message = 'Your changes could not be saved: ' + error.message;
    }
  }

  const sameDuty = (a, b) => a.date === b.date && a.start === b.start && a.end === b.end;
  const sortDuties = () => duties.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

  // A duty with the same date and shift is replaced, unless some of it is already on the site.
  function addDuties(incoming) {
    const refused = [];
    for (const duty of incoming) {
      const old = duties.find((d) => sameDuty(d, duty));
      let reason = '';
      if (old && Object.values(marksFor(old)).includes('logged')) reason = 'already in the list and saved on the site';
      else if (old && old.entries.some((e) => e.unconfirmed)) reason = 'already in the list with an entry not yet confirmed';
      if (reason) {
        refused.push({ source: duty.date, date: duty.date, reason });
        continue;
      }
      duties = duties.filter((d) => d !== old).concat(duty);
    }
    sortDuties();
    return refused;
  }

  const edit = (id, change) => { duties = duties.map((d) => (d.id === id ? change(d) : d)); };

  const edits = {
    import(a) {
      const result = importFile({ name: a.name, text: a.text, pages: a.pages }, settings);
      skipped = result.skipped.concat(addDuties(result.duties));
    },
    addDuty(a) { skipped = addDuties([D.createDuty({ category: settings.category, ...a.input }, settings)]); },
    deleteDuty(a) { duties = duties.filter((d) => d.id !== a.id); },
    select(a) { edit(a.id, (d) => ({ ...d, selected: !!a.value })); },
    setTimes(a) { edit(a.dutyId, (d) => D.setTimes(d, a.entryId, a.start, a.end)); },
    setText(a) { edit(a.dutyId, (d) => D.setText(d, a.entryId, a.text)); },
    // `at` is a clock time; without it the entry is split in the middle.
    splitWork(a) {
      edit(a.dutyId, (d) => {
        const item = d.entries.find((e) => e.id === a.entryId);
        if (!item) return d;
        const middle = Math.round((item.start + item.end) / 10) * 5;
        const clock = a.at ? T.parseClock(a.at) : null;
        return D.splitWork(d, a.entryId, clock === null ? middle : T.resolveMinute(clock, (item.start + item.end) / 2));
      });
    },
    moveLine(a) { edit(a.dutyId, (d) => D.moveLine(d, a.lineKey, a.entryId, settings)); },
    splitCount(a) { edit(a.dutyId, (d) => D.splitCount(d, a.entryId, a.lineKey, Number(a.amount), a.toEntryId, settings)); },
    rewriteEntry(a) { edit(a.dutyId, (d) => D.rewrite(d, settings, a.entryId)); },
    writeEntries(a) {
      edit(a.dutyId, (d) => {
        const next = D.rewrite(d, settings);
        const kept = next.entries.filter((e) => e.text !== null).length;
        const notes = [];
        if (next.format !== d.format) notes.push('This duty came from an earlier version, so its entries and times were planned again.');
        if (kept) notes.push('Kept ' + kept + (kept === 1 ? ' entry' : ' entries') + ' you wrote by hand.');
        message = notes.join(' ');
        return next;
      });
    },
    removeEmptyWork(a) { edit(a.dutyId, (d) => D.removeEmptyWork(d, a.entryId)); },
    updateActivities(a) {
      edit(a.dutyId, (d) => {
        if (!D.LAYOUTS.includes(a.layout) || a.layout === D.layoutOf(d)) return D.updateActivities(d, a.patch, settings);
        if (d.entries.some((e) => (e.text ?? null) !== null)) {
          message = 'The layout changed, so the text you typed in this duty was replaced.';
        }
        return D.setLayout({ ...d, activities: { ...d.activities, ...a.patch } }, a.layout, settings);
      });
    },
    resetTimes(a) { edit(a.dutyId, (d) => D.resetTimes(d, settings)); },
    allowPossible(a) {
      edit(a.dutyId, (d) => ({ ...d, entries: d.entries.map((e) => (e.id === a.entryId ? { ...e, allowPossible: !!a.value } : e)) }));
    },
    settings(a) {
      const next = { ...settings, wording: { ...settings.wording, ...a.patch.wording } };
      for (const [key, [low, high]] of Object.entries(LIMITS)) {
        const n = Math.round(Number(a.patch[key]));
        if (a.patch[key] !== undefined && Number.isFinite(n)) next[key] = Math.min(high, Math.max(low, n));
      }
      if (a.patch.speed in SPEEDS) next.speed = a.patch.speed;
      if (D.CATEGORIES.includes(a.patch.category)) next.category = a.patch.category;
      if (a.patch.layouts) {
        next.layouts = Object.fromEntries(D.CATEGORIES.map((c) =>
          [c, D.LAYOUTS.includes(a.patch.layouts[c]) ? a.patch.layouts[c] : settings.layouts[c]]));
      }
      settings = next;
    }
  };

  function hold(item, held) {
    edit(item.dutyId, (d) => ({
      ...d,
      entries: d.entries.map((e) => (e.id === item.entryId
        ? { ...e, unconfirmed: held, allowPossible: held ? false : e.allowPossible }
        : e))
    }));
    save();
  }

  const shortLabel = (item) => {
    const [y, m, d] = item.date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + T.time12(T.parseClock(item.start));
  };

  async function check() {
    busy = true;
    run = null; // the last run's progress line no longer applies
    checkOk = false;
    publish();
    try {
      const page = await driver.probe();
      if (page.loggedOut) throw new Error('logged out');
      if (!page.ok) throw new Error('The diary form is not complete on this page. Missing: ' + page.missing.join(', '));
      const all = duties.flatMap(D.siteEntries);
      if (all.length) await watched.readLogs(datesToCheck(all));
      site = 'ready';
      checkOk = true;
      message = all.length ? 'The form is as expected. The logs were checked.' : 'The form is as expected.';
    } catch (error) {
      message = error.message === 'logged out' ? 'You are logged out of the site. Log in, then try again.' : error.message;
    } finally {
      busy = false;
    }
  }

  // `only` lists the entries shown in the preview: nothing else is sent.
  function startRun(mode, only) {
    const chosen = duties.filter((d) => d.selected);
    if (!chosen.length) { message = 'Select at least one duty first.'; return; }
    const items = [];
    let future = 0;
    for (const duty of chosen) {
      const problems = D.validate(duty, now());
      const blocking = problems.find((p) => p.code !== 'future');
      if (blocking) { message = 'Fix this first (' + duty.date + '): ' + blocking.message; return; }
      const waiting = new Set(problems.map((p) => p.entryId));
      future += waiting.size;
      items.push(...D.siteEntries(duty).filter((item) => !waiting.has(item.entryId)));
    }
    if (Array.isArray(only)) items.splice(0, items.length, ...items.filter((item) => only.includes(item.entryId)));
    if (!items.length) { message = 'Nothing to send: the selected entries have not ended yet.'; return; }

    message = '';
    run = { mode, paused: false, event: { type: 'checking', index: 0, total: items.length } };
    runner = createRunner({
      driver: watched, items, now, msPerChar: SPEEDS[settings.speed], gapMs: GAP_MS, sleep,
      listing: settings.nightListing,
      onListing: (nightListing) => { settings = { ...settings, nightListing }; save(); },
      onHold: hold,
      onEvent: (event) => {
        if (event.type === 'done' || event.type === 'stopped') return;
        run = { ...run, event };
        publish();
      }
    });

    const going = mode === 'fillNext' ? runner.fillNext() : runner.autopilot();
    finished = going.then((report) => {
      const skippedFor = (reason) => report.skipped.filter((s) => s.reason === reason).length;
      const possible = skippedFor('possible');
      const unconfirmed = skippedFor('unconfirmed');
      const already = skippedFor('logged');
      const parts = ['Saved ' + report.saved.length + '.'];
      if (already) parts.push(already + ' already on the site.');
      if (possible) parts.push(possible + ' possible duplicate(s) skipped.');
      if (future) parts.push(future + ' not ended yet, left out.');
      if (unconfirmed) parts.push(unconfirmed + ' not confirmed earlier, skipped.');
      if (report.missing.length) {
        const names = report.missing.map((key) => shortLabel(items.find((item) => item.key === key)));
        parts.push('Not found in the logs: ' + names.slice(0, 8).join(', ') +
          (names.length > 8 ? ' and ' + (names.length - 8) + ' more' : '') + '.');
      }
      if (report.message) parts.unshift(report.message);
      run = { mode, paused: false, event: { type: report.state, index: items.length, total: items.length, message: parts.join(' ') } };
    }, (error) => {
      run = { mode, paused: false, event: { type: 'stopped', index: 0, total: items.length, message: error.message } };
    }).then(() => {
      runner = null;
      publish();
    });
  }

  async function dispatch(action) {
    const type = action && action.type;
    if (RUN_ACTIONS.has(type)) {
      if (type === 'siteStatus') {
        if (!runner && !busy) {
          try {
            const page = await driver.peek();
            site = page.loggedOut ? 'login' : page.ok ? 'ready' : 'other';
          } catch (error) {
            site = 'unknown';
          }
        }
      } else if (runner) {
        runner[type]();
        if (run) run = { ...run, paused: type === 'pause' };
      }
    } else if (runner || busy) {
      return state(); // nothing changes while the app is working
    } else if (type === 'check') {
      await check();
    } else if (type === 'fillNext' || type === 'autopilot') {
      startRun(type, action.only);
    } else if (Object.prototype.hasOwnProperty.call(edits, type)) {
      try {
        message = '';
        edits[type](action);
        save();
      } catch (error) {
        message = error.message;
      }
    }
    publish();
    return state();
  }

  return { state, dispatch, idle: () => finished };
}

module.exports = { createController };
