'use strict';
// Drives the diary page in a webContents by calling the injected agent.
const fs = require('node:fs');
const path = require('node:path');
const { humanPace } = require('../core/rhythm');

const AGENT = fs.readFileSync(path.join(__dirname, '..', 'site', 'agent.js'), 'utf8');
const GONE = Symbol('page left');
const POLL_MS = 150;
const LOAD_LIMIT_MS = 20000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createDriver(web) {
  let cancelled = false;

  // Resolves once the page is not loading (or after a limit, so a hung page cannot hang the app).
  async function ready() {
    const deadline = Date.now() + LOAD_LIMIT_MS;
    while (web.isLoadingMainFrame() && Date.now() < deadline) await sleep(100);
  }

  // Calls an agent method; resolves to GONE if the page navigates away before answering.
  async function call(method, ...args) {
    await ready();
    let leave;
    const gone = new Promise((resolve) => {
      leave = (event, url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) resolve(GONE); };
      web.on('did-start-navigation', leave);
    });
    const code = AGENT + '\n;window.__odwd[' + JSON.stringify(method) + '](...' + JSON.stringify(args) + ')';
    try {
      return await Promise.race([web.executeJavaScript(code), gone]);
    } finally {
      web.removeListener('did-start-navigation', leave);
    }
  }

  async function answer(method, ...args) {
    const value = await call(method, ...args);
    if (value === GONE) throw new Error('The page changed while the app was working. Try again.');
    return value;
  }

  const savePressedNow = async () => {
    const status = await call('status').catch(() => GONE);
    return status !== GONE && !!status.saveClicked;
  };

  return {
    savePressed: savePressedNow,

    // Opens the Dashboard anew, so nothing from an earlier edit is left in the form.
    async fresh() {
      if (!(await answer('openDashboard'))) web.reload();
      await sleep(300);
      await ready();
    },

    // Looks at the current page without moving anywhere.
    peek: () => answer('probe'),

    async probe() {
      let page = await answer('probe');
      if (!page.ok && !page.loggedOut && (await answer('openDashboard'))) {
        await sleep(300);
        page = await answer('probe');
      }
      return page;
    },

    async readLogs(dates) {
      const result = await answer('readLogs', dates);
      if (result.error) throw new Error(result.error);
      return result.logs;
    },

    // speed is milliseconds per character, or 'human'.
    async fill(entry, speed) {
      const pace = speed === 'human' ? humanPace(String(entry.description).replace(/\r\n?/g, '\n')) : speed;
      const typed = await call('fill', entry, pace);
      // Leaving the page while typing may mean Save was pressed.
      return typed === GONE || typed === 'user-saved' ? 'user-saved' : typed === true;
    },

    abortFill() { call('abort').catch(() => {}); },

    matches: (entry) => answer('matches', entry),

    async clickSave() {
      const clicked = await answer('clickSave');
      if (clicked === 'pressed') throw new Error('You pressed Save yourself. Check this entry on the site before sending it again.');
      if (!clicked) throw new Error('The Save Task button was not found.');
    },

    // Waits until Save was pressed and the form cleared, or the site complained.
    async waitSaved(timeoutMs) {
      cancelled = false;
      const deadline = timeoutMs ? Date.now() + timeoutMs : Infinity;
      let navigated = false;
      let pressed = false;
      const leave = (event, url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) navigated = true; };
      web.on('did-start-navigation', leave);
      try {
        while (!cancelled) {
          if (navigated) {
            await sleep(300);
            await ready();
            return { result: 'gone', pressed };
          }
          const status = await call('status').catch(() => GONE);
          if (status === GONE) { navigated = true; continue; }
          pressed = pressed || !!status.saveClicked;
          if (status.alert) return { result: 'alert', message: status.alert, pressed };
          if (status.saveClicked && status.descEmpty) return { result: 'cleared', pressed };
          if (Date.now() > deadline) return { result: 'timeout', pressed };
          await sleep(POLL_MS);
        }
        pressed = pressed || (await savePressedNow());
        return { result: 'aborted', pressed };
      } finally {
        web.removeListener('did-start-navigation', leave);
      }
    },

    cancelWait() { cancelled = true; }
  };
}

module.exports = { createDriver };
