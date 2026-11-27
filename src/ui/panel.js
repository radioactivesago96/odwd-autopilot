// The trainer panel. It shows the state held by the main process and sends actions back.
// Every piece of text is set with textContent or value, never as HTML.
(() => {
  const $ = (selector) => document.querySelector(selector);
  const odwd = window.odwd;

  const ACTIVITIES = [
    ['hema', 'Hematology'], ['micro', 'Clinical Microscopy'], ['serology', 'Serology'], ['crossmatch', 'Crossmatching'],
    ['chem', 'Clinical Chemistry'], ['immunoassay', 'Immunoassay'], ['electrolytes', 'Electrolytes'],
    ['admission', 'Admitted patients'], ['phleb', 'Phlebotomy'], ['ihomis', 'iHOMIS']
  ];
  // Written only when switched on.
  const ROUTINES = [
    ['supplies', 'Laboratory supplies checked'], ['reagents', 'Reagents and expiry dates checked'],
    ['analyzer', 'Analyzers checked'], ['workarea', 'Workstations organized'],
    ['logbooks', 'Logbooks updated'], ['results', 'Results verified and released']
  ];
  // The nurse's numbers, in the order of the entry.
  const NURSE = [
    ['censusIn', 'Endorsed to you'], ['ivfRegulated', 'IVF regulated'], ['ivfFollowed', 'IVF followed up'],
    ['ivReinserted', 'IV reinsertion'], ['ivRemoved', 'IV removal'], ['nebulized', 'Nebulization'],
    ['labResults', 'Lab results relayed'], ['oxygen', 'O2 inhalation'], ['medications', 'Oral and IVTT meds'],
    ['skinTest', 'Skin testing'], ['complaints', 'Complaints'], ['healthTeaching', 'Health teaching'],
    ['newAdmissions', 'New admissions'], ['discharges', 'For discharge'], ['censusOut', 'You endorsed']
  ];
  // The nurse attendant's numbers, in the order of the entry. The vital-sign rounds are apart.
  const ATTENDANT = [
    ['censusIn', 'Endorsed to you'], ['aBottles', 'Specimen bottles'], ['aSpecimens', 'Specimens sent'],
    ['aLabRequests', 'Lab requests encoded'], ['aDiet', 'Diet list updated'], ['aIvfAssist', 'IVF insertion assisted'],
    ['aIvFollowed', 'IV fluid followed up'], ['aIvTerminated', 'Dislodged IV ended'], ['aNewAdmit', 'New admits received'],
    ['aDietNew', 'Diet list, new admits'], ['aRequests', 'Patient requests'], ['aHeplock', 'Changed to heplock'],
    ['aNewborn', 'Newborns bathed'], ['aVsEncoded', 'Vital signs encoded']
  ];
  const VITALS = [['aVs1', '8pm'], ['aVs2', '12am'], ['aVs3', '4am']]; // key, example time
  const WARD_FIELDS = { nurse: NURSE, attendant: ATTENDANT.concat(VITALS.map(([key]) => [key])) };
  const CATEGORY_NAMES = { lab: 'Laboratory', nurse: 'Nurse', attendant: 'Nurse Attendant' };
  const SHORT_NAMES = { lab: 'Lab', nurse: 'Nurse', attendant: 'NA' }; // for the narrow top bar
  const LAYOUT_NAMES = [['intervals', 'Intervals (timed entries)'], ['whole', 'Whole (one entry)']];
  const WORDING_LABELS = {
    prep: 'Time in', received: 'Endorsement received ({name})', endorse: 'Endorsement to next shift ({name})', timeout: 'Time out',
    fallbackFrom: 'When no outgoing name', fallbackTo: 'When no incoming name',
    ...Object.fromEntries(ACTIVITIES), ...Object.fromEntries(ROUTINES), admissionCbc: 'New admissions: CBC',
    admissionChem: 'New admissions: chemistry ({tests})', admissionOther: 'New admissions: other tests ({name})',
    other: 'Other test ({name})', cleaning: 'Cleaning', qc: 'QC',
    ...Object.fromEntries(NURSE.map(([key, label]) => [key, 'Nurse: ' + label])),
    nLogin: 'Nurse: log-in', nReceive: 'Nurse: endorsed to you', nEndorse: 'Nurse: you endorsed', nLogout: 'Nurse: log-out',
    ...Object.fromEntries(ATTENDANT.filter(([key]) => key !== 'censusIn').map(([key, label]) => [key, 'NA: ' + label])),
    aVitals: 'NA: vital signs ({at} is the time)', aLogin: 'NA: log-in ({in} is the start time)', aReceive: 'NA: endorsed to you',
    aEndorse: 'NA: endorsement', aLogout: 'NA: log-out'
  };
  const KIND = { whole: 'Whole duty', prep: 'Time in', received: 'Endorsement received', work: 'Duty work', endorse: 'Endorsement to next shift', timeout: 'Time out' };
  const MARK = { logged: 'ON SITE', possible: 'POSSIBLE DUPLICATE', unconfirmed: 'NOT CONFIRMED', new: 'NEW' };

  let state = null;
  let localNotice = '';
  const open = new Set();
  const expanded = new Set(); // "Activities in this interval" lists the user opened
  let deleting = null;
  let pointerDown = false;
  let renderWanted = false;
  let drawn = '';
  let startPreviewed = null; // sends what the open preview shows

  /* Helpers */

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'text') el.textContent = value;
      else if (key === 'class') el.className = value;
      else if (key === 'data') Object.assign(el.dataset, value);
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value);
    }
    el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  }

  const dateLabel = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const time12 = (minutes) => {
    const m = ((minutes % 1440) + 1440) % 1440;
    const hour = Math.floor(m / 60);
    return (hour % 12 || 12) + ':' + String(m % 60).padStart(2, '0') + ' ' + (hour >= 12 ? 'PM' : 'AM');
  };
  const shiftLabel = (duty) => (state.shifts[duty.shift] ? state.shifts[duty.shift].label : time12(duty.start) + ' – ' + time12(duty.end));

  const layoutSelect = (id, value) => {
    const select = h('select', { id }, ...LAYOUT_NAMES.map(([key, text]) => h('option', { value: key, text })));
    select.value = value;
    return select;
  };
  // "Nurse · 3 PM – 11 PM · Whole"
  const dutyNote = (duty) => [WARD_FIELDS[duty.category] && CATEGORY_NAMES[duty.category], shiftLabel(duty),
    duty.layout === 'whole' && 'Whole'].filter(Boolean).join(' · ');

  async function send(action) {
    localNotice = '';
    const next = await odwd.dispatch(action);
    update(next);
    return next;
  }

  function update(next) {
    if (!next) return;
    state = next;
    render();
  }

  /* Preview: the entries as the site's logs will list them */

  const spent = (minutes) => (minutes >= 60 ? Math.floor(minutes / 60) + ' hr ' : '') + (minutes % 60) + ' min';

  function previewDuty(duty, entries, withMarks) {
    const night = duty.end > 1440 || duty.entries.some((e) => e.end > 1440);
    const rows = entries.map((e) => {
      const mark = duty.marks[e.id];
      const notes = !withMarks ? [] : [mark && mark !== 'new' && MARK[mark],
        ...duty.problems.filter((p) => p.entryId === e.id).map((p) => p.message)].filter(Boolean);
      return h('tr', {},
        h('td', { text: time12(e.start) }, e.date !== duty.date && h('small', { text: dateLabel(e.date) })),
        h('td', { text: time12(e.end) }),
        h('td', { text: spent(Math.max(0, e.end - e.start)) }),
        h('td', { class: 'what' }, h('span', { text: e.description }),
          ...notes.map((text) => h('small', { class: 'problem future', text }))));
    });
    const total = entries.reduce((sum, e) => sum + Math.max(0, e.end - e.start), 0);
    return h('section', { class: 'preview-duty' },
      h('h3', { text: dateLabel(duty.date) + ' · ' + dutyNote(duty) }),
      night && h('p', { class: 'muted', text: 'The Night shift box will be ticked.' }),
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Start Time', 'End Time', 'Time Spent', 'Task Description'].map((text) => h('th', { text })))),
        h('tbody', {}, ...rows),
        h('tfoot', {}, h('tr', {}, h('th', { text: 'Total time spent', colSpan: 2 }), h('td', { text: spent(total), colSpan: 2 })))));
  }

  // groups: [[duty, entries]]. With onStart the preview can send them; without it, it only shows.
  function openPreview(note, groups, onStart) {
    startPreviewed = onStart;
    $('#preview-note').textContent = note;
    $('#preview-body').replaceChildren(...groups.map(([duty, entries]) => previewDuty(duty, entries, !onStart)));
    $('#preview-start').hidden = !onStart;
    $('#preview-close').textContent = onStart ? 'Cancel' : 'Close';
    $('#preview').hidden = false;
    $('#preview-body').scrollTop = 0;
    $('#app').inert = true;
    odwd.showSite(false);
    $(onStart ? '#preview-start' : '#preview-close').focus();
  }

  function closePreview() {
    if ($('#preview').hidden) return;
    $('#preview').hidden = true;
    $('#app').inert = false;
    startPreviewed = null;
    odwd.showSite(true);
  }

  async function previewOne(id) {
    const fresh = await odwd.state(); // includes a field that was just left
    const duty = fresh.duties.find((d) => d.id === id);
    if (duty) openPreview('How this duty will look in your logs. Nothing is sent from here.', [[duty, duty.entries]], null);
  }

  /* Duty list */

  function entryView(duty, item) {
    const works = duty.entries.filter((e) => e.kind === 'work');
    const mark = duty.marks[item.id];
    const key = duty.id + ':' + item.id;
    const ids = { dutyId: duty.id, entryId: item.id };

    const clock = (which, value) => h('input', {
      type: 'time', class: which, value, 'aria-label': which + ' time',
      data: { key: key + ':' + which, saved: value, commit: 'times', duty: duty.id, entry: item.id }
    });
    const text = h('textarea', {
      class: 'desc', rows: item.kind === 'whole' ? 16 : 3, value: item.description, 'aria-label': 'Task description',
      data: { key: key + ':text', saved: item.description, commit: 'text', duty: duty.id, entry: item.id }
    });

    const parts = [
      h('div', { class: 'entry-head' },
        h('strong', { text: item.kind === 'work' && works.length > 1 ? 'Interval ' + (works.indexOf(item) + 1) + ' of ' + works.length : KIND[item.kind] }),
        h('span', { class: 'muted', text: item.date === duty.date ? '' : dateLabel(item.date) }),
        mark && h('span', { class: 'chip ' + mark, text: MARK[mark] })),
      h('div', { class: 'times' }, clock('start', item.startClock), h('span', { text: 'to' }), clock('end', item.endClock)),
      text,
      item.text !== null && h('button', { class: 'link', text: 'Use the automatic text again', onclick: () => send({ type: 'setText', ...ids, text: null }) }),
      item.text === null && item.rewritable && h('div', { class: 'row' },
        h('button', { class: 'rewrite', text: 'Rewrite', title: 'Say it another way', data: { key: key + ':rewrite' }, onclick: () => send({ type: 'rewriteEntry', ...ids }) }))
    ];

    if (item.kind === 'work') {
      if (works.length > 1 && item.lines.length) {
        const rows = [h('summary', { text: 'Move or split activities' })];
        const span = (w) => w.startClock + '–' + w.endClock;
        for (const line of item.lines) {
          const select = h('select', {
            'aria-label': 'Move this line', data: { key: key + ':move:' + line.key },
            onchange: (event) => send({ type: 'moveLine', dutyId: duty.id, lineKey: line.key, entryId: event.target.value })
          }, ...works.map((w) => h('option', { value: w.id, text: span(w) })));
          select.value = item.id;
          rows.push(h('div', { class: 'line' }, h('span', { text: line.text }), select));
          if (line.count > 1) {
            const amount = h('input', {
              type: 'number', class: 'amount', min: 1, max: line.count - 1, step: 1, placeholder: 'No.',
              'aria-label': 'How many of ' + line.count + ' to move', data: { key: key + ':amount:' + line.key, saved: '' }
            });
            const target = h('select', { class: 'target', 'aria-label': 'Move them to', data: { key: key + ':target:' + line.key, saved: '' } },
              ...works.filter((w) => w.id !== item.id).map((w) => h('option', { value: w.id, text: span(w) })));
            // The first choice is what the box shows at the start; keep a later choice through redraws.
            target.dataset.saved = target.value;
            rows.push(h('div', { class: 'line split' }, h('span', { text: 'Move some of ' + line.count }), amount, target,
              h('button', {
                class: 'split-count', text: 'Move',
                onclick: () => send({ type: 'splitCount', ...ids, lineKey: line.key, amount: Number(amount.value), toEntryId: target.value })
              })));
          }
        }
        parts.push(h('details', {
          class: 'move', open: expanded.has(key),
          ontoggle: (event) => { if (event.target.open) expanded.add(key); else expanded.delete(key); }
        }, ...rows));
      }
      const at = h('input', { type: 'time', class: 'split-at', 'aria-label': 'Split at', data: { key: key + ':split', saved: '' } });
      parts.push(h('div', { class: 'row' },
        at,
        h('button', { text: 'Split work', title: 'Add a work entry', onclick: () => send({ type: 'splitWork', ...ids, at: at.value || undefined }) }),
        item.start < 1440 && item.end > 1440 && h('button', { text: 'Split at midnight', onclick: () => send({ type: 'splitWork', ...ids, at: '00:00' }) }),
        works.length > 1 && !item.lines.length && !(item.text || '').trim() &&
          h('button', { text: 'Remove', onclick: () => send({ type: 'removeEmptyWork', ...ids }) })));
    }
    if (mark === 'unconfirmed') {
      parts.push(h('div', { class: 'problem future', text: 'Save was pressed but not confirmed. Check your logs on the site.' }));
    }
    if (mark === 'possible' || mark === 'unconfirmed') {
      parts.push(h('label', { class: 'switch' },
        h('input', {
          type: 'checkbox', checked: !!item.allowPossible, data: { key: key + ':allow' },
          onchange: (event) => send({ type: 'allowPossible', ...ids, value: event.target.checked })
        }),
        h('span', { text: 'Send it anyway' })));
    }
    for (const problem of duty.problems.filter((p) => p.entryId === item.id)) {
      parts.push(h('div', { class: 'problem ' + problem.code, text: problem.message }));
    }
    return h('div', { class: 'entry' }, ...parts);
  }

  function badge(duty) {
    const marks = duty.entries.map((e) => duty.marks[e.id]);
    if (marks.some((m) => !m)) return '';
    if (marks.every((m) => m === 'logged')) return 'SAVED';
    return marks.every((m) => m === 'new') ? 'NEW' : 'PARTLY';
  }

  function dutyView(duty) {
    const isOpen = open.has(duty.id);
    const blocking = duty.problems.some((p) => p.code !== 'future');
    const waiting = duty.problems.some((p) => p.code === 'future');
    const label = badge(duty);
    return h('li', { class: 'duty' + (isOpen ? ' open' : '') },
      h('div', { class: 'head' },
        h('input', {
          type: 'checkbox', class: 'pick', checked: duty.selected, 'aria-label': 'Include this duty', data: { key: duty.id + ':pick' },
          onchange: (event) => send({ type: 'select', id: duty.id, value: event.target.checked })
        }),
        h('button', {
          class: 'title', 'aria-expanded': String(isOpen), data: { key: duty.id + ':title' },
          onclick: () => { if (isOpen) open.delete(duty.id); else open.add(duty.id); drawn = ''; render(); }
        }, h('span', { text: dateLabel(duty.date) }), h('small', { text: dutyNote(duty) })),
        blocking && h('span', { class: 'chip problem-chip', text: 'CHECK' }),
        !blocking && waiting && h('span', { class: 'chip', text: 'NOT ENDED' }),
        label && h('span', { class: 'badge ' + label.toLowerCase(), text: label })),
      isOpen && h('div', { class: 'body' },
        ...duty.entries.map((item) => entryView(duty, item)),
        h('div', { class: 'row' },
          h('button', {
            class: 'primary write', text: 'Write entries', title: 'Write them again with other phrasings',
            data: { key: duty.id + ':write' }, onclick: () => send({ type: 'writeEntries', dutyId: duty.id })
          }),
          h('button', { class: 'preview', text: 'Preview', onclick: () => previewOne(duty.id) }),
          h('button', { text: 'Activities', onclick: () => dutyForm(duty) }),
          h('button', {
            class: 'replan', text: duty.layout === 'whole' ? 'Reset times' : 'Re-plan intervals',
            onclick: () => send({ type: 'resetTimes', dutyId: duty.id })
          }),
          h('button', {
            class: 'danger', text: deleting === duty.id ? 'Click again to delete' : 'Delete',
            onclick: () => {
              if (deleting === duty.id) { deleting = null; send({ type: 'deleteDuty', id: duty.id }); return; }
              deleting = duty.id; drawn = ''; render();
            }
          }))));
  }

  /* Rendering */

  const SITE_TEXT = { ready: 'Ready', login: 'Log in on the site', other: 'Open the Dashboard', unknown: 'Waiting for the site' };

  function progressText() {
    const run = state.run;
    if (!run) return '';
    const e = run.event;
    if (!state.running) return e.message || '';
    if (run.paused) return 'Paused. F8 continues.';
    const step = 'Entry ' + Math.min(e.index + 1, e.total) + ' of ' + e.total;
    if (e.type === 'waiting') return step + ': ' + e.message;
    const verb = { checking: 'checking', typing: 'typing', saved: 'saved', skipped: 'skipped' }[e.type] || 'working';
    return step + ': ' + verb + '…';
  }

  function render() {
    if (!state) return;
    // A redraw between pressing and releasing the mouse would swallow the click.
    if (pointerDown) { renderWanted = true; return; }
    const running = state.running;

    $('#site').textContent = SITE_TEXT[state.site];
    $('#site').className = 'status ' + state.site;

    const notices = [localNotice, state.warning, state.siteError,
      state.blocked.length ? 'Blocked: ' + state.blocked.join(', ') : ''].filter(Boolean);
    $('#notice').textContent = notices.join('\n');

    const picked = state.duties.filter((d) => d.selected).length;
    $('#duty-count').textContent = state.duties.length ? picked + ' of ' + state.duties.length + ' selected' : 'No duties yet. Import a report or add one.';

    const signature = JSON.stringify([state.duties, [...open], deleting, running]);
    if (signature !== drawn) {
      drawn = signature;
      const active = document.activeElement;
      const key = active && active.dataset ? active.dataset.key : null;
      const unsaved = key && active.dataset.saved !== undefined && active.value !== active.dataset.saved ? active.value : null;
      const scroll = $('#scroll').scrollTop;
      $('#duties').replaceChildren(...state.duties.map(dutyView));
      $('#scroll').scrollTop = scroll;
      if (key) {
        const again = document.querySelector('[data-key="' + CSS.escape(key) + '"]');
        if (again) {
          if (unsaved !== null) again.value = unsaved;
          again.focus({ preventScroll: true });
        }
      }
    }

    const skipped = $('#skipped');
    skipped.hidden = !state.skipped.length;
    skipped.querySelector('summary').textContent = state.skipped.length + ' skipped';
    skipped.querySelector('ul').replaceChildren(...state.skipped.map((s) =>
      h('li', { text: (s.date ? dateLabel(s.date) : s.source) + ': ' + s.reason })));

    for (const el of document.querySelectorAll('.tools button, .select-row button, #duties input, #duties textarea, #duties select, #duties .body button, #check, #fill, .speed button, #home')) {
      el.disabled = running;
    }
    for (const el of document.querySelectorAll('.speed button')) {
      el.setAttribute('aria-checked', String(el.dataset.speed === state.settings.speed));
    }
    const section = state.settings.category;
    $('#section').textContent = SHORT_NAMES[section];
    $('#section').title = 'Your section: ' + CATEGORY_NAMES[section] + '. Click to change it.';
    $('#section').disabled = running;
    // Reports that can be imported are laboratory reports.
    $('#import').disabled = running || section !== 'lab';
    $('#import').title = section !== 'lab' ? 'Import is for laboratory reports' : '';
    const auto = $('#auto');
    const inAutopilot = running && !!state.run && state.run.mode === 'autopilot';
    auto.textContent = !inAutopilot ? 'F8 AUTOPILOT' : state.run.paused ? 'F8 RESUME' : 'F8 PAUSE';
    auto.disabled = running && !inAutopilot;
    $('#stop').disabled = !running;
    $('#progress').textContent = progressText();
  }

  /* Saving a field when the cursor leaves it */

  async function commit(el) {
    if (!el || !el.dataset || !el.dataset.commit || el.value === el.dataset.saved || el.disabled) return;
    const ids = { dutyId: el.dataset.duty, entryId: el.dataset.entry };
    if (el.dataset.commit === 'text') {
      el.dataset.saved = el.value;
      await send({ type: 'setText', ...ids, text: el.value });
      return;
    }
    const row = el.closest('.times');
    const start = row.querySelector('.start');
    const end = row.querySelector('.end');
    if (!start.value || !end.value) return;
    start.dataset.saved = start.value;
    end.dataset.saved = end.value;
    await send({ type: 'setTimes', ...ids, start: start.value, end: end.value });
  }

  document.addEventListener('focusout', (event) => { commit(event.target); });
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  const released = () => {
    setTimeout(() => {
      pointerDown = false;
      if (renderWanted) { renderWanted = false; render(); }
    }, 0);
  };
  document.addEventListener('pointerup', released, true);
  document.addEventListener('pointercancel', released, true);
  window.addEventListener('blur', released);

  /* Sheets: add or edit a duty, settings */

  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheet').replaceChildren();
  }

  // A sheet with only a Close or Cancel button.
  function showPage(title, content, closeId, closeText) {
    $('#sheet').replaceChildren(h('div', {},
      h('h2', { text: title }),
      ...content,
      h('div', { class: 'row sticky' }, h('button', { type: 'button', id: closeId, text: closeText, onclick: closeSheet }))));
    $('#sheet').hidden = false;
  }

  function sectionSheet() {
    const choose = (category) => { closeSheet(); send({ type: 'settings', patch: { category } }); };
    showPage('What section are you?', [
      h('div', { class: 'sections' }, ...Object.entries(CATEGORY_NAMES).map(([key, name]) => h('button', {
        type: 'button', class: key === state.settings.category ? 'chosen' : '', data: { section: key }, text: name,
        onclick: () => choose(key)
      })))
    ], 'section-cancel', 'Cancel');
  }

  function aboutSheet() {
    showPage('About', [
      h('div', { class: 'logo-card' }, h('img', { id: 'logo', src: 'img/sago-logo.png', alt: 'sago' })),
      h('p', { class: 'about-name', text: 'ODWD Autopilot ' + state.version }),
      h('p', { text: 'Types Online Work Diary entries for the Laboratory, Nurse and Nurse Attendant sections.' }),
      h('p', { text: 'Made by sago.' }),
      h('p', { class: 'problem future', text: 'It is a typing helper, not an excuse to get lazy. Enter only work you really did, and read every entry before it is saved.' }),
      h('p', { class: 'muted', text: 'Built with Electron and PDF.js.' })
    ], 'about-close', 'Close');
  }

  function showSheet(title, fields, saveId, onSave) {
    const error = h('div', { class: 'problem', role: 'alert' });
    const form = h('form', {
      onsubmit: (event) => {
        event.preventDefault();
        const message = onSave();
        if (message) error.textContent = message;
        else closeSheet();
      }
    },
      h('h2', { text: title }),
      ...fields,
      error,
      h('div', { class: 'row sticky' },
        h('button', { type: 'button', id: saveId.replace('save', 'cancel'), text: 'Cancel', onclick: closeSheet }),
        h('button', { type: 'submit', id: saveId, class: 'primary', text: 'Save' })));
    $('#sheet').replaceChildren(form);
    $('#sheet').hidden = false;
  }

  const field = (label, control) => h('label', { class: 'field' }, h('span', { text: label }), control);
  const input = (id, props = {}) => h('input', { id, ...props });

  function dutyForm(duty) {
    const a = duty ? duty.activities : {};
    const counts = a.counts || {};
    const today = new Date();
    const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    const category = duty ? duty.category || 'lab' : state.settings.category;
    const ward = WARD_FIELDS[category]; // undefined for the laboratory
    const layout = layoutSelect('f-layout', duty ? duty.layout || 'intervals' : state.settings.layouts[category]);
    const date = input('f-date', { type: 'date', value: duty ? duty.date : iso, disabled: !!duty });
    const shift = h('select', { id: 'f-shift', disabled: !!duty },
      ...Object.entries(state.shifts).map(([key, s]) => h('option', { value: key, text: s.label })),
      h('option', { value: 'custom', text: 'Custom times' }));
    shift.value = duty ? duty.shift : '11-7';
    const start = input('f-start', { type: 'time', disabled: !!duty });
    const end = input('f-end', { type: 'time', disabled: !!duty });
    const custom = h('div', { class: 'row' }, field('Start', start), field('End', end));
    const showCustom = () => { custom.hidden = !!duty || shift.value !== 'custom'; };
    shift.addEventListener('change', showCustom);
    showCustom();

    const numbers = (list) => list.map(([key, label]) => field(label, input('f-' + key, { type: 'number', min: 0, step: 1, value: counts[key] ?? '' })));
    const tests = input('f-admissionTests', { value: a.admissionTests || '', placeholder: 'CBC; FBS; Creatinine' });
    const qc = input('f-qc', { type: 'checkbox', checked: !!a.qc });
    const cleaning = input('f-cleaning', { type: 'checkbox', checked: !!a.cleaning });
    const other = h('textarea', { id: 'f-other', rows: 2, placeholder: 'Gram Stain: 2', value: (a.otherTests || []).map((o) => o.name + ': ' + o.count).join('\n') });
    const extra = h('textarea', { id: 'f-extra', rows: 3, placeholder: 'One task on each line', value: (a.extraLines || []).join('\n') });
    const routine = ROUTINES.map(([key, label]) => {
      const box = input('f-r-' + key, { type: 'checkbox', checked: (a.routine || []).includes(key) });
      return h('label', { class: 'switch' }, box, h('span', { text: label }));
    });
    const from = input('f-from', { value: a.from || '' });
    const to = input('f-to', { value: a.to || '' });
    const lines = (el) => el.value.split('\n').map((s) => s.trim()).filter(Boolean);

    const labFields = h('div', { id: 'f-lab' },
      h('h3', { text: 'Patients' }), h('div', { class: 'grid' }, ...numbers(ACTIVITIES)),
      field('Tests for admitted patients', tests),
      h('label', { class: 'switch' }, cleaning, h('span', { text: 'Laboratory cleaning done' })),
      h('label', { class: 'switch' }, qc, h('span', { text: 'QC done' })),
      h('h3', { text: 'Routine tasks (only the ones you did)' }), ...routine,
      field('Other tests (name: patients)', other));
    const blanks = () => h('p', { class: 'muted', text: 'Blank leaves a sentence out. A 0 is written as 0.' });
    const nurseFields = h('div', { id: 'f-nurse' },
      h('h3', { text: 'Patients' }), blanks(),
      h('div', { class: 'grid' }, ...(category === 'nurse' ? numbers(NURSE) : [])));
    const vitalRows = () => VITALS.map(([key, example], i) => h('div', { class: 'row vitals' },
      field('Round ' + (i + 1) + ' time', input('f-vt' + i, { value: (a.vitalTimes || [])[i] || '', placeholder: example })),
      field('Patients', input('f-' + key, { type: 'number', min: 0, step: 1, value: counts[key] ?? '' }))));
    const attendantFields = h('div', { id: 'f-attendant' }, ...(category !== 'attendant' ? [] : [
      h('h3', { text: 'Vital signs' }), ...vitalRows(),
      h('h3', { text: 'Patients and items' }), blanks(),
      h('div', { class: 'grid' }, ...numbers(ATTENDANT))
    ]));
    const handover = h('div', { id: 'f-handover' },
      field('Endorsement received from', from), field('Endorsed to', to));
    labFields.hidden = !!ward;
    handover.hidden = !!ward;
    nurseFields.hidden = category !== 'nurse';
    attendantFields.hidden = category !== 'attendant';

    showSheet((duty ? 'ACTIVITIES' : 'NEW DUTY') + ' · ' + CATEGORY_NAMES[category], [
      field('Entries', layout),
      field('Date', date), field('Shift', shift), custom,
      labFields, nurseFields, attendantFields, field('Other tasks', extra), handover
    ], 'form-save', () => {
      const activities = ward ? { counts: {}, extraLines: lines(extra) } : {
        counts: {}, admissionTests: tests.value.trim(), qc: qc.checked, cleaning: cleaning.checked,
        otherTests: [], extraLines: lines(extra), from: from.value.trim(), to: to.value.trim(),
        routine: ROUTINES.map(([key]) => key).filter((key) => $('#f-r-' + key).checked)
      };
      if (category === 'attendant') activities.vitalTimes = VITALS.map((v, i) => $('#f-vt' + i).value.trim());
      for (const [key] of ward || ACTIVITIES) {
        const el = $('#f-' + key);
        if (el.value === '') continue;
        const n = Number(el.value);
        if (!Number.isInteger(n) || n < 0) return 'Counts must be whole numbers.';
        if (n || ward) activities.counts[key] = n;
      }
      for (const line of ward ? [] : lines(other)) {
        const match = line.match(/^(.+?)\s*[:=]\s*(\d+)$/);
        if (!match) return 'Write other tests as "name: number", for example "Gram Stain: 2".';
        activities.otherTests.push({ name: match[1], count: Number(match[2]) });
      }
      const worked = Object.keys(activities.counts).length || activities.qc || activities.cleaning ||
        activities.extraLines.length || (activities.otherTests || []).length || (activities.routine || []).length;
      if (!worked) return ward ? 'Enter at least one number or task.' : 'Enter at least one activity.';
      if (duty) { send({ type: 'updateActivities', dutyId: duty.id, patch: activities, layout: layout.value }); return ''; }
      if (!date.value) return 'Choose the date.';
      const request = { date: date.value, shift: shift.value, category, layout: layout.value, ...activities };
      if (shift.value === 'custom') {
        if (!start.value || !end.value) return 'Enter the start and end of the shift.';
        const minutes = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
        request.start = minutes(start.value);
        request.end = minutes(end.value);
      }
      send({ type: 'addDuty', input: request });
      return '';
    });
  }

  function settingsForm() {
    const s = state.settings;
    const number = (key) => input('s-' + key, { type: 'number', min: 0, step: 1, value: s[key] });
    const speed = h('select', { id: 's-speed' },
      ...[['instant', 'Instant'], ['fast', 'Fast'], ['slow', 'Slow'], ['human', 'Human typing']].map(([value, text]) => h('option', { value, text })));
    speed.value = s.speed;
    const wording = Object.keys(s.wording).map((key) =>
      field(WORDING_LABELS[key] || key, h('textarea', { id: 's-t-' + key, rows: 3, value: s.wording[key] })));

    showSheet('SETTINGS', [
      h('p', { class: 'muted', text: 'Times apply to new duties. Use "Re-plan intervals" on a duty already in the list.' }),
      field('Time in: minutes before shift start', number('minutesEarly')),
      field('Endorsement received: minutes before shift start', number('receiveLead')),
      field('Endorsement to next shift: minutes before shift end', number('endorseLead')),
      field('Time out: minutes after shift end', number('endAfter')),
      field('Typing speed', speed),
      field('Laboratory entries', layoutSelect('s-layout-lab', s.layouts.lab)),
      field('Nurse entries', layoutSelect('s-layout-nurse', s.layouts.nurse)),
      field('Nurse Attendant entries', layoutSelect('s-layout-attendant', s.layouts.attendant)),
      h('h3', { text: 'Wording' }),
      h('p', { class: 'muted', text: 'One phrasing on each line; Rewrite takes the next one. {n} is the count; {s} or {S} adds the plural s or S.' }),
      ...wording,
      h('p', { class: 'muted', text: 'Data folder: ' + state.dataDir })
    ], 'settings-save', () => {
      const layouts = Object.fromEntries(Object.keys(CATEGORY_NAMES).map((key) => [key, $('#s-layout-' + key).value]));
      const patch = { speed: speed.value, wording: {}, layouts };
      for (const key of ['minutesEarly', 'receiveLead', 'endorseLead', 'endAfter']) patch[key] = Number($('#s-' + key).value);
      for (const key of Object.keys(s.wording)) patch.wording[key] = $('#s-t-' + key).value;
      send({ type: 'settings', patch });
      return '';
    });
  }

  /* Running */

  function notice(text) {
    localNotice = text;
    render();
  }

  // What Autopilot would send now, after reading the logs.
  async function askAutopilot() {
    await commit(document.activeElement);
    const checked = await send({ type: 'check' });
    if (!checked || !checked.checkOk) return;
    const chosen = checked.duties.filter((d) => d.selected);
    if (!chosen.length) { notice('Select at least one duty first.'); return; }
    const groups = [];
    let left = 0;
    for (const duty of chosen) {
      const blocking = duty.problems.find((p) => p.code !== 'future');
      if (blocking) { notice('Fix this first (' + dateLabel(duty.date) + '): ' + blocking.message); return; }
      const ready = duty.entries.filter((e) => duty.marks[e.id] !== 'logged' &&
        !((duty.marks[e.id] === 'possible' || duty.marks[e.id] === 'unconfirmed') && !e.allowPossible) &&
        !duty.problems.some((p) => p.entryId === e.id));
      left += duty.entries.length - ready.length;
      if (ready.length) groups.push([duty, ready]);
    }
    const entries = groups.reduce((sum, [, list]) => sum + list.length, 0);
    if (!entries) { notice('Nothing new to send: everything selected is already saved, a possible duplicate, not confirmed, or not ended yet.'); return; }
    const note = entries + (entries === 1 ? ' entry' : ' entries') + ' from ' + groups.length +
      (groups.length === 1 ? ' duty' : ' duties') + ' will be saved to HRMIS, exactly as shown.' +
      (left ? ' Not shown: ' + left + ' already saved, possible duplicate, not confirmed or not ended.' : '');
    const only = groups.flatMap(([, list]) => list.map((e) => e.id));
    openPreview(note, groups, () => send({ type: 'autopilot', only }));
  }

  const modalOpen = () => !$('#intro').hidden || !$('#sheet').hidden || !$('#preview').hidden;

  async function pressAuto() {
    if (state.running) {
      if (state.run && state.run.mode === 'autopilot') await send({ type: state.run.paused ? 'resume' : 'pause' });
    } else if (!modalOpen()) {
      await askAutopilot();
    }
  }

  async function pressFill() {
    if (state.running || modalOpen()) return;
    await commit(document.activeElement);
    await send({ type: 'fillNext' });
  }

  /* Wiring */

  $('#import').onclick = () => $('#file').click();
  $('#file').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      if (/\.pdf$/i.test(file.name)) {
        await send({ type: 'import', name: file.name, pages: await window.readPdfPages(buffer) });
      } else {
        let text;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch (error) {
          text = new TextDecoder('windows-1252').decode(buffer); // CSV saved by Excel
        }
        await send({ type: 'import', name: file.name, text });
      }
    } catch (error) {
      notice('Could not read ' + file.name + ': ' + error.message);
    } finally {
      event.target.value = '';
    }
  };
  $('#add').onclick = () => dutyForm(null);
  $('#open-settings').onclick = settingsForm;
  $('#home').onclick = () => odwd.home();
  const selectAll = async (value) => { for (const d of state.duties) if (d.selected !== value) await send({ type: 'select', id: d.id, value }); };
  $('#select-all').onclick = () => selectAll(true);
  $('#select-none').onclick = () => selectAll(false);
  for (const el of document.querySelectorAll('.speed button')) {
    el.onclick = () => send({ type: 'settings', patch: { speed: el.dataset.speed } });
  }
  $('#check').onclick = () => send({ type: 'check' });
  $('#fill').onclick = pressFill;
  $('#auto').onclick = pressAuto;
  $('#stop').onclick = () => send({ type: 'stop' });
  $('#section').onclick = sectionSheet;
  $('#about').onclick = aboutSheet;
  $('#preview-close').onclick = closePreview;
  $('#preview-start').onclick = () => {
    const go = startPreviewed;
    closePreview();
    if (go) go();
  };

  odwd.onState(update);
  odwd.onHotkey((key) => {
    if (!state) return;
    if (key === 'F6') pressFill();
    else if (key === 'F8') pressAuto();
    else if (!$('#preview').hidden) closePreview();
    else if (!$('#sheet').hidden) closeSheet();
  });
  odwd.state().then(update);
  setInterval(() => odwd.state().then(update), 30000); // entries become sendable as time passes
})();
