'use strict';
const S = require('./shared');

const ID_MAP = {
  hematology: 'hema', microscopy: 'micro', chemistry: 'chem', phlebotomy: 'phleb', ihomis: 'ihomis',
  serology: 'serology', crossmatching: 'crossmatch', immunoassay: 'immunoassay'
};

const NOT_A_BACKUP = 'This JSON file is not a CDH Accomplishment Report backup.';

function dutiesFromBackup(data) {
  if (!data || !Array.isArray(data.entries)) throw new Error(NOT_A_BACKUP);
  const activities = new Map((data.activities || []).map((a) => [a.id, a]));

  return data.entries.slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((entry) => {
      const source = 'Entry ' + entry.date;
      const date = S.parseDateValue(entry.date);
      if (!date) return { source, skip: 'unreadable date "' + entry.date + '"' };
      if (entry.draft) return { source, date, skip: 'still a draft' };
      if (entry.demo) return { source, date, skip: 'demo data' };
      if (entry.dutyStatus && entry.dutyStatus !== 'Working Day') return { source, date, skip: entry.dutyStatus };

      const shiftText = entry.shift === 'Custom Shift' ? entry.customShift || '' : entry.shift;
      const shift = S.parseShift(shiftText);
      if (!shift) return { source, date, skip: 'shift "' + shiftText + '" could not be read' };

      const input = { ...S.blankInput(), ...shift };
      for (const output of entry.outputs || []) {
        if (!output.selected) continue;
        const count = S.parseCount(output.count);
        if (output.activityId === 'qc') { input.qc = true; continue; }
        if (output.activityId === 'cleaning') { input.cleaning = output.completed !== false; continue; }
        const key = ID_MAP[output.activityId];
        if (key) {
          if (count) input.counts[key] = count;
          continue;
        }
        const activity = activities.get(output.activityId);
        if (activity && count) input.otherTests.push({ name: activity.name, count });
      }
      for (const manual of entry.manualActivities || []) {
        const line = String(manual.outputText || manual.targetText || '').trim();
        if (line) input.extraLines.push(line);
      }
      return S.result(source, date, input);
    });
}

function dutiesFromBackupText(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(NOT_A_BACKUP);
  }
  return dutiesFromBackup(data);
}

module.exports = { dutiesFromBackup, dutiesFromBackupText };
