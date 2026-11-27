'use strict';
// Settings and duties in one JSON file. The PIN is never part of it.
const fs = require('node:fs');
const path = require('node:path');
const { defaultSettings } = require('../core/duty');

function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch (error) {
    return false;
  }
}

// Beside the portable exe when possible, otherwise in the user's app data folder.
function resolveDataDir({ portableDir, appData, canWrite = canWriteDir }) {
  const fallback = path.join(appData, 'ODWD-Autopilot');
  if (!portableDir) return { dir: fallback, warning: '' };
  const beside = path.join(portableDir, 'ODWD-Autopilot-data');
  if (canWrite(beside)) return { dir: beside, warning: '' };
  return { dir: fallback, warning: 'The app folder cannot be written to, so your data is stored in ' + fallback };
}

function withDefaults(settings) {
  const base = defaultSettings();
  const saved = settings || {};
  // Only wording the app still uses is kept.
  const own = saved.wording || {};
  const wording = Object.fromEntries(Object.keys(base.wording).map((key) => [key, key in own ? own[key] : base.wording[key]]));
  const next = { ...base, ...saved, wording, layouts: { ...base.layouts, ...saved.layouts }, format: base.format };
  // Settings from before 1.2: the old wording and the old default early start are replaced.
  delete next.templates;
  if (!(saved.format >= 2) && saved.minutesEarly === 15) next.minutesEarly = base.minutesEarly;
  return next;
}

function createStore(dir) {
  const file = path.join(dir, 'data.json');
  const empty = (warning) => ({ settings: defaultSettings(), duties: [], warning });
  let locked = ''; // set when an existing file must not be overwritten
  const lock = (why) => { locked = 'Saving is off so your saved data is not overwritten. ' + why; return empty(locked); };

  return {
    dir,
    load() {
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return empty('');
        return lock('The file in ' + dir + ' could not be read (' + error.message + '). Close the app and try again.');
      }
      try {
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.duties) || data.duties.some((d) => !Array.isArray(d.entries))) throw new Error('shape');
        return { settings: withDefaults(data.settings), duties: data.duties, warning: '' };
      } catch (error) {
        const kept = 'data.corrupt-' + Date.now() + '.json';
        try {
          fs.renameSync(file, path.join(dir, kept));
        } catch (failure) {
          return lock('data.json in ' + dir + ' is damaged and could not be moved aside (' + failure.message + ').');
        }
        return empty('The saved data could not be read. It was kept as ' + kept + ' in ' + dir);
      }
    },
    save({ settings, duties }) {
      if (locked) throw new Error(locked);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify({ settings, duties }, null, 1), 'utf8');
      fs.renameSync(file + '.tmp', file);
    }
  };
}

module.exports = { resolveDataDir, createStore };
