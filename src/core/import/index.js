'use strict';
const { createDuty } = require('../duty');
const { dutiesFromCsv } = require('./csv');
const { dutiesFromBackupText } = require('./backup');
const { dutiesFromReport } = require('./report');

function read({ name, text, pages }) {
  if (pages) return dutiesFromReport(pages);
  if (/\.json$/i.test(name) || /^﻿?\s*\{/.test(text)) return dutiesFromBackupText(text);
  return dutiesFromCsv(text);
}

// Turns a file into duties ready for review. Nothing here talks to the site.
function importFile(file, settings) {
  const duties = [];
  const skipped = [];
  for (const row of read(file)) {
    if (row.skip) skipped.push({ source: row.source, date: row.date, reason: row.skip });
    else duties.push(createDuty(row.input, settings));
  }
  return { duties, skipped };
}

module.exports = { importFile };
