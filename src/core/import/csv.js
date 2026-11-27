'use strict';
const T = require('../time');
const S = require('./shared');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^﻿/, '');
  const closeRow = () => {
    row.push(field);
    field = '';
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      closeRow();
    } else {
      field += c;
    }
  }
  closeRow();
  return rows;
}

const COLUMNS = {
  date: ['date', 'dutydate'],
  status: ['dutystatus', 'status'],
  shift: ['shift'],
  timeIn: ['timein', 'actualtimein'],
  timeOut: ['timeout', 'actualtimeout'],
  hema: ['hematology', 'hema'],
  micro: ['clinicalmicroscopy', 'microscopy', 'micro'],
  chem: ['clinicalchemistry', 'chemistry', 'chem'],
  phleb: ['phlebotomy', 'phleb'],
  ihomis: ['ihomis', 'chargeslips'],
  admissionTests: ['admissiontests', 'admissiontest'],
  admission: ['admission', 'admitted'],
  serology: ['serology'],
  crossmatch: ['crossmatch'],
  immunoassay: ['immunoassay'],
  electrolytes: ['electrolytes'],
  qc: ['qc', 'qualitycontrol'],
  cleaning: ['cleaning', 'laboratorycleaning'],
  from: ['endorsementfrom', 'receivedendorsementfrom', 'outgoing', 'from'],
  to: ['endorsementto', 'endorsedto', 'incoming', 'to']
};
const COUNT_KEYS = ['hema', 'micro', 'chem', 'phleb', 'ihomis', 'admission', 'serology', 'crossmatch', 'immunoassay', 'electrolytes'];

function findColumn(header, aliases, taken) {
  const exact = header.findIndex((h, i) => !taken.has(i) && aliases.includes(h));
  if (exact >= 0) return exact;
  return header.findIndex((h, i) => !taken.has(i) && aliases.some((a) => a.length > 3 && h.startsWith(a)));
}

function dutiesFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The CSV file has no data rows.');

  const header = rows[0].map(S.norm);
  const col = {};
  const taken = new Set();
  for (const key of Object.keys(COLUMNS)) {
    col[key] = findColumn(header, COLUMNS[key], taken);
    if (col[key] >= 0) taken.add(col[key]);
  }
  if (col.date < 0 || col.shift < 0) throw new Error('The CSV needs at least "Date" and "Shift" columns.');
  if (!['hema', 'micro', 'chem', 'phleb', 'ihomis'].some((k) => col[k] >= 0) && header.includes('activities')) {
    throw new Error('This is the app\'s "Daily CSV", which lists activity names but no patient counts. ' +
      'Use the PDF report or the JSON backup instead.');
  }

  return rows.slice(1).map((r, i) => {
    const get = (key) => (col[key] >= 0 ? (r[col[key]] || '').trim() : '');
    const source = 'Row ' + (i + 2);
    const date = S.parseDateValue(get('date'));
    if (!date) return { source, skip: 'unreadable date "' + get('date') + '"' };
    const status = get('status');
    if (status && !/working/i.test(status)) return { source, date, skip: status };
    const shift = S.parseShift(get('shift'));
    if (!shift) return { source, date, skip: 'shift "' + get('shift') + '" could not be read' };

    const input = { ...S.blankInput(), ...shift };
    for (const key of COUNT_KEYS) {
      const n = S.parseCount(get(key));
      if (n) input.counts[key] = n;
    }
    input.admissionTests = get('admissionTests');
    input.qc = S.parseBool(get('qc'));
    input.cleaning = S.parseBool(get('cleaning'));
    for (const key of ['timeIn', 'timeOut']) {
      const minutes = T.parseClock(get(key));
      if (minutes !== null) input[key] = minutes;
    }
    input.from = S.joinNames(get('from'));
    input.to = S.joinNames(get('to'));
    return S.result(source, date, input);
  });
}

module.exports = { parseCsv, dutiesFromCsv };
