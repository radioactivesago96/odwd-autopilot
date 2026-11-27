const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../src/core/duty');
const { importFile } = require('../src/core/import');
const report = require('../src/core/import/report');

const item = (str, x, y, width = str.length * 4) => ({ str, x, y, width });
// A made-up report page with the app's table layout.
const page = (shift) => ({ items: [
  item('Date', 40, 700), item('Target Activities', 120, 700), item('Output', 320, 700), item('Remarks', 500, 700),
  item('October 1, 2026', 40, 680, 60), item('(' + shift + ')', 40, 668, 50),
  item('• Performed Hematology', 110, 680, 100), item('• 5 patients processed', 300, 680, 100),
  item('• Performed phlebotomy for blood samples', 110, 660, 170), item('• 7 patients extracted', 300, 660, 100),
  item('• Performed laboratory cleaning', 110, 640, 130), item('• Completed', 300, 640, 50),
  item('October 2, 2026', 40, 600, 60), item('D A Y O F F', 200, 600, 80),
  item('Prepared by:', 40, 500, 60)
] });

test('12-hour shift report', () => {
  const rows = report.dutiesFromReport([page('7 PM – 7 AM')]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].input.shift, '7p-7a');
  assert.deepEqual(rows[0].input.counts, { hema: 5, phleb: 7 });
  assert.equal(rows[0].input.cleaning, true);
  assert.equal(rows[0].input.qc, false);
  assert.equal(rows[1].skip, 'Day off');
});

test('importFile accepts PDF pages', () => {
  const r = importFile({ name: 'r.pdf', pages: [page('11 PM – 7 AM')] }, D.defaultSettings());
  assert.equal(r.duties[0].date, '2026-10-01');
  assert.equal(r.duties[0].shift, '11-7');
  assert.equal(r.skipped[0].reason, 'Day off');
});

test('pages that are not a report are refused', () => {
  assert.throws(() => report.dutiesFromReport([{ items: [] }]), /No text was found/);
  assert.throws(() => report.dutiesFromReport([{ items: [item('Hello', 10, 10)] }]), /Target Activities/);
});

const downloads = process.env.ODWD_PDF_DIR || path.join(os.homedir(), 'Downloads');
const pdfs = fs.existsSync(downloads) ? fs.readdirSync(downloads).filter((f) => /^Accomplishment_Report_.*\.pdf$/i.test(f)) : [];

async function readPages(file) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push({ items: content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width })) });
  }
  return pages;
}

// The old userscript is kept only on the author's PC, so this comparison runs only there.
const script = path.join(__dirname, '..', 'reference', 'CDH-Diary-Importer.user.js');
const missing = !fs.existsSync(script) ? 'the old userscript is not here' : !pdfs.length ? 'no Accomplishment_Report_*.pdf found' : false;

test('real reports read the same as the userscript', { skip: missing }, async (t) => {
  const original = require(script);
  const keys = ['hema', 'micro', 'chem', 'phleb', 'ihomis', 'serology', 'crossmatch', 'immunoassay', 'electrolytes', 'admission'];
  let compared = 0;
  for (const file of pdfs) {
    const pages = await readPages(path.join(downloads, file));
    const mine = report.dutiesFromReport(pages);
    for (const old of original.dutiesFromReport(pages).filter((r) => r.duty)) {
      const row = mine.find((r) => r.date === old.date);
      assert.ok(row && row.input, file + ' ' + old.date + ' is missing');
      for (const k of keys) assert.equal(row.input.counts[k] || 0, old.duty[k], file + ' ' + old.date + ' ' + k);
      assert.equal(row.input.qc, !!old.duty.qc, file + ' ' + old.date + ' qc');
      assert.equal(row.input.cleaning, !!old.duty.cleaning, file + ' ' + old.date + ' cleaning');
      assert.deepEqual(row.input.otherTests, old.duty.otherTests);
      assert.deepEqual(row.input.extraLines, old.duty.extraTasks);
      compared++;
    }
  }
  t.diagnostic('compared ' + compared + ' duties from ' + pdfs.length + ' PDF reports');
});
