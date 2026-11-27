// Runs inside the diary page. Installs window.__odwd once; the app calls it from outside.
// Fields are found by id only, so nothing is ever typed into an unexpected form.
(() => {
  if (window.__odwd) return;

  const FIELDS = {
    date: ['#log_date', 'Date'],
    start: ['#start_time', 'Start Time'],
    end: ['#end_time', 'End Time'],
    desc: ['#task_description', 'Task Description'],
    night: ['#nightshift', 'Night shift box']
  };
  const find = (name) => document.querySelector(FIELDS[name][0]);

  function saveButton() {
    const desc = find('desc');
    const form = desc && desc.closest('form');
    if (!form) return null;
    return Array.from(form.querySelectorAll('button, input[type="submit"]'))
      .find((b) => /save\s*task/i.test(b.textContent || b.value || '')) || null;
  }

  let aborted = false;
  let quiet = false; // true after the app pressed Save: record the site's alert without showing it
  let lastAlert = '';
  let saveClicked = false;
  let highlighted = null;

  const originalAlert = window.alert;
  window.alert = function (message) {
    lastAlert = String(message == null ? '' : message) || '(empty message)';
    if (!quiet) originalAlert.call(window, message);
  };

  document.addEventListener('click', (event) => {
    const button = saveButton();
    if (!button || !button.contains(event.target)) return;
    if (event.isTrusted) quiet = false;
    saveClicked = true;
    lastAlert = '';
  }, true);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (text) => String(text).replace(/\r\n?/g, '\n');

  function highlight(el) {
    if (highlighted) highlighted.style.outline = '';
    highlighted = el;
    if (!el) return;
    el.style.outline = '3px solid #39ff88';
    el.scrollIntoView({ block: 'center' });
  }

  function nativeSet(el, value) {
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
  }

  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  async function setValue(el, value, wait) {
    highlight(el);
    el.focus();
    nativeSet(el, value);
    fire(el, 'input');
    fire(el, 'change');
    await sleep(wait);
  }

  // One key at a time, with the events a keyboard produces. delays[i] is the wait after key i.
  async function typeKeys(el, text, delays) {
    const chars = Array.from(text);
    let value = '';
    for (let i = 0; i < chars.length; i++) {
      if (saveClicked) return 'user-saved';
      if (aborted) return false;
      const lineBreak = chars[i] === '\n';
      const key = (type) => el.dispatchEvent(new KeyboardEvent(type, { key: lineBreak ? 'Enter' : chars[i], bubbles: true }));
      key('keydown');
      value += chars[i];
      nativeSet(el, value);
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: lineBreak ? 'insertLineBreak' : 'insertText', data: lineBreak ? null : chars[i]
      }));
      key('keyup');
      el.scrollTop = el.scrollHeight;
      await sleep(delays[i]);
    }
    fire(el, 'change');
    return saveClicked ? 'user-saved' : !aborted;
  }

  // pace is a number (milliseconds per character, 0 for instant) or { keys, fields } for Human.
  async function typeText(el, text, pace) {
    highlight(el);
    el.focus();
    if (saveClicked) return 'user-saved';
    if (pace && pace.keys) return typeKeys(el, text, pace.keys);
    const msPerChar = pace;
    if (!msPerChar) {
      await setValue(el, text, 20);
      return saveClicked ? 'user-saved' : !aborted;
    }
    const step = Math.max(1, Math.round(30 / msPerChar));
    for (let length = 0; length < text.length;) {
      if (saveClicked) return 'user-saved';
      if (aborted) return false;
      length = Math.min(text.length, length + step);
      nativeSet(el, text.slice(0, length));
      fire(el, 'input');
      el.scrollTop = el.scrollHeight;
      await sleep(msPerChar * step + (/[.,]/.test(text[length - 1]) && msPerChar > 20 ? 120 : 0));
    }
    fire(el, 'change');
    return saveClicked ? 'user-saved' : !aborted;
  }

  window.__odwd = {
    probe() {
      const missing = Object.keys(FIELDS).filter((name) => !find(name)).map((name) => FIELDS[name][1]);
      if (!saveButton()) missing.push('Save Task button');
      // A filled-in record number means Save would change an old entry instead of adding one.
      const form = find('desc') && find('desc').closest('form');
      const editing = !!form && Array.from(form.querySelectorAll('input[type="hidden"]')).some((input) =>
        /^(id|(task|log|entry|record|diary|edit|update)_?id)$/i.test(input.name || input.id) && input.value && input.value !== '0');
      if (editing) missing.push('a new, empty form (this one is editing another entry)');
      return { ok: !missing.length, missing, loggedOut: !!document.querySelector('input[type="password"]') };
    },

    openDashboard() {
      const link = Array.from(document.querySelectorAll('a[href]')).find((a) => /^\s*dashboard\s*$/i.test(a.textContent || ''));
      if (!link) return false;
      setTimeout(() => link.click(), 0);
      return true;
    },

    async fill(entry, pace) {
      if (!window.__odwd.probe().ok) return false;
      aborted = false;
      quiet = false;
      lastAlert = '';
      saveClicked = false;
      const fields = [['date', entry.date], ['start', entry.start], ['end', entry.end]];
      for (let i = 0; i < fields.length; i++) {
        if (saveClicked) return 'user-saved';
        if (aborted) return false;
        const wait = !pace ? 20 : pace.fields ? pace.fields[i] : 250;
        await setValue(find(fields[i][0]), fields[i][1], wait);
      }
      if (saveClicked) return 'user-saved';
      if (aborted) return false;
      const night = find('night');
      highlight(night);
      if (night.checked !== entry.night) night.click();
      if (night.checked !== entry.night) { night.checked = entry.night; fire(night, 'change'); }
      const typed = await typeText(find('desc'), clean(entry.description), pace);
      highlight(null);
      return typed;
    },

    abort() { aborted = true; highlight(null); },

    matches(entry) {
      return window.__odwd.probe().ok &&
        find('date').value === entry.date && find('start').value === entry.start && find('end').value === entry.end &&
        find('night').checked === entry.night && find('desc').value === clean(entry.description);
    },

    clickSave() {
      const button = saveButton();
      if (!button) return false;
      if (saveClicked) return 'pressed'; // the user already did
      quiet = true;
      lastAlert = '';
      setTimeout(() => button.click(), 0);
      return true;
    },

    status() {
      const desc = find('desc');
      return { descEmpty: !!desc && !desc.value.trim(), alert: lastAlert, saveClicked };
    },

    // Reads the Daily Logs table for each date. Errors come back as { error }.
    async readLogs(dates) {
      const logs = {};
      try {
        for (const date of dates) {
          const response = await fetch(location.origin + '/odwd/view_logs_detail.php?start=' + date + '&end=' + date,
            { credentials: 'same-origin', cache: 'no-store' });
          if (!response.ok) throw new Error('The site answered ' + response.status + ' for the logs page.');
          const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
          if (doc.querySelector('input[type="password"]')) throw new Error('logged out');
          if (!doc.querySelector('table')) {
            if (!/no logs found/i.test(doc.body ? doc.body.textContent : '')) throw new Error('The logs page could not be read.');
            logs[date] = [];
            continue;
          }
          logs[date] = Array.from(doc.querySelectorAll('tr'), (tr) =>
            Array.from(tr.cells, (cell) => cell.textContent.replace(/\s+/g, ' ').trim()));
        }
      } catch (error) {
        return { error: error.message };
      }
      return { logs };
    }
  };
})();
