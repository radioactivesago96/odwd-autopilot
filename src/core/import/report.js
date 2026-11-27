'use strict';
// Reader for the CDH Accomplishment Report PDF, ported from the CDH Diary Importer userscript.
// pages: [{ items: [{ str, x, y, width }] }] — text pieces with their position (pdf.js getTextContent).
const S = require('./shared');

var REPORT_ACTIVITIES = [                       // order matters: QC/iHOMIS rows also mention other sections
    [/\bqc\b|quality\s+control/i, 'qc'],
    [/ihomis|charge\s+slip/i, 'ihomis'],
    [/cleaning/i, 'cleaning'],
    [/hematology/i, 'hema'],
    [/clinical\s+microscopy|urinalysis|fecalysis/i, 'micro'],
    [/serology/i, 'serology'],
    [/crossmatch/i, 'crossmatch'],
    [/clinical\s+chemistry/i, 'chem'],
    [/immunoassay/i, 'immunoassay'],
    [/electrolyte|sodium|potassium/i, 'electrolytes'],
    [/phlebotomy|blood\s+samples|extract/i, 'phleb'],
    [/admi(tted|ssion)/i, 'admission']
];

var DATE_START = /^((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*\d{1,2}\s*,?)$/i;
var MONTH_DATE = /^((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*\d{1,2}\s*,?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2})\b\s*(.*)$/i;

/* PDF readers hand text over in pieces (whole lines, words, or single letters, depending on the
   version and how the PDF was made). Join pieces that sit next to each other on the same line. */
function joinLinePieces(items) {
    var pieces = items.map(function (it) {
        var str = String(it.str || '').replace(/\u00a0/g, ' ');
        var width = it.width != null && it.width > 0 ? it.width : str.length * 4.6;
        return { str: str, x: it.x, y: it.y, end: it.x + width };
    }).filter(function (it) { return it.str.trim().length; });   // space pieces can stretch across columns
    pieces.sort(function (a, b) { return Math.abs(a.y - b.y) > 1.5 ? b.y - a.y : a.x - b.x; });
    var lines = [];
    var current = null;
    pieces.forEach(function (it) {
        var sameLine = current && Math.abs(current.y - it.y) <= 1.5;
        var gap = sameLine ? it.x - current.end : Infinity;
        if (sameLine && gap < 6) {                                     // a column gap in the report is about 10 pt
            var space = gap > 0.8 && !/\s$/.test(current.str) && !/^\s/.test(it.str) ? ' ' : '';
            current.str += space + it.str;
            current.end = Math.max(current.end, it.end);
        } else {
            current = { str: it.str, x: it.x, y: it.y, end: it.end };
            lines.push(current);
        }
    });
    return lines.map(function (l) { return { str: l.str.replace(/\s+/g, ' ').trim(), x: l.x, y: l.y }; })
        .filter(function (l) { return l.str; });
}

function dutiesFromReport(pages) {
    var all = [];
    pages.forEach(function (page, pi) {
        joinLinePieces(page.items).forEach(function (it) {
            all.push({ str: it.str, x: it.x, y: it.y, page: pi });
        });
    });
    if (!all.length) throw new Error('No text was found in this PDF. Is it a scanned image? Export the report again from the CDH app.');

    // Column positions come from the table itself: target bullets, output bullets, Remarks header.
    var header = all.filter(function (it) { return /^target activities$/i.test(it.str); });
    if (!header.length) throw new Error('This PDF does not look like a CDH Accomplishment Report (no "Target Activities" column).');
    var bulletXs = all.filter(function (it) { return /^[•▪●◦·\-–]\s/.test(it.str) || /^•/.test(it.str); }).map(function (it) { return it.x; });
    // Left edges used by many lines = the columns (Date, Target Activities, Output, Remarks).
    var edges = {};
    all.forEach(function (it) { var k = Math.round(it.x / 3) * 3; edges[k] = (edges[k] || 0) + 1; });
    var columns = Object.keys(edges).map(Number).filter(function (k) { return edges[k] >= 4; }).sort(function (a, b) { return a - b; })
        .filter(function (k, i, arr) { return i === 0 || k - arr[i - 1] > 25; });
    var dateHeader = all.filter(function (it) { return /^date$/i.test(it.str); })[0];
    var targetX, outputX;
    if (bulletXs.length >= 3) {
        targetX = Math.min.apply(null, bulletXs);
        var outputXs = bulletXs.filter(function (x) { return x > targetX + 40; });
        outputX = outputXs.length ? Math.min.apply(null, outputXs) : targetX + 180;
    } else {
        var afterDate = columns.filter(function (k) { return k > (dateHeader ? dateHeader.x : columns[0]) + 30; });
        targetX = afterDate[0] != null ? afterDate[0] : header[0].x - 40;
        outputX = afterDate[1] != null ? afterDate[1] : targetX + 180;
    }
    var remarks = all.filter(function (it) { return /^remarks$/i.test(it.str); })[0];
    var remarksX = remarks ? remarks.x - 8 : outputX + 170;
    var headerY = {};
    all.forEach(function (it) { if (/^date$/i.test(it.str)) headerY[it.page] = it.y; });

    // One running position through all pages so rows that continue onto the next page stay together.
    var rows = all.filter(function (it) { return headerY[it.page] == null || it.y < headerY[it.page] - 2; })
        .filter(function (it) { return it.y > 28 && !/^CDH Accomplishment Report$/i.test(it.str) && !/^page \d+( of \d+)?$/i.test(it.str); })
        .map(function (it) { return Object.assign(it, { g: it.page * 100000 + (10000 - it.y) }); })
        .sort(function (a, b) { return a.g - b.g || a.x - b.x; });

    var days = [];
    var day = null;
    var lastCol = {};
    for (var i = 0; i < rows.length; i++) {
        var it = rows[i];
        if (/^(prepared|noted|approved) by/i.test(it.str)) break;          // signatures: end of the table
        var col = it.x < targetX - 2 ? 'date' : it.x < outputX - 2 ? 'target' : it.x < remarksX ? 'output' : 'remarks';
        var dm = col === 'date' ? MONTH_DATE.exec(it.str) : null;
        // Long month names wrap: "September 1," on one line and "2026" on the next.
        var partial = col === 'date' && !dm ? DATE_START.exec(it.str) : null;
        if (partial) dm = [it.str, partial[1], ''];
        if (col === 'date' && !dm && day && day.partialDate && /^\d{4}\b/.test(it.str)) {
            day.dateText += ' ' + it.str.slice(0, 4);
            day.partialDate = false;
            var rest = it.str.slice(4).trim();
            if (rest) day.shiftText += ' ' + rest;
            continue;
        }
        if (dm) {
            day = { dateText: dm[1], shiftText: dm[2] || '', status: '', targets: [], outputs: [], partialDate: !!partial };
            days.push(day);
            lastCol = {};
            continue;
        }
        if (!day) continue;
        if (col === 'date') { day.shiftText += ' ' + it.str; continue; }
        if (col === 'remarks') continue;
        // "D A Y O F F" / "LEAVE" is centred across the table and may arrive letter by letter
        if (!/^•/.test(it.str) && /^([A-Z]\s?)+$/.test(it.str) && !day.targets.length && !day.outputs.length) {
            day.status += it.str.replace(/\s+/g, '');
            continue;
        }
        var list = col === 'target' ? day.targets : day.outputs;
        var isBullet = /^•/.test(it.str) || /^[▪●◦·]\s/.test(it.str);
        if (isBullet || !lastCol[col] || (bulletXs.length < 3 && /^(Performed|Logged|Completed|Assisted|Attended|Processed|Collected|Received|\d+\s+patient)/i.test(it.str))) {
                            lastCol[col] = { text: it.str.replace(/^([•▪●◦·]\s*)+/, ''), top: it.g, bottom: it.g };
            list.push(lastCol[col]);
        } else {
            lastCol[col].text += ' ' + it.str;
            lastCol[col].bottom = it.g;
        }
    }
    if (!days.length) {
        var seen = rows.filter(function (it) { return it.x < targetX - 2; }).slice(0, 4).map(function (it) { return '"' + it.str + '"'; });
        throw new Error('No dated rows were found in this report.' + (seen.length ? ' The Date column reads: ' + seen.join(', ') + '.' : ''));
    }


  return days.map((dd) => {
    const date = S.parseDateValue(dd.dateText);
    const source = 'Report ' + dd.dateText;
    if (!date) return { source, skip: 'unreadable date "' + dd.dateText + '"' };
    if (dd.status && !dd.targets.length) {
      const label = { DAYOFF: 'Day off', LEAVE: 'Leave', HOLIDAY: 'Holiday', OB: 'Official business', OFFICIALBUSINESS: 'Official business', TRAINING: 'Training' }[dd.status] ||
        dd.status.charAt(0) + dd.status.slice(1).toLowerCase();
      return { source, date, skip: label };
    }
    const shiftText = dd.shiftText.replace(/[()]/g, '').trim();
    const shift = S.parseShift(shiftText);
    if (!shift) return { source, date, skip: 'shift "' + (shiftText || '?') + '" could not be read' };
    return S.result(source, date, { ...S.blankInput(), ...shift, ...readActivities(dd) });
  });
}

// Each output sits beside (vertically centred on) its target activity.
function readActivities(day) {
  const found = { counts: {}, qc: false, cleaning: false, otherTests: [], extraLines: [] };
  const targets = day.targets.map((t) => {
    const match = REPORT_ACTIVITIES.find(([pattern]) => pattern.test(t.text));
    return { text: t.text, key: match ? match[1] : null, top: t.top, bottom: t.bottom, outputs: [] };
  });
  for (const o of day.outputs) {
    const centre = (o.top + o.bottom) / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const t of targets) {
      const distance = centre < t.top ? t.top - centre : centre > t.bottom ? centre - t.bottom : 0;
      if (distance < bestDistance) { bestDistance = distance; best = t; }
    }
    if (best) best.outputs.push(o.text);
  }

  for (const t of targets) {
    const out = t.outputs.join(' ');
    if (!out) continue;
    const number = /(\d+)\s*(patients?|charge\s+slips?|specimens?|samples?|tests?)/i.exec(out) || /(\d+)/.exec(out);
    const count = number ? parseInt(number[1], 10) : 0;
    const notDone = /\bnot\s+(completed|done|performed)\b/i.test(out);
    const describes = !number && !/^(completed|done|achieved|not completed)\b/i.test(out) && !/\bnot\s+completed\b/i.test(out) &&
      !/^completed qc logs/i.test(out) && out.split(/\s+/).length >= 4;
    if (describes && t.key !== 'qc' && t.key !== 'cleaning') t.key = null;
    if (t.key === 'qc') { found.qc = !notDone; continue; }
    if (t.key === 'cleaning') { found.cleaning = !notDone; continue; }
    if (t.key) {
      if (count) found.counts[t.key] = (found.counts[t.key] || 0) + count;
      continue;
    }
    const name = t.text.replace(/^(performed|processed|conducted|did)\s+/i, '').replace(/\s*\(.*$/, '').trim();
    if (count) {
      found.otherTests.push({ name, count });
    } else {
      const did = pastTense(t.text);
      const result = out && !/^completed\.?$/i.test(out) ? pastTense(out) : '';
      found.extraLines.push(S.sentence(did) + (result && S.norm(result) !== S.norm(did) ? ' ' + S.sentence(result) : ''));
    }
  }
  return found;
}

var PAST = {
    attending: 'attended', teaching: 'taught', observing: 'observed', participating: 'participated', assisting: 'assisted',
    conducting: 'conducted', giving: 'gave', joining: 'joined', facilitating: 'facilitated', preparing: 'prepared',
    organizing: 'organized', monitoring: 'monitored', training: 'trained', orienting: 'oriented', helping: 'helped',
    doing: 'did', leading: 'led', presenting: 'presented', coordinating: 'coordinated', supervising: 'supervised',
    checking: 'checked', receiving: 'received', encoding: 'encoded', submitting: 'submitted', meeting: 'met'
};

/* "Teaching and observing AMOMC staff…" → "Taught and observed AMOMC staff…" (leading verbs only) */
function pastTense(text) {
    var words = String(text || '').trim().split(/\s+/);
    for (var i = 0; i < words.length && i < 6; i++) {
        var low = words[i].toLowerCase().replace(/[^a-z]/g, '');
        if (PAST[low]) {
            var past = PAST[low];
            words[i] = (i === 0 ? past.charAt(0).toUpperCase() + past.slice(1) : past) + words[i].slice(low.length);
            continue;
        }
        if (low === 'and' || low === '&') continue;
        break;
    }
    return words.join(' ');
}

module.exports = { dutiesFromReport, pastTense };
