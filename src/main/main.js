'use strict';
const { app, BrowserWindow, BrowserView, ipcMain, session, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../core/duty');
const { resolveDataDir, createStore } = require('./store');
const { isAllowed, SITE } = require('./guard');
const { createDriver } = require('./driver');
const { createController } = require('./controller');
const { version } = require('../../package.json');

const PANEL_WIDTH = 340;
const dev = !app.isPackaged;
const home = (dev && process.env.ODWD_URL) || 'http://www.misocc-hrmis.net/odwd/index.php';
const siteHost = dev && process.env.ODWD_URL ? new URL(home).hostname : SITE;

const data = dev && process.env.ODWD_DATA
  ? { dir: process.env.ODWD_DATA, warning: '' }
  : resolveDataDir({ portableDir: process.env.PORTABLE_EXECUTABLE_DIR, appData: app.getPath('appData') });

// The browser's own files go to a temporary folder; the login itself is only ever in memory.
const sessionDir = dev && process.env.ODWD_DATA
  ? path.join(process.env.ODWD_DATA, 'session')
  : path.join(os.tmpdir(), 'odwd-autopilot-session');
app.setPath('userData', sessionDir);

if (!app.requestSingleInstanceLock()) app.quit();
else start();

function start() {
  let win = null;
  let view = null;
  let controller = null;
  const blocked = new Set();
  let siteError = '';
  let entered = false; // the start screen has been closed

  const full = (state) => ({ ...state, version, shifts: D.SHIFTS, blocked: [...blocked], siteError });
  const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
  const refresh = () => { if (controller) send('odwd:state', full(controller.state())); };

  function layout() {
    if (!entered) return;
    const [width, height] = win.getContentSize();
    view.setBounds({ x: PANEL_WIDTH, y: 0, width: Math.max(0, width - PANEL_WIDTH), height });
  }

  // The site view lies over the panel's page, so it is taken away while a full-window screen
  // (the preview) is open. The page inside it is kept.
  function showSite(visible) {
    const attached = win.getBrowserViews().includes(view);
    if (visible && !attached) {
      win.addBrowserView(view);
      layout();
    } else if (!visible && attached) {
      win.removeBrowserView(view);
    }
  }

  function hotkeys(contents) {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat || input.control || input.alt || input.meta || input.shift) return;
      if (input.key === 'F6' || input.key === 'F8') {
        event.preventDefault();
        send('odwd:hotkey', input.key);
      } else if (input.key === 'Escape') {
        // Stopping does not depend on the panel.
        if (controller.state().running) {
          event.preventDefault();
          controller.dispatch({ type: 'stop' });
        }
        send('odwd:hotkey', 'Escape');
      }
    });
  }

  function createWindow() {
    const site = session.fromPartition('odwd-site');
    site.webRequest.onBeforeRequest((details, callback) => {
      const allowed = isAllowed(details, siteHost);
      if (!allowed && /^https?:/i.test(details.url)) {
        blocked.add(new URL(details.url).hostname);
        refresh();
      }
      callback({ cancel: !allowed });
    });
    site.setPermissionRequestHandler((contents, permission, callback) => callback(false));

    const offscreen = dev && process.env.ODWD_OFFSCREEN ? { x: -3000, y: 0 } : {};
    win = new BrowserWindow({
      width: 1280, height: 800, minWidth: 1000, minHeight: 640, title: 'ODWD Autopilot', backgroundColor: '#0b0f14',
      autoHideMenuBar: true, ...offscreen,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    });
    win.removeMenu();
    view = new BrowserView({
      webPreferences: { session: site, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    win.on('resize', layout);

    const web = view.webContents;
    controller = createController({
      store: createStore(data.dir),
      driver: createDriver(web),
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      emit: (state) => send('odwd:state', full(state)),
      warning: data.warning
    });

    web.setWindowOpenHandler(() => ({ action: 'deny' }));
    web.on('will-navigate', (event, url) => { if (!isAllowed({ url, resourceType: 'mainFrame' }, siteHost)) event.preventDefault(); });
    web.on('did-finish-load', () => { siteError = ''; controller.dispatch({ type: 'siteStatus' }); });
    web.on('did-fail-load', (event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || code === -20) return; // -3 aborted, -20 blocked by the app
      siteError = 'The site could not be reached (' + description + '). Check the internet, then press Reload.';
      refresh();
    });
    web.on('render-process-gone', () => { controller.dispatch({ type: 'stop' }); web.loadURL(home); });

    // The panel is a local page and must never navigate (for example by dropping a file on it).
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    hotkeys(win.webContents);
    hotkeys(web);

    win.on('close', (event) => {
      if (!controller.state().running) return;
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning', buttons: ['Keep running', 'Stop and close'], defaultId: 0, cancelId: 0,
        message: 'Autopilot is still working.', detail: 'Closing now stops it. Check your logs on the site afterwards.'
      });
      if (choice === 0) event.preventDefault();
      else controller.dispatch({ type: 'stop' });
    });
    win.on('closed', () => { win = null; app.quit(); });

    win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  }

  const fromPanel = (event) => win && event.sender === win.webContents;
  // The site view covers part of the window, so it is attached only when the start screen is
  // closed. (Attached before the panel has loaded, its page can also stay 0×0.)
  ipcMain.on('odwd:enter', (event) => {
    if (!fromPanel(event) || entered) return;
    entered = true;
    showSite(true);
    view.webContents.loadURL(home).catch(() => {});
  });
  ipcMain.on('odwd:show-site', (event, visible) => { if (fromPanel(event) && entered) showSite(!!visible); });
  ipcMain.handle('odwd:state', (event) => (fromPanel(event) ? full(controller.state()) : null));
  ipcMain.handle('odwd:dispatch', async (event, action) => (fromPanel(event) ? full(await controller.dispatch(action)) : null));
  ipcMain.on('odwd:home', (event) => {
    if (fromPanel(event) && !controller.state().running) view.webContents.loadURL(home).catch(() => {});
  });

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    try {
      if (!(dev && process.env.ODWD_DATA)) fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (error) {
      // Windows may still hold a cache file; it contains no login.
    }
  });
  app.whenReady().then(createWindow);
}
