'use strict';
// A duty and the diary entries made from it. Every function returns new objects; nothing is random.
const T = require('./time');

const shift = (start, end, label) => ({ start, end, label });
const SHIFTS = {
  '7-3': shift(420, 900, '7 AM – 3 PM'),
  '3-11': shift(900, 1380, '3 PM – 11 PM'),
  '11-7': shift(1380, 1860, '11 PM – 7 AM'),
  '7a-7p': shift(420, 1140, '7 AM – 7 PM'),
  '7p-7a': shift(1140, 1860, '7 PM – 7 AM'),
  '6p-6a': shift(1080, 1800, '6 PM – 6 AM'),
  '3p-7a': shift(900, 1860, '3 PM – 7 AM (double duty)'),
  '7a-11p': shift(420, 1380, '7 AM – 11 PM (double duty)')
};

const ACTIVITY_KEYS = ['hema', 'micro', 'serology', 'crossmatch', 'chem', 'immunoassay', 'electrolytes', 'admission', 'phleb'];
// Written only when the user switches them on.
const ROUTINE_KEYS = ['supplies', 'reagents', 'analyzer', 'workarea', 'logbooks', 'results'];
// A nurse's numbers, in the order of the entry. censusIn and censusOut are the two endorsements.
const NURSE_KEYS = ['ivfRegulated', 'ivfFollowed', 'ivReinserted', 'ivRemoved', 'nebulized', 'labResults', 'oxygen',
  'medications', 'skinTest', 'complaints', 'healthTeaching', 'newAdmissions', 'discharges'];

// A nurse attendant's numbers, in the order of the entry. aVs1-3 are the vital-sign rounds.
const ATTENDANT_KEYS = ['aVs1', 'aBottles', 'aSpecimens', 'aLabRequests', 'aDiet', 'aIvfAssist', 'aIvFollowed', 'aVs2',
  'aIvTerminated', 'aNewAdmit', 'aDietNew', 'aRequests', 'aVs3', 'aHeplock', 'aNewborn', 'aVsEncoded'];
const VITAL_ROUNDS = ['aVs1', 'aVs2', 'aVs3'];

const CATEGORIES = ['lab', 'nurse', 'attendant'];
const LAYOUTS = ['whole', 'intervals'];
const DEFAULT_LAYOUTS = { lab: 'intervals', nurse: 'whole', attendant: 'whole' };
const HANDOVERS = ['prep', 'received', 'endorse', 'timeout'];
// The ward sections. census: the endorsement sentences that need a patient number.
const WARD = {
  nurse: {
    keys: NURSE_KEYS, task: 'task',
    handovers: { prep: 'nLogin', received: 'nReceive', endorse: 'nEndorse', timeout: 'nLogout' },
    census: { received: 'censusIn', endorse: 'censusOut' }
  },
  attendant: {
    keys: ATTENDANT_KEYS, task: 'atask',
    handovers: { prep: 'aLogin', received: 'aReceive', endorse: 'aEndorse', timeout: 'aLogout' },
    census: { received: 'censusIn' }
  }
};

// Duties made before categories and layouts existed are laboratory duties in intervals.
const categoryOf = (duty) => (CATEGORIES.includes(duty.category) ? duty.category : 'lab');
const layoutOf = (duty) => (duty.layout === 'whole' ? 'whole' : 'intervals');

// One phrasing on each line. Rewrite takes the next one.
const lines = (...phrases) => phrases.join('\n');
const WORDING = {
  prep: lines('Timed in and prepared the laboratory work area.',
    'Timed in, set up the work area, and readied the materials for the shift.'),
  received: 'Received endorsement from {name}. Reviewed pending requests, specimens, and analyzer status.',
  endorse: 'Endorsed pending requests, specimens, and analyzer status to {name}.',
  timeout: 'Finished the remaining documentation and timed out.',
  fallbackFrom: 'the outgoing staff',
  fallbackTo: 'the incoming staff',
  qc: lines('Ran daily QC on the Hematology and Chemistry analyzers.', 'Performed quality control on the analyzers and logged the results.'),
  admissionCbc: 'Performed CBC for {n} newly admitted patient{s}.',
  admissionChem: 'Performed chemistry tests{tests} for {n} newly admitted patient{s}.',
  admissionOther: 'Performed {name} for {n} newly admitted patient{s}.',
  phleb: lines('Drew blood samples from {n} patient{s}.', 'Performed phlebotomy for {n} patient{s}.',
    'Collected blood specimens from {n} patient{s}.'),
  hema: lines('Ran Hematology tests for {n} patient{s}.', 'Performed Hematology tests for {n} patient{s}.',
    'Processed Hematology requests for {n} patient{s}.'),
  chem: lines('Performed Clinical Chemistry tests for {n} patient{s}.', 'Ran Clinical Chemistry tests for {n} patient{s}.',
    'Processed Clinical Chemistry requests for {n} patient{s}.'),
  electrolytes: lines('Ran electrolyte tests (Na, K, Ca) for {n} patient{s}.', 'Performed electrolyte tests for {n} patient{s}.'),
  immunoassay: lines('Performed Immunoassay tests for {n} patient{s}.', 'Ran Immunoassay tests for {n} patient{s}.'),
  crossmatch: lines('Performed crossmatching for {n} patient{s}.', 'Crossmatched blood for {n} patient{s}.'),
  micro: lines('Examined urinalysis and fecalysis samples of {n} patient{s}.', 'Performed Clinical Microscopy tests for {n} patient{s}.',
    'Processed urine and stool examinations for {n} patient{s}.'),
  serology: lines('Performed Serology tests for {n} patient{s}.', 'Ran Serology tests for {n} patient{s}.'),
  other: 'Performed {name} for {n} patient{s}.',
  supplies: lines('Checked and arranged the laboratory supplies.', 'Reviewed the supply inventory.'),
  reagents: lines('Checked reagent levels and expiry dates.', 'Inspected the reagents and consumables.'),
  analyzer: lines('Checked that the analyzers and equipment were working properly.', 'Monitored analyzer performance.'),
  workarea: lines('Organized the workstations.', 'Prepared the workstations and materials.'),
  logbooks: lines('Updated the laboratory logbooks.', 'Recorded the finished tests in the logbooks.'),
  results: lines('Verified and released completed results.', 'Checked the results before release.'),
  ihomis: lines('Encoded {n} charge slip{s} in iHOMIS.', 'Processed {n} charge slip{s} through iHOMIS.', 'Posted {n} charge slip{s} in iHOMIS.'),
  cleaning: lines('Cleaned and disinfected the work area.', 'Cleaned the laboratory and disinfected the work surfaces.'),
  // Nurse wording, as the user's own diary entry puts it. {S} adds a capital plural S.
  nLogin: 'BIOMETRIC LOG-IN @ CDH LOBBY.',
  nReceive: 'BED TO BED ENDORSEMENT TO {n} PATIENT{S}.',
  ivfRegulated: 'REGULATED IVF OF {n} PATIENT{S}.',
  ivfFollowed: 'IVF FOLLOWED UP TO {n} PATIENT{S}.',
  ivReinserted: 'IV REINSERTION DONE TO {n} PATIENT{S}.',
  ivRemoved: 'IV REMOVAL TO {n} PATIENT{S}.',
  nebulized: 'ASSISTED NEBULIZATION TO {n} PATIENT{S}.',
  labResults: 'RECEIVED LABORATORY RESULTS FROM LABORATORY AND RELAYED RESULTS TO ATTENDING PHYSICIAN - {n} PATIENT{S}.',
  oxygen: 'ASSISTED O2 INHALATION TO {n} PATIENT{S}.',
  medications: 'ADMINISTERED ORAL AND IVTT MEDICATIONS TO {n} PATIENT{S}.',
  skinTest: 'PERFORMED SKIN TESTING FOR IVTT MEDS TO {n} PATIENT{S}.',
  complaints: 'RESPONDED TO {n} PATIENT COMPLAINT{S}.',
  healthTeaching: 'HEALTH TEACHING IMPARTED TO {n} PATIENT{S}.',
  newAdmissions: 'CARRIED OUT {n} NEW ADMISSION{S}.',
  discharges: 'CARRIED OUT {n} PT{S} FOR DISCHARGE.',
  nEndorse: 'BED TO BED ENDORSEMENT TO {n} PATIENT{S} TO NEXT SHIFT NOD.',
  nLogout: 'BIOMETRIC LOGGED OUT AT CDH LOBBY.',
  // Nurse attendant wording, as the user's photo puts it. {in} is the entry's start time.
  aLogin: '{in}) *Biometric logged in.',
  aReceive: '*Received and reviewed {n} patient{s} from outgoing shift.',
  aVitals: '*Took vital signs{at} of {n} admitted patient{s}.',
  aBottles: '*Provided specimen bottle to {n} patient{s}.',
  aSpecimens: '*Sent {n} specimen{s} to laboratory for examination.',
  aLabRequests: '*Encoded {n} laboratory request{s} to IHOMIS.',
  aDiet: '*Updated diet list of {n} admitted patient{s}.',
  aIvfAssist: '*Assisted nurses for IVF insertion of {n} patient{s}.',
  aIvFollowed: '*Followed up IV fluid to {n} patient{s}.',
  aIvTerminated: '*Terminated dislodged IV of {n} patient{s}.',
  aNewAdmit: '*Received and took vital signs of {n} newly admitted patient{s}.',
  aDietNew: '*Updated diet list of {n} newly admitted patient{s}.',
  aRequests: '*Responded to {n} patient request{s}.',
  aHeplock: '*Changed {n} IVF line{s} to heplock.',
  aNewborn: '*Bathed {n} newborn{s}.',
  aVsEncoded: '*Encoded vital signs of {n} admitted patient{s} to IHOMIS.',
  aEndorse: '*Endorsement to incoming shift.',
  aLogout: '*Biometric logged out.'
};

// nightListing: where the site lists entries after midnight ('calendar' or 'duty'), once the app has seen it.
const defaultSettings = () => ({
  format: 2, minutesEarly: 30, receiveLead: 10, endorseLead: 10, endAfter: 15, speed: 'fast', nightListing: '', wording: { ...WORDING },
  category: 'lab', layouts: { ...DEFAULT_LAYOUTS }
});

let counter = 0;
const newId = () => Date.now().toString(36) + '-' + (++counter).toString(36);

const wholeCount = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);
// A nurse's number counts as soon as it is typed, zero included.
const typedCount = (value) => value !== undefined && value !== null && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0;

/* Wording */

const phrases = (wording, key) => String(wording[key] || '').split('\n').map((s) => s.trim()).filter(Boolean);
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? values[name] : whole));

// A line with a template is written from the wording; `variant` picks the phrasing.
function worded(line, variant, wording) {
  if (!line.template) return line;
  const list = phrases(wording, line.template);
  if (!list.length) return { ...line, text: '' };
  const part = Number(line.key.split('#')[1] || 0); // the parts of a split count read differently
  const one = line.count === 1;
  const count = line.count === undefined ? {} : { n: String(line.count), s: one ? '' : 's', S: one ? '' : 'S' };
  return { ...line, text: fill(list[(variant + part) % list.length], { ...line.values, ...count }) };
}

function sentence(text) {
  const trimmed = String(text || '').trim().replace(/\s+/g, ' ');
  return !trimmed || /[.!?]$/.test(trimmed) ? trimmed : trimmed + '.';
}

// A full stop after a title or a single capital ("Dr.", "H.") does not end a sentence.
const SHORT_FORM = /(?:\b(?:Mr|Ms|Mrs|Ma|Dr|Engr|Sr|Jr|St|No|vs)|\b[A-Z])\.$/;
function splitSentences(text) {
  const parts = [];
  for (const piece of String(text || '').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9("•*])/)) {
    if (!piece) continue;
    if (parts.length && SHORT_FORM.test(parts[parts.length - 1])) parts[parts.length - 1] += ' ' + piece;
    else parts.push(piece);
  }
  return parts;
}

const MAX_SENTENCES = 2;
const weight = (line) => Math.max(1, splitSentences(line.text).length);
const total = (list) => list.reduce((sum, line) => sum + weight(line), 0);

/* Order: each group gets its own intervals. */

const GROUPS = [
  ['qc'], ['admission-cbc'], ['admission-chem', 'admission-other'], ['phleb', 'hema'], ['chem', 'electrolytes'],
  ['immunoassay', 'crossmatch'], ['micro', 'serology'], ['other', 'extra'], ROUTINE_KEYS, ['ihomis', 'cleaning'],
  // Nurse duties (their own keys), then their typed tasks.
  ['ivfRegulated', 'ivfFollowed'], ['ivReinserted', 'ivRemoved'], ['nebulized', 'labResults'], ['oxygen', 'medications'],
  ['skinTest', 'complaints'], ['healthTeaching'], ['newAdmissions', 'discharges'], ['task'],
  // Nurse attendant duties.
  ['aVs1'], ['aBottles', 'aSpecimens'], ['aLabRequests', 'aDiet'], ['aIvfAssist', 'aIvFollowed'], ['aVs2'],
  ['aIvTerminated', 'aNewAdmit'], ['aDietNew', 'aRequests'], ['aVs3'], ['aHeplock', 'aNewborn'], ['aVsEncoded'], ['atask']
];
const ORDER = GROUPS.flat();
const unsplit = (key) => key.split('#')[0];
const baseKey = (key) => unsplit(key).split(':')[0];
const groupIndex = (key) => GROUPS.findIndex((keys) => keys.includes(baseKey(key)));
const rank = (key) => ORDER.indexOf(baseKey(key)) * 1000 + Number(unsplit(key).split(':')[1] || 0) + Number(key.split('#')[1] || 0) / 1000;
const inOrder = (list) => list.slice().sort((a, b) => rank(a.key) - rank(b.key));

const IS_CBC = /\bcbc\b|complete blood count/i;
const IS_CHEMISTRY = /\b(fbs|rbs|glucose|glu|creatinine|crea|bun|urea|uric|bua|lipid|cholesterol|chol|triglycerides?|trig|hdl|ldl|vldl|sgpt|sgot|alt|ast|na|k|cl|ca|sodium|potassium|chloride|calcium|electrolytes?|hba1c|ogtt|bilirubin|protein|albumin|amylase|chemistry|chem)\b/i;

// The parts the user split a count into, as long as they still add up to it.
function partsOf(activities, key, count) {
  const parts = (activities.splits || {})[key];
  return Array.isArray(parts) && parts.length > 1 && parts.every(wholeCount) && parts.reduce((a, b) => a + b, 0) === count ? parts : [count];
}

// New admissions: the CBC first, then the chemistry tests. Only listed tests are named;
// with no list at all, the CBC every admission starts with is written.
function admissionLines(activities, n, add) {
  const tests = String(activities.admissionTests || '').split(/\s*[;,/]\s*/).filter(Boolean);
  const chemistry = tests.filter((t) => !IS_CBC.test(t) && IS_CHEMISTRY.test(t));
  const others = tests.filter((t) => !IS_CBC.test(t) && !IS_CHEMISTRY.test(t));
  if (!tests.length || tests.some((t) => IS_CBC.test(t))) add('admission-cbc', 'admissionCbc', n);
  if (chemistry.length) add('admission-chem', 'admissionChem', n, { tests: ' (' + chemistry.join(', ') + ')' });
  if (others.length) add('admission-other', 'admissionOther', n, { name: others.join(', ') });
}

// A long typed or imported task is cut into pieces of two sentences.
function typedLines(activities, prefix) {
  const list = [];
  (activities.extraLines || []).forEach((line, i) => {
    const pieces = splitSentences(sentence(line));
    for (let j = 0; j * MAX_SENTENCES < pieces.length; j++) {
      list.push({ key: prefix + ':' + i + (j ? '.' + j : ''), text: pieces.slice(j * MAX_SENTENCES, (j + 1) * MAX_SENTENCES).join(' ') });
    }
  });
  return list;
}

// A vital-sign round is named by the time the user typed; without one, no time is written.
function vitalValues(activities, round) {
  const time = String((activities.vitalTimes || [])[round] || '').replace(/[()]/g, '').trim();
  return { at: time ? ' (' + time + ')' : '' };
}

function wardLines(category, activities, wording) {
  const { keys, task } = WARD[category];
  const counts = activities.counts || {};
  const list = [];
  for (const key of keys) {
    if (!typedCount(counts[key])) continue;
    const round = VITAL_ROUNDS.indexOf(key);
    const template = round < 0 ? key : 'aVitals';
    const values = round < 0 ? {} : vitalValues(activities, round);
    partsOf(activities, key, Number(counts[key])).forEach((count, i) => {
      list.push(worded({ key: i ? key + '#' + i : key, template, count, values }, 0, wording));
    });
  }
  return inOrder(list.concat(typedLines(activities, task)));
}

const workLines = (category, activities, wording) =>
  (WARD[category] ? wardLines(category, activities, wording) : activityLines(activities, wording));

// The work lines of one laboratory duty, in diary order. Only things the data or the user says were done.
function activityLines(activities, wording) {
  const counts = activities.counts || {};
  const list = [];
  const push = (line) => list.push(worded(line, 0, wording));
  const add = (key, template, n, values = {}) => {
    partsOf(activities, key, n).forEach((count, i) => push({ key: i ? key + '#' + i : key, template, count, values }));
  };
  const plain = (key) => push({ key, template: key, values: {} });

  if (activities.qc) plain('qc');
  const admitted = wholeCount(counts.admission);
  if (admitted) admissionLines(activities, admitted, add);
  for (const key of ACTIVITY_KEYS) {
    const n = wholeCount(counts[key]);
    if (n && key !== 'admission') add(key, key, n);
  }
  (activities.otherTests || []).forEach((other, i) => {
    const n = wholeCount(other.count);
    if (n && other.name) add('other:' + i, 'other', n, { name: other.name });
  });
  list.push(...typedLines(activities, 'extra'));
  for (const key of ROUTINE_KEYS) if ((activities.routine || []).includes(key)) plain(key);
  const slips = wholeCount(counts.ihomis);
  if (slips) add('ihomis', 'ihomis', slips);
  if (activities.cleaning) plain('cleaning');
  return inOrder(list);
}

/* Entries */

const entry = (kind, start, end, list) => ({ id: newId(), kind, start, end, lines: list, text: null, variant: 0, allowPossible: false });

// The time in, endorsement and time out sentences. A ward endorsement that states a patient
// number needs it: without it there is no sentence (null).
function handoverLine(category, kind, activities, wording, variant) {
  if (WARD[category]) {
    const census = WARD[category].census[kind];
    const typed = census && (activities.counts || {})[census];
    if (census && !typedCount(typed)) return null;
    const line = { key: kind, template: WARD[category].handovers[kind], values: {} };
    return worded(census ? { ...line, count: Number(typed) } : line, variant, wording);
  }
  const incoming = kind === 'received';
  const name = incoming ? activities.from || wording.fallbackFrom : activities.to || wording.fallbackTo;
  const values = kind === 'received' || kind === 'endorse' ? { name: String(name).replace(/\.$/, '') } : {};
  return worded({ key: kind, template: kind, values }, variant, wording);
}

// Cuts one group of lines into pieces of at most two sentences. The parts of a split count
// were put in different entries by the user, so they stay apart.
function pieces(group) {
  const out = [];
  for (const line of group) {
    const last = out[out.length - 1];
    const apart = (other) => unsplit(other.key) !== unsplit(line.key);
    if (last && last.every(apart) && total(last) + weight(line) <= MAX_SENTENCES) last.push(line);
    else out.push([line]);
  }
  return out;
}

// Shares the working time equally among the pieces of work, on 5-minute marks. Nothing here is random.
function planWork(list, start, end) {
  const blocks = GROUPS.flatMap((keys, i) => pieces(list.filter((line) => groupIndex(line.key) === i)));
  const span = end - start;
  const count = Math.max(1, Math.min(blocks.length, Math.floor(span / 5)));
  while (blocks.length > count) {
    const last = blocks.pop(); // only when there is not even 5 minutes for each
    blocks[blocks.length - 1] = blocks[blocks.length - 1].concat(last);
  }
  if (blocks.length <= 1) return [entry('work', start, end, list)];
  const mark = (i) => (i === 0 ? start : i === count ? end : Math.round((start + (span * i) / count) / 5) * 5);
  return blocks.map((block, i) => entry('work', mark(i), mark(i + 1), block));
}

// Everything one duty says, in order, for a single entry. Split counts are written as one.
function wholeLines(category, activities, wording, variant) {
  const joined = { ...activities, splits: {} };
  const [prep, received, endorse, timeout] = HANDOVERS.map((kind) => handoverLine(category, kind, joined, wording, variant));
  const work = workLines(category, joined, wording).map((line) => worded(line, variant, wording));
  return [prep, received, ...work, endorse, timeout].filter(Boolean);
}

// Whole: one entry from time in to time out. Intervals: time in, endorsement received (up to
// the start of the shift), work, endorsement given (up to the end of the shift), time out.
function makeEntries(duty, settings) {
  const { activities, start, end } = duty;
  const category = categoryOf(duty);
  const { wording, minutesEarly, endorseLead, endAfter } = settings;
  const lead = Math.max(1, settings.receiveLead || 10);

  const timeIn = activities.timeIn != null ? T.resolveMinute(activities.timeIn, start) : start - Math.max(minutesEarly, lead + 5);
  const timeOut = activities.timeOut != null ? T.resolveMinute(activities.timeOut, end) : end + Math.max(5, endAfter);
  if (layoutOf(duty) === 'whole') return [entry('whole', timeIn, timeOut, wholeLines(category, activities, wording, 0))];

  const [prep, received, endorse, out] = HANDOVERS.map((kind) => handoverLine(category, kind, activities, wording, 0));
  const prepEnd = Math.max(received ? start - lead : start, timeIn + 5);
  const workStart = received ? Math.max(start, prepEnd + 5) : prepEnd;
  const closeStart = Math.min(end, timeOut - 5);
  const endorseStart = endorse ? Math.min(end - endorseLead, closeStart - 5) : closeStart;

  return [
    entry('prep', timeIn, prepEnd, [prep]),
    received && entry('received', prepEnd, workStart, [received]),
    ...planWork(workLines(category, activities, wording), workStart, endorseStart),
    endorse && entry('endorse', endorseStart, closeStart, [endorse]),
    entry('timeout', closeStart, timeOut, [out])
  ].filter(Boolean);
}

const ACTIVITY_FIELDS = ['counts', 'vitalTimes', 'admissionTests', 'qc', 'cleaning', 'routine', 'otherTests', 'extraLines', 'from', 'to', 'timeIn', 'timeOut'];
const FORMAT = 2;

function createDuty(input, settings) {
  let start;
  let end;
  if (input.shift === 'custom') {
    start = input.start;
    end = input.end <= input.start ? input.end + 1440 : input.end;
  } else {
    if (!SHIFTS[input.shift]) throw new Error('Unknown shift "' + input.shift + '".');
    ({ start, end } = SHIFTS[input.shift]);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new Error('A duty needs a date.');
  const activities = {};
  for (const field of ACTIVITY_FIELDS) if (input[field] !== undefined) activities[field] = input[field];
  const category = categoryOf(input);
  const layout = LAYOUTS.includes(input.layout) ? input.layout : (settings.layouts || DEFAULT_LAYOUTS)[category];
  const duty = { id: newId(), format: FORMAT, date: input.date, shift: input.shift, category, layout, start, end, activities, selected: true };
  return { ...duty, entries: makeEntries(duty, settings) };
}

function describe(item) {
  if (item.text !== null && item.text !== undefined) return item.text;
  // {in} is filled in here, so it follows the start time when the user changes it.
  return item.lines.map((line) => line.text).filter(Boolean).join(' ')
    .replace(/\{in\}/g, () => T.time12(item.start).toLowerCase());
}

function siteEntries(duty) {
  // One night box for the whole duty: ticked if the shift or any entry runs past midnight.
  const night = duty.end > 1440 || duty.entries.some((item) => item.end > 1440);
  return duty.entries.map((item) => ({
    key: duty.id + ':' + item.id,
    dutyId: duty.id,
    entryId: item.id,
    dutyDate: duty.date,
    date: T.addDays(duty.date, Math.floor(item.start / 1440)),
    start: T.hhmm(item.start),
    end: T.hhmm(item.end),
    night,
    description: describe(item),
    allowPossible: !!item.allowPossible,
    unconfirmed: !!item.unconfirmed
  }));
}

function validate(duty, now) {
  const [year, month, day] = duty.date.split('-').map(Number);
  const problems = [];
  const report = (item, code, message) => problems.push({ entryId: item.id, code, message });

  duty.entries.forEach((item, i) => {
    const span = T.time12(item.start) + ' – ' + T.time12(item.end);
    if (item.end <= item.start) report(item, 'order', 'The end time is not after the start time (' + span + ').');
    if (duty.entries.slice(0, i).some((other) => item.start < other.end && other.start < item.end)) {
      report(item, 'overlap', 'This entry overlaps another one (' + span + ').');
    }
    if (!describe(item).trim()) report(item, 'empty', 'This entry has no description (' + span + ').');
    if (new Date(year, month - 1, day, 0, item.end) > now) {
      report(item, 'future', 'This entry has not ended yet (' + span + ').');
    }
  });
  return problems;
}

/* Editing */

const withEntry = (duty, entryId, change) => ({
  ...duty,
  entries: duty.entries.map((item) => (item.id === entryId ? { ...item, ...change(item) } : item))
});

function setTimes(duty, entryId, startClock, endClock) {
  const start = T.parseClock(startClock);
  const end = T.parseClock(endClock);
  if (start === null || end === null) return duty;
  // New times need a new "send it anyway".
  return withEntry(duty, entryId, (item) => ({
    start: T.resolveMinute(start, item.start), end: T.resolveMinute(end, item.end), allowPossible: false
  }));
}

const setText = (duty, entryId, text) => withEntry(duty, entryId, () => ({ text }));

function splitWork(duty, entryId, atMinute) {
  const index = duty.entries.findIndex((item) => item.id === entryId);
  const item = duty.entries[index];
  if (!item || item.kind !== 'work' || !(atMinute > item.start && atMinute < item.end)) return duty;
  const entries = duty.entries.slice();
  entries.splice(index, 1, { ...item, end: atMinute, allowPossible: false }, entry('work', atMinute, item.end, []));
  return { ...duty, entries };
}

// After lines were moved or split: joins parts that met in one interval and renumbers the rest.
function repart(duty, wording) {
  const seen = new Map(); // key before splitting → counts, in entry order
  const entries = duty.entries.map((item) => {
    if (item.kind !== 'work') return item;
    const joined = new Map();
    const list = [];
    for (const line of inOrder(item.lines)) {
      if (line.count === undefined) { list.push(line); continue; }
      const key = unsplit(line.key);
      if (joined.has(key)) joined.get(key).count += line.count;
      else { joined.set(key, { ...line }); list.push(joined.get(key)); }
    }
    return {
      ...item,
      lines: list.map((line) => {
        if (line.count === undefined) return line;
        const key = unsplit(line.key);
        const counts = seen.get(key) || [];
        seen.set(key, counts.concat(line.count));
        return worded({ ...line, key: counts.length ? key + '#' + counts.length : key }, item.variant || 0, wording);
      })
    };
  });
  const splits = {};
  for (const [key, counts] of seen) if (counts.length > 1) splits[key] = counts;
  return { ...duty, activities: { ...duty.activities, splits }, entries };
}

function moveLine(duty, lineKey, toEntryId, settings = defaultSettings()) {
  const target = duty.entries.find((item) => item.id === toEntryId && item.kind === 'work');
  const line = duty.entries.filter((item) => item.kind === 'work').flatMap((item) => item.lines).find((l) => l.key === lineKey);
  if (!target || !line) return duty;
  const moved = {
    ...duty,
    entries: duty.entries.map((item) => {
      if (item.kind !== 'work') return item;
      const kept = item.lines.filter((l) => l.key !== lineKey);
      if (item.id !== toEntryId) return { ...item, lines: kept };
      return { ...item, lines: inOrder(kept.concat(worded(line, item.variant || 0, settings.wording))) };
    })
  };
  return duty.format === FORMAT ? repart(moved, settings.wording) : moved;
}

// Moves part of a count to another interval. Only the amount the user gives is moved.
function splitCount(duty, entryId, lineKey, amount, toEntryId, settings) {
  const from = duty.entries.find((item) => item.id === entryId && item.kind === 'work');
  const to = duty.entries.find((item) => item.id === toEntryId && item.kind === 'work');
  const line = from && from.lines.find((l) => l.key === lineKey);
  if (!line || !to || to === from) throw new Error('Choose the interval to move the patients to.');
  if (line.count === undefined) throw new Error('This line has no count to split.');
  if (line.count < 2) throw new Error('A count of 1 cannot be split.');
  if (!Number.isInteger(amount) || amount < 1 || amount >= line.count) {
    throw new Error('Enter a whole number from 1 to ' + (line.count - 1) + '.');
  }
  if ((from.text ?? null) !== null || (to.text ?? null) !== null) {
    throw new Error('Press "Use the automatic text again" on both intervals first.');
  }
  const part = { ...line, key: unsplit(line.key) + '#new', count: amount };
  return repart({
    ...duty,
    entries: duty.entries.map((item) => {
      if (item === from) return { ...item, lines: item.lines.map((l) => (l === line ? { ...l, count: l.count - amount } : l)) };
      if (item === to) return { ...item, lines: item.lines.concat(part) };
      return item;
    })
  }, settings.wording);
}

function removeEmptyWork(duty, entryId) {
  const index = duty.entries.findIndex((item) => item.id === entryId);
  const item = duty.entries[index];
  const works = duty.entries.filter((e) => e.kind === 'work');
  if (!item || item.kind !== 'work' || works.length < 2 || item.lines.length || (item.text || '').trim()) return duty;
  const entries = duty.entries.slice();
  entries.splice(index, 1);
  const before = entries[index - 1];
  const after = entries[index];
  if (before && before.kind === 'work') entries[index - 1] = { ...before, end: item.end };
  else if (after && after.kind === 'work') entries[index] = { ...after, start: item.start };
  return { ...duty, entries };
}

// A new line goes where its kind of work is, if that entry has room; else to the last interval,
// if that has room; else the interval is cut in half. Hand-written entries are never used.
function placeLine(entries, line, wording) {
  const works = entries.filter((e) => e.kind === 'work');
  const related = works.filter((w) => w.lines.some((l) => groupIndex(l.key) === groupIndex(line.key)));
  const last = works[works.length - 1];
  const free = (w) => (w.text ?? null) === null && total(w.lines) + weight(line) <= MAX_SENTENCES;
  const target = related.find(free) || (free(last) ? last : null);
  const add = (item) => ({ ...item, lines: inOrder(item.lines.concat(worded(line, item.variant || 0, wording))) });
  if (target) return entries.map((item) => (item === target ? add(item) : item));

  const home = related[related.length - 1] || last;
  if (home.end - home.start < 10) return entries.map((item) => (item === home ? add(item) : item));
  const middle = Math.round((home.start + home.end) / 10) * 5;
  const cut = middle > home.start && middle < home.end ? middle : home.start + 5;
  return entries.flatMap((item) => (item === home
    ? [{ ...item, end: cut, allowPossible: false }, add(entry('work', cut, item.end, []))]
    : [item]));
}

function updateActivities(duty, patch, settings) {
  const activities = { ...duty.activities, ...patch };
  if (duty.format !== FORMAT) return resetTimes({ ...duty, activities }, settings);
  const { wording } = settings;
  const category = categoryOf(duty);
  if (layoutOf(duty) === 'whole') {
    const entries = duty.entries.map((item) => ({ ...item, lines: wholeLines(category, activities, wording, item.variant || 0) }));
    return { ...duty, activities, entries };
  }
  // An endorsement that appeared or went away (a nurse's patient number) needs a new plan.
  const missing = (kind) => !handoverLine(category, kind, activities, wording, 0);
  if (HANDOVERS.some((kind) => missing(kind) === duty.entries.some((item) => item.kind === kind))) {
    return resetTimes({ ...duty, activities }, settings);
  }
  // Splits of a count that changed no longer apply.
  const fresh = workLines(category, activities, wording);
  const byKey = new Map(fresh.map((line) => [line.key, line]));
  const placed = new Set();
  let entries = duty.entries.map((item) => {
    if (item.kind !== 'work') return { ...item, lines: [handoverLine(category, item.kind, activities, wording, item.variant || 0)] };
    const kept = item.lines.filter((line) => byKey.has(line.key)).map((line) => {
      placed.add(line.key);
      return worded(byKey.get(line.key), item.variant || 0, wording);
    });
    return { ...item, lines: inOrder(kept) };
  });
  const hadWork = new Set(duty.entries.filter((e) => e.kind === 'work' && e.lines.length).map((e) => e.id));
  for (const line of fresh) if (!placed.has(line.key)) entries = placeLine(entries, line, wording);

  let next = repart({ ...duty, activities, entries }, wording);
  // An interval whose activities were all removed gives its time back.
  for (const item of next.entries.filter((e) => e.kind === 'work' && hadWork.has(e.id))) next = removeEmptyWork(next, item.id);
  return next;
}

// Plans the intervals and default times again. Hand-written prep and endorsement text is kept.
function resetTimes(duty, settings) {
  const planned = makeEntries(duty, settings);
  const held = duty.entries.filter((e) => e.unconfirmed);
  const entries = planned.map((item) => {
    const old = duty.entries.filter((e) => e.kind === item.kind);
    // An entry of a new kind (the layout changed) keeps the mark of anything it overlaps.
    const unconfirmed = old.length ? old.some((e) => e.unconfirmed) : held.some((e) => item.start < e.end && e.start < item.end);
    const next = { ...item, unconfirmed };
    const oneForOne = old.length === 1 && planned.filter((e) => e.kind === item.kind).length === 1;
    if (!oneForOne) return next;
    const variant = old[0].variant || 0;
    return { ...next, id: old[0].id, text: old[0].text, variant, lines: next.lines.map((l) => worded(l, variant, settings.wording)) };
  });
  return { ...duty, format: FORMAT, entries };
}

function setLayout(duty, layout, settings) {
  if (!LAYOUTS.includes(layout) || layout === layoutOf(duty)) return duty;
  return resetTimes({ ...duty, layout }, settings);
}

const canRewrite = (item, wording) => item.lines.some((line) => line.template && phrases(wording, line.template).length > 1);

// Writes one entry, or every entry not written by hand, with the next phrasing.
function rewrite(duty, settings, entryId) {
  const current = duty.format === FORMAT ? duty : resetTimes(duty, settings);
  return {
    ...current,
    entries: current.entries.map((item) => {
      if (entryId ? item.id !== entryId : (item.text ?? null) !== null) return item;
      const variant = (item.variant || 0) + 1;
      return { ...item, variant, text: null, lines: item.lines.map((line) => worded(line, variant, settings.wording)) };
    })
  };
}

module.exports = {
  SHIFTS, ACTIVITY_KEYS, ROUTINE_KEYS, NURSE_KEYS, ATTENDANT_KEYS, CATEGORIES, LAYOUTS, WORDING, defaultSettings, categoryOf, layoutOf,
  createDuty, describe, siteEntries, validate, splitSentences, setTimes, setText, splitWork, moveLine, splitCount,
  removeEmptyWork, updateActivities, resetTimes, setLayout, rewrite, canRewrite
};
