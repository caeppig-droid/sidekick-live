/* Sidekick Live — script.js
   Plain JavaScript. Host (teacher) browser is the single source of truth;
   students only send requests. Multiplayer via PeerJS 1.5.4. */
'use strict';

/* =====================================================================
   1. SETTINGS YOU MAY CHANGE
   ===================================================================== */
const TEACHER_PIN = '2468';          // Teacher PIN. Change before sharing with families.
const MAX_STUDENTS = 100;            // Hard cap per session.
const GOAL_PCT = 0.8;                // Class earns a star when this share of connected students answers.

/* =====================================================================
   2. CONSTANTS
   ===================================================================== */
const APP = 'sidekicklive';
const VER = 'v1';
const NS = APP + '.' + VER + '.';
const PEER_PREFIX = 'sidekick-live-';
const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY34679';   // no 0/O, 1/I/L, 2/Z, 5/S, 8/B
const SLIDE_MAX_W = 1280;
const PREVIEW_W = 400;
const CHUNK = 12000;                 // slide bytes per message (under PeerJS's 16 KB packet size)
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const KEYS = {
  sets: NS + 'sets', report: NS + 'report', pinLock: NS + 'pinlock', prefs: NS + 'prefs',
  settings: NS + 'settings', wheels: NS + 'wheels', wbTiles: NS + 'wbtiles', games: NS + 'games', host: NS + 'hostsession', student: NS + 'student', teacherOk: NS + 'teacherok'
};
const IDB_NAME = NS + 'db';
const QS = new URLSearchParams(location.search);
const REACTIONS = ['👏', '💡', '👍', '❤️', '🤩'];
const CHECKIN = [
  { v: 'got', e: '😀', label: 'Got it' },
  { v: 'kinda', e: '🤔', label: 'Kinda' },
  { v: 'lost', e: '😵‍💫', label: 'Lost me' }
];

/* =====================================================================
   3. SMALL UTILITIES
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
function show(id) { document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; }); window.scrollTo(0, 0); }
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function rand(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
function randFloat() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function uid(n = 10) { const c = 'abcdefghijkmnpqrstuvwxyz23456789'; const a = new Uint32Array(n); crypto.getRandomValues(a); let s = ''; for (const x of a) s += c[x % c.length]; return s; }
function makeCode() { let s = ''; for (let i = 0; i < 4; i++) s += CODE_CHARS[rand(CODE_CHARS.length)]; return s; }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast('Could not save: this browser’s storage is full.'); return false; } }
function ssGet(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
function ssDel(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } }
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function cleanText(s, max = 200) { return String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, max); }
function norm(s) { return String(s ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().replace(/[.!?,;:]+$/, ''); }
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.rate = 0.9; speechSynthesis.speak(u);
}
function download(name, text, type = 'text/csv;charset=utf-8') {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function dateStamp() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function naturalSort(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
function readBtn(fn) { return el('button', { class: 'btn read-btn', type: 'button', onclick: () => speak(fn()) }, '🔊 Read to me'); }
function makeTicker(ms, fn) {
  // A worker timer keeps ticking even when the tab is in the background.
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),' + ms + ')'], { type: 'text/javascript' })));
    w.onmessage = fn; return { stop: () => w.terminate() };
  } catch { const t = setInterval(fn, ms); return { stop: () => clearInterval(t) }; }
}
function peerOptions() {
  const o = { debug: 0 };
  const ps = QS.get('peerserver');                 // testing only, e.g. ?peerserver=localhost:9000
  if (ps) { const [h, p] = ps.split(':'); Object.assign(o, { host: h, port: Number(p) || 9000, path: '/', secure: false, config: { iceServers: [] } }); }
  return o;
}

/* Modals */
function openModal(build) {
  return new Promise(res => {
    const ov = $('#modal-overlay'), card = $('#modal-card');
    card.replaceChildren();
    const esc = e => { if (e.key === 'Escape') close(null); };
    function close(v) { ov.hidden = true; card.replaceChildren(); document.removeEventListener('keydown', esc); res(v); }
    document.addEventListener('keydown', esc);
    build(card, close);
    ov.hidden = false;
    const f = card.querySelector('input, textarea, select, button'); if (f) f.focus();
  });
}
function askText(title, value = '', label = 'Name') {
  return openModal((card, close) => {
    const inp = el('input', { maxlength: 60 }); inp.value = value;
    card.append(el('form', { onsubmit: e => { e.preventDefault(); const v = inp.value.trim(); if (v) close(v); } },
      el('h2', { text: title }), el('label', { text: label }), inp,
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, 'Cancel'))));
  });
}
function confirmBox(title, detail, yes = 'Delete') {
  return openModal((card, close) => {
    card.append(el('h2', { text: title }), detail ? el('p', { class: 'muted', text: detail }) : null,
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => close(true) }, yes),
        el('button', { class: 'btn btn-ghost', onclick: () => close(false) }, 'Cancel')));
  });
}

/* =====================================================================
   4. CSV
   ===================================================================== */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // formula-injection guard
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCSV(rows) { return '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }

/* =====================================================================
   5. QUESTIONS (7 types) — same template as the classroom game bank
   CSV columns: Type, Question, Answer 1 … Answer 6 (a Check column is ignored)
   - Multiple choice: Answer 1 = correct; Answers 2–6 = wrong (students see them mixed)
   - True/False:      Answer 1 = True or False
   - Type the answer: Answers 1–6 = accepted answers (case, spaces, end punctuation ignored; 4.0 = 4)
   - Word bank:       [brackets] around each blank word in the Question; Answers = extra decoys
   - Put in order:    Answers = 3–6 items in the CORRECT order
   - Match:           each Answer = left = right (2–6 pairs)
   - Sort:            each Answer = Group: item, item (2–4 groups, 12 items or fewer, all different)
   Internally: q = { id, type, text, choices[], answer[], read }
   ===================================================================== */
const TYPE_ALIASES = {
  'mc': 'mc', 'multiple choice': 'mc', 'multiple_choice': 'mc', 'multiplechoice': 'mc', 'multiple-choice': 'mc',
  'tf': 'tf', 'true/false': 'tf', 'true false': 'tf', 'truefalse': 'tf', 'true_false': 'tf', 'true-false': 'tf',
  'type': 'type', 'type the answer': 'type', 'typed': 'type', 'short answer': 'type', 'type_answer': 'type',
  'wordbank': 'wordbank', 'word bank': 'wordbank', 'word_bank': 'wordbank', 'word-bank': 'wordbank',
  'order': 'order', 'put in order': 'order', 'ordering': 'order', 'sequence': 'order',
  'match': 'match', 'matching': 'match',
  'sort': 'sort', 'sorting': 'sort', 'categorize': 'sort'
};
const TYPE_LABEL = { mc: 'Multiple choice', tf: 'True/False', type: 'Type the answer', wordbank: 'Word bank', order: 'Put in order', match: 'Match', sort: 'Sort', draw: 'Drawing', dots: 'Dot map', wordbuild: 'Word builder' };
function pairs(q) { return q.choices.map(c => { const i = c.indexOf('='); return [c.slice(0, i).trim(), c.slice(i + 1).trim()]; }); }
function cells(list) { return (list || []).map(x => cleanText(x, 160).trim()).filter(Boolean).slice(0, 6); }

/* Build a question from a template row: type, question text, answer cells */
function questionFromRow(typeText, questionText, answerCells, read) {
  const type = TYPE_ALIASES[norm(typeText)];
  if (!type) throw new Error('pick a type from the list (got "' + cleanText(typeText, 30) + '")');
  let text = cleanText(questionText, 400).trim();
  if (!text) throw new Error('add the question');
  const a = cells(answerCells);
  const q = { id: uid(8), type, text, choices: [], answer: [], read: cleanText(read || '', 600).trim() };
  switch (type) {
    case 'mc':
      if (a.length < 2) throw new Error('needs Answer 1 (correct) and Answer 2 (wrong)');
      if (norm(a[0]) === norm(a[1])) throw new Error('wrong answer is the same as the correct one');
      q.choices = a; q.answer = [a[0]]; break;
    case 'tf': {
      const v = norm(a[0]);
      if (v !== 'true' && v !== 'false') throw new Error('Answer 1 must be True or False');
      q.choices = ['True', 'False']; q.answer = [v === 'true' ? 'True' : 'False']; break;
    }
    case 'type':
      if (!a.length) throw new Error('add an accepted answer in Answer 1');
      q.answer = a; break;
    case 'wordbank': {
      const words = [...text.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim()).filter(Boolean);
      if (!words.length) throw new Error('put [brackets] around each blank word in the question');
      if (words.length > 6) throw new Error('use 6 blanks or fewer');
      q.text = text.replace(/\[([^\]]+)\]/g, '___');
      q.answer = words;
      q.choices = words.concat(a.filter(d => !words.some(w => norm(w) === norm(d))));
      break;
    }
    case 'order':
      if (a.length < 3) throw new Error('needs 3 to 6 items, in the correct order');
      q.choices = a; break;
    case 'match': {
      const pr = a.map(c => { const i = c.indexOf('='); return i > 0 ? [c.slice(0, i).trim(), c.slice(i + 1).trim()] : null; });
      if (a.length < 2 || pr.some(p => !p || !p[0] || !p[1])) throw new Error('each pair needs left = right (2 to 6 pairs)');
      if (new Set(pr.map(p => norm(p[0]))).size !== pr.length) throw new Error('each left side must be different');
      q.choices = pr.map(p => p[0] + '=' + p[1]); break;
    }
    case 'sort': {
      const out = [];
      for (const c of a) {
        const i = c.indexOf(':');
        if (i <= 0) throw new Error('each group needs Name: item, item (2 to 4 groups)');
        const g = c.slice(0, i).trim();
        c.slice(i + 1).split(',').map(x => x.trim()).filter(Boolean).forEach(it => out.push([it, g]));
      }
      if (a.length < 2 || a.length > 4) throw new Error('each group needs Name: item, item (2 to 4 groups)');
      if (out.length > 12) throw new Error('12 items or fewer in all');
      if (new Set(out.map(p => norm(p[0]))).size !== out.length) throw new Error('every item must be different');
      q.choices = out.map(p => p[0] + '=' + p[1]); break;
    }
  }
  return q;
}
/* Turn a stored question back into template cells (for export) */
function questionToRow(q) {
  let text = q.text, ans = [];
  switch (q.type) {
    case 'mc': ans = [q.answer[0], ...q.choices.filter(c => c !== q.answer[0])]; break;
    case 'tf': ans = [q.answer[0]]; break;
    case 'type': ans = q.answer.slice(); break;
    case 'wordbank': { let k = 0; text = q.text.replace(/_{3,}/g, () => '[' + (q.answer[k++] || '') + ']'); const pool = q.choices.slice(); q.answer.forEach(w => { const i = pool.findIndex(p => norm(p) === norm(w)); if (i >= 0) pool.splice(i, 1); }); ans = pool; break; }
    case 'order': ans = q.choices.slice(); break;
    case 'match': ans = pairs(q).map(p => p[0] + ' = ' + p[1]); break;
    case 'sort': { const g = new Map(); pairs(q).forEach(([it, gr]) => { if (!g.has(gr)) g.set(gr, []); g.get(gr).push(it); }); ans = [...g].map(([gr, its]) => gr + ': ' + its.join(', ')); break; }
  }
  while (ans.length < 6) ans.push('');
  return [TYPE_LABEL[q.type], text, ...ans.slice(0, 6)];
}
/* JSON from older exports or other tools: accept {type, question/text, answers[]} or our own stored shape */
function normalizeQuestion(raw) {
  if (raw && TYPE_ALIASES[norm(raw.type)] && Array.isArray(raw.choices) && Array.isArray(raw.answer) && raw.text) {
    // our own stored shape: re-validate through the template rules
    const row = questionToRow({ ...raw, type: TYPE_ALIASES[norm(raw.type)] });
    return questionFromRow(row[0], row[1], row.slice(2), raw.read);
  }
  const answers = Array.isArray(raw.answers) ? raw.answers : [1, 2, 3, 4, 5, 6].map(n => raw['answer' + n] ?? raw['Answer ' + n]);
  return questionFromRow(raw.type, raw.question ?? raw.text, answers, raw.read);
}
function sameNumber(a, b) {
  const x = String(a).replace(/,/g, '').trim(), y = String(b).replace(/,/g, '').trim();
  if (!/^-?\d*\.?\d+$/.test(x) || !/^-?\d*\.?\d+$/.test(y)) return false;
  return Number(x) === Number(y);
}
function publicQ(q, qid) {
  const p = { qid, type: q.type, text: q.text, read: q.read || '' };
  switch (q.type) {
    case 'mc': p.options = shuffle(q.choices); break;
    case 'tf': p.options = ['True', 'False']; break;
    case 'wordbank': p.parts = q.text.split(/_{3,}/); p.bank = shuffle(q.choices); break;
    case 'order': { let s = shuffle(q.choices); for (let t = 0; t < 10 && s.every((x, i) => x === q.choices[i]); t++) s = shuffle(q.choices); p.items = s; break; }
    case 'match': { const pr = pairs(q); p.lefts = pr.map(x => x[0]); p.rights = shuffle(pr.map(x => x[1])); break; }
    case 'sort': { const pr = pairs(q); p.items = shuffle(pr.map(x => x[0])); p.groups = [...new Set(pr.map(x => x[1]))]; break; }
  }
  return p;
}
function sanitizeAnswer(q, a) {
  const s = v => cleanText(v, 120).trim();
  switch (q.type) {
    case 'mc': case 'tf': case 'type': return typeof a === 'string' && a.trim() ? s(a) : null;
    case 'wordbank': case 'order': return Array.isArray(a) && a.length > 0 && a.length <= 40 ? a.map(s) : null;
    case 'match': case 'sort': {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
      const o = Object.create(null); let n = 0;
      for (const [k, v] of Object.entries(a)) { if (n++ >= 40) break; o[s(k)] = s(v); }
      return o;
    }
  }
  return null;
}
function grade(q, a) {
  try {
    switch (q.type) {
      case 'mc': case 'tf': return norm(a) === norm(q.answer[0]);
      case 'type': return q.answer.some(x => norm(x) === norm(a) || sameNumber(x, a));
      case 'wordbank': return a.length === q.answer.length && a.every((x, i) => norm(x) === norm(q.answer[i]));
      case 'order': return a.length === q.choices.length && a.every((x, i) => x === q.choices[i]);
      case 'match': case 'sort': return pairs(q).every(([l, r]) => a[l] === r);
    }
  } catch { /* fall through */ }
  return false;
}
function answerText(q, a) {
  if (a == null) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.join(q.type === 'order' ? ' > ' : ' | ');
  return Object.entries(a).map(([k, v]) => k + (q.type === 'sort' ? ' -> ' : ' = ') + v).join('; ');
}
function correctText(q) {
  switch (q.type) {
    case 'mc': case 'tf': case 'type': return q.answer[0];
    case 'wordbank': return q.answer.join(', ');
    case 'order': return q.choices.join(' → ');
    case 'match': return pairs(q).map(p => p[0] + ' = ' + p[1]).join('; ');
    case 'sort': return pairs(q).map(p => p[0] + ' → ' + p[1]).join('; ');
  }
  return '';
}

/* Question sets (localStorage) */
const Sets = {
  all() { const v = lsGet(KEYS.sets, []); return Array.isArray(v) ? v : []; },
  save(list) { return lsSet(KEYS.sets, list); },
  get(id) { return Sets.all().find(s => s.id === id); }
};
const CSV_HEADER = ['Type', 'Question', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Answer 5', 'Answer 6'];
const CSV_TEMPLATE = [CSV_HEADER,
  ['Multiple choice', 'Which planet is called the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Saturn', '', ''],
  ['True/False', 'The Sun is a star.', 'True', '', '', '', '', ''],
  ['Type the answer', 'What is 9 + 6?', '15', 'fifteen', '', '', '', ''],
  ['Word bank', 'The [Sun] is a [star] at the center of our solar system.', 'moon', 'planet', '', '', '', ''],
  ['Put in order', 'Put the planets in order, starting closest to the Sun.', 'Mercury', 'Venus', 'Earth', 'Mars', '', ''],
  ['Match', 'Match each animal to its baby.', 'cat = kitten', 'dog = puppy', 'cow = calf', 'frog = tadpole', '', ''],
  ['Sort', 'Sort these into living and nonliving things.', 'Living: tree, dog, mushroom', 'Nonliving: rock, water, rocket', '', '', '', '']
];
function questionsFromCSV(text) {
  const rows = parseCSV(text); if (!rows.length) throw new Error('The file is empty.');
  const head = rows[0].map(h => norm(h));
  let ti = 0, qi = 1, ai = [2, 3, 4, 5, 6, 7], ri = -1, start = 0;
  if (!(head.includes('type') && head.includes('question'))) { const e = new Error('incorrect format'); e.format = true; throw e; }
  {
    ti = head.indexOf('type'); qi = head.indexOf('question'); start = 1;
    const found = [1, 2, 3, 4, 5, 6].map(n => head.indexOf('answer ' + n));
    if (found.some(i => i >= 0)) ai = found.filter(i => i >= 0);
    ri = head.findIndex(h => h === 'read aloud' || h === 'read_aloud');
  }
  const out = [], errors = [];
  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    if (!(row[ti] || '').trim() && !(row[qi] || '').trim()) continue;   // blank template row
    try { out.push(questionFromRow(row[ti], row[qi], ai.map(i => row[i]), ri >= 0 ? row[ri] : '')); }
    catch (e) { errors.push('Row ' + (r + 1) + ': ' + e.message); }
  }
  return { questions: out, errors };
}
function questionsToCSV(set) { return toCSV([CSV_HEADER, ...set.questions.map(questionToRow)]); }

/* =====================================================================
   6. LESSONS (IndexedDB, slides stored as image Blobs)
   ===================================================================== */
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('lessons', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbPromise;
}
async function idbRun(mode, fn) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction('lessons', mode); const req = fn(tx.objectStore('lessons'));
    tx.oncomplete = () => res(req ? req.result : undefined);
    tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Storage full'));
  });
}
const Lessons = {
  all: () => idbRun('readonly', s => s.getAll()),
  get: id => idbRun('readonly', s => s.get(id)),
  put: l => { l.updated = Date.now(); return idbRun('readwrite', s => s.put(l)); },
  del: id => idbRun('readwrite', s => s.delete(id))
};

/* Slide image processing (runs on the teacher's device) */
async function toSlideBlob(source, w, h, maxW = SLIDE_MAX_W, quality = 0.8) {
  const scale = Math.min(1, maxW / w);
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.drawImage(source, 0, 0, cw, ch);
  let b = await new Promise(r => c.toBlob(r, 'image/webp', quality));
  if (!b || b.type !== 'image/webp') b = await new Promise(r => c.toBlob(r, 'image/jpeg', quality + 0.05));
  return { blob: b, w: cw, h: ch };
}
async function imageFileToSlide(file) {
  const bmp = await createImageBitmap(file);
  const r = await toSlideBlob(bmp, bmp.width, bmp.height);
  if (bmp.close) bmp.close();
  return r;
}
async function makePreview(blob) {
  const bmp = await createImageBitmap(blob);
  const r = await toSlideBlob(bmp, bmp.width, bmp.height, PREVIEW_W, 0.5);
  if (bmp.close) bmp.close();
  return r.blob;
}
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej) => {
    const s = el('script', { src: PDFJS_URL }); s.onload = res;
    s.onerror = () => rej(new Error('Could not load the PDF reader. Check your internet connection.'));
    document.head.append(s);
  });
  try {
    const t = await (await fetch(PDFJS_WORKER)).text();
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
  } catch { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }
  return window.pdfjsLib;
}
async function pdfToSlides(file, onProgress) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2, (SLIDE_MAX_W * 1.25) / vp1.width) });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(await toSlideBlob(c, c.width, c.height));
    if (onProgress) onProgress(i, pdf.numPages);
  }
  return out;
}
function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }

/* Student display preferences */
const prefs = Object.assign({ big: false, read: false }, lsGet(KEYS.prefs, {}));
function applyPrefs() { document.body.classList.toggle('big', !!prefs.big); }
const settings = Object.assign({ rateKB: 375, spinMode: 'round' }, lsGet(KEYS.settings, {}));
if (QS.get('rate')) settings.rateKB = Math.max(50, Number(QS.get('rate')) || 375);

/* =====================================================================
   7. STUDENT CLIENT
   ===================================================================== */
const S = {
  active: false, leaving: false, peer: null, conn: null, connecting: false, rtimer: null, backoff: 0,
  everConnected: false, firstTimer: null, room: '', first: '', initial: '', token: null, id: null, name: '',
  view: null, slides: new Map(), previews: new Map(), deck: [], vol: false, live: null, spot: null, reviewIdx: null,
  lastRx: 0, pendingAns: null, ackQid: null, stars: 0,
  ink: { iid: null, strokes: [] }, drawDraft: {}, drawTool: { tool: 'pen', color: '#1E2B4A', size: 5 }, timer: null, dotMine: {}, dotPaint: null, wb: null, wbTab: null, game: null, bossHp: null, bossTimerT: null, demo: false, lostAt: 0, racePrev: null, raceTimerT: null
};

function studentJoin(room, first, initial, token) {
  S.active = true; S.leaving = false; S.joinStart = Date.now(); S.room = room; S.first = first; S.initial = initial; S.token = token || null;
  ssSet(KEYS.student, { room, first, initial, token: S.token });
  $('#st-name').textContent = first + ' ' + initial + '.';
  show('screen-student'); setConn('warn', 'Connecting…');
  renderStudent();
  clearTimeout(S.firstTimer);
  S.firstTimer = setTimeout(() => { if (!S.everConnected) renderStudent(); }, 20000);
  clientPeer();
}
function setConn(state, text) {
  const p = $('#st-conn'); p.dataset.state = state; p.textContent = text;
  if (state === 'ok') S.lostAt = 0; else if (S.everConnected && !S.lostAt) S.lostAt = Date.now();
}
function failJoin(msg) {
  S.leaving = true; S.active = false; clearTimeout(S.rtimer); S.rtimer = null;
  try { S.peer && S.peer.destroy(); } catch { /* ignore */ }
  S.peer = null; S.conn = null; ssDel(KEYS.student);
  show('screen-join'); $('#join-error').textContent = msg; $('#join-btn').disabled = false;
}
function clientPeer() {
  if (S.leaving) return;
  if (S.peer && !S.peer.destroyed) {
    if (S.peer.open) { connectHost(); return; }
    if (S.peer.disconnected) { try { S.peer.reconnect(); } catch { /* ignore */ } }
    return;
  }
  const p = new Peer(peerOptions());
  S.peer = p;
  p.on('open', () => connectHost());
  p.on('disconnected', () => {
    if (S.leaving) return;
    setTimeout(() => { try { if (p.disconnected && !p.destroyed) p.reconnect(); } catch { /* ignore */ } }, 1000 + rand(2000));
  });
  p.on('error', e => {
    if (S.leaving) return;
    if (e.type === 'peer-unavailable') {
      S.connecting = false;
      if (!S.everConnected && !S.token) { failJoin('No class found with code ' + S.room + '. Check the code with your teacher.'); return; }
      scheduleReconnect(); return;
    }
    if (e.type === 'browser-incompatible') { failJoin('This browser can’t join. Try Chrome, Edge, or Safari.'); return; }
    if (e.type === 'unavailable-id' || e.type === 'invalid-id') { try { p.destroy(); } catch { /* ignore */ } S.peer = null; }
    scheduleReconnect();
  });
}
function connectHost() {
  if (S.leaving || S.connecting || (S.conn && S.conn.open)) return;
  S.connecting = true;
  const c = S.peer.connect(PEER_PREFIX + S.room, { reliable: true });
  S.conn = c;
  const to = setTimeout(() => { if (!c.open) { S.connecting = false; try { c.close(); } catch { /* ignore */ } if (S.conn === c) S.conn = null; scheduleReconnect(); } }, 12000);
  c.on('open', () => {
    clearTimeout(to); S.connecting = false;
    c.send({ t: 'hello', v: 1, token: S.token, first: S.first, initial: S.initial, have: completeSids(), demo: S.demo ? 1 : 0 });
  });
  c.on('data', m => { try { onHostMsg(m); } catch (err) { console.error(err); } });
  c.on('close', () => {
    clearTimeout(to); S.connecting = false;
    if (S.conn === c) { S.conn = null; if (!S.leaving) { setConn('warn', 'Reconnecting…'); scheduleReconnect(); } }
  });
  c.on('error', () => { /* close handler covers recovery */ });
}
function scheduleReconnect() {
  if (S.leaving || S.rtimer) return;
  const d = Math.min(15000, 1000 * 2 ** Math.min(S.backoff, 4)) * (0.5 + randFloat());
  S.backoff++;
  S.rtimer = setTimeout(() => { S.rtimer = null; S.connecting = false; clientPeer(); }, d);
}
function reconnectNow() {
  if (!S.active || S.leaving || (S.conn && S.conn.open)) return;
  clearTimeout(S.rtimer); S.rtimer = null; S.backoff = 0; S.connecting = false; clientPeer();
}
function sendHost(m) { if (S.conn && S.conn.open) { try { S.conn.send(m); return true; } catch { /* ignore */ } } return false; }
function completeSids() { return [...S.slides.entries()].filter(([, s]) => s.url).map(([k]) => k); }

function onHostMsg(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'welcome':
      S.everConnected = true; S.backoff = 0; S.token = m.token; S.id = m.id; S.name = m.name;
      S.deck = Array.isArray(m.deck) ? m.deck : []; S.vol = !!m.vol; S.stars = m.stars || 0;
      ssSet(KEYS.student, { room: S.room, first: S.first, initial: S.initial, token: S.token });
      setConn('ok', 'Connected'); $('#st-name').textContent = m.name; renderVol(); renderStars(false);
      $('#spin-overlay').hidden = true; $('#tool-overlay').hidden = true;
      if (S.pendingAns) { sendHost(S.pendingAns); }
      break;
    case 'reject':
      failJoin(m.why === 'full' ? 'This class is full. Tell your teacher.' : 'Please type your first name and last initial.');
      break;
    case 'view':
      S.view = m; if (!m.review) S.reviewIdx = null;
      if (m.k === 'slide') S.ink = { iid: m.sid, strokes: Array.isArray(m.ink) ? m.ink : [] };
      if (S.pendingAns && !(viewQid(m) === S.pendingAns.qid && m.phase === 'open')) S.pendingAns = null;
      if (!m.signup && S.vol) { S.vol = false; renderVol(); }
      renderStudent(); break;
    case 'p': sendHost({ t: 'pg', h: document.hidden }); break;
    case 'ack': if (S.pendingAns && S.pendingAns.qid === m.qid) S.pendingAns = null; S.ackQid = m.qid; updateSentNote(); break;
    case 'live': S.live = m; renderLive(); break;
    case 'star': S.stars = m.stars; renderStars(true); break;
    case 'sh': (m.p ? S.previews : S.slides).set(m.sid, { size: m.size, mime: m.mime, buf: new Uint8Array(m.size), got: 0, url: null }); break;
    case 'sc': onSlideChunk(m); break;
    case 'spin': studentSpin(m); break;
    case 'you': studentYou(); break;
    case 'spot': S.spot = m.items || null; renderStudent(); break;
    case 'pt': showPointer($('#st-stage'), m.x, m.y); break;
    case 'ink': onInkMsg(m); break;
    case 'game': onGameMsg(m); break;
    case 'bb': onBossMsg(m); break;
    case 'dm': onDotShare(m); break;
    case 'lz': if (S.view && S.view.k === 'slide' && S.reviewIdx == null) showLaser($('#st-stage'), m); break;
    case 'tm': onTimer(m); break;
    case 'sb': onScore(m); break;
    case 'dice': case 'wheel': case 'toolclose': studentTool(m); break;
  }
}
function viewQid(v) { return v ? ((v.k === 'boss' || v.k === 'race') ? (v.q ? v.q.qid : null) : v.k === 'q' ? v.q.qid : (v.k === 'draw' || v.k === 'dots') ? v.qid : null) : null; }
function viewMedia(v) { return v ? (v.k === 'slide' ? v.sid : v.k === 'q' ? v.q.img : (v.k === 'draw' || v.k === 'dots') ? v.bg : null) : null; }
function mediaBox(mid) {
  const u = mediaUrl(mid);
  return el('div', { class: 'q-img', 'data-mid': mid }, u ? el('img', { src: u, alt: 'Question picture' }) : el('div', { class: 'slide-loading' }, 'Loading picture…'));
}
function onSlideChunk(m) {
  const map = m.p ? S.previews : S.slides;
  const s = map.get(m.sid); if (!s || s.url || !s.buf) return;
  const d = m.d instanceof ArrayBuffer ? new Uint8Array(m.d) : new Uint8Array(m.d.buffer || m.d);
  if (m.o + d.length > s.size) return;
  s.buf.set(d, m.o); s.got = Math.max(s.got, m.o + d.length);
  if (s.got >= s.size) {
    s.url = URL.createObjectURL(new Blob([s.buf], { type: s.mime })); s.buf = null;
    if (!m.p) { const pv = S.previews.get(m.sid); if (pv && pv.url) { setTimeout(() => URL.revokeObjectURL(pv.url), 5000); S.previews.delete(m.sid); } }
    else if (S.slides.get(m.sid)?.url) return;   // full one already here
    const v = S.view;
    if (S.reviewIdx != null && S.deck[S.reviewIdx] === m.sid) { renderStudent(); return; }
    if (viewMedia(v) !== m.sid) return;
    if (v.k === 'q') document.querySelectorAll('[data-mid="' + m.sid + '"]').forEach(b => b.replaceWith(mediaBox(m.sid)));   // keep the student's answer in progress
    else renderStudent();
  }
}

/* ---- student rendering ---- */
function msgCard(emoji, title, text) {
  return el('div', { class: 'msg-card' }, el('span', { class: 'big-emoji', 'aria-hidden': 'true' }, emoji), el('h2', { text: title }), text ? el('p', { class: 'muted', text }) : null);
}
function slideEl(sid, readText) {
  const s = S.slides.get(sid), pv = S.previews.get(sid);
  const frame = el('div', { class: 'slide-frame' });
  if (s && s.url) frame.append(el('img', { src: s.url, alt: readText || 'Slide' }));
  else if (pv && pv.url) frame.append(el('img', { src: pv.url, alt: readText || 'Slide', class: 'preview' }), el('span', { class: 'sharpen' }, 'Sharpening…'));
  else frame.append(el('div', { class: 'slide-loading' }, 'Loading slide…'));
  return frame;
}
function renderStudent() {
  const stage = $('#st-stage'); stage.replaceChildren();
  const v = S.view;
  $('#st-review').hidden = !(v && v.review && !v.paused && !v.look);
  $('#st-vol').hidden = !(v && v.signup && v.k !== 'end');
  if (!v) {
    if (!S.everConnected && S.firstTimer && performanceWaitedLong()) {
      stage.append(helpCard({ retry: true }));
    } else stage.append(msgCard('⏳', 'Joining your class…', 'Hang on a moment.'));
    return;
  }
  if (v.k === 'end') { onGameMsg({ off: 1 }); stage.append(msgCard('👋', 'Class is over!', 'Great work today. You can close this page.')); S.leaving = true; ssDel(KEYS.student); try { S.peer && S.peer.destroy(); } catch { /* ignore */ } setConn('ok', 'Finished'); return; }
  if (v.paused) { stage.append(msgCard('👀', 'Eyes on your teacher', 'Your screen will come back soon.')); return; }
  if (v.look) { stage.append(msgCard('📺', 'Look at LL', 'Your teacher is showing something in LiveLesson right now.')); return; }

  if (v.review && S.reviewIdx != null && S.deck.length) {
    stage.append(slideEl(S.deck[S.reviewIdx]));
    stage.append(el('p', { class: 'muted' }, 'Reviewing slide ' + (S.reviewIdx + 1) + ' of ' + S.deck.length));
  } else {
    switch (v.k) {
      case 'wait': stage.append(msgCard('⏳', 'You’re in!', 'Waiting for your teacher…')); break;
      case 'slide': {
        const fr = slideEl(v.sid, v.read); stage.append(fr);
        if (fr.querySelector('img')) attachStudentInk(fr);
        if (prefs.read && v.read) stage.append(readBtn(() => v.read));
        break;
      }
      case 'draw': stage.append(buildDrawResponse(v)); break;
      case 'dots': stage.append(buildDotMap(v)); break;
      case 'wb': stage.append(buildWordBoard(v)); break;
      case 'boss': stage.append(buildBossView(v)); break;
      case 'race': stage.append(buildRaceView(v)); break;
      case 'text': {
        const card = el('div', { class: 'text-slide' }, v.title ? el('h2', { text: v.title }) : null, el('p', { text: v.body || '' }));
        stage.append(card);
        if (prefs.read) stage.append(readBtn(() => v.read || ((v.title || '') + '. ' + (v.body || ''))));
        break;
      }
      case 'q': stage.append(buildStudentQ(v)); break;
      case 'check': stage.append(buildCheckin(v)); break;
    }
  }
  if (S.spot && S.spot.length) stage.append(spotCard(S.spot));
}
function performanceWaitedLong() { return !S.everConnected && (Date.now() - (S.joinStart || Date.now())) > 19000; }
function spotCard(items) {
  return el('div', { class: 'spot-card' }, el('h3', null, '🔦 Spotlight'),
    el('div', { class: items.some(i => i.d) ? 'spot-draws' : '' }, items.map(i => {
      const by = el('span', { class: 'by', text: i.by || 'A classmate' });
      if (i.wb) return el('div', { class: 'spot-item' }, by, wbMini(i.wb, 'big'));
      if (i.d) {
        const c = document.createElement('canvas'), u = mediaUrl(i.bg);
        let img = null; if (u) { img = new Image(); img.src = u; img.onload = () => renderDrawing(c, i.d.s, img, i.aspect, 520); }
        renderDrawing(c, i.d.s, img, i.aspect, 520);
        return el('figure', { class: 'spot-item spot-draw' }, c, by);
      }
      return el('div', { class: 'spot-item' }, by, i.text);
    })));
}
function showPointer(container, x, y) {
  const img = container.querySelector('.slide-frame img'); if (!img) return;
  const frame = img.parentElement;
  const dot = el('div', { class: 'pointer-dot' });
  dot.style.left = (Math.min(1, Math.max(0, x)) * 100) + '%'; dot.style.top = (Math.min(1, Math.max(0, y)) * 100) + '%';
  frame.append(dot); setTimeout(() => dot.remove(), 2600);
}
function renderLive() {
  const c = $('#st-rx-counts'); c.replaceChildren();
  const rx = (S.live && S.live.rx) || {};
  for (const e of REACTIONS) if (rx[e]) c.append(el('span', null, e + ' ' + rx[e]));
}
function renderStars(celebrate) {
  const s = $('#st-stars'); s.textContent = S.stars ? '⭐ ' + S.stars : '';
  if (celebrate) { s.classList.remove('celebrate'); void s.offsetWidth; s.classList.add('celebrate'); toast('The class earned a star! ⭐'); }
}
function renderVol() {
  const b = $('#st-vol'); b.setAttribute('aria-pressed', String(S.vol));
  $('.vol-text', b).textContent = S.vol ? 'I’d like to share 🎤 (tap to cancel)' : 'I’d like to share on the mic 🎤';
}

/* ---- questions (student side) ---- */
function speakableQ(q) {
  let t = q.type === 'wordbank' ? q.parts.join(' blank ') : q.text;
  if (q.options) t += '. ' + q.options.join(', ');
  if (q.bank) t += '. Word bank: ' + q.bank.join(', ');
  return t;
}
function updateSentNote() {
  const n = $('#q-sent'); if (!n || !viewQid(S.view)) return;
  if (S.ackQid === viewQid(S.view)) n.textContent = S.view.k === 'dots' ? 'Your dot is in ✓ Tap somewhere else to move it.' : S.view.k === 'draw' ? 'Drawing sent ✓ You can change it and send again.' : 'Answer sent ✓ You can change it until results are shown.';
}
function buildStudentQ(v) {
  const q = v.q, locked = v.phase !== 'open';
  const card = el('div', { class: 'q-card' });
  card.append(el('div', { class: 'q-text', text: q.type === 'wordbank' ? 'Fill in the blanks.' : q.text }));
  if (q.img) card.append(mediaBox(q.img));
  if (prefs.read) card.append(readBtn(() => q.read || speakableQ(q)));
  const body = el('div'); card.append(body);
  let getAnswer = () => null, complete = () => false;
  const mine = v.mine;

  if (q.type === 'mc' || q.type === 'tf') {
    let sel = typeof mine === 'string' ? mine : null;
    const grid = el('div', { class: 'choice-grid' });
    const btns = q.options.map(o => el('button', { class: 'choice', type: 'button', 'aria-pressed': String(sel === o), disabled: locked,
      onclick: () => { sel = o; btns.forEach(x => x.setAttribute('aria-pressed', String(x === btnFor(o)))); } }, o));
    const btnFor = o => btns[q.options.indexOf(o)];
    grid.append(...btns); body.append(grid);
    getAnswer = () => sel; complete = () => sel != null;
  } else if (q.type === 'type') {
    const inp = el('input', { maxlength: 120, 'aria-label': 'Your answer', disabled: locked, autocomplete: 'off', spellcheck: 'true' });
    inp.value = typeof mine === 'string' ? mine : '';
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    body.append(inp);
    getAnswer = () => inp.value.trim(); complete = () => inp.value.trim().length > 0;
  } else {
    const ui = ({ wordbank: bankUI, order: orderUI, match: matchUI, sort: sortUI })[q.type](q, mine, locked);
    body.append(ui.node);
    getAnswer = ui.get; complete = ui.done;
  }

  const note = el('span', { class: 'sent-note', id: 'q-sent', 'aria-live': 'polite' });
  function submit() {
    if (locked) return;
    if (!complete()) { toast('Finish every part first.'); return; }
    const msg = { t: 'ans', qid: q.qid, a: getAnswer() };
    S.pendingAns = msg; S.ackQid = null;
    if (sendHost(msg)) note.textContent = 'Sending…';
    else note.textContent = 'Not connected — it will send when you’re back.';
  }
  if (!locked) {
    card.append(el('div', { class: 'q-actions' }, el('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, 'Send my answer'), note));
    if (mine != null) note.textContent = 'Answer sent ✓ You can change it until results are shown.';
  } else if (v.phase === 'results') {
    const my = v.my || {};
    card.append(el('div', { class: 'result-mine' },
      my.answered ? (my.correct ? '✓ You got it!' : 'Not quite this time. ') : 'You didn’t answer this one. ',
      my.correct ? '' : el('span', null, 'The answer: ' + my.answer)));
    card.append(resultsBlock(v.results, 'Class results (no names)'));
  } else {
    card.append(el('p', { class: 'muted' }, 'Answers are closed.'));
  }
  return card;
}
function resultsBlock(res, title) {
  const wrap = el('div', { class: 'results' }, el('h3', { text: title }));
  if (!res) return wrap;
  if (res.labels) {
    const chart = el('div', { class: 'chart' });
    const max = Math.max(1, res.n);
    res.labels.forEach((l, i) => chart.append(el('div', { class: 'bar-row' + (i === res.correctIdx ? ' correct' : '') },
      el('span', { class: 'bar-label', text: l }),
      el('span', { class: 'bar-track' }, Object.assign(el('span', { class: 'bar-fill' }), { style: 'width:' + (100 * res.counts[i] / max) + '%' })),
      el('span', { class: 'bar-num', text: String(res.counts[i]) }))));
    wrap.append(chart);
  } else {
    wrap.append(el('div', { class: 'big-pct', text: res.pct + '%' }), el('p', { class: 'muted', text: 'of the class got it (' + res.n + ' answered)' }));
  }
  return wrap;
}
function buildCheckin(v) {
  const card = el('div', { class: 'q-card' }, el('div', { class: 'q-text', text: v.prompt || 'How are you feeling about this?' }));
  if (prefs.read) card.append(readBtn(() => (v.prompt || 'How are you feeling about this?') + '. Got it. Kinda. Lost me.'));
  const grid = el('div', { class: 'checkin-grid' });
  const btns = CHECKIN.map(c => el('button', { class: 'choice', type: 'button', 'aria-pressed': String(v.mine === c.v),
    onclick: () => { if (sendHost({ t: 'ck', iid: v.iid, v: c.v })) { v.mine = c.v; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(CHECKIN[i].v === c.v))); toast('Thanks! Only your teacher sees this.'); } else toast('Not connected yet — try again in a moment.'); } },
    el('span', { class: 'e', 'aria-hidden': 'true' }, c.e), c.label));
  grid.append(...btns); card.append(grid);
  card.append(el('p', { class: 'muted' }, 'Only your teacher sees your answer.'));
  return card;
}

/* ---- spinner (student side) ---- */
let studentSpinTimer = null;
function studentSpin(m) {
  const ov = $('#spin-overlay');
  $('#spin-host-controls').hidden = true;
  if (m.ph === 'close') { ov.hidden = true; clearInterval(studentSpinTimer); return; }
  ov.hidden = false;
  const vis = $('#spin-visual'), res = $('#spin-result');
  if (m.ph === 'ready') {
    res.textContent = ''; let n = m.s || 3;
    vis.replaceChildren(el('div', null, el('div', { class: 'countdown', text: String(n) }), el('p', { class: 'muted' }, 'Get ready, volunteers!')));
    clearInterval(studentSpinTimer);
    studentSpinTimer = setInterval(() => { n--; const c = $('.countdown', vis); if (n <= 0 || !c) { clearInterval(studentSpinTimer); return; } c.textContent = String(n); }, 1000);
  } else if (m.ph === 'go') {
    clearInterval(studentSpinTimer); res.textContent = ''; S.spinDone = false; S.you = false;
    animateSpin(vis, m.names, m.wi, m.win, m.dur, () => {
      S.spinDone = true;
      res.replaceChildren(el('span', null, m.win), el('span', { class: 'sub' }, 'is sharing next!'));
      if (S.you) res.append(youCard());
    });
  } else if (m.ph === 'ready-open') {
    clearInterval(studentSpinTimer);
    vis.replaceChildren(el('div', { class: 'mystery', 'aria-hidden': 'true' }, '🎤'));
    const b = el('button', { class: 'vol-toggle', 'aria-pressed': String(S.vol), onclick: () => { toggleVol(); b.setAttribute('aria-pressed', String(S.vol)); } },
      el('span', { class: 'vol-box', 'aria-hidden': 'true' }), el('span', null, 'I’d like to share on the mic 🎤'));
    res.replaceChildren(el('span', { class: 'sub' }, 'The share spinner is open.'), S.view && S.view.signup ? b : null);
  } else if (m.ph === 'skip') {
    res.replaceChildren(el('span', { class: 'sub' }, 'Let’s spin again!'));
  }
}
function toggleVol() {
  if (!S.view || !S.view.signup) { toast('Share sign-up isn’t open right now.'); return; }
  S.vol = !S.vol; renderVol();
  if (!sendHost({ t: 'vol', on: S.vol })) { S.vol = !S.vol; renderVol(); toast('Not connected yet — try again in a moment.'); }
  else toast(S.vol ? 'You’re on the share list 🎤' : 'You’re off the share list.');
}
function youCard() { return el('div', { class: 'you-card' }, 'That’s you! 🎤 Go to LL and unmute when your teacher says. Come back here after.'); }
function studentYou() {
  S.you = true;
  if (S.spinDone) $('#spin-result').append(youCard());
  if (prefs.read) speak('That is you! Go to LiveLesson and unmute when your teacher says.');
}

/* =====================================================================
   8. SPINNER ANIMATION (shared by teacher and student screens)
   ===================================================================== */
function animateSpin(container, names, wi, winName, dur, done) {
  container.replaceChildren();
  if (reduceMotion()) { container.append(el('div', { class: 'mystery', 'aria-hidden': 'true' }, '🎤')); setTimeout(done, 300); return; }
  if (!names || !names.length || wi < 0) {
    container.append(el('div', { class: 'mystery', 'aria-hidden': 'true' }, '🎤')); setTimeout(done, dur); return;
  }
  if (names.length <= 12) {
    const NSV = 'http://www.w3.org/2000/svg', n = names.length, seg = 360 / n, r = 96;
    const mk = (t, a) => { const e = document.createElementNS(NSV, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = mk('svg', { viewBox: '-100 -100 200 200', role: 'img', 'aria-label': 'Spinner wheel' });
    const g = mk('g', { class: 'wheel-rot' });
    const colors = ['#FFC53D', '#CFE3F7', '#FFE08A', '#8DB7E2', '#FFF4D6', '#B6D2EE'];
    const pt = a => [Math.sin(a * Math.PI / 180) * r, -Math.cos(a * Math.PI / 180) * r];
    names.forEach((name, i) => {
      const a0 = i * seg, a1 = (i + 1) * seg, [x0, y0] = pt(a0), [x1, y1] = pt(a1);
      const fill = colors[(n % 2 && i === n - 1 && n > 1) ? 4 : i % colors.length];
      g.append(n === 1 ? mk('circle', { r, fill }) :
        mk('path', { d: `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`, fill, stroke: '#1E2B4A', 'stroke-width': 1 }));
      const c = (i + 0.5) * seg;
      const t = mk('text', { transform: `rotate(${c - 90}) translate(24 0)`, 'dominant-baseline': 'middle', 'font-size': n <= 6 ? 11 : 8.5, 'font-weight': 600, fill: '#1E2B4A', 'font-family': 'Lexend, system-ui, sans-serif' });
      t.textContent = name.length > 16 ? name.slice(0, 15) + '…' : name;
      if (t.textContent.length > 9) { t.setAttribute('textLength', '66'); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      g.append(t);
    });
    g.append(mk('circle', { r: 12, fill: '#1E2B4A' }));
    svg.append(g);
    const wrap = el('div', { class: 'wheel-wrap' }, el('div', { class: 'wheel-pointer', 'aria-hidden': 'true' }));
    wrap.append(svg); container.append(wrap);
    const R = 360 * 6 - (wi + 0.5) * seg;
    g.style.transform = 'rotate(0deg)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      g.style.transition = `transform ${dur}ms cubic-bezier(.12,.7,.14,1)`; g.style.transform = `rotate(${R}deg)`;
    }));
  } else {
    const reel = el('div', { class: 'reel', 'aria-hidden': 'true' }), strip = el('div', { class: 'reel-strip' });
    const total = Math.max(30, names.length * 2), seq = [];
    for (let i = 0; i < total; i++) seq.push(names[rand(names.length)]);
    seq.push(winName, names[rand(names.length)]);
    strip.append(...seq.map(x => el('div', null, x)));
    strip.style.transform = 'translateY(0)';
    reel.append(strip); container.append(reel);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      strip.style.transition = `transform ${dur}ms cubic-bezier(.15,.75,.2,1)`; strip.style.transform = `translateY(${-(total - 1) * 1.4}em)`;
    }));
  }
  setTimeout(done, dur + 120);
}

/* =====================================================================
   9. HOST ENGINE (teacher's browser = single source of truth)
   ===================================================================== */
let H = null;

function newReport(lesson, code) {
  return { v: 1, lesson: lesson.name, code, started: new Date().toISOString(), students: {}, questions: [], answers: {}, checkins: {} };
}
async function startHost(lesson, snap) {
  const now = performance.now();
  H = {
    lesson, items: lesson.items || [], code: snap ? snap.code : makeCode(), pos: snap ? Math.min(snap.pos, Math.max(0, (lesson.items || []).length - 1)) : 0,
    resumed: !!snap, peer: null, students: new Map(), byToken: new Map(),
    manual: snap ? snap.manual || [] : [],
    spin: snap ? snap.spin : { mode: settings.spinMode, round: [], headsUp: true, showPool: false },
    spinState: null, lastPick: null,
    stars: snap ? snap.stars || 0 : 0, goalHit: new Set(snap ? snap.goalHit || [] : []),
    phase: snap ? snap.phase || {} : {}, paused: false, look: false, review: snap ? !!snap.review : false, pointer: false,
    spotlight: null, pub: {}, rx: {}, rxDirty: false, liveDirty: true, rosterDirty: true, deckDirty: true, reportDirty: false,
    slideData: new Map(), sids: [], urls: new Map(), rr: 0,
    rate: settings.rateKB * 1024, bucket: 0, lastTick: now, lastLive: 0, lastPing: now, lastRoster: 0, lastSave: 0,
    report: null, netState: 'connecting', ended: false, ticker: null, reconnTimer: null,
    signup: snap ? !!snap.signup : false, ink: snap && snap.ink ? snap.ink : {}, tool: null, inkColor: INK_COLORS[0], inkCanvas: null,
    timer: Object.assign({ total: 0, left: 0, run: false, at: now, chime: true, stChime: false }, snap && snap.timer ? { ...snap.timer, run: false } : {}),
    sb: snap && snap.sb ? snap.sb : { show: false, autoStar: false, teams: [{ n: 'Teacher', s: 0 }, { n: 'Students', s: 0 }] },
    dice: { n: 1, custom: false, text: 'add\nsubtract\nmultiply' }, wheel: { listId: null, remove: false, used: {} },
    mediaIds: [], imgCache: {}, galleryDirty: false, lastGallery: 0,
    dotState: snap && snap.dotState ? snap.dotState : {}, dotsDirty: false, lastDots: 0, dotPaint: null,
    wb: snap && snap.wb ? snap.wb : null, wbDirty: false, lastWb: 0
  };
  H.report = snap ? (lsGet(KEYS.report, null) || newReport(lesson, H.code)) : newReport(lesson, H.code);
  H.report.lessonId = lesson.id;
  if (snap) for (const s of snap.students || []) {
    const st = mkStudent(s.id, s.token, s.name); st.vol = !!s.vol; st.shared = s.shared || 0;
    H.students.set(st.id, st); H.byToken.set(st.token, st);
  }
  for (const it of H.items) {
    const mid = mediaIdFor(it), blob = mediaBlob(it); if (!mid || !blob) continue;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let pv = null; try { pv = await makePreview(blob); } catch { /* preview is optional */ }
    const pbuf = pv ? new Uint8Array(await pv.arrayBuffer()) : null;
    H.slideData.set(mid, { buf, size: buf.length, mime: blob.type || 'image/webp', pbuf, psize: pbuf ? pbuf.length : 0, pmime: pv ? pv.type : '' });
    H.urls.set(mid, URL.createObjectURL(blob));
    H.mediaIds.push(mid); if (it.kind === 'slide') H.sids.push(mid);
  }
  if (H.timer.total && H.timer.left <= 0) H.timer.total = 0;
  document.body.classList.remove('safe'); $('#h-safe').checked = false;
  show('screen-host');
  updateHostHeader();
  hostConnectPeer(0);
  H.ticker = makeTicker(250, hostTick);
  const it = currentItem(); if (it && it.kind === 'q') { if (!H.phase[it.id]) H.phase[it.id] = 'open'; ensureReportQuestion(it); }
  H.boss = null; H.race = null;
  H.game = null; $('#game-host-body').replaceChildren(); showGameHost(false); updateGameBar();
  setSignup(H.signup, true); updateHostScore(); updateHostTimer();
  renderHostStage(); renderHostSide(); saveReport(); saveHostSnap();
}
function mediaIdFor(it) {
  if (!it) return null;
  if (it.kind === 'slide') return it.blob ? it.id : null;
  if (it.kind === 'q') return it.img ? 'qi-' + it.id : null;
  if (it.kind === 'draw') return it.bg ? 'db-' + it.id : null;
  if (it.kind === 'dots') return it.bg ? 'dm-' + it.id : null;
  return null;
}
function mediaBlob(it) { return it.kind === 'slide' ? it.blob : it.kind === 'q' ? it.img : (it.kind === 'draw' || it.kind === 'dots') ? it.bg : null; }
function setSignup(on, quiet) {
  if (!H) return;
  H.signup = !!on;
  if (!on) for (const st of H.students.values()) st.vol = false;
  const b = $('#h-signup'); b.setAttribute('aria-pressed', String(H.signup)); b.textContent = H.signup ? '✋ Close share sign-up' : '✋ Open share sign-up';
  broadcastView(); renderSpinPool(); renderHostSide(); saveHostSnap();
  if (!quiet) toast(H.signup ? 'Share sign-up is open on student screens.' : 'Share sign-up closed. Ticks cleared.');
}
function mkStudent(id, token, name) {
  return { id, token, name, conn: null, online: false, lastSeen: 0, hidden: false, quiet: false, vol: false, shared: 0, have: new Set(), sent: new Map(), havePrev: new Set(), sentPrev: new Map(), lastRx: 0 };
}
function hostConnectPeer(attempt) {
  if (!H || H.ended) return;
  const peer = new Peer(PEER_PREFIX + H.code, peerOptions());
  H.peer = peer;
  peer.on('open', () => { if (H.peer !== peer) return; H.netState = 'ok'; updateNet(); saveHostSnap(); });
  peer.on('connection', conn => hostOnConnection(conn));
  peer.on('disconnected', () => { if (H.peer !== peer || H.ended) return; H.netState = 'warn'; updateNet(); hostReconnectServer(); });
  peer.on('error', err => {
    if (!H || H.peer !== peer || H.ended) return;
    if (err.type === 'unavailable-id') {
      try { peer.destroy(); } catch { /* ignore */ }
      if (H.resumed && attempt < 12) { setTimeout(() => hostConnectPeer(attempt + 1), 2500); }
      else { H.code = makeCode(); H.report.code = H.code; updateHostHeader(); hostConnectPeer(0); }
      return;
    }
    if (err.type === 'browser-incompatible') { alert('This browser cannot host a session. Please use Chrome or Edge.'); return; }
    if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) { H.netState = 'warn'; updateNet(); hostReconnectServer(); }
  });
}
function hostReconnectServer() {
  if (!H || H.reconnTimer) return;
  let n = 0;
  const attempt = () => {
    H.reconnTimer = null;
    if (!H || H.ended) return;
    const p = H.peer;
    if (!p || p.destroyed) { hostConnectPeer(0); return; }
    if (!p.disconnected && p.open) { H.netState = 'ok'; updateNet(); return; }
    try { p.reconnect(); } catch { /* ignore */ }
    n++; H.reconnTimer = setTimeout(attempt, Math.min(15000, 1500 * 2 ** Math.min(n, 4)));
  };
  H.reconnTimer = setTimeout(attempt, 1000);
}
function updateNet() {
  const p = $('#h-net');
  if (!H) return;
  if (H.netState === 'ok') { p.dataset.state = 'ok'; p.textContent = 'Online'; }
  else if (H.netState === 'connecting') { p.dataset.state = 'warn'; p.textContent = 'Starting…'; }
  else { p.dataset.state = 'warn'; p.textContent = 'Reconnecting — joined students are fine'; }
}
function joinURL() { return location.origin + location.pathname; }
function updateHostHeader() {
  $('#h-url').textContent = joinURL().replace(/^https?:\/\//, '');
  $('#h-code').textContent = H.code;
}

/* ---- connections ---- */
function hostOnConnection(conn) {
  conn._sk = { hello: false, st: null };
  conn.on('data', m => { try { hostOnData(conn, m); } catch (e) { console.error(e); } });
  conn.on('close', () => hostConnClosed(conn));
  conn.on('error', () => hostConnClosed(conn));
  setTimeout(() => { if (!conn._sk.hello) { try { conn.close(); } catch { /* ignore */ } } }, 20000);
}
function hostConnClosed(conn) {
  if (!H) return;
  const st = conn._sk && conn._sk.st;
  if (st && st.conn === conn) { st.online = false; st.conn = null; H.rosterDirty = true; H.liveDirty = true; }
}
function send(st, msg) {
  const c = st.conn; if (!c || !c.open) return false;
  try { c.send(msg); return true; } catch { return false; }
}
function sendConn(conn, msg) { try { conn.send(msg); } catch { /* ignore */ } }
function broadcast(msg) { for (const st of H.students.values()) if (st.online) send(st, msg); }
function onlineStudents() { return [...H.students.values()].filter(s => s.online && !s.demo); }   // the demo student never counts
function makeName(first, initial) {
  let f = cleanText(first, 20).replace(/[^\p{L}\p{M}' -]/gu, '').replace(/\s+/g, ' ').trim();
  const i = cleanText(initial, 4).replace(/[^\p{L}]/gu, '').slice(0, 1).toUpperCase();
  if (!f || !i) return null;
  f = f.charAt(0).toUpperCase() + f.slice(1);
  return f + ' ' + i + '.';
}
function hostOnData(conn, m) {
  if (!H || H.ended || !m || typeof m !== 'object') return;
  if (m.t === 'hello') { hostHello(conn, m); return; }
  const st = conn._sk.st; if (!st || st.conn !== conn) return;
  st.lastSeen = Date.now(); if (st.quiet) { st.quiet = false; H.rosterDirty = true; }
  switch (m.t) {
    case 'pg': if (st.hidden !== !!m.h) { st.hidden = !!m.h; H.rosterDirty = true; } break;
    case 'vis': st.hidden = !!m.h; H.rosterDirty = true; break;
    case 'ans': hostAnswer(st, m); break;
    case 'ck': hostCheckin(st, m); break;
    case 'vol': if (H.signup && st.vol !== !!m.on) { st.vol = !!m.on; H.rosterDirty = true; renderSpinPool(); saveHostSnap(); } break;
    case 'rx': hostReaction(st, m.e); break;
    case 'wbb': wbBoardMsg(st, m); break;
  }
}
function hostHello(conn, m) {
  let st = (typeof m.token === 'string' && H.byToken.get(m.token)) || null;
  if (!st) {
    const name = makeName(m.first, m.initial);
    if (!name) { sendConn(conn, { t: 'reject', why: 'name' }); return; }
    const offline = [...H.students.values()].find(s => s.name === name && !s.online);
    if (offline) st = offline;
    else {
      if (H.students.size >= MAX_STUDENTS) { sendConn(conn, { t: 'reject', why: 'full' }); return; }
      let display = name, n = 2;
      while ([...H.students.values()].some(s => s.name === display)) display = name.replace(/\.$/, '') + '. (' + (n++) + ')';
      st = mkStudent(uid(8), uid(16), display);
      H.students.set(st.id, st); H.byToken.set(st.token, st);
    }
  }
  st.demo = !!m.demo;
  if (!st.demo && !H.report.students[st.id]) H.report.students[st.id] = { name: st.name, shared: st.shared };
  if (st.conn && st.conn !== conn) { const old = st.conn; old._sk.st = null; try { old.close(); } catch { /* ignore */ } }
  st.conn = conn; conn._sk.st = st; conn._sk.hello = true;
  st.online = true; st.lastSeen = Date.now(); st.hidden = false; st.quiet = false;
  st.have = new Set((Array.isArray(m.have) ? m.have : []).filter(x => H.slideData.has(x)));
  st.sent = new Map(); st.havePrev = new Set(); st.sentPrev = new Map();
  send(st, { t: 'welcome', id: st.id, token: st.token, name: st.name, deck: H.sids, vol: st.vol, stars: H.stars });
  send(st, viewMsg(st));
  send(st, liveMsg());
  if (H.spotlight) send(st, { t: 'spot', items: H.spotlight });
  if (H.timer.total) send(st, timerMsg());
  send(st, gameMsgFor(st));
  if (H.sb.show) send(st, sbMsg());
  H.rosterDirty = true; H.liveDirty = true; H.deckDirty = true; H.reportDirty = true;
  renderSpinPool(); saveHostSnap();
}

/* ---- views ---- */
function currentItem() { return H.items[H.pos] || null; }
function getPub(it) { if (!H.pub[it.id]) H.pub[it.id] = { ...publicQ(it.q, it.id), img: mediaIdFor(it) }; return H.pub[it.id]; }
function resultsFor(it) {
  const ans = H.report.answers[it.id] || {}; const recs = Object.entries(ans).filter(([sid]) => !isDemoId(sid)).map(([, r]) => r);
  const n = recs.length, correct = recs.filter(r => r.correct).length;
  const res = { n, pct: n ? Math.round(100 * correct / n) : 0 };
  if (it.q.type === 'mc' || it.q.type === 'tf') {
    const opts = getPub(it).options;
    res.labels = opts; res.counts = opts.map(o => recs.filter(r => norm(r.raw) === norm(o)).length);
    res.correctIdx = opts.findIndex(o => norm(o) === norm(it.q.answer[0]));
  }
  return res;
}
function viewMsg(st, cache) {
  const base = { t: 'view', paused: H.paused, look: H.look, review: H.review, signup: H.signup, pos: H.pos, total: H.items.length };
  if (H.ended) return { t: 'view', k: 'end' };
  if (H.race && H.race.active) return raceView(base, st);
  if (H.boss && H.boss.active) return bossView(base, st);
  if (H.wb && H.wb.active) return wbView(base, st);
  const it = currentItem();
  if (!it) return { ...base, k: 'wait' };
  switch (it.kind) {
    case 'slide': return { ...base, k: 'slide', sid: it.id, read: it.read || '', ink: H.ink[it.id] || [] };
    case 'dots': return dotsViewMsg(base, it, st);
    case 'draw': {
      const rec = (H.report.answers[it.id] || {})[st.id];
      return { ...base, k: 'draw', qid: it.id, prompt: it.prompt || '', read: it.read || '', bg: mediaIdFor(it), aspect: drawAspect(it), phase: H.phase[it.id] || 'open', mine: rec ? rec.raw : null };
    }
    case 'text': return { ...base, k: 'text', title: it.title || '', body: it.body || '', read: it.read || '' };
    case 'check': { const c = H.report.checkins[it.id]; return { ...base, k: 'check', iid: it.id, prompt: it.prompt || '', mine: c && c.votes[st.id] || null }; }
    case 'q': {
      const ph = H.phase[it.id] || 'open', rec = (H.report.answers[it.id] || {})[st.id];
      const v = { ...base, k: 'q', q: getPub(it), phase: ph, mine: rec ? rec.raw : null };
      if (ph === 'results') {
        v.results = cache ? (cache.res ||= resultsFor(it)) : resultsFor(it);
        v.my = { answered: !!rec, correct: !!(rec && rec.correct), answer: correctText(it.q) };
      }
      return v;
    }
  }
  return { ...base, k: 'wait' };
}
function broadcastView() { const cache = {}; for (const st of H.students.values()) if (st.online) send(st, viewMsg(st, cache)); }
function liveMsg() {
  const it = currentItem();
  let answered = null;
  if ((H.wb && H.wb.active) || (H.boss && H.boss.active) || (H.race && H.race.active)) answered = null;
  else if (it && (it.kind === 'q' || it.kind === 'draw' || it.kind === 'dots')) answered = Object.keys(H.report.answers[it.id] || {}).filter(sid => !isDemoId(sid)).length;
  return { t: 'live', answered, online: onlineStudents().length, stars: H.stars, rx: H.rx };
}

/* ---- student actions ---- */
function ensureReportQuestion(it) {
  if (H.report.questions.some(q => q.qid === it.id)) return;
  const n = H.items.filter(x => x.kind === 'q' || x.kind === 'draw' || x.kind === 'dots').indexOf(it) + 1;
  if (it.kind === 'dots') { H.report.questions.push({ qid: it.id, n, type: 'dots', text: it.prompt || 'Dot map', graded: (it.zones || []).some(z => z.correct) }); H.reportDirty = true; return; }
  H.report.questions.push(it.kind === 'draw' ? { qid: it.id, n, type: 'draw', text: it.prompt || 'Drawing' } : { qid: it.id, n, type: it.q.type, text: it.q.text });
  H.reportDirty = true;
}
function hostAnswer(st, m) {
  if (H.race && H.race.active) { raceAnswer(st, m); return; }
  if (H.boss && H.boss.active) { bossAnswer(st, m); return; }
  const it = currentItem();
  if (!it || (it.kind !== 'q' && it.kind !== 'draw' && it.kind !== 'dots') || m.qid !== it.id || (H.phase[it.id] || 'open') !== 'open') return;
  if (it.kind === 'dots') {
    const rec = dotAnswer(it, m.a); if (!rec) return;
    (H.report.answers[it.id] ||= {})[st.id] = rec; H.dotsDirty = true;
  } else if (it.kind === 'draw') {
    const d = sanitizeDrawing(m.a); if (!d) return;
    (H.report.answers[it.id] ||= {})[st.id] = { raw: d, a: '(drawing)', correct: null, t: Date.now() };
    H.galleryDirty = true;
  } else {
    const a = sanitizeAnswer(it.q, m.a); if (a == null) return;
    (H.report.answers[it.id] ||= {})[st.id] = { raw: a, a: answerText(it.q, a), correct: grade(it.q, a), t: Date.now() };
  }
  ensureReportQuestion(it);
  send(st, { t: 'ack', qid: it.id });
  H.liveDirty = true; H.reportDirty = true;
  const online = onlineStudents().length, answered = Object.keys(H.report.answers[it.id]).filter(sid => !isDemoId(sid)).length;
  if (online > 0 && !H.goalHit.has(it.id) && answered / online >= GOAL_PCT) {
    H.goalHit.add(it.id); H.stars++; broadcast({ t: 'star', stars: H.stars }); toast('The class earned a star! ⭐'); awardStarPoint(); saveHostSnap();
  }
}
function hostCheckin(st, m) {
  const it = currentItem();
  if (!it || it.kind !== 'check' || m.iid !== it.id || !CHECKIN.some(c => c.v === m.v)) return;
  const c = (H.report.checkins[it.id] ||= { prompt: it.prompt || 'Check-in', votes: {} });
  c.votes[st.id] = m.v; H.liveDirty = true; H.reportDirty = true;
}
function hostReaction(st, e) {
  if (!REACTIONS.includes(e)) return;
  const now = Date.now(); if (now - st.lastRx < 2000) return;
  st.lastRx = now; H.rx[e] = (H.rx[e] || 0) + 1; H.rxDirty = true;
}

/* ---- the tick: slides, heartbeat, batched updates, saving ---- */
function hostTick() {
  if (!H || H.ended) return;
  const now = performance.now();
  pumpSlides(now);
  if (H.timer.total) updateHostTimer();
  dotsTick(now);
  bossTick(now);
  raceTick(now);
  if (H.wbDirty && now - H.lastWb > 500) { H.lastWb = now; if (H.wb && H.wb.active) renderWbGallery(); else H.wbDirty = false; }
  if (H.galleryDirty && now - H.lastGallery > 1000) { H.lastGallery = now; const it = currentItem(); if (it && it.kind === 'draw') renderGallery(it); else H.galleryDirty = false; }
  if (now - H.lastPing > 5000) {
    H.lastPing = now; const t = Date.now();
    for (const st of H.students.values()) {
      if (!st.online) continue;
      send(st, { t: 'p' });
      const quiet = t - st.lastSeen > 30000;
      if (quiet !== st.quiet) { st.quiet = quiet; H.rosterDirty = true; }
    }
  }
  if (now - H.lastLive > 1000 && (H.liveDirty || H.rxDirty)) {
    H.lastLive = now; const msg = liveMsg(); broadcast(msg); H.liveDirty = false; H.rxDirty = false; renderHostLive(msg);
  }
  if (now - H.lastRoster > 1000 && (H.rosterDirty || H.deckDirty)) { H.lastRoster = now; H.rosterDirty = false; H.deckDirty = false; renderHostSide(); }
  if (now - H.lastSave > 2000 && H.reportDirty) { H.lastSave = now; saveReport(); }
}
function bufferedOf(st) { const c = st.conn; const dc = c && c.dataChannel; return (dc ? dc.bufferedAmount : 0) + ((c && c.bufferSize) || 0) * CHUNK; }
function slideOrder() {
  // current slide first, then forward, then the rest
  if (H._orderPos === H.pos && H._order) return H._order;
  const idx = H.items.map((it, i) => (mediaIdFor(it) && H.slideData.has(mediaIdFor(it))) ? i : -1).filter(i => i >= 0);
  const fwd = idx.filter(i => i >= H.pos), back = idx.filter(i => i < H.pos).reverse();
  H._order = [...fwd, ...back].map(i => mediaIdFor(H.items[i])); H._orderPos = H.pos;
  return H._order;
}
function pumpSlides(now) {
  const dt = Math.min(1, (now - H.lastTick) / 1000); H.lastTick = now;
  H.bucket = Math.min(H.rate * 0.5, H.bucket + H.rate * dt);
  if (!H.mediaIds.length) return;
  const list = [...H.students.values()].filter(s => s.online && s.conn && s.conn.open && s.have.size < H.mediaIds.length);
  if (!list.length) return;
  const order = slideOrder();
  // Class-wide priority: everyone gets the current slide's quick preview, then everyone gets the
  // sharp current slide, and only then do the other slides flow (round robin, under the speed cap).
  let guard = 0;
  while (H.bucket >= CHUNK && guard++ < 400) {
    const parts = list.map(st => ({ st, p: bufferedOf(st) > 64 * 1024 ? null : nextPart(st, order) })).filter(x => x.p);
    if (!parts.length) break;
    const level = Math.min(...parts.map(x => x.p.level));
    const turn = parts.filter(x => x.p.level === level);
    let sent = 0;
    for (let k = 0; k < turn.length && H.bucket >= CHUNK; k++) {
      const { st, p } = turn[(H.rr + k) % turn.length];
      const n = sendPart(st, p.sid, p.prev); if (n) { H.bucket -= n; sent++; }
    }
    H.rr = (H.rr + 1) % Math.max(1, list.length);
    if (!sent) break;
  }
}
function nextPart(st, order) {
  const cm = mediaIdFor(currentItem());
  if (cm && H.slideData.has(cm) && !st.have.has(cm)) {
    const d = H.slideData.get(cm);
    if (d.pbuf && !st.havePrev.has(cm) && !st.sent.has(cm)) return { sid: cm, prev: true, level: 0 };
    return { sid: cm, prev: false, level: 1 };
  }
  const sid = order.find(id => !st.have.has(id));
  return sid ? { sid, prev: false, level: 2 } : null;
}
function sendPart(st, sid, isPrev) {
  const d = H.slideData.get(sid);
  const buf = isPrev ? d.pbuf : d.buf, size = isPrev ? d.psize : d.size, mime = isPrev ? d.pmime : d.mime;
  const map = isPrev ? st.sentPrev : st.sent, done = isPrev ? st.havePrev : st.have;
  let off = map.get(sid);
  if (off === undefined) { if (!send(st, { t: 'sh', sid, size, mime, p: isPrev ? 1 : 0 })) return 0; off = 0; }
  const end = Math.min(off + CHUNK, size);
  if (!send(st, { t: 'sc', sid, o: off, p: isPrev ? 1 : 0, d: buf.slice(off, end).buffer })) return 0;
  if (end >= size) { done.add(sid); map.delete(sid); if (!isPrev) H.deckDirty = true; } else map.set(sid, end);
  return end - off;
}

/* ---- navigation & teacher controls ---- */
function hostGo(pos) {
  if (!H || pos < 0 || pos >= H.items.length) return;
  if (H.wb && H.wb.active) { toast('End the word builder to go back to the lesson.'); return; }
  if (H.boss && H.boss.active) { toast('End the boss battle to go back to the lesson.'); return; }
  if (H.race && H.race.active) { toast('End the race to go back to the lesson.'); return; }
  H.pos = pos; H.spotlight = null; H.rx = {}; H.rxDirty = true; H.liveDirty = true; H.inkCanvas = null; H.dotPaint = null;
  const it = currentItem();
  if (it && (it.kind === 'q' || it.kind === 'draw' || it.kind === 'dots')) { if (!H.phase[it.id]) H.phase[it.id] = 'open'; ensureReportQuestion(it); }
  if (it && it.signup && !H.signup) setSignup(true, true);
  broadcast({ t: 'spot', items: null });
  hideToolFromClass();
  if (!$('#spin-overlay').hidden) closeSpinner();
  broadcastView(); renderHostStage(); renderHostSide(); saveHostSnap();
}
function setPhase(ph) {
  const it = currentItem(); if (!it || (it.kind !== 'q' && it.kind !== 'draw' && it.kind !== 'dots')) return;
  H.phase[it.id] = ph; broadcastView(); renderHostStage(); saveHostSnap();
}
function toggleFlag(flag, btn) {
  H[flag] = !H[flag]; btn.setAttribute('aria-pressed', String(H[flag]));
  broadcastView(); saveHostSnap();
}
let snapTimer = null;
function saveHostSnap() {
  if (!H || H.ended) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    if (!H || H.ended) return;
    ssSet(KEYS.host, {
      code: H.code, lessonId: H.lesson.id, pos: H.pos, phase: H.phase, review: H.review,
      students: [...H.students.values()].map(s => ({ id: s.id, token: s.token, name: s.name, vol: s.vol, shared: s.shared })),
      manual: H.manual, spin: H.spin, stars: H.stars, goalHit: [...H.goalHit],
      signup: H.signup, ink: H.ink, sb: H.sb, dotState: H.dotState, wb: H.wb, timer: { total: H.timer.total, left: timerLeft(), chime: H.timer.chime, stChime: H.timer.stChime }
    });
  }, 400);
}
function saveReport() {
  if (!H) return;
  for (const st of H.students.values()) if (!st.demo) H.report.students[st.id] = { name: st.name, shared: st.shared };
  H.report.manual = H.manual.map(m => ({ name: m.name, shared: m.shared }));
  H.reportDirty = false; lsSet(KEYS.report, H.report);
}
async function endSession() {
  if (!(await confirmBox('End this session?', 'Students will see “Class is over.” Your report is saved on this device.', 'End session'))) return;
  if (H.wb && H.wb.active) wbRecord();
  H.ended = true; broadcast({ t: 'view', k: 'end' }); saveReport();
  ssDel(KEYS.host);
  if (H.ticker) H.ticker.stop();
  clearTimeout(H.reconnTimer);
  const peer = H.peer;
  for (const u of H.urls.values()) URL.revokeObjectURL(u);
  setTimeout(() => { try { peer && peer.destroy(); } catch { /* ignore */ } }, 1500);
  $('#spin-overlay').hidden = true; $('#spot-overlay').hidden = true; $('#tools-overlay').hidden = true;
  $('#h-timer').hidden = true; $('#h-score').hidden = true;
  $('#game-host-body').replaceChildren(); showGameHost(false); $('#h-game').hidden = true;
  H = null;
  enterDash('report');
}

/* =====================================================================
   10. HOST SCREEN
   ===================================================================== */
function itemLabel(it) {
  if (!it) return '';
  switch (it.kind) {
    case 'slide': return 'Slide';
    case 'text': return 'Text: ' + (it.title || 'Untitled');
    case 'q': return TYPE_LABEL[it.q.type] + ': ' + it.q.text;
    case 'check': return 'Check-in: ' + (it.prompt || '');
    case 'draw': return 'Drawing: ' + (it.prompt || '');
    case 'dots': return 'Dot map: ' + (it.prompt || '');
  }
  return '';
}
function hostQPreview(it) {
  const q = it.q, p = getPub(it);
  const card = el('div', { class: 'q-card' }, el('div', { class: 'tag', text: TYPE_LABEL[q.type] }), el('div', { class: 'q-text', text: q.text }));
  if (p.img) card.append(el('div', { class: 'q-img' }, el('img', { src: H.urls.get(p.img), alt: 'Question picture' })));
  const list = p.options || p.items || p.bank || (p.lefts ? p.lefts.map((l, i) => l + '  ·  ' + (p.rights[i] || '')) : null);
  if (list) card.append(el('ul', { class: 'q-preview' }, list.map(x => el('li', { text: x }))));
  if (p.groups) card.append(el('p', { class: 'muted', text: 'Groups: ' + p.groups.join(', ') }));
  return card;
}
function renderHostStage() {
  if (!H) return;
  const stage = $('#h-stage'); stage.replaceChildren();
  $('#h-wb').setAttribute('aria-pressed', String(!!(H.wb && H.wb.active)));
  $('#h-boss').setAttribute('aria-pressed', String(!!(H.boss && H.boss.active)));
  $('#h-race').setAttribute('aria-pressed', String(!!(H.race && H.race.active)));
  if (H.race && H.race.active) {
    renderRaceStage(stage); $('#h-prev').disabled = true; $('#h-next').disabled = true;
    $('#h-pos').textContent = 'Team Race'; $('#h-notes').textContent = ''; $('#h-next-preview').textContent = 'Back to the lesson when you end the race.'; return;
  }
  if (H.boss && H.boss.active) {
    renderBossStage(stage); $('#h-prev').disabled = true; $('#h-next').disabled = true;
    $('#h-pos').textContent = 'Boss Battle'; $('#h-notes').textContent = ''; $('#h-next-preview').textContent = 'Back to the lesson when you end the boss battle.'; return;
  }
  if (H.wb && H.wb.active) {
    renderWbStage(stage); $('#h-prev').disabled = true; $('#h-next').disabled = true;
    $('#h-pos').textContent = 'Word builder'; $('#h-notes').textContent = ''; $('#h-next-preview').textContent = 'Back to the lesson when you end the word builder.'; return;
  }
  const it = currentItem();
  if (!it) {
    stage.append(msgCard('🎤', 'Activities-only session', 'Use the share spinner, spotlight, pause and reactions. Students see a waiting screen.'));
  } else if (it.kind === 'slide') {
    stage.append(inkToolbar(it));
    const frame = el('div', { class: 'slide-frame' });
    frame.append(el('img', { src: H.urls.get(it.id), alt: 'Current slide' })); stage.append(frame);
    attachHostInk(frame, it);
  } else if (it.kind === 'draw') {
    renderDrawStage(stage, it);
  } else if (it.kind === 'dots') {
    renderDotStage(stage, it);
  } else if (it.kind === 'text') {
    stage.append(el('div', { class: 'text-slide' }, it.title ? el('h2', { text: it.title }) : null, el('p', { text: it.body || '' })));
  } else if (it.kind === 'q') {
    const ph = H.phase[it.id] || 'open';
    stage.append(hostQPreview(it));
    const meta = el('div', { class: 'host-q-meta' },
      el('span', { class: 'count-pill', id: 'h-answered' }, ''),
      ph === 'open' ? el('button', { class: 'btn btn-primary', onclick: () => setPhase('results') }, 'Show results')
                    : el('button', { class: 'btn', onclick: () => setPhase('open') }, 'Reopen answers'),
      el('button', { class: 'btn', onclick: openSpotlight }, '🔦 Spotlight answers'));
    stage.append(meta);
    if (ph === 'results') { const c = el('div', { class: 'q-card' }); c.append(resultsBlock(resultsFor(it), 'Class results (shown to students without names)')); stage.append(c); }
  } else if (it.kind === 'check') {
    stage.append(el('div', { class: 'q-card' }, el('div', { class: 'q-text', text: it.prompt || 'How are you feeling about this?' }),
      el('div', { id: 'h-check' }), el('p', { class: 'muted' }, 'Only you see these counts.')));
  }
  $('#h-pos').textContent = H.items.length ? (H.pos + 1) + ' / ' + H.items.length : '';
  $('#h-prev').disabled = H.pos <= 0; $('#h-next').disabled = H.pos >= H.items.length - 1;
  const nx = H.items[H.pos + 1], prev = $('#h-next-preview'); prev.replaceChildren();
  if (!nx) prev.textContent = H.items.length ? 'End of lesson' : '—';
  else if (nx.kind === 'slide') prev.append(el('img', { src: H.urls.get(nx.id), alt: 'Next slide' }));
  else prev.textContent = itemLabel(nx);
  $('#h-notes').textContent = it && it.notes ? it.notes : '';
  renderHostLive(liveMsg());
}
function renderHostLive(msg) {
  if (!H) return;
  const it = currentItem(), online = msg.online;
  let line = '⭐ ' + H.stars + ' class stars';
  if (!(H.wb && H.wb.active) && !(H.boss && H.boss.active) && !(H.race && H.race.active) && it && (it.kind === 'q' || it.kind === 'draw' || it.kind === 'dots')) {
    line = 'Answered ' + msg.answered + ' of ' + online + '  ·  ' + line;
    const a = $('#h-answered'); if (a) a.textContent = msg.answered + ' of ' + online + ' answered';
  }
  if (it && it.kind === 'check') {
    const votes = Object.values((H.report.checkins[it.id] || { votes: {} }).votes);
    const box = $('#h-check');
    if (box) box.replaceChildren(resultsBlock({ n: votes.length, labels: CHECKIN.map(c => c.e + ' ' + c.label), counts: CHECKIN.map(c => votes.filter(v => v === c.v).length), correctIdx: -1 }, votes.length + ' checked in'));
    line = votes.length + ' checked in  ·  ' + line;
  }
  $('#h-live').textContent = line;
  const rx = $('#h-rx'); rx.replaceChildren();
  for (const e of REACTIONS) if (msg.rx[e]) rx.append(el('span', null, e + ' ' + msg.rx[e]));
}
function renderHostSide() {
  if (!H) return;
  const all = [...H.students.values()], on = all.filter(s => s.online && !s.demo);
  const inClass = on.filter(s => s.hidden).length;
  $('#h-count').textContent = on.length + (on.length === 1 ? ' student' : ' students') + (inClass ? ' (' + inClass + ' in LL)' : '');
  if (H.sids.length) {
    const ready = on.filter(s => s.have.size >= H.sids.length).length;
    $('#h-deck').hidden = false; $('#h-deck').textContent = 'Slides ready: ' + ready + '/' + on.length;
  } else $('#h-deck').hidden = true;
  const vols = (H.signup ? all.filter(s => s.vol && s.online).length : 0) + H.manual.length;
  $('#h-vol-count').textContent = String(vols);
  const ul = $('#h-roster'); ul.replaceChildren();
  all.sort((a, b) => naturalSort(a.name, b.name)).forEach(s => {
    let dot = 'dot', status = '';
    if (!s.online) { dot += ' off'; status = 'left'; }
    else if (s.hidden) { dot += ' away'; status = '🎤 in LL'; }
    else if (s.quiet) { dot += ' away'; status = 'no signal'; }
    ul.append(el('li', null, el('span', { class: dot }), el('span', { class: 'rname', text: s.name + (s.demo ? ' (demo)' : '') }),
      s.vol && s.online ? el('span', { title: 'Wants to share' }, '✋') : null,
      s.shared ? el('span', { class: 'muted', title: 'Times shared' }, '🎤' + s.shared) : null,
      status ? el('span', { class: 'muted' }, status) : null));
  });
  if (!all.length) ul.append(el('li', { class: 'muted' }, 'No students yet.'));
}

/* ---- spinner (teacher side) ---- */
function spinPool() {
  const vols = [...H.students.values()].filter(s => s.vol && s.online).map(s => ({ id: s.id, name: s.name, shared: s.shared }));
  return vols.concat(H.manual.map(m => ({ id: m.id, name: m.name, shared: m.shared, manual: true })));
}
function openSpinner() {
  if (!H.signup) setSignup(true);
  const ov = $('#spin-overlay'); ov.hidden = false;
  $('#spin-host-controls').hidden = false;
  document.querySelector(`input[name="spin-mode"][value="${H.spin.mode}"]`).checked = true;
  $('#spin-headsup').checked = H.spin.headsUp; $('#spin-showpool').checked = H.spin.showPool;
  if (!H.spinState || H.spinState.phase === 'result') {
    $('#spin-visual').replaceChildren(el('div', { class: 'mystery', 'aria-hidden': 'true' }, '🎤'));
    $('#spin-result').textContent = '';
    $('#spin-skip').hidden = true;
  }
  renderSpinPool();
  broadcast({ t: 'spin', ph: 'ready-open' });
}
function renderSpinPool() {
  if (!H || $('#spin-overlay').hidden || $('#spin-host-controls').hidden) return;
  const box = $('#spin-pool'); box.replaceChildren();
  const pool = spinPool();
  box.append(el('span', { class: 'muted' }, pool.length ? pool.length + ' volunteer' + (pool.length === 1 ? '' : 's') + ':' : 'No volunteers yet. Students tick “I’d like to share.”'));
  pool.sort((a, b) => naturalSort(a.name, b.name)).forEach(p => {
    const done = H.spin.mode === 'round' && H.spin.round.includes(p.id);
    box.append(el('span', { class: 'pool-chip' + (done ? ' done' : ''), title: done ? 'Already shared this round' : '' },
      el('span', { class: 'pname', text: p.name }), p.shared ? el('span', { class: 'muted' }, '·' + p.shared) : null,
      p.manual ? el('button', { type: 'button', 'aria-label': 'Remove ' + p.name, onclick: () => { H.manual = H.manual.filter(m => m.id !== p.id); renderSpinPool(); renderHostSide(); saveHostSnap(); } }, '✕') : null));
  });
}
function doSpin() {
  if (H.spinState && (H.spinState.phase === 'countdown' || H.spinState.phase === 'spinning')) return;
  const pool = spinPool();
  if (!pool.length) { toast('No volunteers yet. Students tick “I’d like to share.”'); return; }
  let cands = pool;
  if (H.spin.mode === 'round') {
    cands = pool.filter(p => !H.spin.round.includes(p.id));
    if (!cands.length) { H.spin.round = []; cands = pool; toast('Everyone has had a turn. New round!'); }
  }
  cands = shuffle(cands);
  let winner;
  if (H.spin.mode === 'weighted') {
    const w = cands.map(p => 1 / (1 + p.shared)), tot = w.reduce((a, b) => a + b, 0);
    let r = randFloat() * tot; winner = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { winner = cands[i]; break; } }
  } else winner = cands[rand(cands.length)];
  const names = cands.map(c => c.name), wi = cands.indexOf(winner);
  const dur = reduceMotion() ? 400 : (names.length <= 12 ? 4200 : 3600);
  H.spinState = { phase: 'countdown', winner };
  $('#spin-go').disabled = true; $('#spin-skip').hidden = true; $('#spin-result').textContent = '';
  const go = () => {
    if (!H) return;
    H.spinState.phase = 'spinning';
    const show = H.spin.showPool;
    broadcast({ t: 'spin', ph: 'go', names: show ? names : null, wi: show ? wi : -1, win: winner.name, dur });
    animateSpin($('#spin-visual'), names, wi, winner.name, dur, () => finishPick(winner));
  };
  if (H.spin.headsUp && !reduceMotion()) {
    broadcast({ t: 'spin', ph: 'ready', s: 3 });
    let n = 3; const vis = $('#spin-visual');
    vis.replaceChildren(el('div', null, el('div', { class: 'countdown', text: '3' }), el('p', { class: 'muted' }, 'Get ready, volunteers!')));
    const t = setInterval(() => { n--; if (n <= 0) { clearInterval(t); go(); } else { const c = $('.countdown', vis); if (c) c.textContent = String(n); } }, 1000);
  } else go();
}
function finishPick(w) {
  if (!H) return;
  H.spinState.phase = 'result';
  if (w.manual) { const m = H.manual.find(x => x.id === w.id); if (m) m.shared++; }
  else { const st = H.students.get(w.id); if (st) { st.shared++; send(st, { t: 'you' }); } }
  if (!H.spin.round.includes(w.id)) H.spin.round.push(w.id);
  H.lastPick = w;
  $('#spin-result').replaceChildren(el('span', null, w.name), el('span', { class: 'sub' }, 'is sharing next!'));
  $('#spin-go').disabled = false; $('#spin-go').textContent = 'Spin again'; $('#spin-skip').hidden = false;
  renderSpinPool(); H.rosterDirty = true; H.reportDirty = true; saveHostSnap();
}
function skipPick() {
  const w = H && H.lastPick; if (!w) return;
  if (w.manual) { const m = H.manual.find(x => x.id === w.id); if (m) m.shared = Math.max(0, m.shared - 1); }
  else { const st = H.students.get(w.id); if (st) st.shared = Math.max(0, st.shared - 1); }
  H.spin.round = H.spin.round.filter(x => x !== w.id);
  H.lastPick = null; $('#spin-skip').hidden = true;
  $('#spin-result').replaceChildren(el('span', { class: 'sub' }, w.name + ' keeps their turn for later.'));
  broadcast({ t: 'spin', ph: 'skip' });
  renderSpinPool(); H.rosterDirty = true; H.reportDirty = true; saveHostSnap();
}
function closeSpinner() {
  $('#spin-overlay').hidden = true;
  if (H) { broadcast({ t: 'spin', ph: 'close' }); $('#spin-go').textContent = 'Spin'; }
}

/* ---- spotlight ---- */
function openSpotlight() {
  const it = currentItem();
  if (it && it.kind === 'dots') { toast('For a dot map, use “Share the dot map with the class”.'); return; } const list = $('#spot-list'); list.replaceChildren();
  if (!it || (it.kind !== 'q' && it.kind !== 'draw')) { list.append(el('p', { class: 'muted' }, 'Spotlight works on a question. Go to a question first.')); }
  else if (it.kind === 'draw') {
    const ans = H.report.answers[it.id] || {}, bg = hostImg(mediaIdFor(it));
    if (!Object.keys(ans).length) list.append(el('p', { class: 'muted' }, 'No drawings yet.'));
    else list.append(el('p', { class: 'muted' }, 'Pick up to 4 drawings.'));
    Object.entries(ans).forEach(([sid, r]) => {
      const st = H.students.get(sid);
      list.append(el('label', { class: 'check spot-pick' }, el('input', { type: 'checkbox', value: sid }),
        renderDrawing(document.createElement('canvas'), r.raw.s, bg, drawAspect(it), 160), el('strong', { class: 'sname', text: st ? st.name : 'Student' })));
    });
  } else {
    const ans = H.report.answers[it.id] || {};
    const rows = Object.entries(ans).filter(([, r]) => r.a);
    if (!rows.length) list.append(el('p', { class: 'muted' }, 'No answers yet.'));
    else list.append(el('p', { class: 'muted spot-legend' }, el('span', { class: 'is-right' }, '✓ green = correct'), '  ·  ', el('span', { class: 'is-wrong' }, '✗ red = not correct'), '  ·  Only you see these colors.'));
    rows.forEach(([sid, r]) => {
      const st = H.students.get(sid);
      const cb = el('input', { type: 'checkbox', value: sid });
      const mark = r.correct === true ? 'is-right' : r.correct === false ? 'is-wrong' : '';
      list.append(el('label', { class: 'check' }, cb, el('span', null, el('strong', { class: 'sname', text: (st ? st.name : 'Student') + ': ' }),
        el('span', { class: 'spot-ans ' + mark }, (r.correct === true ? '✓ ' : r.correct === false ? '✗ ' : '') + r.a))));
    });
  }
  $('#spot-overlay').hidden = false;
}
function showSpotlight() {
  const it = currentItem(); if (!it || (it.kind !== 'q' && it.kind !== 'draw')) return;
  const anon = document.querySelector('input[name="spot-mode"]:checked').value === 'anon';
  const ans = H.report.answers[it.id] || {};
  const picked = [...document.querySelectorAll('#spot-list input:checked')].map(c => c.value);
  if (!picked.length) { toast('Tick at least one answer.'); return; }
  if (it.kind === 'draw' && picked.length > 4) { toast('Pick 4 drawings or fewer.'); return; }
  const firstName = st => anon || !st ? null : st.name.replace(/\s\(\d+\)$/, '').split(' ')[0];
  H.spotlight = picked.map(sid => {
    const st = H.students.get(sid);
    if (it.kind === 'draw') return { d: ans[sid] ? ans[sid].raw : { s: [] }, bg: mediaIdFor(it), aspect: drawAspect(it), by: firstName(st) };
    return { text: ans[sid] ? ans[sid].a : '', by: firstName(st) };
  });
  broadcast({ t: 'spot', items: H.spotlight });
  $('#spot-overlay').hidden = true; toast('Spotlight is showing on student screens.');
}
function hideSpotlight() { H.spotlight = null; broadcast({ t: 'spot', items: null }); $('#spot-overlay').hidden = true; toast('Spotlight hidden.'); }

/* =====================================================================
   15. CLASSROOM TOOLS: timer, dice, scoreboard, random wheel
   ===================================================================== */
function chime() {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    const a = chime.ctx || (chime.ctx = new A());
    [0, 0.18, 0.36].forEach((t, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = [880, 1046, 1318][i]; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, a.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t + 0.35);
      o.connect(g).connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.4);
    });
  } catch { /* sound is optional */ }
}
function fmtTime(ms) { const s = Math.ceil(Math.max(0, ms) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
const DIE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const Wheels = { all() { const v = lsGet(KEYS.wheels, []); return Array.isArray(v) ? v : []; }, save(v) { lsSet(KEYS.wheels, v); } };

/* ---------- teacher: state helpers ---------- */
function timerLeft() { const t = H.timer; if (!t.total) return 0; return t.run ? Math.max(0, t.left - (performance.now() - t.at)) : t.left; }
function timerMsg() { const t = H.timer; return t.total ? { t: 'tm', left: Math.round(timerLeft()), run: t.run, total: t.total, chime: t.stChime } : { t: 'tm', off: 1 }; }
function setTimer(patch) { Object.assign(H.timer, patch); broadcast(timerMsg()); updateHostTimer(); saveHostSnap(); if (toolsTab === 'timer') renderTools(); }
function updateHostTimer() {
  const b = $('#h-timer'); if (!H || !H.timer.total) { b.hidden = true; return; }
  const left = timerLeft(); b.hidden = false; b.textContent = (left <= 0 ? '⏰ ' : '⏱ ') + fmtTime(left);
  b.dataset.state = left <= 0 ? 'done' : left <= 10000 ? 'low' : '';
  const big = $('#tool-big-time'); if (big) big.textContent = fmtTime(left);
  if (H.timer.run && left <= 0) { H.timer.run = false; H.timer.left = 0; broadcast(timerMsg()); if (H.timer.chime) chime(); toast('⏰ Time’s up!'); if (toolsTab === 'timer') renderTools(); }
}
function sbMsg() { return { t: 'sb', show: H.sb.show, teams: H.sb.teams }; }
function setScore() { broadcast(sbMsg()); updateHostScore(); saveHostSnap(); }
function updateHostScore() {
  const b = $('#h-score'); if (!H || !H.sb.show) { b.hidden = true; return; }
  b.hidden = false; b.textContent = '🏆 ' + H.sb.teams.map(t => t.n + ' ' + t.s).join(' · ');
}
function awardStarPoint() {
  if (!H.sb.autoStar) return;
  const team = H.sb.teams.find(t => /student|class/i.test(t.n)) || H.sb.teams[1] || H.sb.teams[0];
  if (team) { team.s++; setScore(); }
}

/* ---------- teacher: the tools panel ---------- */
let toolsTab = 'timer';
function openTools(tab) { if (tab) toolsTab = tab; $('#tools-overlay').hidden = false; renderTools(); }
function closeTools() { $('#tools-overlay').hidden = true; hideToolFromClass(); }
function hideToolFromClass() { if (H && H.toolShowing) { H.toolShowing = false; broadcast({ t: 'toolclose' }); } }
function renderTools() {
  if ($('#tools-overlay').hidden) return;
  document.querySelectorAll('#tools-tabs .tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tool === toolsTab)));
  const body = $('#tools-body'); body.replaceChildren();
  ({ timer: toolTimer, dice: toolDice, score: toolScore, wheel: toolWheel })[toolsTab](body);
}
function toolTimer(body) {
  const t = H.timer;
  body.append(el('div', { class: 'big-time', id: 'tool-big-time' }, fmtTime(timerLeft())));
  const presets = el('div', { class: 'spin-buttons' }, [1, 2, 3, 5, 10].map(m => el('button', { class: 'btn', onclick: () => setTimer({ total: m * 60000, left: m * 60000, run: true, at: performance.now() }) }, m + ' min')));
  const mm = el('input', { type: 'number', min: 0, max: 99, value: 1, 'aria-label': 'Minutes', class: 'num' }), ss = el('input', { type: 'number', min: 0, max: 59, value: 30, 'aria-label': 'Seconds', class: 'num' });
  const custom = el('div', { class: 'row-inline' }, mm, ':', ss, el('button', { class: 'btn', onclick: () => { const ms = ((+mm.value || 0) * 60 + (+ss.value || 0)) * 1000; if (ms > 0) setTimer({ total: ms, left: ms, run: true, at: performance.now() }); } }, 'Start'));
  const ctl = el('div', { class: 'spin-buttons' });
  if (t.total) {
    if (t.run) ctl.append(el('button', { class: 'btn btn-primary', onclick: () => setTimer({ left: timerLeft(), run: false }) }, '⏸ Pause'));
    else if (timerLeft() > 0) ctl.append(el('button', { class: 'btn btn-primary', onclick: () => setTimer({ run: true, at: performance.now() }) }, '▶ Resume'));
    ctl.append(el('button', { class: 'btn', onclick: () => setTimer({ left: timerLeft() + 30000, total: H.timer.total + 30000, at: performance.now(), run: H.timer.run || timerLeft() <= 0 }) }, '+30 sec'),
      el('button', { class: 'btn btn-ghost', onclick: () => setTimer({ total: 0, left: 0, run: false }) }, 'Stop & hide'));
  }
  const ch = el('input', { type: 'checkbox' }); ch.checked = t.chime; ch.addEventListener('change', () => { H.timer.chime = ch.checked; saveHostSnap(); });
  const sch = el('input', { type: 'checkbox' }); sch.checked = t.stChime; sch.addEventListener('change', () => { H.timer.stChime = sch.checked; broadcast(timerMsg()); saveHostSnap(); });
  body.append(presets, custom, ctl,
    el('label', { class: 'check small' }, ch, 'Chime on my computer when time is up'),
    el('label', { class: 'check small' }, sch, 'Chime on student devices too'),
    el('p', { class: 'muted' }, 'Students see a small timer at the top of their screen. It keeps going if you close this panel.'));
}
function diceFacesFromText(txt) { return txt.split('\n').map(s => cleanText(s, 30).trim()).filter(Boolean).slice(0, 20); }
function toolDice(body) {
  const d = H.dice;
  const count = el('div', { class: 'seg', role: 'group', 'aria-label': 'How many dice' }, [1, 2, 3].map(n => el('button', { class: 'chip', 'aria-pressed': String(d.n === n), onclick: () => { d.n = n; renderTools(); } }, n + (n === 1 ? ' die' : ' dice'))));
  const kind = el('div', { class: 'seg', role: 'group', 'aria-label': 'Dice faces' },
    el('button', { class: 'chip', 'aria-pressed': String(!d.custom), onclick: () => { d.custom = false; renderTools(); } }, 'Dots 1–6'),
    el('button', { class: 'chip', 'aria-pressed': String(!!d.custom), onclick: () => { d.custom = true; renderTools(); } }, 'My own faces'));
  body.append(el('label', null, 'Dice'), count, el('label', null, 'Faces'), kind);
  if (d.custom) {
    const ta = el('textarea', { rows: 4, 'aria-label': 'One face per line' }); ta.value = d.text;
    ta.addEventListener('input', () => { d.text = ta.value; });
    body.append(el('p', { class: 'muted' }, 'One face per line (for example: add, subtract, multiply).'), ta);
  }
  const vis = el('div', { class: 'spin-visual', id: 'dice-host' });
  body.append(el('div', { class: 'spin-buttons' }, el('button', { class: 'btn btn-sun', onclick: () => rollDice(vis) }, '🎲 Roll'),
    el('button', { class: 'btn btn-ghost', onclick: () => { H.toolShowing = true; hideToolFromClass(); toast('Hidden from student screens.'); } }, 'Hide from class')), vis);
}
function rollDice(vis) {
  const d = H.dice, faces = d.custom ? diceFacesFromText(d.text) : null;
  if (d.custom && faces.length < 2) { toast('Add at least 2 faces, one per line.'); return; }
  const n = faces ? faces.length : 6, vals = Array.from({ length: d.n }, () => rand(n));
  const msg = { t: 'dice', faces, vals, dur: reduceMotion() ? 200 : 1300 };
  broadcast(msg); H.toolShowing = true; showDice(vis, msg);
}
function diceLabel(faces, v) { return faces ? faces[v] : DIE_FACES[v]; }
function showDice(vis, m, resultEl) {
  vis.replaceChildren();
  const row = el('div', { class: 'dice-row' }); vis.append(row);
  const dice = m.vals.map(() => { const d = el('div', { class: 'die' + (m.faces ? ' word' : '') }); row.append(d); return d; });
  const n = m.faces ? m.faces.length : 6;
  const tick = setInterval(() => dice.forEach(d => { d.textContent = diceLabel(m.faces, rand(n)); }), 90);
  setTimeout(() => {
    clearInterval(tick); dice.forEach((d, i) => { d.textContent = diceLabel(m.faces, m.vals[i]); d.classList.add('landed'); });
    const total = m.faces ? null : m.vals.reduce((a, v) => a + v + 1, 0);
    const txt = m.faces ? m.vals.map(v => m.faces[v]).join(' + ') : (m.vals.length > 1 ? 'Total: ' + total : 'You rolled ' + total);
    if (resultEl) resultEl.textContent = txt; else vis.append(el('div', { class: 'spin-result', text: txt }));
  }, m.dur);
}
function toolScore(body) {
  const sb = H.sb;
  const list = el('div', { class: 'score-list' });
  sb.teams.forEach((t, i) => {
    const name = el('input', { maxlength: 20, 'aria-label': 'Team name' }); name.value = t.n;
    name.addEventListener('change', () => { t.n = cleanText(name.value, 20).trim() || 'Team'; setScore(); });
    list.append(el('div', { class: 'score-row' }, name,
      el('button', { class: 'btn', 'aria-label': 'Minus one for ' + t.n, onclick: () => { t.s--; setScore(); renderTools(); } }, '−'),
      el('span', { class: 'score-num', text: String(t.s) }),
      el('button', { class: 'btn btn-primary', 'aria-label': 'Plus one for ' + t.n, onclick: () => { t.s++; setScore(); renderTools(); } }, '+'),
      sb.teams.length > 2 ? el('button', { class: 'btn btn-ghost', 'aria-label': 'Remove ' + t.n, onclick: () => { sb.teams.splice(i, 1); setScore(); renderTools(); } }, '✕') : null));
  });
  const show = el('input', { type: 'checkbox' }); show.checked = sb.show; show.addEventListener('change', () => { sb.show = show.checked; setScore(); });
  const auto = el('input', { type: 'checkbox' }); auto.checked = sb.autoStar; auto.addEventListener('change', () => { sb.autoStar = auto.checked; saveHostSnap(); });
  body.append(list, el('div', { class: 'spin-buttons' },
    sb.teams.length < 4 ? el('button', { class: 'btn', onclick: () => { sb.teams.push({ n: 'Team ' + (sb.teams.length + 1), s: 0 }); setScore(); renderTools(); } }, '+ Add team') : null,
    el('button', { class: 'btn', onclick: () => { sb.teams.forEach(t => { t.s = 0; }); setScore(); renderTools(); } }, 'Reset scores'),
    el('button', { class: 'btn', onclick: () => { sb.teams = [{ n: 'Teacher', s: 0 }, { n: 'Students', s: 0 }]; setScore(); renderTools(); } }, 'Teacher vs Students')),
    el('label', { class: 'check small' }, show, 'Show the scoreboard on student screens'),
    el('label', { class: 'check small' }, auto, 'Give Students +1 when the class earns a ⭐'));
}
function toolWheel(body) {
  const lists = Wheels.all();
  const pick = el('select', { 'aria-label': 'Which list' },
    el('option', { value: '__class' }, 'Everyone in class (names)'), lists.map(l => el('option', { value: l.id }, l.name + ' (' + l.items.length + ')')));
  pick.value = H.wheel.listId && (H.wheel.listId === '__class' || lists.some(l => l.id === H.wheel.listId)) ? H.wheel.listId : (lists[0] ? lists[0].id : '__class');
  H.wheel.listId = pick.value;
  pick.addEventListener('change', () => { H.wheel.listId = pick.value; renderTools(); });
  const rm = el('input', { type: 'checkbox' }); rm.checked = H.wheel.remove; rm.addEventListener('change', () => { H.wheel.remove = rm.checked; });
  const cur = lists.find(l => l.id === pick.value);
  body.append(el('label', null, 'List'), el('div', { class: 'row-inline' }, pick,
    el('button', { class: 'btn', onclick: () => editWheelList(null) }, 'New list'),
    cur ? el('button', { class: 'btn', onclick: () => editWheelList(cur) }, 'Edit') : null,
    cur ? el('button', { class: 'btn btn-danger', onclick: async () => { if (await confirmBox('Delete “' + cur.name + '”?')) { Wheels.save(Wheels.all().filter(x => x.id !== cur.id)); H.wheel.listId = null; renderTools(); } } }, 'Delete') : null),
    el('label', { class: 'check small' }, rm, 'Take out each pick until I reset'));
  const used = H.wheel.used[pick.value] || [];
  if (used.length) body.append(el('p', { class: 'muted' }, 'Already picked: ' + used.join(', ') + ' ', el('button', { class: 'btn btn-small', onclick: () => { H.wheel.used[pick.value] = []; renderTools(); } }, 'Reset')));
  const vis = el('div', { class: 'spin-visual' }), res = el('div', { class: 'spin-result', 'aria-live': 'assertive' });
  body.append(el('div', { class: 'spin-buttons' }, el('button', { class: 'btn btn-sun', onclick: () => spinWheel(vis, res) }, '🎡 Spin'),
    el('button', { class: 'btn btn-ghost', onclick: () => { H.toolShowing = true; hideToolFromClass(); toast('Hidden from student screens.'); } }, 'Hide from class')), vis, res);
}
function wheelItems(listId) {
  if (listId === '__class') return [...H.students.values()].filter(s => s.online && !s.demo).map(s => s.name).sort(naturalSort);
  const l = Wheels.all().find(x => x.id === listId); return l ? l.items.slice() : [];
}
function spinWheel(vis, res) {
  const id = H.wheel.listId, used = (H.wheel.used[id] ||= []);
  let items = wheelItems(id);
  if (H.wheel.remove) items = items.filter(x => !used.includes(x));
  if (!items.length) { toast(H.wheel.remove && used.length ? 'Everything has been picked. Choose Reset.' : 'This list is empty.'); return; }
  items = shuffle(items);
  const wi = rand(items.length), win = items[wi], dur = reduceMotion() ? 300 : 3800;
  const title = id === '__class' ? 'Random pick' : (Wheels.all().find(x => x.id === id) || {}).name || 'Random wheel';
  broadcast({ t: 'wheel', names: items, wi, win, dur, title }); H.toolShowing = true;
  res.textContent = '';
  animateSpin(vis, items, wi, win, dur, () => { res.textContent = win; if (H.wheel.remove) { used.push(win); renderTools(); } });
}
function editWheelList(list) {
  openModal((card, close) => {
    const name = el('input', { maxlength: 40 }); name.value = list ? list.name : '';
    const ta = el('textarea', { rows: 8 }); ta.value = list ? list.items.join('\n') : '';
    card.append(el('h2', null, list ? 'Edit list' : 'New list'), el('label', null, 'List name'), name,
      el('label', null, 'Items (one per line, up to 60)'), ta,
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => {
          const items = ta.value.split('\n').map(s => cleanText(s, 40).trim()).filter(Boolean).slice(0, 60);
          if (!name.value.trim() || items.length < 2) { toast('Add a name and at least 2 items.'); return; }
          const all = Wheels.all(), rec = { id: list ? list.id : uid(), name: cleanText(name.value, 40).trim(), items };
          const i = all.findIndex(x => x.id === rec.id); if (i >= 0) all[i] = rec; else all.push(rec);
          Wheels.save(all); H.wheel.listId = rec.id; close(); renderTools();
        } }, 'Save'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}

/* ---------- student side ---------- */
let stTimerT = null;
function onTimer(m) {
  clearInterval(stTimerT);
  const b = $('#st-timer');
  if (m.off) { S.timer = null; b.hidden = true; return; }
  S.timer = { end: Date.now() + m.left, run: m.run, left: m.left, chime: m.chime, rang: m.left <= 0 };
  const paint = () => {
    const t = S.timer; if (!t) return;
    const left = t.run ? t.end - Date.now() : t.left;
    b.hidden = false; b.textContent = (left <= 0 ? '⏰ Time’s up!' : '⏱ ' + fmtTime(left));
    b.dataset.state = left <= 0 ? 'done' : left <= 10000 ? 'low' : '';
    if (left <= 0 && !t.rang) { t.rang = true; clearInterval(stTimerT); if (t.chime) chime(); toast('⏰ Time’s up!'); }
  };
  paint(); if (m.run) stTimerT = setInterval(paint, 250);
}
function onScore(m) {
  const b = $('#st-score');
  if (!m.show) { b.hidden = true; return; }
  b.hidden = false; b.textContent = '🏆 ' + (m.teams || []).map(t => cleanText(t.n, 20) + ' ' + (t.s | 0)).join(' · ');
}
function studentTool(m) {
  const ov = $('#tool-overlay');
  if (m.t === 'toolclose') { ov.hidden = true; return; }
  ov.hidden = false;
  const vis = $('#tool-visual'), res = $('#tool-result'); res.textContent = '';
  if (m.t === 'dice') { $('#tool-title').textContent = '🎲 Dice'; showDice(vis, m, res); }
  else { $('#tool-title').textContent = '🎡 ' + cleanText(m.title || 'Random wheel', 40); animateSpin(vis, m.names, m.wi, m.win, m.dur, () => { res.textContent = m.win; }); }
}

/* =====================================================================
   14. INK: shared stroke drawing (annotations + drawing answers)
   A stroke = { id, c: color, w: width in 1/1000 of picture width, hl: highlighter?, p: [x,y,x,y…] }
   Points are whole numbers 0–10000 across the picture, so every screen size lines up.
   ===================================================================== */
const INK_COLORS = ['#D62F4B', '#1F6FD1', '#178A4C', '#1E2B4A'];
const DRAW_COLORS = ['#1E2B4A', '#D62F4B', '#1F6FD1', '#178A4C', '#F2A100', '#8A3FD1'];
const HIGHLIGHT = '#FFD43B';
function paintStrokes(ctx, strokes, W, Hh) {
  for (const s of strokes || []) {
    const p = s.p; if (!p || p.length < 2) continue;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c; ctx.globalAlpha = s.hl ? 0.45 : 1; ctx.lineWidth = Math.max(1, s.w / 1000 * W);
    ctx.beginPath(); ctx.moveTo(p[0] / 10000 * W, p[1] / 10000 * Hh);
    if (p.length === 2) ctx.lineTo(p[0] / 10000 * W + 0.1, p[1] / 10000 * Hh);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] / 10000 * W, p[i + 1] / 10000 * Hh);
    ctx.stroke(); ctx.restore();
  }
}
function fitCanvas(c) {
  const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return [w, h];
}
function redrawInk(c, strokes) { if (!c || !c.isConnected) return; const [w, h] = fitCanvas(c); const x = c.getContext('2d'); x.clearRect(0, 0, w, h); paintStrokes(x, strokes, w, h); }
function canvasPos(c, e) {
  const r = c.getBoundingClientRect();
  return [Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 10000), Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 10000)];
}
function strokeNear(strokes, x, y, r) {
  for (let i = strokes.length - 1; i >= 0; i--) { const p = strokes[i].p; for (let k = 0; k < p.length; k += 2) if (Math.abs(p[k] - x) < r && Math.abs(p[k + 1] - y) < r) return i; }
  return -1;
}
function applyInkOp(list, m) {
  if (m.op === 'start' && m.s) list.push({ id: m.s.id, c: m.s.c, w: m.s.w, hl: !!m.s.hl, p: (m.s.p || []).slice() });
  else if (m.op === 'pts') { const s = list.find(x => x.id === m.id); if (s && Array.isArray(m.p)) s.p.push(...m.p); }
  else if (m.op === 'del') { const i = list.findIndex(x => x.id === m.id); if (i >= 0) list.splice(i, 1); }
  else if (m.op === 'clear') list.length = 0;
}
/* Draw one finished drawing (with optional background picture) onto a canvas */
function renderDrawing(canvas, strokes, bgImg, aspect, width) {
  const w = width, h = Math.round(width / (aspect || 4 / 3));
  canvas.width = w; canvas.height = h;
  const x = canvas.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  if (bgImg && bgImg.complete && bgImg.naturalWidth) x.drawImage(bgImg, 0, 0, w, h);
  paintStrokes(x, strokes, w, h);
  return canvas;
}

/* ---- student side: teacher annotations + laser on the current slide ---- */
function attachStudentInk(frame) {
  const c = el('canvas', { class: 'ink-layer', 'aria-hidden': 'true' }); frame.append(c);
  requestAnimationFrame(() => redrawInk(c, S.ink.strokes));
}
function onInkMsg(m) {
  if (!S.view || S.view.k !== 'slide' || S.view.sid !== m.iid) return;
  applyInkOp(S.ink.strokes, m);
  redrawInk($('#st-stage .slide-frame .ink-layer'), S.ink.strokes);
}
let laserHideT = null;
function showLaser(container, m) {
  const frame = container.querySelector('.slide-frame'); if (!frame) return;
  let dot = frame.querySelector('.laser-dot');
  if (m.off) { if (dot) dot.remove(); return; }
  if (!dot) { dot = el('div', { class: 'laser-dot', 'aria-hidden': 'true' }); frame.append(dot); }
  dot.style.left = (m.x / 100) + '%'; dot.style.top = (m.y / 100) + '%';
  clearTimeout(laserHideT); laserHideT = setTimeout(() => dot.remove(), 2000);
}

/* ---- teacher side: annotation toolbar + drawing on the current slide ---- */
function inkToolbar(it) {
  const tools = [['pointer', '👆 Point'], ['laser', '🔴 Laser'], ['pen', '✏️ Pen'], ['hl', '🖍 Highlight'], ['eraser', '🧽 Eraser']];
  const bar = el('div', { class: 'ink-bar', role: 'toolbar', 'aria-label': 'Annotate this slide' });
  tools.forEach(([t, label]) => bar.append(el('button', { class: 'tool-btn', type: 'button', 'aria-pressed': String(H.tool === t),
    onclick: () => { H.tool = H.tool === t ? null : t; renderHostStage(); } }, label)));
  bar.append(el('span', { class: 'swatches' }, INK_COLORS.map(c => el('button', { class: 'swatch', type: 'button', 'aria-label': 'Pen color', 'aria-pressed': String(H.inkColor === c), style: 'background:' + c,
    onclick: () => { H.inkColor = c; if (H.tool !== 'pen') H.tool = 'pen'; renderHostStage(); } }))));
  bar.append(el('button', { class: 'tool-btn', type: 'button', onclick: () => { const l = H.ink[it.id] || []; const s = l.pop(); if (s) { broadcast({ t: 'ink', op: 'del', iid: it.id, id: s.id }); redrawInk(H.inkCanvas, l); saveHostSnap(); } } }, '↶ Undo'),
    el('button', { class: 'tool-btn', type: 'button', onclick: () => { H.ink[it.id] = []; broadcast({ t: 'ink', op: 'clear', iid: it.id }); redrawInk(H.inkCanvas, []); saveHostSnap(); } }, '🗑 Clear'));
  return bar;
}
function attachHostInk(frame, it) {
  const c = el('canvas', { class: 'ink-layer' + (H.tool ? ' active' : '') }); frame.append(c); H.inkCanvas = c;
  const list = () => (H.ink[it.id] ||= []);
  requestAnimationFrame(() => redrawInk(c, list()));
  let cur = null, buf = [], flushT = null, lastLz = 0, erasing = false, drawing = false;
  const flush = () => { flushT = null; if (cur && buf.length) { broadcast({ t: 'ink', op: 'pts', iid: it.id, id: cur.id, p: buf }); buf = []; } };
  c.addEventListener('pointerdown', e => {
    if (!H.tool) return;
    e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const [x, y] = canvasPos(c, e); drawing = true;
    if (H.tool === 'pointer') { broadcast({ t: 'pt', x: x / 10000, y: y / 10000 }); showPointer($('#h-stage'), x / 10000, y / 10000); }
    else if (H.tool === 'laser') { broadcast({ t: 'lz', x, y }); showLaser($('#h-stage'), { x, y }); lastLz = performance.now(); }
    else if (H.tool === 'eraser') { erasing = true; eraseAt(x, y); }
    else {
      if (list().length >= 300) { toast('This slide has a lot of ink. Clear some first.'); return; }
      cur = { id: uid(6), c: H.tool === 'hl' ? HIGHLIGHT : H.inkColor, w: H.tool === 'hl' ? 24 : 5, hl: H.tool === 'hl', p: [x, y] };
      list().push(cur); broadcast({ t: 'ink', op: 'start', iid: it.id, s: cur }); redrawInk(c, list());
    }
  });
  c.addEventListener('pointermove', e => {
    if (!drawing) return;
    const [x, y] = canvasPos(c, e);
    if (H.tool === 'laser') { const n = performance.now(); if (n - lastLz > 70) { lastLz = n; broadcast({ t: 'lz', x, y }); } showLaser($('#h-stage'), { x, y }); return; }
    if (erasing) { eraseAt(x, y); return; }
    if (!cur) return;
    const p = cur.p, lx = p[p.length - 2], ly = p[p.length - 1];
    if (Math.abs(x - lx) + Math.abs(y - ly) < 20 || p.length > 4000) return;
    p.push(x, y); buf.push(x, y);
    redrawInk(c, list());
    if (!flushT) flushT = setTimeout(flush, 60);
  });
  const end = () => {
    if (!drawing) return; drawing = false;
    if (H.tool === 'laser') { broadcast({ t: 'lz', off: 1 }); showLaser($('#h-stage'), { off: 1 }); }
    clearTimeout(flushT); flush(); cur = null; erasing = false; saveHostSnap();
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end); c.addEventListener('pointerleave', end);
  function eraseAt(x, y) {
    const l = list(), i = strokeNear(l, x, y, 180);
    if (i >= 0) { const s = l.splice(i, 1)[0]; broadcast({ t: 'ink', op: 'del', iid: it.id, id: s.id }); redrawInk(c, l); }
  }
}
window.addEventListener('resize', () => {
  if (H && H.inkCanvas) redrawInk(H.inkCanvas, H.ink[(currentItem() || {}).id] || []);
  if (S.active) redrawInk($('#st-stage .slide-frame .ink-layer'), S.ink.strokes);
  document.querySelectorAll('.draw-layer').forEach(c => c._redraw && c._redraw());
});

/* =====================================================================
   16. DRAWING RESPONSES
   Drawings travel as strokes (tiny), not pictures. Only the teacher sees them,
   until the teacher spotlights some (first name or anonymous).
   ===================================================================== */
function mediaUrl(mid) { if (!mid) return null; const s = S.slides.get(mid), p = S.previews.get(mid); return (s && s.url) || (p && p.url) || null; }

/* ---- student: drawing canvas ---- */
function buildDrawResponse(v) {
  const locked = v.phase !== 'open';
  const card = el('div', { class: 'q-card draw-card' }, el('div', { class: 'q-text', text: v.prompt || 'Draw your answer.' }));
  if (prefs.read) card.append(readBtn(() => v.read || v.prompt || 'Draw your answer.'));
  if (!S.drawDraft[v.qid]) S.drawDraft[v.qid] = v.mine && Array.isArray(v.mine.s) ? JSON.parse(JSON.stringify(v.mine.s)) : [];
  const strokes = S.drawDraft[v.qid];
  const st = S.drawTool;
  const frame = el('div', { class: 'draw-frame' }); frame.style.aspectRatio = String(v.aspect || 4 / 3); frame.style.setProperty('--ar', String(v.aspect || 4 / 3));
  if (v.bg) { const u = mediaUrl(v.bg); frame.append(u ? el('img', { src: u, alt: '' }) : el('div', { class: 'slide-loading' }, 'Loading picture…')); }
  const c = el('canvas', { class: 'ink-layer draw-layer' + (locked ? '' : ' active'), 'aria-label': 'Drawing space' });
  frame.append(c);
  c._redraw = () => redrawInk(c, strokes);
  requestAnimationFrame(c._redraw);

  const bar = el('div', { class: 'ink-bar draw-bar', role: 'toolbar', 'aria-label': 'Drawing tools' });
  const paintBar = () => {
    bar.replaceChildren(
      el('span', { class: 'swatches' }, DRAW_COLORS.map(col => el('button', { class: 'swatch', type: 'button', 'aria-label': 'Color', 'aria-pressed': String(st.tool === 'pen' && st.color === col), style: 'background:' + col, disabled: locked,
        onclick: () => { st.color = col; st.tool = 'pen'; paintBar(); } }))),
      el('button', { class: 'tool-btn', type: 'button', 'aria-pressed': String(st.size === 5), disabled: locked, onclick: () => { st.size = 5; st.tool = 'pen'; paintBar(); } }, 'Thin'),
      el('button', { class: 'tool-btn', type: 'button', 'aria-pressed': String(st.size === 14), disabled: locked, onclick: () => { st.size = 14; st.tool = 'pen'; paintBar(); } }, 'Thick'),
      el('button', { class: 'tool-btn', type: 'button', 'aria-pressed': String(st.tool === 'eraser'), disabled: locked, onclick: () => { st.tool = st.tool === 'eraser' ? 'pen' : 'eraser'; paintBar(); } }, '🧽 Eraser'),
      el('button', { class: 'tool-btn', type: 'button', disabled: locked, onclick: () => { strokes.pop(); c._redraw(); } }, '↶ Undo'),
      el('button', { class: 'tool-btn', type: 'button', disabled: locked, onclick: () => { strokes.length = 0; c._redraw(); } }, '🗑 Clear'));
  };
  paintBar();
  if (!locked) {
    let cur = null;
    c.addEventListener('pointerdown', e => {
      e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const [x, y] = canvasPos(c, e);
      if (st.tool === 'eraser') { const i = strokeNear(strokes, x, y, 250); if (i >= 0) { strokes.splice(i, 1); c._redraw(); } cur = 'erase'; return; }
      if (strokes.length >= 300) { toast('That’s a lot of lines! Undo some first.'); return; }
      cur = { c: st.color, w: st.size, p: [x, y] }; strokes.push(cur); c._redraw();
    });
    c.addEventListener('pointermove', e => {
      if (!cur) return;
      const [x, y] = canvasPos(c, e);
      if (cur === 'erase') { const i = strokeNear(strokes, x, y, 250); if (i >= 0) { strokes.splice(i, 1); c._redraw(); } return; }
      const p = cur.p; if (Math.abs(x - p[p.length - 2]) + Math.abs(y - p[p.length - 1]) < 40 || p.length > 1600) return;
      p.push(x, y); c._redraw();
    });
    const end = () => { cur = null; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  }
  card.append(bar, frame);
  const note = el('span', { class: 'sent-note', id: 'q-sent', 'aria-live': 'polite' });
  if (!locked) {
    const submit = () => {
      if (!strokes.length) { toast('Draw something first.'); return; }
      const msg = { t: 'ans', qid: v.qid, a: { s: strokes.map(s => ({ c: s.c, w: s.w, p: s.p.slice() })) } };
      S.pendingAns = msg; S.ackQid = null;
      note.textContent = sendHost(msg) ? 'Sending…' : 'Not connected — it will send when you’re back.';
    };
    card.append(el('div', { class: 'q-actions' }, el('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, 'Send my drawing'), note));
    if (v.mine) note.textContent = 'Drawing sent ✓ You can change it and send again.';
    card.append(el('p', { class: 'muted' }, 'Only your teacher sees your drawing.'));
  } else card.append(el('p', { class: 'muted' }, v.mine ? 'Drawing sent ✓ Answers are closed.' : 'Answers are closed.'));
  return card;
}

/* ---- teacher: checking + storing drawings ---- */
function sanitizeDrawing(a) {
  if (!a || !Array.isArray(a.s) || a.s.length > 300) return null;
  let total = 0; const out = [];
  for (const s of a.s) {
    if (!s || !Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2) continue;
    total += s.p.length; if (total > 40000) return null;
    const p = s.p.map(n => Math.max(0, Math.min(10000, Math.round(Number(n) || 0))));
    out.push({ c: DRAW_COLORS.includes(s.c) ? s.c : DRAW_COLORS[0], w: Math.max(2, Math.min(30, Number(s.w) || 5)), p });
  }
  return out.length ? { s: out } : null;
}
function hostImg(mid) {
  if (!mid) return null;
  H.imgCache ||= {};
  if (!H.imgCache[mid]) { const im = new Image(); im.src = H.urls.get(mid); im.onload = () => { H.galleryDirty = true; }; H.imgCache[mid] = im; }
  return H.imgCache[mid];
}
function drawAspect(it) { return it.bgW && it.bgH ? it.bgW / it.bgH : 4 / 3; }

/* ---- teacher: stage for a drawing question ---- */
function renderDrawStage(stage, it) {
  const ph = H.phase[it.id] || 'open';
  stage.append(el('div', { class: 'q-card' }, el('div', { class: 'tag', text: 'Drawing' }), el('div', { class: 'q-text', text: it.prompt || 'Draw your answer.' })));
  stage.append(el('div', { class: 'host-q-meta' },
    el('span', { class: 'count-pill', id: 'h-answered' }, ''),
    ph === 'open' ? el('button', { class: 'btn btn-primary', onclick: () => setPhase('closed') }, 'Stop answers')
                  : el('button', { class: 'btn', onclick: () => setPhase('open') }, 'Reopen answers'),
    el('button', { class: 'btn', onclick: openSpotlight }, '🔦 Spotlight drawings'),
    el('button', { class: 'btn', onclick: () => downloadDrawings([it.id]) }, '⬇ Download drawings')));
  stage.append(el('div', { class: 'gallery', id: 'h-gallery' }));
  renderGallery(it);
}
function renderGallery(it) {
  const g = $('#h-gallery'); if (!g) return;
  H.galleryDirty = false;
  const ans = H.report.answers[it.id] || {}, bg = hostImg(mediaIdFor(it)), aspect = drawAspect(it);
  const rows = Object.entries(ans).sort((a, b) => naturalSort((H.students.get(a[0]) || {}).name || '', (H.students.get(b[0]) || {}).name || ''));
  g.replaceChildren();
  if (!rows.length) { g.append(el('p', { class: 'muted' }, 'Drawings appear here as students send them. Only you can see them.')); return; }
  rows.forEach(([sid, r]) => {
    const st = H.students.get(sid);
    g.append(el('figure', { class: 'thumb-card' }, renderDrawing(document.createElement('canvas'), r.raw.s, bg, aspect, 240),
      el('figcaption', { class: 'sname', text: st ? st.name : 'Student' })));
  });
}

/* ---- teacher: download drawings as one page saved on this computer ---- */
async function downloadDrawings(qids, report, lesson) {
  const r = report || H.report, items = lesson ? lesson.items : (H ? H.items : []);
  const parts = [], made = [];
  for (const qid of qids) {
    const it = items.find(x => x.id === qid), q = r.questions.find(x => x.qid === qid);
    let img = null;
    if (it && it.bg) { const u = URL.createObjectURL(it.bg); made.push(u); img = new Image(); img.src = u; await img.decode().catch(() => {}); }
    const aspect = it ? drawAspect(it) : 4 / 3;
    const ans = Object.entries(r.answers[qid] || {}).sort((a, b) => naturalSort((r.students[a[0]] || {}).name || '', (r.students[b[0]] || {}).name || ''));
    const figs = ans.map(([sid, a]) => {
      const url = renderDrawing(document.createElement('canvas'), a.raw.s, img, aspect, 800).toDataURL('image/jpeg', 0.85);
      const name = (r.students[sid] || {}).name || 'Student';
      return '<figure><img src="' + url + '" alt=""><figcaption>' + escapeHTML(name) + '</figcaption></figure>';
    });
    parts.push('<h2>' + escapeHTML((q ? 'Question ' + q.n + ': ' + q.text : 'Drawing question')) + '</h2>' + (figs.join('') || '<p>No drawings.</p>'));
  }
  made.forEach(u => URL.revokeObjectURL(u));
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sidekick Live drawings</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#1E2B4A}figure{display:inline-block;margin:8px;width:300px;vertical-align:top}img{width:100%;border:1px solid #ccd}figcaption{font-weight:600}</style></head><body><h1>Sidekick Live drawings</h1><p>' +
    escapeHTML(r.lesson + ' · ' + new Date(r.started).toLocaleString()) + ' · saved on this computer only</p>' + parts.join('') + '</body></html>';
  download('sidekick-live-drawings-' + dateStamp() + '.html', html, 'text/html;charset=utf-8');
}
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

/* =====================================================================
   17. DOT MAP ("tap the picture")
   Each student places one dot (tap again to move it). Dots never carry names on any shared screen.
   Areas (zones) are boxes on the picture: { x, y, w, h, l: label, correct } in 0–10000 units.
   ===================================================================== */
const ZONE_PRESETS = {
  none: { label: 'No areas', make: () => [] },
  cols2: { label: '2 columns (left / right)', make: () => cols(2) },
  cols3: { label: '3 columns', make: () => cols(3) },
  cols4: { label: '4 columns', make: () => cols(4) },
  rows2: { label: '2 rows (top / bottom)', make: () => [0, 1].map(i => ({ x: 0, y: i * 5000, w: 10000, h: 5000 })) },
  quad: { label: '4 quadrants', make: () => [[0, 0], [5000, 0], [0, 5000], [5000, 5000]].map(([x, y]) => ({ x, y, w: 5000, h: 5000 })) },
  own: { label: 'Draw my own boxes', make: () => [] }
};
function cols(n) { const w = Math.floor(10000 / n); return Array.from({ length: n }, (_, i) => ({ x: i * w, y: 0, w: i === n - 1 ? 10000 - i * w : w, h: 10000 })); }
function zoneHit(z, x, y) { return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h; }
function dotCounts(zones, pts) { return { total: pts.length, per: zones.map(z => pts.filter(p => zoneHit(z, p[0], p[1])).length) }; }
function pctText(n, total) { return total ? Math.round(100 * n / total) + '%' : '0%'; }

/* Draw areas + dots onto a canvas. o = { zones, counts, pts, mine, reveal } */
function paintDotMap(c, o) {
  if (!c || !c.isConnected) return;
  const [W, Hh] = fitCanvas(c), x = c.getContext('2d');
  x.clearRect(0, 0, W, Hh);
  const sx = v => v / 10000 * W, sy = v => v / 10000 * Hh, fs = Math.max(13, Math.round(W / 42));
  (o.zones || []).forEach((z, i) => {
    x.save();
    if (o.reveal && z.c) { x.fillStyle = 'rgba(19,124,114,.18)'; x.fillRect(sx(z.x), sy(z.y), sx(z.w), sy(z.h)); }
    x.setLineDash([8, 6]); x.lineWidth = Math.max(2, W / 400); x.strokeStyle = o.reveal && z.c ? '#137C72' : 'rgba(30,43,74,.55)';
    x.strokeRect(sx(z.x) + 2, sy(z.y) + 2, sx(z.w) - 4, sy(z.h) - 4);
    const label = (z.l || '') + (o.counts ? '  ' + pctText(o.counts.per[i], o.counts.total) : '') + (o.reveal && z.c ? '  ✓' : '');
    if (label.trim()) {
      x.font = '700 ' + fs + 'px Lexend, system-ui, sans-serif';
      const tw = x.measureText(label).width;
      x.fillStyle = 'rgba(255,255,255,.88)'; x.fillRect(sx(z.x) + 6, sy(z.y) + 6, tw + 14, fs + 12);
      x.fillStyle = '#1E2B4A'; x.fillText(label, sx(z.x) + 13, sy(z.y) + fs + 9);
    }
    x.restore();
  });
  const r = Math.max(5, W * 0.011);
  for (const p of o.pts || []) {
    x.beginPath(); x.arc(sx(p[0]), sy(p[1]), r, 0, Math.PI * 2);
    x.fillStyle = 'rgba(31,111,209,.55)'; x.fill(); x.lineWidth = 1.5; x.strokeStyle = '#fff'; x.stroke();
  }
  if (o.mine) {
    x.beginPath(); x.arc(sx(o.mine[0]), sy(o.mine[1]), r * 1.6, 0, Math.PI * 2);
    x.fillStyle = '#FFC53D'; x.fill(); x.lineWidth = 3; x.strokeStyle = '#1E2B4A'; x.stroke();
  }
}

/* ---------- student ---------- */
function buildDotMap(v) {
  const locked = v.phase !== 'open';
  const card = el('div', { class: 'q-card draw-card' }, el('div', { class: 'q-text', text: v.prompt || 'Tap the picture.' }));
  if (prefs.read) card.append(readBtn(() => v.read || v.prompt || 'Tap the picture.'));
  if (!(v.qid in S.dotMine)) S.dotMine[v.qid] = v.mine || null;
  const frame = el('div', { class: 'draw-frame' }); frame.style.aspectRatio = String(v.aspect || 4 / 3); frame.style.setProperty('--ar', String(v.aspect || 4 / 3));
  if (v.bg) { const u = mediaUrl(v.bg); frame.append(u ? el('img', { src: u, alt: '' }) : el('div', { class: 'slide-loading' }, 'Loading picture…')); }
  const c = el('canvas', { class: 'ink-layer draw-layer dot-layer' + (locked ? '' : ' active'), 'aria-label': 'Tap to place your dot' });
  frame.append(c);
  const note = el('span', { class: 'sent-note', id: 'q-sent', 'aria-live': 'polite' });
  const paint = () => {
    const sh = S.view && S.view.qid === v.qid ? S.view.share : v.share;
    paintDotMap(c, { zones: v.zones, counts: sh && sh.counts, pts: sh ? sh.pts : [], mine: S.dotMine[v.qid], reveal: !!v.reveal });
  };
  c._redraw = paint; S.dotPaint = paint;
  requestAnimationFrame(paint);
  const place = (x, y) => {
    if (locked) return;
    S.dotMine[v.qid] = [x, y]; paint();
    const msg = { t: 'ans', qid: v.qid, a: { x, y } };
    S.pendingAns = msg; S.ackQid = null;
    note.textContent = sendHost(msg) ? 'Sending…' : 'Not connected — it will send when you’re back.';
  };
  if (!locked) c.addEventListener('pointerdown', e => { e.preventDefault(); const [x, y] = canvasPos(c, e); place(x, y); });
  card.append(frame);
  if (!locked && v.zones && v.zones.length && v.zones.some(z => z.l)) {
    card.append(el('div', { class: 'zone-btns' }, el('span', { class: 'muted' }, 'Or choose: '),
      v.zones.filter(z => z.l).map(z => el('button', { class: 'chip', type: 'button', onclick: () => place(Math.round(z.x + z.w / 2), Math.round(z.y + z.h / 2)) }, z.l))));
  }
  if (v.reveal) {
    card.append(el('div', { class: 'result-mine' }, v.reveal.correct == null ? 'You didn’t place a dot.' : v.reveal.correct ? '✓ Your dot is in the right spot!' : 'Not quite. The green box shows the right spot.'));
  }
  if (!locked) { card.append(el('div', { class: 'q-actions' }, note)); note.textContent = S.dotMine[v.qid] ? 'Your dot is in ✓ Tap somewhere else to move it.' : 'Tap to place your dot.'; }
  else card.append(el('p', { class: 'muted' }, 'Dots are closed.'));
  card.append(el('p', { class: 'muted' }, v.share ? 'This is the class dot map. No names are shown. Your dot is yellow.' : 'Only your teacher sees where you tapped.'));
  return card;
}
function onDotShare(m) {
  if (!S.view || S.view.k !== 'dots' || S.view.qid !== m.qid) return;
  const wasShared = !!S.view.share;
  S.view.share = m.share;
  if (wasShared !== !!m.share) renderStudent(); else if (S.dotPaint) S.dotPaint();
}

/* ---------- teacher ---------- */
function dotState(it) { return (H.dotState[it.id] ||= { share: false, pct: false, reveal: false, showZones: it.showZones !== false }); }
function dotPts(it) { return Object.entries(H.report.answers[it.id] || {}).filter(([sid]) => !isDemoId(sid)).map(([, r]) => [r.raw.x, r.raw.y]); }
function dotShareData(it) {
  const ds = dotState(it), pts = dotPts(it);
  return { pts, counts: ds.pct ? dotCounts(it.zones || [], pts) : null };
}
function dotZonesFor(it) {
  const ds = dotState(it);
  if (!(ds.showZones || ds.reveal || (ds.share && ds.pct))) return [];
  return (it.zones || []).map(z => ({ x: z.x, y: z.y, w: z.w, h: z.h, l: z.l || '', c: ds.reveal ? !!z.correct : false }));
}
function dotAspect(it) { return it.bgW && it.bgH ? it.bgW / it.bgH : 4 / 3; }
function dotsViewMsg(base, it, st) {
  const ds = dotState(it), rec = (H.report.answers[it.id] || {})[st.id], hasCorrect = (it.zones || []).some(z => z.correct);
  return { ...base, k: 'dots', qid: it.id, prompt: it.prompt || '', read: it.read || '', bg: mediaIdFor(it), aspect: dotAspect(it),
    phase: H.phase[it.id] || 'open', mine: rec ? [rec.raw.x, rec.raw.y] : null, zones: dotZonesFor(it),
    share: ds.share ? dotShareData(it) : null, reveal: ds.reveal && hasCorrect ? { correct: rec ? !!rec.correct : null } : null };
}
function dotAnswer(it, a) {
  if (!a || typeof a !== 'object') return null;
  const x = Math.round(Number(a.x)), y = Math.round(Number(a.y));
  if (!(x >= 0 && x <= 10000 && y >= 0 && y <= 10000)) return null;
  const zones = it.zones || [], hit = zones.filter(z => zoneHit(z, x, y)), graded = zones.some(z => z.correct);
  const where = hit.length ? hit.map(z => z.l || 'Area ' + (zones.indexOf(z) + 1)).join(', ') : 'outside the areas';
  return { raw: { x, y }, a: where + ' (' + Math.round(x / 100) + '% across, ' + Math.round(y / 100) + '% down)', correct: graded ? hit.some(z => z.correct) : null, t: Date.now() };
}
function renderDotStage(stage, it) {
  const ds = dotState(it), ph = H.phase[it.id] || 'open', hasCorrect = (it.zones || []).some(z => z.correct), hasZones = (it.zones || []).length > 0;
  stage.append(el('div', { class: 'q-card' }, el('div', { class: 'tag', text: 'Dot map' }), el('div', { class: 'q-text', text: it.prompt || 'Tap the picture.' })));
  const tog = (label, key, after) => {
    const i = el('input', { type: 'checkbox' }); i.checked = ds[key];
    i.addEventListener('change', () => { ds[key] = i.checked; if (after) after(); broadcastView(); renderHostStage(); saveHostSnap(); });
    return el('label', { class: 'check small' }, i, label);
  };
  stage.append(el('div', { class: 'host-q-meta' },
    el('span', { class: 'count-pill', id: 'h-answered' }, ''),
    ph === 'open' ? el('button', { class: 'btn btn-primary', onclick: () => setPhase('closed') }, 'Stop dots')
                  : el('button', { class: 'btn', onclick: () => setPhase('open') }, 'Reopen dots')));
  stage.append(el('div', { class: 'host-q-meta dot-toggles' },
    hasZones ? tog('Show percentages', 'pct') : null,
    tog('📣 Share the dot map with the class (no names)', 'share'),
    hasZones ? tog('Show the areas to students', 'showZones') : null,
    hasCorrect ? tog('✓ Reveal the right area', 'reveal') : null));
  const frame = el('div', { class: 'draw-frame host-dot-frame' }); frame.style.aspectRatio = String(dotAspect(it)); frame.style.setProperty('--ar', String(dotAspect(it)));
  const mid = mediaIdFor(it); if (mid) frame.append(el('img', { src: H.urls.get(mid), alt: '' }));
  const c = el('canvas', { class: 'ink-layer draw-layer' }); frame.append(c);
  stage.append(frame);
  if (!hasZones) stage.append(el('p', { class: 'muted' }, 'Tip: add areas to this dot map in the lesson builder to get percentages.'));
  H.dotPaint = () => {
    const pts = dotPts(it);
    paintDotMap(c, { zones: (it.zones || []).map(z => ({ ...z, c: !!z.correct })), counts: ds.pct ? dotCounts(it.zones || [], pts) : null, pts, reveal: ds.reveal });
  };
  c._redraw = H.dotPaint;
  requestAnimationFrame(H.dotPaint);
}
function dotsTick(now) {
  if (!H.dotsDirty || now - H.lastDots < 1000) return;
  H.lastDots = now; H.dotsDirty = false;
  const it = currentItem(); if (!it || it.kind !== 'dots') return;
  if (H.dotPaint) H.dotPaint();
  if (dotState(it).share) broadcast({ t: 'dm', qid: it.id, share: dotShareData(it) });
}

/* ---------- lesson builder: dot map setup + areas editor ---------- */
function addDotsModal(fromSlide) {
  const slides = B.lesson.items.filter(x => x.kind === 'slide');
  openModal((card, close) => {
    const prompt = el('input', { maxlength: 200 }); prompt.value = fromSlide ? 'Tap the slide.' : 'Tap where you think the answer is.';
    let bg = fromSlide ? fromSlide.blob : null, bgW = fromSlide ? fromSlide.w : 0, bgH = fromSlide ? fromSlide.h : 0, mode = fromSlide ? 'slide' : 'blank';
    const choose = el('div'), opts = el('div', { class: 'spin-opts' });
    const radio = (v, label) => { const r = el('input', { type: 'radio', name: 'dot-bg', value: v }); if (v === mode) r.checked = true; r.addEventListener('change', () => { mode = v; paint(); }); return el('label', { class: 'check small' }, r, label); };
    if (!fromSlide) opts.append(radio('blank', 'Blank (good for Agree / Disagree)'), slides.length ? radio('slide', 'One of my slides') : null, radio('image', 'A picture from my computer'));
    const paint = () => {
      choose.replaceChildren();
      if (fromSlide) return;
      if (mode === 'slide') {
        const sel = el('select', { 'aria-label': 'Which slide' }, slides.map((s, k) => el('option', { value: String(k) }, 'Slide ' + (B.lesson.items.indexOf(s) + 1))));
        const set = () => { const s = slides[+sel.value]; bg = s.blob; bgW = s.w; bgH = s.h; }; sel.addEventListener('change', set); set(); choose.append(sel);
      } else if (mode === 'image') {
        bg = null; choose.append(fileButton('Choose picture', 'image/*', async f => { try { const bmp = await createImageBitmap(f); const r = await toSlideBlob(bmp, bmp.width, bmp.height); bg = r.blob; bgW = r.w; bgH = r.h; toast('Picture ready.'); } catch { toast('Could not read that picture.'); } }));
      } else bg = null;
    };
    paint();
    const preset = el('select', { 'aria-label': 'Areas' }, Object.entries(ZONE_PRESETS).map(([k, p]) => el('option', { value: k }, p.label)));
    preset.value = fromSlide ? 'none' : 'cols2';
    const labels = el('input', { maxlength: 200, placeholder: 'Agree, Disagree' }); labels.value = fromSlide ? '' : 'Agree, Disagree';
    card.append(el('h2', null, 'Add a dot map'), el('label', null, 'What should students tap?'), prompt,
      fromSlide ? el('p', { class: 'muted' }, 'Background: this slide') : el('label', null, 'Background'), opts, choose,
      el('label', null, 'Areas (for percentages)'), preset,
      el('label', null, 'Area names, in order, separated by commas (optional)'), labels,
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => {
          if (mode !== 'blank' && !bg) { toast('Choose a picture first.'); return; }
          const names = labels.value.split(',').map(s => cleanText(s, 30).trim());
          const zones = ZONE_PRESETS[preset.value].make().map((z, i) => ({ ...z, l: names[i] || '', correct: false }));
          const it = { id: uid(), kind: 'dots', prompt: cleanText(prompt.value, 200).trim() || 'Tap the picture.', bg: mode === 'blank' ? null : bg, bgW: mode === 'blank' ? 0 : bgW, bgH: mode === 'blank' ? 0 : bgH, zones, showZones: true, read: '', notes: '' };
          const at = fromSlide ? B.lesson.items.indexOf(fromSlide) + 1 : B.lesson.items.length;
          B.lesson.items.splice(at, 0, it); saveLessonSoon(); renderBuilder(); close();
          if (preset.value === 'own') editZones(it); else toast(fromSlide ? 'Dot map added after this slide.' : 'Dot map added at the end. Use ▲ to move it.');
        } }, 'Add'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}
function editZones(it) {
  const zones = (it.zones || []).map(z => ({ ...z }));
  openModal((card, close) => {
    const frame = el('div', { class: 'draw-frame zone-editor' }); const ar = it.bgW && it.bgH ? it.bgW / it.bgH : 16 / 9;
    frame.style.aspectRatio = String(ar); frame.style.setProperty('--ar', String(ar));
    let url = null; if (it.bg) { url = URL.createObjectURL(it.bg); frame.append(el('img', { src: url, alt: '' })); }
    const c = el('canvas', { class: 'ink-layer active' }); frame.append(c);
    const list = el('div', { class: 'zone-list' });
    let drag = null;
    const paint = (extra) => paintDotMap(c, { zones: zones.map(z => ({ ...z, c: z.correct })).concat(extra ? [extra] : []), reveal: true, pts: [] });
    const draw = () => {
      list.replaceChildren();
      if (!zones.length) list.append(el('p', { class: 'muted' }, 'Drag on the picture to draw a box. Draw up to 8.'));
      zones.forEach((z, i) => {
        const name = el('input', { maxlength: 30, placeholder: 'Area ' + (i + 1), 'aria-label': 'Area name' }); name.value = z.l || '';
        name.addEventListener('input', () => { z.l = name.value; paint(); });
        const ok = el('input', { type: 'checkbox' }); ok.checked = !!z.correct; ok.addEventListener('change', () => { z.correct = ok.checked; paint(); });
        list.append(el('div', { class: 'zone-row' }, el('strong', null, (i + 1) + '.'), name, el('label', { class: 'check small' }, ok, 'Right answer'),
          el('button', { class: 'btn btn-small btn-danger', 'aria-label': 'Delete area', onclick: () => { zones.splice(i, 1); draw(); } }, '✕')));
      });
      requestAnimationFrame(() => paint());
    };
    c.addEventListener('pointerdown', e => { if (zones.length >= 8) { toast('8 areas is the most.'); return; } e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ } const [x, y] = canvasPos(c, e); drag = { x0: x, y0: y }; });
    c.addEventListener('pointermove', e => { if (!drag) return; const [x, y] = canvasPos(c, e); drag.z = { x: Math.min(x, drag.x0), y: Math.min(y, drag.y0), w: Math.abs(x - drag.x0), h: Math.abs(y - drag.y0), l: '' }; paint(drag.z); });
    c.addEventListener('pointerup', () => { if (drag && drag.z && drag.z.w > 300 && drag.z.h > 300) zones.push({ ...drag.z, l: '', correct: false }); drag = null; draw(); });
    card.classList.add('wide');
    card.append(el('h2', null, 'Areas for this dot map'), el('p', { class: 'muted' }, 'Drag to draw boxes. Name them for percentages. Tick “Right answer” to let students check their dot when you reveal it.'),
      frame, list,
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => { it.zones = zones; if (zones.some(z => z.correct)) { it.showZones = false; toast('Areas are hidden from students so the answer stays secret. Reveal it during class.'); } saveLessonSoon(); renderBuilder(); if (url) URL.revokeObjectURL(url); card.classList.remove('wide'); close(); } }, 'Save areas'),
        el('button', { class: 'btn', onclick: () => { zones.length = 0; draw(); } }, 'Remove all'),
        el('button', { class: 'btn btn-ghost', onclick: () => { if (url) URL.revokeObjectURL(url); card.classList.remove('wide'); close(); } }, 'Cancel')));
    draw();
  });
}

/* =====================================================================
   18. MANIPULATIVES: drag and drop, with "tap a card, then tap where it goes"
   Works with mouse, touch and keyboard (Tab to a card, Enter, Tab to a spot, Enter).
   ===================================================================== */
function dragKit(root, onDrop) {
  root.addEventListener('pointerdown', e => {
    const card = e.target.closest('[data-drag]');
    if (!card || !root.contains(card) || card.disabled || (e.button && e.button !== 0)) return;
    const id = e.pointerId, sx = e.clientX, sy = e.clientY;
    let ghost = null, over = null;
    const move = ev => {
      if (ev.pointerId !== id) return;
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        const r = card.getBoundingClientRect();
        ghost = card.cloneNode(true); ghost.classList.add('drag-ghost'); ghost.style.width = r.width + 'px';
        document.body.append(ghost); card.classList.add('dragging'); root.classList.add('is-dragging');
      }
      ev.preventDefault();
      ghost.style.left = (ev.clientX - ghost.offsetWidth / 2) + 'px'; ghost.style.top = (ev.clientY - ghost.offsetHeight / 2) + 'px';
      const t = document.elementFromPoint(ev.clientX, ev.clientY), d = t && t.closest('[data-drop]');
      const tgt = d && root.contains(d) ? d : null;
      if (tgt !== over) { if (over) over.classList.remove('drop-hover'); over = tgt; if (over) over.classList.add('drop-hover'); }
    };
    const up = ev => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!ghost) return;
      ghost.remove(); card.classList.remove('dragging'); root.classList.remove('is-dragging');
      if (over) over.classList.remove('drop-hover');
      card._dragged = true; setTimeout(() => { card._dragged = false; }, 60);
      if (over && ev.type === 'pointerup') onDrop(card, over, ev);
    };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}
function cardBtn(label, key, selected, locked, onTap, extraClass) {
  return el('button', { class: 'card' + (selected ? ' selected' : '') + (extraClass ? ' ' + extraClass : ''), type: 'button', 'data-drag': key, disabled: locked,
    'aria-pressed': String(!!selected), onclick: e => { e.stopPropagation(); if (e.currentTarget._dragged) return; onTap(); } }, label);
}
function tip(locked, text) { return locked ? null : el('p', { class: 'manip-tip' }, text); }

/* ---- Sort: cards into group boxes ---- */
function sortUI(q, mine, locked) {
  const place = q.items.map(it => (mine && q.groups.includes(mine[it])) ? mine[it] : null);
  let sel = null;
  const wrap = el('div', { class: 'manip' });
  const draw = () => {
    wrap.replaceChildren();
    // tapping a card that sits somewhere else while one is chosen = put the chosen card there
    const card = i => cardBtn(q.items[i], String(i), sel === i, locked, () => {
      if (sel !== null && sel !== i && place[sel] !== place[i]) { place[sel] = place[i]; sel = null; } else sel = sel === i ? null : i;
      draw();
    });
    const tray = el('div', { class: 'tray' + (sel !== null && place[sel] ? ' ready' : ''), 'data-drop': 'tray', 'aria-label': 'Cards to sort' });
    tray.addEventListener('click', () => { if (sel !== null) { place[sel] = null; sel = null; draw(); } });
    const left = q.items.map((_, i) => i).filter(i => !place[i]);
    left.forEach(i => tray.append(card(i)));
    if (!left.length) tray.append(el('span', { class: 'muted' }, locked ? '' : 'All sorted! ✓'));
    const bins = el('div', { class: 'bins' });
    q.groups.forEach(g => {
      const bin = el('div', { class: 'bin' + (sel !== null ? ' ready' : ''), 'data-drop': 'g:' + g },
        el('button', { class: 'bin-title', type: 'button', disabled: locked, onclick: e => { e.stopPropagation(); if (sel !== null) { place[sel] = g; sel = null; draw(); } } }, g));
      bin.addEventListener('click', () => { if (sel !== null) { place[sel] = g; sel = null; draw(); } });
      q.items.forEach((_, i) => { if (place[i] === g) bin.append(card(i)); });
      bins.append(bin);
    });
    wrap.append(tip(locked, sel !== null ? 'Now tap the group where “' + q.items[sel] + '” belongs.' : 'Drag each card into a group — or tap a card, then tap a group.'), tray, bins);
  };
  if (!locked) dragKit(wrap, (c, t) => { const i = +c.dataset.drag; place[i] = t.dataset.drop === 'tray' ? null : t.dataset.drop.slice(2); sel = null; draw(); });
  draw();
  return { node: wrap, get: () => { const o = {}; q.items.forEach((it, i) => { o[it] = place[i]; }); return o; }, done: () => place.every(Boolean) };
}

/* ---- Match: drag answer cards next to each left side ---- */
function matchUI(q, mine, locked) {
  const rights = q.rights, slot = q.lefts.map(() => null), used = new Set();
  if (mine) q.lefts.forEach((l, i) => { const k = rights.findIndex((r, j) => r === mine[l] && !used.has(j)); if (k >= 0) { slot[i] = k; used.add(k); } });
  let sel = null;
  const wrap = el('div', { class: 'manip' });
  const put = (card, i) => { const from = slot.indexOf(card); const prev = slot[i]; if (from >= 0) slot[from] = prev; slot[i] = card; };
  const draw = () => {
    wrap.replaceChildren();
    const card = k => cardBtn(rights[k], String(k), sel === k, locked, () => {
      const at = x => slot.indexOf(x);
      if (sel !== null && sel !== k && at(sel) !== at(k)) { if (at(k) >= 0) put(sel, at(k)); else slot[at(sel)] = null; sel = null; } else sel = sel === k ? null : k;
      draw();
    });
    const tray = el('div', { class: 'tray', 'data-drop': 'tray', 'aria-label': 'Answer cards' });
    tray.addEventListener('click', () => { if (sel !== null) { const f = slot.indexOf(sel); if (f >= 0) slot[f] = null; sel = null; draw(); } });
    const free = rights.map((_, k) => k).filter(k => !slot.includes(k));
    free.forEach(k => tray.append(card(k)));
    if (!free.length) tray.append(el('span', { class: 'muted' }, locked ? '' : 'All matched! ✓'));
    const rows = el('div', { class: 'match-rows' });
    q.lefts.forEach((l, i) => {
      const drop = el('div', { class: 'slot' + (sel !== null ? ' ready' : ''), 'data-drop': 's:' + i, role: 'button', tabindex: locked ? null : '0', 'aria-label': 'Match for ' + l });
      const tapSlot = () => { if (locked) return; if (sel !== null) { put(sel, i); sel = null; } else if (slot[i] !== null) slot[i] = null; draw(); };
      drop.addEventListener('click', tapSlot); drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tapSlot(); } });
      if (slot[i] !== null) drop.append(card(slot[i])); else drop.append(el('span', { class: 'slot-hint' }, locked ? '—' : 'drop here'));
      rows.append(el('div', { class: 'match-row' }, el('span', { class: 'left' }, l), el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'), drop));
    });
    wrap.append(tip(locked, sel !== null ? 'Now tap the spot where “' + rights[sel] + '” goes.' : 'Drag each answer next to its match — or tap an answer, then tap a spot.'), rows, tray);
  };
  if (!locked) dragKit(wrap, (c, t) => { const k = +c.dataset.drag; if (t.dataset.drop === 'tray') { const f = slot.indexOf(k); if (f >= 0) slot[f] = null; } else put(k, +t.dataset.drop.slice(2)); sel = null; draw(); });
  draw();
  return { node: wrap, get: () => { const o = {}; q.lefts.forEach((l, i) => { o[l] = slot[i] !== null ? rights[slot[i]] : ''; }); return o; }, done: () => slot.every(s => s !== null) };
}

/* ---- Put in order: drag cards up and down (arrow buttons too) ---- */
function orderUI(q, mine, locked) {
  let order = Array.isArray(mine) && mine.length === q.items.length && mine.every(m => q.items.includes(m)) ? mine.slice() : q.items.slice();
  let sel = null;
  const wrap = el('div', { class: 'manip' });
  const moveTo = (from, to) => { const [x] = order.splice(from, 1); order.splice(to, 0, x); };
  const draw = (focusKey) => {
    wrap.replaceChildren();
    const list = el('ol', { class: 'order-list' });
    order.forEach((it, i) => {
      const li = el('li', { 'data-drop': 'o:' + i, class: sel !== null && sel !== i ? 'ready' : '' },
        el('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)),
        cardBtn(it, String(i), sel === i, locked, () => { if (sel === null) sel = i; else { if (sel !== i) moveTo(sel, i); sel = null; } draw(); }, 'grow'),
        el('button', { class: 'btn', type: 'button', 'aria-label': 'Move ' + it + ' up', disabled: locked || i === 0, onclick: () => { moveTo(i, i - 1); sel = null; draw('u' + (i - 1)); } }, '▲'),
        el('button', { class: 'btn', type: 'button', 'aria-label': 'Move ' + it + ' down', disabled: locked || i === order.length - 1, onclick: () => { moveTo(i, i + 1); sel = null; draw('d' + (i + 1)); } }, '▼'));
      li.addEventListener('click', () => { if (sel !== null && sel !== i) { moveTo(sel, i); sel = null; draw(); } });
      list.append(li);
    });
    wrap.append(tip(locked, sel !== null ? 'Now tap the spot where “' + order[sel] + '” should go.' : 'Drag the cards into order — or tap a card, then tap its new spot. ▲ ▼ work too.'), list);
    if (focusKey) { const i = +focusKey.slice(1), li = list.children[i]; const b = li && li.querySelectorAll('button')[focusKey[0] === 'u' ? 1 : 2]; if (b && !b.disabled) b.focus(); else if (li) li.querySelector('button:not(:disabled)')?.focus(); }
  };
  if (!locked) dragKit(wrap, (c, t, ev) => {
    const from = +c.dataset.drag; let to = +t.dataset.drop.slice(2);
    const r = t.getBoundingClientRect(); if (ev.clientY > r.top + r.height / 2 && to < from) to++; else if (ev.clientY < r.top + r.height / 2 && to > from) to--;
    if (to !== from) moveTo(from, to); sel = null; draw();
  });
  draw();
  return { node: wrap, get: () => order.slice(), done: () => true };
}

/* ---- Word bank: drag words into blanks (or tap a word, then a blank) ---- */
function bankUI(q, mine, locked) {
  const n = q.parts.length - 1, fill = new Array(n).fill(null);   // fill[i] = bank index
  if (Array.isArray(mine)) mine.forEach((w, i) => { const k = q.bank.findIndex((b, j) => b === w && !fill.includes(j)); if (k >= 0 && i < n) fill[i] = k; });
  let sel = null;
  const wrap = el('div', { class: 'manip' });
  const put = (k, i) => { const from = fill.indexOf(k); const prev = fill[i]; if (from >= 0) fill[from] = prev; fill[i] = k; };
  const draw = () => {
    wrap.replaceChildren();
    const sentence = el('div', { class: 'wb-sentence' });
    q.parts.forEach((p, i) => {
      sentence.append(p);
      if (i >= n) return;
      const k = fill[i];
      const blank = el('button', { class: 'blank' + (sel !== null ? ' ready' : '') + (k !== null ? ' filled' : ''), type: 'button', 'data-drop': 'b:' + i, disabled: locked,
        'aria-label': k !== null ? 'Blank ' + (i + 1) + ': ' + q.bank[k] + '. Tap to take it out.' : 'Blank ' + (i + 1) + ', empty',
        onclick: e => { if (e.currentTarget._dragged) return; if (sel !== null) { put(sel, i); sel = null; } else if (k !== null) fill[i] = null; draw(); } }, k !== null ? q.bank[k] : '\u00a0');
      if (k !== null && !locked) blank.setAttribute('data-drag', String(k));
      sentence.append(blank);
    });
    const bank = el('div', { class: 'tray bank', 'data-drop': 'tray', 'aria-label': 'Word bank' });
    bank.addEventListener('click', () => { if (sel !== null) { const f = fill.indexOf(sel); if (f >= 0) fill[f] = null; sel = null; draw(); } });
    q.bank.forEach((w, k) => { if (!fill.includes(k)) bank.append(cardBtn(w, String(k), sel === k, locked, () => { sel = sel === k ? null : k; draw(); })); });
    wrap.append(tip(locked, sel !== null ? 'Now tap the blank where “' + q.bank[sel] + '” goes.' : 'Drag words into the blanks — or tap a word, then tap a blank.'), sentence, bank);
  };
  if (!locked) dragKit(wrap, (c, t) => { const k = +c.dataset.drag; if (t.dataset.drop === 'tray') { const f = fill.indexOf(k); if (f >= 0) fill[f] = null; } else put(k, +t.dataset.drop.slice(2)); sel = null; draw(); });
  draw();
  return { node: wrap, get: () => fill.map(k => k !== null ? q.bank[k] : null), done: () => fill.every(k => k !== null) };
}

/* =====================================================================
   19. WORD BUILDER (live word chains with sound boxes)
   Teacher sends a word; it is split into sounds (graphemes). Students build it from reusable tiles.
   Chain mode keeps each student's board so they change only the sound that's different.
   ===================================================================== */
const WB_GROUPS = [
  { id: 'letters', name: 'Letters', cls: 'g-letters', tiles: 'a b c d e f g h i j k l m n o p q r s t u v w x y z'.split(' ') },
  { id: 'digraphs', name: 'Consonant digraphs', cls: 'g-dig', tiles: ['ch', 'sh', 'th', 'wh', 'ph'] },
  { id: 'other', name: 'Other', cls: 'g-other', tiles: ['ck', 'ng', 'nk', 'ed', 'ing'] },
  { id: 'rcontrol', name: 'R-controlled vowels', cls: 'g-r', tiles: ['ar', 'er', 'ir', 'or', 'ur'] },
  { id: 'teams', name: 'Vowel teams', cls: 'g-team', tiles: ['ai', 'ay', 'ea', 'ee', 'igh', 'oa', 'oo', 'ow', 'au', 'aw'] },
  { id: 'diph', name: 'Diphthongs', cls: 'g-diph', tiles: ['oi', 'oy', 'ou', 'ow'] }
];
const WB_PRESETS = {
  k: { label: 'Letters only (K)', groups: ['letters'] },
  g1: { label: 'Letters, digraphs & other (Gr 1)', groups: ['letters', 'digraphs', 'other'] },
  full: { label: 'Full board', groups: ['letters', 'digraphs', 'other', 'rcontrol', 'teams', 'diph'] },
  custom: { label: 'My custom board', groups: null }
};
const WB_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
function wbSettings() { return Object.assign({ preset: 'full', groups: ['letters', 'digraphs', 'other'], extra: '', chain: true, hear: true }, lsGet(KEYS.wbTiles, {})); }
function wbSaveSettings(cfg) { lsSet(KEYS.wbTiles, cfg); }
function wbBuildGroups(cfg) {
  const ids = cfg.preset === 'custom' ? (cfg.groups || []) : (WB_PRESETS[cfg.preset] || WB_PRESETS.full).groups;
  const out = WB_GROUPS.filter(g => ids.includes(g.id)).map(g => ({ name: g.name, cls: g.cls, tiles: g.tiles.slice() }));
  const extra = String(cfg.extra || '').split(/[,\s]+/).map(t => t.trim().toLowerCase().replace(/[^a-z'-]/g, '')).filter(Boolean).slice(0, 24);
  if (extra.length) out.push({ name: 'Extra tiles', cls: 'g-mine', tiles: [...new Set(extra)] });
  if (!out.length) out.push({ name: 'Letters', cls: 'g-letters', tiles: WB_GROUPS[0].tiles.slice() });
  return out;
}
function wbAllTiles(groups) { return [...new Set(groups.flatMap(g => g.tiles))]; }
function wbSplit(word, tiles) {
  const w = String(word).toLowerCase().trim();
  if (/[-.·\s]/.test(w)) return w.split(/[-.·\s]+/).filter(Boolean);
  // longest-match using the tiles on this board ("ed" is left out: red = r·e·d)
  const list = tiles.filter(t => t !== 'ed').sort((a, b) => b.length - a.length), out = [];
  let i = 0;
  while (i < w.length) { const t = list.find(x => w.startsWith(x, i)); if (t) { out.push(t); i += t.length; } else { out.push(w[i]); i++; } }
  return out;
}
function wbResize(arr, n) { const b = (arr || []).slice(0, n); while (b.length < n) b.push(''); return b; }
function wbIsCorrect(b, target) { return !!target && b.length === target.length && b.every((x, i) => x === target[i]); }

/* ---------- teacher ---------- */
function wbStart() {
  if ((H.boss && H.boss.active) || (H.race && H.race.active)) { toast('End the game first.'); return; }
  if (H.wb && H.wb.active) { renderHostStage(); return; }
  const cfg = wbSettings();
  H.wb = { active: true, round: 0, cid: 0, n: 3, target: null, word: '', chain: cfg.chain !== false, hear: cfg.hear !== false, phase: 'build', showAns: false,
    groups: wbBuildGroups(cfg), preset: cfg.preset, boards: {}, qids: {} };
  H.spotlight = null; broadcast({ t: 'spot', items: null });
  broadcastView(); renderHostStage(); saveHostSnap();
}
function wbEnd() {
  wbRecord(); H.wb.active = false; H.spotlight = null; broadcast({ t: 'spot', items: null });
  broadcastView(); renderHostStage(); renderHostSide(); saveHostSnap();
}
function wbView(base, st) {
  const wb = H.wb, b = wb.boards[st.id] || null;
  return { ...base, k: 'wb', r: wb.round, cid: wb.cid, n: wb.n, groups: wb.groups, phase: wb.phase, free: !wb.target,
    say: wb.hear && wb.target ? wb.word : null, mine: b,
    result: wb.phase === 'check' && wb.target ? { built: !!(b && b.some(Boolean)), correct: !!(b && wbIsCorrect(b, wb.target)) } : null,
    answer: wb.phase === 'check' && wb.showAns && wb.target ? wb.target : null };
}
function wbBoardMsg(st, m) {
  const wb = H.wb;
  if (!wb || !wb.active || wb.phase !== 'build' || m.r !== wb.round || m.cid !== wb.cid || !Array.isArray(m.b) || m.b.length !== wb.n) return;
  const ok = new Set(wbAllTiles(wb.groups));
  wb.boards[st.id] = m.b.map(x => (typeof x === 'string' && ok.has(x)) ? x : '');
  H.wbDirty = true;
}
function wbRecord() {
  const wb = H.wb; if (!wb || !wb.round) return;
  const filled = Object.entries(wb.boards).filter(([, b]) => b.some(Boolean));
  if (!filled.length && !wb.qids[wb.round]) return;
  let qid = wb.qids[wb.round];
  if (!qid) {
    qid = wb.qids[wb.round] = 'wb-' + uid(6);
    H.report.wbCount = (H.report.wbCount || 0) + 1;
    H.report.questions.push({ qid, n: 1000 + H.report.wbCount, label: 'W' + H.report.wbCount, type: 'wordbuild',
      text: wb.target ? 'Build: ' + wb.target.join('-') : 'Free build (' + wb.n + ' boxes)', graded: !!wb.target });
  }
  const ans = H.report.answers[qid] = {};
  filled.forEach(([sid, b]) => { ans[sid] = { raw: b.slice(), a: b.map(x => x || '_').join('-'), correct: wb.target ? wbIsCorrect(b, wb.target) : null, t: Date.now() }; });
  H.reportDirty = true;
}
function wbNewRound(target, n) {
  const wb = H.wb; wbRecord();
  wb.round++; wb.target = target; wb.word = target ? target.join('') : ''; wb.n = n; wb.phase = 'build'; wb.showAns = false;
  if (wb.chain) for (const id in wb.boards) wb.boards[id] = wbResize(wb.boards[id], n);
  else wb.boards = {};
  H.spotlight = null; broadcast({ t: 'spot', items: null });
  broadcastView(); renderHostStage(); saveHostSnap();
}
function wbSend(raw) {
  const word = cleanText(raw, 40).trim();
  if (!word) { toast('Type a word first.'); return; }
  const parts = wbSplit(word, wbAllTiles(H.wb.groups));
  if (parts.length > 8) { toast('8 sounds is the most.'); return; }
  wbNewRound(parts, parts.length);
}
function wbSetPhase(ph) { const wb = H.wb; wb.phase = ph; if (ph === 'check') wbRecord(); else wb.showAns = false; broadcastView(); renderHostStage(); saveHostSnap(); }
function wbClearBoards() { const wb = H.wb; wb.boards = {}; wb.cid++; wb.phase = 'build'; wb.showAns = false; broadcastView(); renderHostStage(); saveHostSnap(); toast('Boards cleared.'); }
function wbCustomize() {
  const cfg = wbSettings();
  openModal((card, close) => {
    const boxes = WB_GROUPS.map(g => { const i = el('input', { type: 'checkbox', value: g.id }); i.checked = (cfg.groups || []).includes(g.id); return el('label', { class: 'check small' }, i, g.name + ': ' + g.tiles.join(' ')); });
    const extra = el('input', { maxlength: 160, placeholder: 'tch, dge, kn, wr, le' }); extra.value = cfg.extra || '';
    card.append(el('h2', null, 'Customize the tile board'), el('p', { class: 'muted' }, 'Choose the groups your students have learned. Saved on this computer for next time.'),
      ...boxes, el('label', null, 'Extra tiles (separate with commas)'), extra,
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => {
          cfg.preset = 'custom'; cfg.groups = boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value); cfg.extra = extra.value;
          wbSaveSettings(cfg); H.wb.preset = 'custom'; H.wb.groups = wbBuildGroups(cfg); broadcastView(); renderHostStage(); saveHostSnap(); close();
        } }, 'Use this board'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}
function wbMini(b, cls) { return el('div', { class: 'wb-mini' + (cls ? ' ' + cls : '') }, (b || []).map(t => el('span', { class: 'wb-mini-box' }, t || '\u00a0'))); }
function renderWbStage(stage) {
  const wb = H.wb, cfg = wbSettings();
  const inp = el('input', { id: 'wb-word', maxlength: 40, placeholder: 'Next word, e.g. ship (or sh-i-p)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Next word' });
  const prev = el('span', { class: 'wb-preview', 'aria-live': 'polite' });
  const tiles = wbAllTiles(wb.groups);
  const showPrev = () => {
    const v = inp.value.trim(); if (!v) { prev.textContent = ''; return; }
    const parts = wbSplit(v, tiles), missing = parts.filter(p => !tiles.includes(p));
    prev.textContent = parts.join(' · ') + '  (' + parts.length + ' sound' + (parts.length === 1 ? '' : 's') + ')' + (missing.length ? '  ⚠ not on the board: ' + missing.join(', ') : '');
  };
  inp.addEventListener('input', showPrev);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); wbSend(inp.value); } });
  const tog = (label, key) => { const i = el('input', { type: 'checkbox' }); i.checked = wb[key]; i.addEventListener('change', () => { wb[key] = i.checked; const c = wbSettings(); c[key] = i.checked; wbSaveSettings(c); broadcastView(); saveHostSnap(); }); return el('label', { class: 'check small' }, i, label); };
  const preset = el('select', { 'aria-label': 'Tile board' }, Object.entries(WB_PRESETS).map(([k, p]) => el('option', { value: k }, p.label)));
  preset.value = wb.preset || 'full';
  preset.addEventListener('change', () => { const c = wbSettings(); c.preset = preset.value; wbSaveSettings(c); wb.preset = preset.value; wb.groups = wbBuildGroups(c); broadcastView(); renderHostStage(); saveHostSnap(); });
  const freeN = el('select', { 'aria-label': 'Boxes for free build' }, [2, 3, 4, 5, 6].map(n => el('option', { value: String(n) }, n + ' boxes')));
  freeN.value = String(Math.min(6, Math.max(2, wb.n)));
  const status = wb.round === 0 ? 'Type a word below and press Send.' : wb.target ? 'Word ' + wb.round + ': ' + wb.target.join(' · ') : 'Free build: ' + wb.n + ' boxes';
  stage.append(el('div', { class: 'q-card wb-host' },
    el('div', { class: 'tag', text: '🔤 Word builder' }), el('div', { class: 'q-text', text: status }),
    el('div', { class: 'row-inline' }, inp, el('button', { class: 'btn btn-primary', onclick: () => wbSend(inp.value) }, wb.round ? 'Send next word' : 'Send word')), prev,
    el('div', { class: 'row-inline wb-actions' },
      wb.round && wb.phase === 'build' ? el('button', { class: 'btn btn-sun', onclick: () => wbSetPhase('check') }, '✓ Check') : null,
      wb.phase === 'check' ? el('button', { class: 'btn', onclick: () => wbSetPhase('build') }, 'Back to building') : null,
      wb.phase === 'check' && wb.target ? el('button', { class: 'btn', 'aria-pressed': String(wb.showAns), onclick: () => { wb.showAns = !wb.showAns; broadcastView(); renderHostStage(); } }, wb.showAns ? 'Hide answer' : 'Show answer') : null,
      el('button', { class: 'btn', onclick: wbClearBoards }, 'Clear boards'),
      el('span', { class: 'row-inline' }, freeN, el('button', { class: 'btn', onclick: () => wbNewRound(null, +freeN.value) }, 'Free build')),
      H.spotlight ? el('button', { class: 'btn', onclick: () => { H.spotlight = null; broadcast({ t: 'spot', items: null }); renderHostStage(); } }, 'Hide spotlight') : null,
      el('button', { class: 'btn btn-ghost', onclick: wbEnd }, 'End word builder')),
    el('div', { class: 'row-inline wb-opts' }, tog('Word chain: keep boards for the next word', 'chain'), tog('Students can tap 🔊 to hear the word', 'hear'),
      el('span', { class: 'row-inline' }, el('span', { class: 'muted' }, 'Tiles:'), preset, el('button', { class: 'btn btn-small', onclick: wbCustomize }, 'Customize…')))));
  stage.append(el('div', { class: 'wb-summary', id: 'wb-summary' }), el('div', { class: 'wb-gallery', id: 'wb-gallery' }));
  renderWbGallery();
  setTimeout(() => { if (document.activeElement === document.body) inp.focus(); }, 0);
}
function renderWbGallery() {
  const g = $('#wb-gallery'), sum = $('#wb-summary'); if (!g || !H.wb) return;
  H.wbDirty = false;
  const wb = H.wb, on = [...H.students.values()].filter(s => s.online || wb.boards[s.id]).sort((a, b) => naturalSort(a.name, b.name));
  const right = on.filter(s => wb.boards[s.id] && wbIsCorrect(wb.boards[s.id], wb.target)).length;
  const started = on.filter(s => wb.boards[s.id] && wb.boards[s.id].some(Boolean)).length;
  sum.textContent = !wb.round ? '' : wb.target ? started + ' of ' + on.length + ' building  ·  ' + right + ' have it right (only you see this)' : started + ' of ' + on.length + ' building';
  g.replaceChildren();
  if (!wb.round) return;
  on.forEach(s => {
    const b = wb.boards[s.id] || wbResize([], wb.n);
    const ok = wb.target && b.some(Boolean) ? wbIsCorrect(b, wb.target) : null;
    g.append(el('button', { class: 'wb-card' + (ok === true ? ' is-right' : ok === false ? ' is-wrong' : ''), type: 'button', title: 'Spotlight this board',
      onclick: () => wbSpotlight(s, b) },
      el('span', { class: 'sname', text: s.name }), el('span', { class: 'wb-mark', 'aria-hidden': 'true' }, ok === true ? '✓' : ok === false ? '✗' : ''), wbMini(b)));
  });
}
function wbSpotlight(st, b) {
  openModal((card, close) => {
    card.append(el('h2', null, 'Spotlight this board?'), wbMini(b, 'big'),
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => { H.spotlight = [{ wb: b.slice(), by: st.name.replace(/\s\(\d+\)$/, '').split(' ')[0] }]; broadcast({ t: 'spot', items: H.spotlight }); renderHostStage(); close(); } }, 'Show with first name'),
        el('button', { class: 'btn', onclick: () => { H.spotlight = [{ wb: b.slice(), by: null }]; broadcast({ t: 'spot', items: H.spotlight }); renderHostStage(); close(); } }, 'Show anonymously'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}

/* ---------- student ---------- */
function buildWordBoard(v) {
  if (!S.wb || S.wb.r !== v.r || S.wb.cid !== v.cid) S.wb = { r: v.r, cid: v.cid, b: wbResize(v.mine, v.n) };
  else if (S.wb.b.length !== v.n) S.wb.b = wbResize(S.wb.b, v.n);
  const locked = v.phase !== 'build' || v.r === 0;
  const commit = () => { sendHost({ t: 'wbb', r: v.r, cid: v.cid, b: S.wb.b.slice() }); renderStudent(); };
  const card = el('div', { class: 'q-card wb-card-student' });
  card.append(el('div', { class: 'wb-head' },
    el('div', { class: 'q-text', text: v.r === 0 ? 'Word builder' : v.free ? 'Build a word' : 'Build the word' }),
    v.say ? el('button', { class: 'btn', type: 'button', onclick: () => speak(v.say) }, '🔊 Hear the word') : null,
    el('button', { class: 'btn', type: 'button', 'aria-label': 'Clear my boxes', disabled: locked, onclick: () => { S.wb.b = wbResize([], v.n); commit(); } }, '↺')));
  if (v.r === 0) { card.append(el('p', { class: 'muted' }, 'Get ready! Your teacher will say a word.')); return card; }
  const boxes = el('div', { class: 'wb-boxes', role: 'group', 'aria-label': 'Sound boxes' });
  S.wb.b.forEach((t, i) => boxes.append(el('button', { class: 'wb-box' + (t ? ' filled' : ''), type: 'button', 'data-drop': 'b:' + i, 'data-drag': t && !locked ? 'f:' + i : null, disabled: locked,
    'aria-label': t ? 'Box ' + (i + 1) + ': ' + t + '. Tap to clear.' : 'Box ' + (i + 1) + ', empty',
    onclick: e => { if (e.currentTarget._dragged || !t) return; S.wb.b[i] = ''; commit(); } }, t || '\u00a0')));
  card.append(boxes);
  if (v.result) card.append(el('div', { class: 'result-mine' }, v.result.correct ? '✓ You built it!' : v.result.built ? 'Not quite. Look at each sound again.' : 'You didn’t build this one.'));
  if (v.answer) card.append(el('div', { class: 'wb-answer' }, el('span', { class: 'muted' }, 'The word: '), wbMini(v.answer, 'big')));
  // tile board (tabs on small screens)
  const small = matchMedia('(max-width: 600px)').matches && v.groups.length > 1;
  if (S.wbTab == null || S.wbTab >= v.groups.length) S.wbTab = 0;
  const tray = el('div', { class: 'wb-tiles', 'data-drop': 'tray' });
  if (small) tray.append(el('div', { class: 'seg wb-tabs', role: 'tablist' }, v.groups.map((g, gi) => el('button', { class: 'chip', type: 'button', role: 'tab', 'aria-pressed': String(gi === S.wbTab), onclick: () => { S.wbTab = gi; renderStudent(); } }, g.name))));
  v.groups.forEach((g, gi) => {
    if (small && gi !== S.wbTab) return;
    tray.append(el('div', { class: 'wb-group ' + g.cls }, small ? null : el('span', { class: 'wb-glabel' }, g.name),
      el('div', { class: 'wb-row' }, g.tiles.map(t => el('button', { class: 'wb-tile' + (g.cls === 'g-letters' && WB_VOWELS.has(t) ? ' vowel' : ''), type: 'button', 'data-drag': 't:' + t, disabled: locked,
        onclick: e => { if (e.currentTarget._dragged) return; const i = S.wb.b.indexOf(''); if (i < 0) { toast('All the boxes are full. Tap a box to clear it.'); return; } S.wb.b[i] = t; commit(); } }, t)))));
  });
  card.append(tray);
  if (!locked) {
    card.append(el('p', { class: 'manip-tip' }, 'Tap a tile to fill the next box, or drag it into a box. Tap a box to clear it.'));
    dragKit(card, (c, target) => {
      const d = c.dataset.drag, to = target.dataset.drop;
      if (to === 'tray') { if (d.startsWith('f:')) S.wb.b[+d.slice(2)] = ''; }
      else { const i = +to.slice(2); if (d.startsWith('t:')) S.wb.b[i] = d.slice(2); else { const j = +d.slice(2); [S.wb.b[i], S.wb.b[j]] = [S.wb.b[j], S.wb.b[i]]; } }
      commit();
    });
  } else if (v.phase === 'check') card.append(el('p', { class: 'muted' }, 'Boxes are locked while your teacher checks.'));
  return card;
}

/* =====================================================================
   20. GAME TIME: launch a Sidekick-edition game (up to 8 players)
   The teacher hosts the game in a window inside Sidekick; the game sends its room code
   up to Sidekick, which brings the chosen students in automatically.
   ===================================================================== */
const GAME_MAX = 8;
const Games = {
  all() { const v = lsGet(KEYS.games, []); return Array.isArray(v) ? v.filter(g => g && g.url && g.name) : []; },
  save(v) { lsSet(KEYS.games, v); }
};
function gameUrlOk(u) { try { const x = new URL(u, location.href); return x.protocol === 'https:' || x.hostname === 'localhost' || x.hostname === '127.0.0.1'; } catch { return false; } }
function gameLink(url, params) { const x = new URL(url, location.href); for (const [k, v] of Object.entries(params)) x.searchParams.set(k, v); return x.href; }

/* ---------- teacher ---------- */
function openGameLauncher() {
  if (H.game) { showGameHost(true); return; }
  const online = onlineStudents().sort((a, b) => naturalSort(a.name, b.name));
  openModal((card, close) => {
    const games = Games.all();
    const pickGame = el('select', { 'aria-label': 'Game' }, games.map((g, i) => el('option', { value: String(i) }, g.name)));
    const addName = el('input', { maxlength: 40, placeholder: 'Escape the Island' }), addUrl = el('input', { maxlength: 300, placeholder: 'https://YOUR-NAME.github.io/escape-the-island-sidekick/' });
    const list = el('div', { class: 'spot-list game-players' }), count = el('p', { class: 'muted' });
    const boxes = online.map(st => { const cb = el('input', { type: 'checkbox', value: st.id }); cb.checked = online.length <= GAME_MAX; return el('label', { class: 'check' }, cb, el('span', { class: 'sname', text: st.name })); });
    const sync = () => {
      const n = boxes.filter(b => b.firstChild.checked).length;
      boxes.forEach(b => { b.firstChild.disabled = !b.firstChild.checked && n >= GAME_MAX; });
      count.textContent = n + ' of ' + GAME_MAX + ' players chosen' + (online.length > GAME_MAX ? '. Everyone else stays on the lesson.' : '.');
    };
    boxes.forEach(b => b.firstChild.addEventListener('change', sync));
    list.append(...boxes); if (!online.length) list.append(el('p', { class: 'muted' }, 'No students are connected yet.'));
    sync();
    card.append(el('h2', null, '🎮 Game time'),
      games.length ? el('div', null, el('label', null, 'Game'), pickGame)
        : el('div', null, el('p', null, 'Add your game first. Use the Sidekick edition’s web address.'), el('label', null, 'Game name'), addName, el('label', null, 'Web address'), addUrl),
      el('label', null, online.length > GAME_MAX ? 'Pick up to 8 players' : 'Players'), list, count,
      el('p', { class: 'muted' }, 'The game opens on your screen. Enter your game PIN to host, and the players join on their own.'),
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => {
          let g = games[+pickGame.value];
          if (!games.length) {
            const name = cleanText(addName.value, 40).trim(), url = addUrl.value.trim();
            if (!name || !gameUrlOk(url)) { toast('Add a game name and its https web address.'); return; }
            g = { name, url }; Games.save([g]);
          }
          const players = boxes.filter(b => b.firstChild.checked).map(b => b.firstChild.value);
          if (!players.length) { toast('Pick at least one player.'); return; }
          close(); startGame(g, players);
        } }, 'Open the game'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}
function startGame(g, players) {
  H.game = { name: g.name, url: new URL(g.url, location.href).href, players: new Set(players), code: null };
  const frame = el('iframe', { id: 'game-host-frame', title: g.name, src: gameLink(H.game.url, { sk: 'host', name: 'Teacher' }), allow: 'clipboard-write; autoplay' });
  $('#game-host-body').replaceChildren(frame);
  updateGameBar(); showGameHost(true);
}
function gameMsgFor(st) { const g = H.game; return g && g.code && g.players.has(st.id) ? { t: 'game', url: g.url, code: g.code, name: g.name } : { t: 'game', off: 1 }; }
function onGameMessage(e) {
  if (!H || !H.game) return;
  const f = $('#game-host-frame'); if (!f || e.source !== f.contentWindow) return;
  const d = e.data || {};
  if (d.event === 'room' && typeof d.code === 'string' && /^[A-Z0-9]{4}$/.test(d.code)) {
    H.game.code = d.code;
    for (const st of H.students.values()) if (st.online && H.game.players.has(st.id)) send(st, gameMsgFor(st));
    updateGameBar(); toast('Players are joining the game.');
  }
}
function updateGameBar() {
  const g = H && H.game, pill = $('#h-game');
  if (!g) { pill.hidden = true; return; }
  const names = [...g.players].map(id => (H.students.get(id) || {}).name).filter(Boolean);
  $('#game-host-title').textContent = '🎮 ' + g.name + (g.code ? '  ·  room ' + g.code : '  ·  enter your game PIN to host');
  $('#game-host-players').textContent = names.length + ' player' + (names.length === 1 ? '' : 's') + ': ' + names.join(', ');
  pill.hidden = false; pill.textContent = '🎮 Game running: open';
}
function showGameHost(on) { $('#game-host').hidden = !on; }
async function endGame() {
  if (!H || !H.game) return;
  if (!(await confirmBox('End the game for everyone?', 'Players go back to the lesson. Download the game’s class report first if you need it.', 'End game'))) return;
  broadcast({ t: 'game', off: 1 });
  H.game = null; $('#game-host-body').replaceChildren(); showGameHost(false); updateGameBar();
  toast('Game over. Everyone is back on the lesson.');
}

/* ---------- student ---------- */
function onGameMsg(m) {
  const box = $('#st-game');
  if (m.off) { S.game = null; box.replaceChildren(); box.hidden = true; document.body.classList.remove('in-game'); return; }
  if (!m.url || !/^[A-Z0-9]{4}$/.test(m.code || '')) return;
  if (S.game && S.game.code === m.code && box.querySelector('iframe')) return;   // already in this game
  S.game = { code: m.code, url: m.url };
  box.replaceChildren(el('iframe', { title: cleanText(m.name || 'Game', 40), src: gameLink(m.url, { sk: 'join', room: m.code, name: S.name || (S.first + ' ' + S.initial + '.') }), allow: 'autoplay' }));
  box.hidden = false; document.body.classList.add('in-game');
}

/* ---------- Settings: the games list ---------- */
function gamesSettings() {
  const wrap = el('div', { class: 'q-card' }, el('h3', null, '🎮 Games for Game time'),
    el('p', { class: 'muted' }, 'Add the web address of each Sidekick edition game (for example your escape-the-island-sidekick page). Up to 8 students play while the rest stay on the lesson.'));
  const draw = () => {
    wrap.querySelectorAll('.game-row, .game-add').forEach(x => x.remove());
    Games.all().forEach((g, i) => wrap.append(el('div', { class: 'game-row row-inline' }, el('strong', null, g.name), el('span', { class: 'muted' }, g.url),
      el('button', { class: 'btn btn-small btn-danger', onclick: () => { const a = Games.all(); a.splice(i, 1); Games.save(a); draw(); } }, 'Remove'))));
    const n = el('input', { maxlength: 40, placeholder: 'Game name' }), u = el('input', { maxlength: 300, placeholder: 'https://YOUR-NAME.github.io/escape-the-island-sidekick/' });
    wrap.append(el('div', { class: 'game-add row-inline' }, n, u, el('button', { class: 'btn', onclick: () => {
      const name = cleanText(n.value, 40).trim(), url = u.value.trim();
      if (!name || !gameUrlOk(url)) { toast('Add a game name and its https web address.'); return; }
      const a = Games.all(); a.push({ name, url }); Games.save(a); draw(); toast('Game added.');
    } }, 'Add game')));
  };
  draw();
  return wrap;
}

/* =====================================================================
   21. BOSS BATTLE: the whole class against an (original) monster
   Every correct answer is one hit. No names are ever shown during the battle.
   ===================================================================== */
const BOSSES = {
  grumble: { name: 'Grumblor', color: '#7B5CD6', dark: '#4E3696', belly: '#B9A6F2' },
  soggy: { name: 'Sir Soggybottom', color: '#3FA36B', dark: '#23704A', belly: '#9EE0B8' },
  bolt: { name: 'Bolt-o-Tron', color: '#7D8AA3', dark: '#4C566B', belly: '#C9D2E3' }
};
const BOSS_LEVELS = { easy: { label: 'Easy (about half right wins)', pct: 0.5 }, medium: { label: 'Medium (about 2 out of 3 right)', pct: 0.65 }, hard: { label: 'Hard (about 4 out of 5 right)', pct: 0.8 } };

/* Original monster art, drawn in code. mood: ok | hurt | angry | down */
function bossSVG(id, mood) {
  const b = BOSSES[id] || BOSSES.grumble;
  const eyes = mood === 'down'
    ? '<path d="M68 82l16 16M84 82l-16 16M116 82l16 16M132 82l-16 16" stroke="#1E2B4A" stroke-width="6" stroke-linecap="round"/>'
    : mood === 'hurt'
      ? '<path d="M66 90q10-10 20 0M114 90q10-10 20 0" stroke="#1E2B4A" stroke-width="6" fill="none" stroke-linecap="round"/>'
      : '<circle cx="76" cy="90" r="15" fill="#fff"/><circle cx="124" cy="90" r="15" fill="#fff"/><circle cx="79" cy="93" r="7" fill="#1E2B4A"/><circle cx="121" cy="93" r="7" fill="#1E2B4A"/>';
  const brows = mood === 'angry' ? '<path d="M58 70l30 10M142 70l-30 10" stroke="#1E2B4A" stroke-width="7" stroke-linecap="round"/>' : '';
  const mouth = mood === 'down'
    ? '<path d="M78 136q22-14 44 0" stroke="#1E2B4A" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M104 132q8 18-4 22" fill="#E86A8A"/>'
    : '<path d="M72 126q28 26 56 0z" fill="#1E2B4A"/><path d="M80 127l6 9 6-9M108 127l6 9 6-9" fill="#fff"/>';
  let body;
  if (id === 'bolt') {
    body = `<rect x="54" y="18" width="8" height="26" fill="${b.dark}"/><circle cx="58" cy="16" r="9" fill="#FFC53D"/>
      <rect x="138" y="18" width="8" height="26" fill="${b.dark}"/><circle cx="142" cy="16" r="9" fill="#FFC53D"/>
      <rect x="30" y="40" width="140" height="130" rx="22" fill="${b.color}" stroke="${b.dark}" stroke-width="6"/>
      <rect x="58" y="148" width="84" height="16" rx="6" fill="${b.belly}"/><circle cx="76" cy="156" r="4" fill="#D62F4B"/><circle cx="100" cy="156" r="4" fill="#FFC53D"/><circle cx="124" cy="156" r="4" fill="#3FA36B"/>
      <rect x="10" y="90" width="22" height="46" rx="10" fill="${b.dark}"/><rect x="168" y="90" width="22" height="46" rx="10" fill="${b.dark}"/>`;
  } else if (id === 'soggy') {
    body = `<path d="M30 120q0-90 70-92q70 2 70 92q0 40-24 50l-6 18-10-16-14 18-12-18-14 18-10-18q-50-8-50-52z" fill="${b.color}" stroke="${b.dark}" stroke-width="6"/>
      <ellipse cx="100" cy="150" rx="38" ry="18" fill="${b.belly}"/><circle cx="52" cy="58" r="8" fill="${b.belly}"/><circle cx="150" cy="52" r="6" fill="${b.belly}"/>`;
  } else {
    body = `<path d="M48 54l-12-40 34 26zM152 54l12-40-34 26z" fill="#FFC53D" stroke="${b.dark}" stroke-width="5"/>
      <ellipse cx="100" cy="112" rx="76" ry="70" fill="${b.color}" stroke="${b.dark}" stroke-width="6"/>
      <ellipse cx="100" cy="150" rx="40" ry="24" fill="${b.belly}"/><path d="M26 112q-20 6-14 30M174 112q20 6 14 30" stroke="${b.dark}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
  }
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${b.name}">${body}${brows}${eyes}${mouth}</svg>`;
}
function bossMood(hp, max, phase) { if (phase === 'won') return 'down'; const f = max ? hp / max : 1; return f < 0.3 ? 'hurt' : f < 0.7 ? 'angry' : 'ok'; }
function bossArena(v, compact) {
  const pct = v.maxHp ? Math.max(0, v.hp) / v.maxHp * 100 : 100;
  const wrap = el('div', { class: 'boss-arena' + (compact ? ' compact' : '') + (v.phase === 'won' ? ' defeated' : '') + (v.phase === 'lost' ? ' escaped' : '') });
  const mon = el('div', { class: 'boss-monster' }); mon.innerHTML = bossSVG(v.monster, bossMood(v.hp, v.maxHp, v.phase));
  wrap.append(el('div', { class: 'boss-name' }, (BOSSES[v.monster] || BOSSES.grumble).name), mon,
    el('div', { class: 'boss-hp', role: 'meter', 'aria-label': 'Boss health', 'aria-valuemin': '0', 'aria-valuemax': String(v.maxHp), 'aria-valuenow': String(Math.max(0, v.hp)) },
      el('div', { class: 'boss-hp-fill', style: 'width:' + pct + '%' }), el('span', { class: 'boss-hp-text' }, Math.max(0, v.hp) + ' / ' + v.maxHp)));
  return wrap;
}
function bossPop(arena, n) {
  if (!arena || n <= 0) return;
  const m = arena.querySelector('.boss-monster'); if (m) { m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); }
  const p = el('div', { class: 'boss-pop' }, '💥 −' + n); p.style.left = (30 + rand(40)) + '%'; arena.append(p); setTimeout(() => p.remove(), 1200);
}
function updateArena(arena, v, prevHp) {
  if (!arena) return;
  const pct = v.maxHp ? Math.max(0, v.hp) / v.maxHp * 100 : 100;
  const f = arena.querySelector('.boss-hp-fill'); if (f) f.style.width = pct + '%';
  const t = arena.querySelector('.boss-hp-text'); if (t) t.textContent = Math.max(0, v.hp) + ' / ' + v.maxHp;
  const m = arena.querySelector('.boss-monster'); if (m) m.innerHTML = bossSVG(v.monster, bossMood(v.hp, v.maxHp, v.phase));
  if (prevHp != null && v.hp < prevHp) bossPop(arena, prevHp - v.hp);
}
function confetti(box) {
  if (reduceMotion() || !box) return;
  const cols = ['#FFC53D', '#D62F4B', '#1F6FD1', '#3FA36B', '#8A3FD1'];
  for (let i = 0; i < 40; i++) { const c = el('span', { class: 'confetti' }); c.style.left = rand(100) + '%'; c.style.background = cols[i % 5]; c.style.animationDelay = (rand(800) / 1000) + 's'; box.append(c); setTimeout(() => c.remove(), 3200); }
}

/* ---------- teacher ---------- */
function bossSetup() {
  if ((H.wb && H.wb.active) || (H.race && H.race.active)) { toast('End the word builder or race first.'); return; }
  if (H.boss && H.boss.active) { renderHostStage(); return; }
  const sets = Sets.all().filter(s => s.questions.length);
  if (!sets.length) { toast('Import a question set first (Teacher Mode → Question sets).'); return; }
  openModal((card, close) => {
    const set = el('select', { 'aria-label': 'Question set' }, sets.map(s => el('option', { value: s.id }, s.name + ' (' + s.questions.length + ')')));
    const count = el('select', { 'aria-label': 'How many questions' }, [5, 8, 10, 12, 15, 20].map(n => el('option', { value: String(n) }, n + ' questions')));
    count.value = '10';
    const secs = el('select', { 'aria-label': 'Time per question' }, [[0, 'No timer'], [20, '20 seconds'], [30, '30 seconds'], [45, '45 seconds'], [60, '1 minute'], [90, '90 seconds']].map(([v, t]) => el('option', { value: String(v) }, t)));
    secs.value = '30';
    const lvl = el('select', { 'aria-label': 'Difficulty' }, Object.entries(BOSS_LEVELS).map(([k, l]) => el('option', { value: k }, l.label)));
    lvl.value = 'medium';
    let mon = 'grumble';
    const pick = el('div', { class: 'boss-pick' });
    const drawPick = () => { pick.replaceChildren(...Object.keys(BOSSES).map(id => { const b = el('button', { class: 'boss-choice', type: 'button', 'aria-pressed': String(id === mon), onclick: () => { mon = id; drawPick(); } }); b.innerHTML = bossSVG(id, 'ok'); b.append(el('span', null, BOSSES[id].name)); return b; })); };
    drawPick();
    const charge = el('input', { type: 'checkbox' }); charge.checked = true;
    const shuf = el('input', { type: 'checkbox' }); shuf.checked = true;
    card.append(el('h2', null, '👾 Boss Battle'), el('label', null, 'Question set'), set,
      el('div', { class: 'row-inline' }, count, secs, lvl), el('label', null, 'Choose your boss'), pick,
      el('label', { class: 'check small' }, shuf, 'Mix up the question order'),
      el('label', { class: 'check small' }, charge, 'The boss powers up (heals a little) when fewer than half get a question right'),
      el('p', { class: 'muted' }, 'Boss health is set from how many students are connected when you start.'),
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-sun', onclick: () => { const s = sets.find(x => x.id === set.value); close(); bossStart({ set: s, n: +count.value, secs: +secs.value, level: lvl.value, monster: mon, charge: charge.checked, shuffle: shuf.checked }); } }, '⚔️ Get ready'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}
function bossStart(o) {
  const all = o.shuffle ? shuffle(o.set.questions) : o.set.questions.slice();
  const qs = all.slice(0, Math.min(o.n, all.length)).map(q => JSON.parse(JSON.stringify(q)));
  const players = Math.max(1, onlineStudents().length);
  const maxHp = Math.max(3, Math.round(players * qs.length * BOSS_LEVELS[o.level].pct));
  H.boss = { active: true, opts: o, qs, i: -1, phase: 'intro', monster: o.monster, maxHp, hp: maxHp, answers: {}, pub: null, endAt: null,
    myHits: {}, qHits: 0, lastBcastHp: maxHp, dirty: false, lastSend: 0, powered: false, round: (H.boss ? H.boss.round : 0) + 1 };
  H.spotlight = null; broadcast({ t: 'spot', items: null });
  broadcastView(); renderHostStage();
}
function bossQ() { const b = H.boss; return b && b.i >= 0 ? b.qs[b.i] : null; }
function bossQid() { return 'bb' + H.boss.round + '-' + H.boss.i; }
function bossNext() {
  const b = H.boss;
  if (b.i + 1 >= b.qs.length) { b.phase = b.hp <= 0 ? 'won' : 'lost'; broadcastView(); renderHostStage(); return; }
  b.i++; b.answers = {}; b.qHits = 0; b.powered = false; b.phase = 'question';
  b.pub = publicQ(bossQ(), bossQid());
  b.endAt = b.opts.secs ? performance.now() + b.opts.secs * 1000 : null;
  broadcastView(); renderHostStage();
}
function bossReveal() {
  const b = H.boss; if (b.phase !== 'question') return;
  b.phase = 'reveal'; b.endAt = null;
  const n = Object.keys(b.answers).length, right = b.qHits;
  if (b.opts.charge && b.hp > 0 && (n === 0 || right / Math.max(n, onlineStudents().length) < 0.5)) {
    const heal = Math.max(1, Math.round(b.maxHp * 0.05)); b.hp = Math.min(b.maxHp, b.hp + heal); b.powered = heal;
  }
  // into the report
  const q = bossQ(), qid = bossQid();
  H.report.bossCount = (H.report.bossCount || 0) + 1;
  H.report.questions.push({ qid, n: 2000 + H.report.bossCount, label: 'B' + H.report.bossCount, type: q.type, text: q.text });
  H.report.answers[qid] = {};
  for (const [sid, r] of Object.entries(b.answers)) H.report.answers[qid][sid] = { raw: r.raw, a: answerText(q, r.raw), correct: r.correct, t: r.t };
  H.reportDirty = true;
  if (b.hp <= 0) b.phase = 'won';
  else if (b.i + 1 >= b.qs.length) b.lastQ = true;
  broadcastView(); renderHostStage();
}
function bossAnswer(st, m) {
  const b = H.boss, q = bossQ();
  if (b.phase !== 'question' || !q || m.qid !== bossQid() || b.answers[st.id]) return;   // one answer each
  const a = sanitizeAnswer(q, m.a); if (a == null) return;
  const correct = grade(q, a);
  b.answers[st.id] = { raw: a, correct, t: Date.now() };
  if (correct) { b.qHits++; b.hp--; b.myHits[st.id] = (b.myHits[st.id] || 0) + 1; }
  b.dirty = true;
  send(st, { t: 'ack', qid: m.qid }); send(st, viewMsg(st));
  if (Object.keys(b.answers).length >= onlineStudents().length) setTimeout(() => { if (H && H.boss && H.boss.phase === 'question') bossReveal(); }, 700);
}
function bossTick(now) {
  const b = H.boss; if (!b || !b.active) return;
  if (b.phase === 'question' && b.endAt && now >= b.endAt) { bossReveal(); return; }
  if (b.dirty && now - b.lastSend > 400) {
    b.dirty = false; b.lastSend = now;
    broadcast({ t: 'bb', hp: b.hp, maxHp: b.maxHp, answered: Object.keys(b.answers).length });
    const arena = $('#h-stage .boss-arena'); updateArena(arena, bossPublic(), b.lastBcastHp); b.lastBcastHp = b.hp;
    const c = $('#boss-answered'); if (c) c.textContent = Object.keys(b.answers).length + ' of ' + onlineStudents().length + ' answered';
  }
  const t = $('#boss-timer'); if (t && b.endAt) t.textContent = '⏱ ' + fmtTime(b.endAt - now);
}
function bossPublic() { const b = H.boss; return { monster: b.monster, hp: b.hp, maxHp: b.maxHp, phase: b.phase }; }
function bossView(base, st) {
  const b = H.boss, mine = b.answers[st.id];
  const v = { ...base, k: 'boss', ...bossPublic(), i: b.i, n: b.qs.length, round: b.round, myHits: b.myHits[st.id] || 0, powered: b.powered || 0, last: !!b.lastQ };
  if (b.phase === 'question' || b.phase === 'reveal') { v.q = b.pub; v.mine = mine ? mine.raw : null; }
  if (b.phase === 'question' && b.endAt) v.left = Math.max(0, Math.round(b.endAt - performance.now()));
  if (b.phase === 'reveal' || ((b.phase === 'won' || b.phase === 'lost') && b.i >= 0)) {
    v.qHits = b.qHits; v.classN = Object.keys(b.answers).length;
    v.my = { answered: !!mine, correct: !!(mine && mine.correct), answer: correctText(bossQ()) };
  }
  return v;
}
function bossEnd() { H.boss.active = false; broadcastView(); renderHostStage(); renderHostSide(); }
function renderBossStage(stage) {
  const b = H.boss, v = bossPublic(), q = bossQ();
  const arena = bossArena(v, false); stage.append(arena); b.lastBcastHp = b.hp;
  const panel = el('div', { class: 'q-card boss-panel' });
  const btn = (label, fn, cls) => el('button', { class: 'btn ' + (cls || ''), onclick: fn }, label);
  if (b.phase === 'intro') {
    panel.append(el('div', { class: 'q-text' }, (BOSSES[b.monster] || {}).name + ' appears! ' + b.qs.length + ' questions to defeat it.'),
      el('div', { class: 'spin-buttons' }, btn('⚔️ Start the battle', bossNext, 'btn-sun'), btn('End boss battle', bossEnd, 'btn-ghost')));
  } else if (b.phase === 'question') {
    panel.append(el('div', { class: 'tag' }, 'Question ' + (b.i + 1) + ' of ' + b.qs.length + ' · ' + TYPE_LABEL[q.type]), el('div', { class: 'q-text', text: q.text }),
      el('div', { class: 'host-q-meta' }, el('span', { class: 'count-pill', id: 'boss-answered' }, Object.keys(b.answers).length + ' of ' + onlineStudents().length + ' answered'),
        b.endAt ? el('span', { class: 'timer-pill', id: 'boss-timer' }, '') : null,
        btn('Show the answer now', bossReveal), btn('End boss battle', bossEnd, 'btn-ghost')));
  } else if (b.phase === 'reveal') {
    const n = Object.keys(b.answers).length;
    panel.append(el('div', { class: 'tag' }, 'Question ' + (b.i + 1) + ' of ' + b.qs.length), el('div', { class: 'q-text', text: q.text }),
      el('p', null, el('strong', null, 'Answer: '), correctText(q)),
      el('p', { class: 'boss-result' }, '💥 ' + b.qHits + ' hit' + (b.qHits === 1 ? '' : 's') + ' (' + (n ? Math.round(100 * b.qHits / n) : 0) + '% of answers)' + (b.powered ? '  ·  ⚡ The boss powered up +' + b.powered : '')),
      el('div', { class: 'spin-buttons' }, btn(b.lastQ ? 'See how it ends' : 'Next question ▶', bossNext, 'btn-primary'), btn('End boss battle', bossEnd, 'btn-ghost')));
  } else {
    const won = b.phase === 'won';
    panel.append(el('div', { class: 'q-text' }, won ? '🏆 Victory! The class defeated ' + (BOSSES[b.monster] || {}).name + '!' : '💨 ' + (BOSSES[b.monster] || {}).name + ' escaped this time…'),
      el('div', { class: 'spin-buttons' }, btn('🔁 Play again', () => bossStart(b.opts), 'btn-sun'), btn('End boss battle', bossEnd, 'btn-primary')));
    if (won) setTimeout(() => confetti($('#h-stage .boss-arena')), 50);
  }
  stage.append(panel);
}

/* ---------- student ---------- */
function buildBossView(v) {
  const box = el('div', { class: 'boss-student' });
  const arena = bossArena(v, true); box.append(arena);
  S.bossHp = v.hp;
  if (v.phase === 'intro') box.append(msgCard('👾', 'A boss appears!', 'Get ready. Every right answer is a hit. Work together to win!'));
  else if (v.phase === 'question') {
    const card = buildStudentQ({ ...v, k: 'q', phase: v.mine != null ? 'closed' : 'open', mine: v.mine });
    const top = el('div', { class: 'boss-qtop' }, el('span', { class: 'tag' }, 'Question ' + (v.i + 1) + ' of ' + v.n), v.left != null ? el('span', { class: 'timer-pill', id: 'boss-st-timer' }, '⏱ ' + fmtTime(v.left)) : null);
    card.prepend(top);
    if (v.mine != null) { const p = [...card.querySelectorAll('p.muted')].pop(); if (p) p.textContent = 'Locked in! ⚔️ Watch the boss…'; }
    box.append(card);
    clearInterval(S.bossTimerT);
    if (v.left != null) { const end = Date.now() + v.left; S.bossTimerT = setInterval(() => { const t = $('#boss-st-timer'); if (!t) { clearInterval(S.bossTimerT); return; } t.textContent = '⏱ ' + fmtTime(end - Date.now()); }, 250); }
  } else if (v.phase === 'reveal') {
    const my = v.my || {};
    box.append(el('div', { class: 'q-card' },
      el('div', { class: 'result-mine big' }, my.correct ? '✓ Hit! You damaged the boss.' : my.answered ? 'Missed this time. The answer: ' + my.answer : 'No answer this time. The answer: ' + my.answer),
      el('p', { class: 'boss-result' }, '💥 The class landed ' + v.qHits + ' hit' + (v.qHits === 1 ? '' : 's') + '!' + (v.powered ? '  ⚡ The boss powered up!' : '')),
      el('p', { class: 'muted' }, 'Your hits so far: ' + v.myHits + (v.last ? '' : '  ·  Waiting for the next question…'))));
  } else {
    const won = v.phase === 'won';
    box.append(msgCard(won ? '🏆' : '💨', won ? 'Victory! The class defeated the boss!' : 'The boss escaped this time…', 'You landed ' + v.myHits + ' hit' + (v.myHits === 1 ? '' : 's') + '. ' + (won ? 'Great teamwork!' : 'Let’s get it next time!')));
    if (won) setTimeout(() => confetti(arena), 50);
  }
  return box;
}
function onBossMsg(m) {
  if (!S.view || S.view.k !== 'boss') return;
  const prev = S.bossHp; S.view.hp = m.hp; S.view.maxHp = m.maxHp; S.bossHp = m.hp;
  updateArena($('#st-stage .boss-arena'), S.view, prev);
}

/* =====================================================================
   22. DEMO STUDENT WINDOW ("Pip D.")
   A second window that joins as a pretend student, with the join address and room code
   shown big at the top, so the teacher can share just that window. Pip never counts.
   ===================================================================== */
const DEMO_FIRST = 'Pip', DEMO_INITIAL = 'D';
function openDemoStudent() {
  const u = new URL(joinURL());
  u.searchParams.set('room', H.code); u.searchParams.set('demo', '1');
  const ps = QS.get('peerserver'); if (ps) u.searchParams.set('peerserver', ps);
  // "noopener": the demo window starts fresh and never gets a copy of the teacher's session
  window.open(u.href, '_blank', 'popup,width=1100,height=820,noopener');
  toast('Demo student window opening… Share just that window in LL. (No window? Allow pop-ups for this site.)');
}
function isDemoId(sid) { const s = H && H.students.get(sid); return !!(s && s.demo); }
function startDemoStudent(room) {
  // a new window can inherit a copy of the teacher's session; this window is only ever the demo student
  ssDel(KEYS.host); ssDel(KEYS.teacherOk); ssDel(KEYS.student);
  S.demo = true; document.body.classList.add('demo-mode');
  document.title = 'Sidekick Live · Student view (demo)';
  const site = (location.origin + location.pathname).replace(/^https?:\/\//, '').replace(/\/index\.html$/, '/');
  const bar = el('div', { class: 'demo-banner', role: 'note' },
    el('div', null, el('span', { class: 'demo-label' }, 'Go to'), el('strong', { class: 'demo-url' }, site)),
    el('div', null, el('span', { class: 'demo-label' }, 'Room code'), el('strong', { class: 'demo-code' }, room)),
    el('div', { class: 'demo-pip' }, '⭐ Pip is our demo student'));
  $('#screen-student').prepend(bar);
  studentJoin(room, DEMO_FIRST, DEMO_INITIAL, null);
}

/* =====================================================================
   23. CONNECTION HELP (on screen + downloadable)
   ===================================================================== */
const HELP_STEPS = [
  ['Check the room code', 'Ask your teacher for today’s 4-letter code. Codes never use O, 0, I, 1, L, S, 5, Z, 2, B or 8.'],
  ['Refresh the page', 'Press Ctrl + R (or the ⟳ button). On a tablet, pull the page down. You keep your spot in class.'],
  ['Use Chrome, Edge or Safari', 'Sidekick Live works best in an up-to-date Chrome or Edge. On an iPad, use Safari. Restart the browser if it asks to update.'],
  ['Get a stronger connection', 'Move closer to your Wi-Fi router, and close other tabs, videos or games that use the internet.'],
  ['Turn off VPNs and blockers', 'VPNs, ad blockers and some “privacy” extensions can block live connections. Turn them off for this site, then refresh.'],
  ['Try a different network', 'If you can, switch to another Wi-Fi network or a phone hotspot. Some home or school filters block live classroom tools.'],
  ['Restart the device', 'Turn the computer or tablet off and on again, then open the page and join with the code.'],
  ['School-issued device?', 'Its filter may block Sidekick Live. Tell your teacher so they can ask tech support to allow it.']
];
function connectionDiagnosis() {
  const out = [];
  if (navigator.onLine === false) out.push('This device looks offline. Check the Wi-Fi first.');
  if (typeof Peer === 'undefined') out.push('Sidekick Live’s connection tool couldn’t load. This network may be blocking it: try another network, or ask your teacher.');
  if (typeof RTCPeerConnection === 'undefined') out.push('This browser can’t make live connections. Try an up-to-date Chrome, Edge or Safari.');
  return out;
}
function helpCard(opts = {}) {
  const diag = connectionDiagnosis();
  const card = el('div', { class: 'help-card' },
    el('h2', null, '📡 Can’t connect? Try these steps'),
    diag.length ? el('div', { class: 'help-diag', role: 'alert' }, diag.map(d => el('p', null, '⚠️ ' + d))) : null,
    el('ol', { class: 'help-steps' }, HELP_STEPS.map(([t, d]) => el('li', null, el('strong', null, t + (t.endsWith('?') ? ' ' : '. ')), d))),
    el('div', { class: 'spin-buttons' },
      opts.retry ? el('button', { class: 'btn btn-primary', onclick: () => { S.joinStart = Date.now(); reconnectNow(); renderStudent(); toast('Trying again…'); } }, '⟳ Try again now') : null,
      el('button', { class: 'btn', onclick: () => downloadHelp(opts.room || S.room) }, '⬇ Download these steps'),
      opts.close ? el('button', { class: 'btn btn-ghost', onclick: opts.close }, 'Close') : null),
    el('div', { class: 'help-ll' }, el('strong', null, '📺 Still not working? Watch in LL.'),
      el('p', null, 'Stay in LiveLesson and follow along with your teacher’s screen. Answer out loud or in the LL chat, use reactions, and raise your hand. Your teacher can add you to the share spinner.')));
  return card;
}
function helpHTML(room) {
  const site = (location.origin + location.pathname).replace(/\/index\.html$/, '/');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sidekick Live: connection help</title><style>body{font-family:system-ui,Arial,sans-serif;max-width:720px;margin:30px auto;color:#1E2B4A;line-height:1.5;padding:0 16px}h1{font-size:1.6rem}li{margin:8px 0}.box{border:2px solid #1E2B4A;border-radius:12px;padding:12px 16px;margin:16px 0}@media print{.noprint{display:none}}</style></head><body>' +
    '<h1>Sidekick Live: can’t connect?</h1><div class="box"><strong>Website:</strong> ' + escapeHTML(site) + (room ? '<br><strong>Room code:</strong> ' + escapeHTML(room) + ' (the code changes each class; use the one your teacher shows)' : '<br><strong>Room code:</strong> your teacher shows a new 4-letter code each class') + '</div>' +
    '<h2>Try these steps in order</h2><ol>' + HELP_STEPS.map(([t, d]) => '<li><strong>' + escapeHTML(t) + (t.endsWith('?') ? '' : '.') + '</strong> ' + escapeHTML(d) + '</li>').join('') + '</ol>' +
    '<div class="box"><strong>Still not working? Watch in LL.</strong><br>Stay in LiveLesson and follow along with your teacher’s screen. Answer out loud or in the LL chat, use reactions, and raise your hand. Your teacher can add you to the share spinner.</div>' +
    '<p class="noprint"><button onclick="print()">🖨 Print this page</button></p></body></html>';
}
function downloadHelp(room) { download('Sidekick-Live-connection-help.html', helpHTML(room), 'text/html;charset=utf-8'); }
function openHelpModal() { openModal((card, close) => card.append(helpCard({ close: () => close() }))); }

/* lost connection during class: offer help after 30 seconds */
setInterval(() => {
  const bar = $('#st-help'); if (!bar) return;
  const stuck = S.active && !S.leaving && S.everConnected && !(S.conn && S.conn.open) && S.lostAt && Date.now() - S.lostAt > 30000;
  if (stuck && bar.hidden) {
    bar.replaceChildren(el('span', null, '📡 Still reconnecting…'),
      el('button', { class: 'btn btn-small', onclick: () => { S.lostAt = Date.now(); reconnectNow(); } }, '⟳ Try again'),
      el('button', { class: 'btn btn-small', onclick: openHelpModal }, 'What to try'));
    bar.hidden = false;
  } else if (!stuck && !bar.hidden) bar.hidden = true;
}, 3000);

/* =====================================================================
   24. TEAM RACE (engine) + TREASURE DIVE (first theme)
   Teams move by their PERCENT correct, so team size doesn't matter. No names during play.
   A theme supplies only the scene, the stops/zones with facts, and the event wording.
   ===================================================================== */
const RACE_TEAMS = [
  { name: 'Octopus', emoji: '🐙', color: '#D9468F' }, { name: 'Dolphin', emoji: '🐬', color: '#1F6FD1' },
  { name: 'Turtle', emoji: '🐢', color: '#2E9E5B' }, { name: 'Whale', emoji: '🐳', color: '#5B5BD6' },
  { name: 'Crab', emoji: '🦀', color: '#E0622B' }, { name: 'Puffer', emoji: '🐡', color: '#C99A06' }
];
const RACE_THEMES = {
  dive: {
    title: 'Treasure Dive', icon: '🤿', goalName: 'the shipwreck',
    stops: [
      { at: 0, name: 'Sunlight zone', fact: 'Sunlight zone: most ocean animals live up here, where sunlight reaches.' },
      { at: 25, name: 'Twilight zone', fact: 'Twilight zone: only a little light gets this deep, and many animals here make their own glow.' },
      { at: 55, name: 'Midnight zone', fact: 'Midnight zone: no sunlight at all! An anglerfish uses a glowing lure to find food.' },
      { at: 100, name: 'The shipwreck', fact: 'The shipwreck! The treasure chest is waiting.' }
    ],
    where: pos => Math.round(Math.min(100, pos) / 100 * 3800).toLocaleString() + ' m deep',
    events: {
      boost: t => '🐬 A friendly dolphin towed Team ' + t + ' deeper!',
      all: () => '🫧 A bubble burst pushed every team a little deeper!',
      back: t => '🌊 A strong current pushed Team ' + t + ' back up a bit.'
    },
    win: t => '💰 Team ' + t + ' reached the shipwreck and opened the treasure chest!',
    deepest: t => '💰 Time’s up! Team ' + t + ' dove the deepest and wins the treasure!'
  }
};
function raceZoneFloor(theme, pos) { let f = 0; for (const s of RACE_THEMES[theme].stops) if (pos >= s.at && s.at < 100) f = s.at; return f; }

/* ---------- scene: the ocean (drawn in code, original art) ---------- */
function diveScene(teams, prev, myTeam) {
  const W = 1000, Hh = 620, top = 70, bottom = 540, n = teams.length, lane = W / (n + 1);
  const y = p => top + (bottom - top) * Math.min(100, Math.max(0, p)) / 100;
  const zone = (y1, y2, c1, c2, id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect x="0" y="${y1}" width="${W}" height="${y2 - y1}" fill="url(#${id})"/>`;
  let s = `<svg viewBox="0 0 ${W} ${Hh}" class="race-svg" role="img" aria-label="Teams diving toward a shipwreck">`;
  s += `<rect x="0" y="0" width="${W}" height="${top}" fill="#CFEAF9"/>`;
  s += zone(top, y(25), '#5BC0EB', '#2A86C9', 'z1') + zone(y(25), y(55), '#2A86C9', '#164E8A', 'z2') + zone(y(55), Hh, '#164E8A', '#0A1E3F', 'z3');
  s += `<path d="M0 ${top} q25 -10 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0" fill="none" stroke="#fff" stroke-width="4" opacity=".8"/>`;
  [['Sunlight zone', 0], ['Twilight zone', 25], ['Midnight zone', 55]].forEach(([t, p]) => { s += `<text x="12" y="${y(p) + 26}" font-size="20" font-weight="700" fill="#fff" opacity=".85" font-family="Lexend, system-ui, sans-serif">${t}</text>`; });
  // sunlight fish, twilight jellies, midnight anglerfish light
  [[180, 130], [760, 170], [520, 110]].forEach(([fx, fy]) => { s += `<g opacity=".8"><ellipse cx="${fx}" cy="${fy}" rx="16" ry="8" fill="#FFC53D"/><path d="M${fx + 14} ${fy} l12 -8 v16z" fill="#FFC53D"/></g>`; });
  [[300, 270], [880, 300], [620, 250]].forEach(([jx, jy]) => { s += `<g opacity=".75"><path d="M${jx - 14} ${jy} a14 12 0 0 1 28 0z" fill="#E7A6F2"/><path d="M${jx - 10} ${jy} q-3 14 0 22M${jx} ${jy} q3 14 0 22M${jx + 10} ${jy} q-3 14 0 22" stroke="#E7A6F2" stroke-width="2" fill="none"/></g>`; });
  s += `<g opacity=".9"><circle cx="840" cy="430" r="7" fill="#FFF6A8"/><circle cx="840" cy="430" r="16" fill="#FFF6A8" opacity=".25"/><path d="M840 437 q-6 18 -24 22 q-40 4 -48 -14 q10 -24 46 -14z" fill="#33415C"/></g>`;
  // the shipwreck + treasure at the bottom
  s += `<path d="M0 ${Hh} L0 ${bottom + 40} q250 -30 500 -6 t500 10 L${W} ${Hh}z" fill="#C9A86A" opacity=".85"/>`;
  s += `<g transform="translate(${W / 2 - 150} ${bottom - 22})"><path d="M0 40 L40 70 L250 70 L300 30 L270 36 L40 36z" fill="#6B4A2B" stroke="#3E2A17" stroke-width="3"/><rect x="120" y="-30" width="8" height="66" fill="#3E2A17" transform="rotate(-12 124 36)"/><path d="M128 -26 l52 18 -52 18z" fill="#E9E1D0" opacity=".7" transform="rotate(-12 124 36)"/>
    <g transform="translate(170 46)"><rect x="0" y="0" width="44" height="26" rx="4" fill="#B5761E" stroke="#5E3A0B" stroke-width="3"/><path d="M0 0 q22 -18 44 0z" fill="#D18F2A" stroke="#5E3A0B" stroke-width="3"/><rect x="18" y="6" width="8" height="10" fill="#FFC53D"/></g></g>`;
  s += `<text x="${W / 2}" y="${Hh - 10}" text-anchor="middle" font-size="18" font-weight="800" fill="#FFF4D6" font-family="Lexend, system-ui, sans-serif">⚓ Shipwreck · 3,800 m</text>`;
  teams.forEach((t, k) => {
    const x = lane * (k + 1), p0 = prev && prev[k] != null ? prev[k] : t.pos;
    s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#fff" stroke-dasharray="4 8" opacity=".25"/>`;
    const mine = myTeam === k;
    s += `<g class="race-token" data-k="${k}" data-from="${y(p0)}" data-to="${y(t.pos)}" style="transform: translateY(${y(p0)}px)">
      <g transform="translate(${x} 0)">${mine ? '<circle r="44" fill="none" stroke="#FFC53D" stroke-width="5" stroke-dasharray="6 5"/>' : ''}
      <ellipse rx="36" ry="20" fill="${t.color}" stroke="#fff" stroke-width="3"/><rect x="-10" y="-34" width="20" height="18" rx="5" fill="${t.color}" stroke="#fff" stroke-width="3"/>
      <circle cx="12" cy="0" r="9" fill="#BFE6FF" stroke="#fff" stroke-width="2"/><path d="M-36 0 l-12 -10 v20z" fill="${t.color}"/>
      <text x="-10" y="7" text-anchor="middle" font-size="20">${t.emoji}</text></g></g>`;
    s += `<text x="${x}" y="${top - 30}" text-anchor="middle" font-size="18" font-weight="800" fill="#1E2B4A" font-family="Lexend, system-ui, sans-serif">${t.emoji} ${t.name}</text>`;
  });
  return s + '</svg>';
}
function raceScene(v, prev) {
  const box = el('div', { class: 'race-scene' + (v.phase === 'won' ? ' won' : '') });
  box.innerHTML = diveScene(v.teams, prev, v.myTeam);
  requestAnimationFrame(() => requestAnimationFrame(() => box.querySelectorAll('.race-token').forEach(g => { g.style.transform = 'translateY(' + g.dataset.to + 'px)'; })));
  return box;
}

/* ---------- teacher ---------- */
function raceSetup() {
  if ((H.wb && H.wb.active) || (H.boss && H.boss.active)) { toast('End the word builder or boss battle first.'); return; }
  if (H.race && H.race.active) { renderHostStage(); return; }
  const sets = Sets.all().filter(s => s.questions.length);
  if (!sets.length) { toast('Import a question set first (Teacher Mode → Question sets).'); return; }
  const n = onlineStudents().length;
  openModal((card, close) => {
    const theme = el('select', { 'aria-label': 'Theme' }, el('option', { value: 'dive' }, '🤿 Treasure Dive'), el('option', { value: 'world', disabled: true }, '🌍 Race Around the World (coming next)'));
    const set = el('select', { 'aria-label': 'Question set' }, sets.map(s => el('option', { value: s.id }, s.name + ' (' + s.questions.length + ')')));
    const count = el('select', { 'aria-label': 'How many questions' }, [5, 8, 10, 12, 15, 20].map(k => el('option', { value: String(k) }, k + ' questions'))); count.value = '10';
    const secs = el('select', { 'aria-label': 'Time per question' }, [[0, 'No timer'], [20, '20 seconds'], [30, '30 seconds'], [45, '45 seconds'], [60, '1 minute'], [90, '90 seconds']].map(([v, t]) => el('option', { value: String(v) }, t))); secs.value = '30';
    const teams = el('select', { 'aria-label': 'Teams' }, [2, 3, 4, 5, 6].map(k => el('option', { value: String(k) }, k + ' teams'))); teams.value = String(Math.min(6, Math.max(2, Math.round(n / 8) || 2)));
    const ev = el('select', { 'aria-label': 'Surprise events' }, [['off', 'Surprise events: Off'], ['some', 'Surprise events: Sometimes'], ['often', 'Surprise events: Often']].map(([v, t]) => el('option', { value: v }, t))); ev.value = 'some';
    const shuf = el('input', { type: 'checkbox' }); shuf.checked = true;
    card.append(el('h2', null, '🏁 Team Race'), el('label', null, 'Theme'), theme, el('label', null, 'Question set'), set,
      el('div', { class: 'row-inline' }, count, secs, teams, ev),
      el('label', { class: 'check small' }, shuf, 'Mix up the question order'),
      el('p', { class: 'muted' }, n + ' student' + (n === 1 ? '' : 's') + ' connected. Teams are made fairly at random; anyone who joins late goes to the smallest team.'),
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-sun', onclick: () => { const s = sets.find(x => x.id === set.value); close(); raceStart({ theme: theme.value, set: s, n: +count.value, secs: +secs.value, teams: +teams.value, events: ev.value, shuffle: shuf.checked }); } }, 'Make the teams'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}
function raceStart(o) {
  const all = o.shuffle ? shuffle(o.set.questions) : o.set.questions.slice();
  const qs = all.slice(0, Math.min(o.n, all.length)).map(q => JSON.parse(JSON.stringify(q)));
  const picks = shuffle(RACE_TEAMS).slice(0, o.teams);
  const teams = picks.map(t => ({ ...t, members: [], pos: 0, gain: 0 }));
  shuffle(onlineStudents()).forEach((st, i) => teams[i % teams.length].members.push(st.id));
  H.race = { active: true, opts: o, theme: o.theme, qs, i: -1, phase: 'teams', teams, step: 100 / (qs.length * 0.65), answers: {}, pub: null, endAt: null,
    myCorrect: {}, round: (H.race ? H.race.round : 0) + 1, prev: null, msg: [], reached: new Set([0]), winner: null };
  H.spotlight = null; broadcast({ t: 'spot', items: null });
  broadcastView(); renderHostStage();
}
function raceTeamOf(sid) { return H.race.teams.findIndex(t => t.members.includes(sid)); }
function raceEnsureTeam(st) {
  if (st.demo || raceTeamOf(st.id) >= 0) return;
  const t = H.race.teams.reduce((a, b) => (a.members.length <= b.members.length ? a : b));
  t.members.push(st.id);
}
function raceQ() { const r = H.race; return r && r.i >= 0 ? r.qs[r.i] : null; }
function raceQid() { return 'tr' + H.race.round + '-' + H.race.i; }
function raceNext() {
  const r = H.race;
  if (r.i + 1 >= r.qs.length) { raceFinish(true); return; }
  r.prev = r.teams.map(t => t.pos); r.i++; r.answers = {}; r.msg = []; r.phase = 'question';
  r.pub = publicQ(raceQ(), raceQid());
  r.endAt = r.opts.secs ? performance.now() + r.opts.secs * 1000 : null;
  broadcastView(); renderHostStage();
}
function raceReveal() {
  const r = H.race; if (r.phase !== 'question') return;
  const th = RACE_THEMES[r.theme];
  r.phase = 'reveal'; r.endAt = null; r.prev = r.teams.map(t => t.pos); r.msg = [];
  r.teams.forEach(t => {
    const present = t.members.filter(id => { const s = H.students.get(id); return (s && s.online) || r.answers[id]; });
    const right = t.members.filter(id => r.answers[id] && r.answers[id].correct).length;
    t.lastPct = present.length ? right / present.length : 0;
    t.gain = r.step * t.lastPct; t.pos += t.gain;
  });
  // surprise event
  const chance = { off: 0, some: 0.25, often: 0.5 }[r.opts.events] || 0;
  if (chance && randFloat() < chance && r.i < r.qs.length - 1) {
    const kind = ['boost', 'all', 'back'][rand(3)];
    if (kind === 'all') { r.teams.forEach(t => { t.pos += r.step * 0.25; }); r.msg.push(th.events.all()); }
    else {
      const t = r.teams[rand(r.teams.length)];
      if (kind === 'boost') { t.pos += r.step * 0.5; r.msg.push(th.events.boost(t.name)); }
      else { const floor = raceZoneFloor(r.theme, t.pos); const np = Math.max(floor, t.pos - r.step * 0.35); if (np < t.pos) { t.pos = np; r.msg.push(th.events.back(t.name)); } }
    }
  }
  // first team into a new zone/stop: a fun fact for everyone
  const lead = Math.max(...r.teams.map(t => t.pos));
  th.stops.forEach(s => { if (s.at > 0 && s.at < 100 && lead >= s.at && !r.reached.has(s.at)) { r.reached.add(s.at); r.msg.push('📍 ' + s.fact); } });
  // report
  const q = raceQ(), qid = raceQid();
  H.report.raceCount = (H.report.raceCount || 0) + 1;
  H.report.questions.push({ qid, n: 3000 + H.report.raceCount, label: 'R' + H.report.raceCount, type: q.type, text: q.text });
  H.report.answers[qid] = {};
  for (const [sid, a] of Object.entries(r.answers)) H.report.answers[qid][sid] = { raw: a.raw, a: answerText(q, a.raw), correct: a.correct, t: a.t };
  H.reportDirty = true;
  if (r.teams.some(t => t.pos >= 100)) raceFinish(false);
  else { if (r.i + 1 >= r.qs.length) r.lastQ = true; broadcastView(); renderHostStage(); }
}
function raceFinish(outOfQuestions) {
  const r = H.race, th = RACE_THEMES[r.theme];
  const best = r.teams.slice().sort((a, b) => b.pos - a.pos || (b.lastPct || 0) - (a.lastPct || 0))[0];
  r.winner = r.teams.indexOf(best); r.phase = 'won';
  r.prev = r.prev || r.teams.map(t => t.pos);
  r.winText = best.pos >= 100 && !outOfQuestions ? th.win(best.name) : th.deepest(best.name);
  broadcastView(); renderHostStage();
}
function raceAnswer(st, m) {
  const r = H.race, q = raceQ();
  if (r.phase !== 'question' || !q || m.qid !== raceQid() || r.answers[st.id]) return;
  const a = sanitizeAnswer(q, m.a); if (a == null) return;
  if (!st.demo) raceEnsureTeam(st);
  r.answers[st.id] = { raw: a, correct: grade(q, a), t: Date.now() };
  if (r.answers[st.id].correct) r.myCorrect[st.id] = (r.myCorrect[st.id] || 0) + 1;
  send(st, { t: 'ack', qid: m.qid }); send(st, viewMsg(st));
  r.dirty = true;
  const real = Object.keys(r.answers).filter(id => !isDemoId(id)).length;
  if (real >= onlineStudents().length) setTimeout(() => { if (H && H.race && H.race.phase === 'question') raceReveal(); }, 700);
}
function raceTick(now) {
  const r = H.race; if (!r || !r.active) return;
  if (r.phase === 'question' && r.endAt && now >= r.endAt) { raceReveal(); return; }
  if (r.dirty) { r.dirty = false; const c = $('#race-answered'); if (c) c.textContent = Object.keys(r.answers).filter(id => !isDemoId(id)).length + ' of ' + onlineStudents().length + ' answered'; }
  const t = $('#race-timer'); if (t && r.endAt) t.textContent = '⏱ ' + fmtTime(r.endAt - now);
}
function racePublicTeams() { return H.race.teams.map(t => ({ name: t.name, emoji: t.emoji, color: t.color, pos: Math.round(t.pos * 10) / 10 })); }
function raceView(base, st) {
  const r = H.race;
  if (!st.demo) raceEnsureTeam(st);
  const k = raceTeamOf(st.id), mine = r.answers[st.id];
  const mates = k >= 0 ? r.teams[k].members.filter(id => id !== st.id).map(id => (H.students.get(id) || {}).name).filter(Boolean).map(nm => nm.replace(/\s\(\d+\)$/, '').split(' ')[0]) : [];
  const v = { ...base, k: 'race', theme: r.theme, phase: r.phase, teams: racePublicTeams(), prev: r.prev ? r.prev.map(p => Math.round(p * 10) / 10) : null,
    myTeam: k, mates, i: r.i, n: r.qs.length, msg: r.msg, myRight: r.myCorrect[st.id] || 0, last: !!r.lastQ };
  if (r.phase === 'question' || r.phase === 'reveal') { v.q = r.pub; v.mine = mine ? mine.raw : null; }
  if (r.phase === 'question' && r.endAt) v.left = Math.max(0, Math.round(r.endAt - performance.now()));
  if (r.phase === 'reveal' || (r.phase === 'won' && r.i >= 0)) {
    v.my = { answered: !!mine, correct: !!(mine && mine.correct), answer: raceQ() ? correctText(raceQ()) : '' };
    if (k >= 0) v.teamGain = Math.round(r.teams[k].gain * 10) / 10;
  }
  if (r.phase === 'won') { v.winner = r.winner; v.winText = r.winText; }
  return v;
}
function raceEnd() { H.race.active = false; broadcastView(); renderHostStage(); renderHostSide(); }
function renderRaceStage(stage) {
  const r = H.race, th = RACE_THEMES[r.theme], q = raceQ();
  stage.append(raceScene({ teams: racePublicTeams(), phase: r.phase, myTeam: -1 }, r.prev));
  r.prev = r.teams.map(t => t.pos);
  const panel = el('div', { class: 'q-card race-panel' });
  const btn = (label, fn, cls) => el('button', { class: 'btn ' + (cls || ''), onclick: fn }, label);
  const roster = el('div', { class: 'race-teams' }, r.teams.map(t => el('div', { class: 'race-team', style: 'border-color:' + t.color },
    el('strong', null, t.emoji + ' Team ' + t.name + ' '), el('span', { class: 'muted' }, th.where(t.pos)),
    el('div', { class: 'sname race-members' }, t.members.map(id => (H.students.get(id) || {}).name).filter(Boolean).join(', ') || '—'))));
  if (r.phase === 'teams') {
    panel.append(el('div', { class: 'q-text' }, th.icon + ' ' + th.title + ': ' + r.teams.length + ' teams, ' + r.qs.length + ' questions. First team to ' + th.goalName + ' wins!'), roster,
      el('div', { class: 'spin-buttons' }, btn('🔀 Shuffle teams', () => { const o = r.opts; raceStart(o); }), btn('🏁 Start the race', raceNext, 'btn-sun'), btn('End race', raceEnd, 'btn-ghost')));
  } else if (r.phase === 'question') {
    panel.append(el('div', { class: 'tag' }, 'Question ' + (r.i + 1) + ' of ' + r.qs.length + ' · ' + TYPE_LABEL[q.type]), el('div', { class: 'q-text', text: q.text }),
      el('div', { class: 'host-q-meta' }, el('span', { class: 'count-pill', id: 'race-answered' }, Object.keys(r.answers).filter(id => !isDemoId(id)).length + ' of ' + onlineStudents().length + ' answered'),
        r.endAt ? el('span', { class: 'timer-pill', id: 'race-timer' }, '') : null, btn('Show the answer now', raceReveal), btn('End race', raceEnd, 'btn-ghost')));
  } else if (r.phase === 'reveal') {
    panel.append(el('div', { class: 'tag' }, 'Question ' + (r.i + 1) + ' of ' + r.qs.length), el('div', { class: 'q-text', text: q.text }),
      el('p', null, el('strong', null, 'Answer: '), correctText(q)),
      el('div', { class: 'race-gains' }, r.teams.map(t => el('span', { class: 'count-pill', style: 'background:' + t.color + '22' }, t.emoji + ' ' + Math.round((t.lastPct || 0) * 100) + '% right'))),
      r.msg.length ? el('div', { class: 'race-msg' }, r.msg.map(m => el('p', null, m))) : null,
      el('div', { class: 'spin-buttons' }, btn(r.lastQ ? 'See who wins' : 'Next question ▶', raceNext, 'btn-primary'), btn('End race', raceEnd, 'btn-ghost')));
  } else {
    panel.append(el('div', { class: 'q-text' }, r.winText), roster,
      el('div', { class: 'spin-buttons' }, btn('🔁 Race again (new teams)', () => raceStart(r.opts), 'btn-sun'), btn('End race', raceEnd, 'btn-primary')));
    setTimeout(() => confetti($('#h-stage .race-scene')), 600);
  }
  stage.append(panel);
}

/* ---------- student ---------- */
function buildRaceView(v) {
  const th = RACE_THEMES[v.theme], box = el('div', { class: 'race-student' });
  const t = v.myTeam >= 0 ? v.teams[v.myTeam] : null;
  if (t) box.append(el('div', { class: 'race-myteam', style: 'border-color:' + t.color },
    el('strong', null, 'You’re on ' + t.emoji + ' Team ' + t.name + '!'), v.mates.length ? el('span', { class: 'muted' }, ' With ' + v.mates.join(', ')) : null));
  box.append(raceScene(v, S.racePrev && S.racePrev.length === v.teams.length ? S.racePrev : v.prev));
  S.racePrev = v.teams.map(x => x.pos);
  if (v.phase === 'teams') box.append(msgCard(th.icon, th.title, 'Work with your team. The first team to reach ' + th.goalName + ' wins!'));
  else if (v.phase === 'question') {
    const card = buildStudentQ({ ...v, k: 'q', phase: v.mine != null ? 'closed' : 'open', mine: v.mine });
    card.prepend(el('div', { class: 'boss-qtop' }, el('span', { class: 'tag' }, 'Question ' + (v.i + 1) + ' of ' + v.n), v.left != null ? el('span', { class: 'timer-pill', id: 'race-st-timer' }, '⏱ ' + fmtTime(v.left)) : null));
    if (v.mine != null) { const p = [...card.querySelectorAll('p.muted')].pop(); if (p) p.textContent = 'Locked in! Waiting for your team…'; }
    box.append(card);
    clearInterval(S.raceTimerT);
    if (v.left != null) { const end = Date.now() + v.left; S.raceTimerT = setInterval(() => { const x = $('#race-st-timer'); if (!x) { clearInterval(S.raceTimerT); return; } x.textContent = '⏱ ' + fmtTime(end - Date.now()); }, 250); }
  } else if (v.phase === 'reveal') {
    const my = v.my || {};
    box.append(el('div', { class: 'q-card' },
      el('div', { class: 'result-mine big' }, my.correct ? '✓ You got it! That helps your team.' : my.answered ? 'Not this time. The answer: ' + my.answer : 'No answer this time. The answer: ' + my.answer),
      t ? el('p', { class: 'boss-result' }, t.emoji + ' Your team is now ' + th.where(t.pos) + '.') : null,
      v.msg.length ? el('div', { class: 'race-msg' }, v.msg.map(m => el('p', null, m))) : null));
  } else {
    const won = v.winner === v.myTeam;
    box.append(msgCard(won ? '🏆' : '🌊', v.winText, (won ? 'Your team won! ' : 'Great diving! ') + 'You got ' + v.myRight + ' right' + (t ? ', and your team reached ' + th.where(t.pos) + '.' : '.')));
    if (won) setTimeout(() => confetti(box.querySelector('.race-scene')), 600);
  }
  return box;
}

/* =====================================================================
   11. TEACHER MODE: PIN, DASHBOARD
   ===================================================================== */
function openTeacher() {
  if (H) return;
  if (S.active) { toast('Leave the class first to open Teacher Mode.'); return; }
  if (ssGet(KEYS.teacherOk, false)) { enterDash(); return; }
  $('#pin-overlay').hidden = false; $('#pin-input').value = ''; $('#pin-error').textContent = ''; $('#pin-input').focus();
}
function checkPin(e) {
  e.preventDefault();
  const lock = lsGet(KEYS.pinLock, { fails: 0, until: 0 }), err = $('#pin-error');
  if (Date.now() < lock.until) { err.textContent = 'Too many tries. Try again in ' + Math.ceil((lock.until - Date.now()) / 1000) + ' seconds.'; return; }
  if ($('#pin-input').value === TEACHER_PIN) {
    lsSet(KEYS.pinLock, { fails: 0, until: 0 }); ssSet(KEYS.teacherOk, true);
    $('#pin-overlay').hidden = true; enterDash(); return;
  }
  lock.fails = (lock.fails || 0) + 1;
  if (lock.fails >= 5) { lock.until = Date.now() + 30000; lock.fails = 0; err.textContent = 'Too many tries. Try again in 30 seconds.'; }
  else err.textContent = 'That PIN isn’t right. ' + (5 - lock.fails) + ' tries left.';
  lsSet(KEYS.pinLock, lock); $('#pin-input').value = '';
}
let currentTab = 'lessons';
async function enterDash(tab) {
  show('screen-dash'); setTab(tab || currentTab);
  const snap = ssGet(KEYS.host, null), banner = $('#resume-banner');
  banner.hidden = !snap; banner.replaceChildren();
  if (snap) banner.append(el('span', null, 'A session with code ', el('strong', { text: snap.code }), ' was interrupted.'),
    el('button', { class: 'btn btn-primary', onclick: () => resumeHost(snap) }, 'Resume session'),
    el('button', { class: 'btn btn-ghost', onclick: () => { ssDel(KEYS.host); banner.hidden = true; } }, 'Discard'));
}
async function resumeHost(snap) {
  let lesson = snap.lessonId === 'quick' ? quickLesson() : await Lessons.get(snap.lessonId).catch(() => null);
  if (!lesson) { toast('That lesson is no longer saved here.'); ssDel(KEYS.host); enterDash(); return; }
  startHost(lesson, snap);
}
function quickLesson() { return { id: 'quick', name: 'Activities-only session', items: [] }; }
function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('#screen-dash .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  ['lessons', 'sets', 'report', 'settings'].forEach(t => { $('#tab-' + t).hidden = t !== tab; });
  ({ lessons: renderLessons, sets: renderSets, report: renderReport, settings: renderSettings })[tab]();
}
function fileButton(label, accept, onFile, multiple) {
  const inp = el('input', { type: 'file', accept, hidden: true, multiple: !!multiple });
  inp.addEventListener('change', () => { const f = [...inp.files]; inp.value = ''; if (f.length) onFile(multiple ? f : f[0]); });
  return el('label', { class: 'btn' }, inp, label);
}
async function beginSession(lesson) {
  const old = lsGet(KEYS.report, null);
  if (old && Object.keys(old.students || {}).length) {
    if (!(await confirmBox('Start a new session?', 'This replaces the current report on this device. Download it first from the Report tab if you need it.', 'Start new session'))) return;
  }
  lsSet(KEYS.report, null);
  startHost(lesson, null);
}

/* ---- Lessons tab ---- */
async function renderLessons() {
  const p = $('#tab-lessons'); p.replaceChildren();
  p.append(el('div', { class: 'toolbar' },
    el('button', { class: 'btn btn-primary', onclick: newLesson }, 'New lesson'),
    fileButton('Import lesson', '.json,application/json', importLesson),
    el('button', { class: 'btn', onclick: () => beginSession(quickLesson()) }, 'Activities-only session')));
  let all = [];
  try { all = await Lessons.all(); } catch { p.append(el('p', { class: 'error' }, 'This browser blocked lesson storage. Try a normal (not private) window.')); return; }
  all.sort((a, b) => b.updated - a.updated);
  if (!all.length) { p.append(el('div', { class: 'empty' }, 'No lessons yet. Choose “New lesson” and add your exported slides.')); return; }
  const ul = el('ul', { class: 'item-list' });
  all.forEach(l => {
    const n = l.items.length, slides = l.items.filter(i => i.kind === 'slide').length;
    ul.append(el('li', null,
      el('div', { class: 'grow' }, el('div', { class: 'name', text: l.name }), el('div', { class: 'muted', text: n + ' items · ' + slides + ' slides · edited ' + new Date(l.updated).toLocaleDateString() })),
      el('button', { class: 'btn btn-primary', onclick: () => beginSession(l) }, 'Start'),
      el('button', { class: 'btn', onclick: () => openBuilder(l.id) }, 'Edit'),
      el('button', { class: 'btn', onclick: async () => { const v = await askText('Rename lesson', l.name); if (v) { l.name = v; await Lessons.put(l); renderLessons(); } } }, 'Rename'),
      el('button', { class: 'btn', onclick: async () => { const c = { ...l, id: uid(), name: l.name + ' (copy)', items: l.items.map(i => ({ ...i, id: uid() })) }; await Lessons.put(c); renderLessons(); } }, 'Duplicate'),
      el('button', { class: 'btn', onclick: () => exportLesson(l) }, 'Export'),
      el('button', { class: 'btn btn-danger', onclick: async () => { if (await confirmBox('Delete “' + l.name + '”?', 'This can’t be undone. Export it first to keep a copy.')) { await Lessons.del(l.id); renderLessons(); } } }, 'Delete')));
  });
  p.append(ul);
}
async function newLesson() {
  const name = await askText('New lesson', '', 'Lesson name'); if (!name) return;
  const l = { id: uid(), name, items: [], updated: Date.now() };
  await Lessons.put(l); openBuilder(l.id);
}
async function exportLesson(l) {
  toast('Preparing lesson file…');
  const items = [];
  for (const it of l.items) {
    const { blob, img, bg, ...rest } = it;
    if (blob) rest.data = await blobToDataURL(blob);
    if (img) rest.imgData = await blobToDataURL(img);
    if (bg) rest.bgData = await blobToDataURL(bg);
    items.push(rest);
  }
  download(l.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.sidekick-lesson.json',
    JSON.stringify({ app: APP, kind: 'lesson', version: 1, name: l.name, items }), 'application/json');
}
function cleanZones(z) {
  if (!Array.isArray(z)) return [];
  const n = v => Math.max(0, Math.min(10000, Math.round(Number(v) || 0)));
  return z.slice(0, 8).map(q => ({ x: n(q.x), y: n(q.y), w: n(q.w), h: n(q.h), l: cleanText(q.l, 30), correct: !!q.correct }));
}
function okImg(s) { return typeof s === 'string' && /^data:image\/(webp|jpeg|png);base64,/.test(s); }
async function importLesson(file) {
  try {
    if (file.size > 60 * 1024 * 1024) throw new Error('That file is too large.');
    const d = JSON.parse(await file.text());
    if (d.app !== APP || d.kind !== 'lesson' || !Array.isArray(d.items)) throw new Error('This isn’t a Sidekick Live lesson file.');
    const items = [];
    for (const it of d.items.slice(0, 200)) {
      const base = { id: uid(), notes: cleanText(it.notes, 1000), read: cleanText(it.read, 600), signup: !!it.signup };
      if (it.kind === 'slide' && typeof it.data === 'string' && /^data:image\/(webp|jpeg|png);base64,/.test(it.data)) {
        const blob = await (await fetch(it.data)).blob(); items.push({ ...base, kind: 'slide', blob, w: +it.w || 0, h: +it.h || 0 });
      } else if (it.kind === 'text') items.push({ ...base, kind: 'text', title: cleanText(it.title, 120), body: cleanText(it.body, 2000) });
      else if (it.kind === 'check') items.push({ ...base, kind: 'check', prompt: cleanText(it.prompt, 200) });
      else if (it.kind === 'q' && it.q) items.push({ ...base, kind: 'q', q: normalizeQuestion({ ...it.q, question: it.q.text }), signup: !!it.signup,
        ...(okImg(it.imgData) ? { img: await (await fetch(it.imgData)).blob(), imgW: +it.imgW || 0, imgH: +it.imgH || 0 } : {}) });
      else if (it.kind === 'dots') items.push({ ...base, kind: 'dots', prompt: cleanText(it.prompt, 200), showZones: it.showZones !== false, zones: cleanZones(it.zones),
        ...(okImg(it.bgData) ? { bg: await (await fetch(it.bgData)).blob(), bgW: +it.bgW || 0, bgH: +it.bgH || 0 } : { bg: null }) });
      else if (it.kind === 'draw') items.push({ ...base, kind: 'draw', prompt: cleanText(it.prompt, 200), signup: !!it.signup,
        ...(okImg(it.bgData) ? { bg: await (await fetch(it.bgData)).blob(), bgW: +it.bgW || 0, bgH: +it.bgH || 0 } : { bg: null }) });
    }
    await Lessons.put({ id: uid(), name: cleanText(d.name, 60) || 'Imported lesson', items, updated: Date.now() });
    toast('Lesson imported.'); renderLessons();
  } catch (e) { toast('Import failed: ' + e.message); }
}

/* ---- Question sets tab ---- */
function renderSets() {
  const p = $('#tab-sets'); p.replaceChildren();
  p.append(el('div', { class: 'toolbar' },
    el('button', { class: 'btn btn-primary', onclick: async () => { const n = await askText('New question set', '', 'Set name'); if (n) { const all = Sets.all(); all.push({ id: uid(), name: n, questions: [] }); Sets.save(all); renderSets(); } } }, 'New set'),
    fileButton('Import (.json or .csv)', '.json,.csv,application/json,text/csv', f => importSetFile(f, null)),
    el('button', { class: 'btn', onclick: downloadTemplate }, 'Download question template')));
  const all = Sets.all();
  if (!all.length) { p.append(el('div', { class: 'empty' }, 'No question sets yet. Use the same question template as your classroom games: fill it in, download it as CSV, then choose “Import”.')); return; }
  const ul = el('ul', { class: 'item-list' });
  all.forEach(set => {
    const details = el('details', { class: 'grow' }, el('summary', null, el('span', { class: 'name', text: set.name }), ' ', el('span', { class: 'muted', text: set.questions.length + ' questions' })),
      el('ol', { class: 'q-preview' }, set.questions.map((q, i) => el('li', null, el('span', { class: 'tag', text: TYPE_LABEL[q.type] }), ' ', q.text, ' ',
        el('button', { class: 'btn btn-small btn-danger', 'aria-label': 'Delete question ' + (i + 1), onclick: async () => { if (await confirmBox('Delete this question?', q.text)) { set.questions.splice(i, 1); saveSet(set); renderSets(); } } }, '✕')))));
    ul.append(el('li', null, details,
      fileButton('Add from CSV', '.csv,text/csv', f => importSetFile(f, set.id)),
      el('button', { class: 'btn', onclick: async () => { const v = await askText('Rename set', set.name); if (v) { set.name = v; saveSet(set); renderSets(); } } }, 'Rename'),
      el('button', { class: 'btn', onclick: () => { const all2 = Sets.all(); all2.push({ ...set, id: uid(), name: set.name + ' (copy)', questions: set.questions.map(q => ({ ...q, id: uid(8) })) }); Sets.save(all2); renderSets(); } }, 'Duplicate'),
      el('button', { class: 'btn', onclick: () => download(fileSafe(set.name) + '.json', JSON.stringify({ app: APP, kind: 'set', name: set.name, questions: set.questions }, null, 1), 'application/json') }, 'Export .json'),
      el('button', { class: 'btn', onclick: () => download(fileSafe(set.name) + '.csv', questionsToCSV(set)) }, 'Export .csv'),
      el('button', { class: 'btn btn-danger', onclick: async () => { if (await confirmBox('Delete “' + set.name + '”?', 'Lessons that already use its questions keep their copies.')) { Sets.save(Sets.all().filter(s => s.id !== set.id)); renderSets(); } } }, 'Delete')));
  });
  p.append(ul);
}
function fileSafe(s) { return String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'set'; }
function saveSet(set) { const all = Sets.all(); const i = all.findIndex(s => s.id === set.id); if (i >= 0) all[i] = set; else all.push(set); Sets.save(all); }
function downloadTemplate() { download('sidekick-live-question-template.csv', toCSV(CSV_TEMPLATE)); }
function formatErrorBox(detail) {
  openModal((card, close) => card.append(
    el('h2', null, '⚠️ Incorrect format'),
    el('p', null, 'This file doesn’t match the question template. Please download the template above, fill it in, and import it again.'),
    detail ? el('p', { class: 'muted', text: detail }) : null,
    el('div', { class: 'spin-buttons' },
      el('button', { class: 'btn btn-primary', onclick: () => { downloadTemplate(); close(); } }, 'Download question template'),
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Close'))));
}
async function importSetFile(file, intoId) {
  let text = '';
  try {
    if (file.size > 2 * 1024 * 1024) { formatErrorBox('That file is too large for a question set.'); return; }
    if (/\.xlsx?$/i.test(file.name)) { formatErrorBox('This is an Excel file. In Excel or Google Sheets, download the Questions tab as a CSV file first.'); return; }
    text = await file.text();
  } catch { formatErrorBox(); return; }
  let incoming = [], errors = [], name = file.name.replace(/\.(csv|json)$/i, '');
  try {
    if (/\.json$/i.test(file.name) || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      const d = JSON.parse(text);
      const raw = Array.isArray(d) ? d : (d.questions || []);
      if (d.name) name = cleanText(d.name, 60);
      raw.forEach((q, i) => { try { incoming.push(normalizeQuestion({ ...q, question: q.question ?? q.text })); } catch (e) { errors.push('Question ' + (i + 1) + ': ' + e.message); } });
    } else ({ questions: incoming, errors } = questionsFromCSV(text));
  } catch (e) { formatErrorBox(e.format ? null : 'The file could not be read.'); return; }
  const rowList = () => el('ul', null, errors.slice(0, 20).map(e => el('li', { text: e })), errors.length > 20 ? el('li', null, '…and ' + (errors.length - 20) + ' more') : null);
  if (!incoming.length) {
    openModal((card, close) => card.append(el('h2', null, '⚠️ Incorrect format: nothing was imported'),
      el('p', null, 'None of the rows match the question template. Please download the template above, check each row’s Check column says OK, and import it again.'),
      errors.length ? rowList() : null,
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => { downloadTemplate(); close(); } }, 'Download question template'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Close'))));
    return;
  }
  if (intoId) { const set = Sets.get(intoId); set.questions.push(...incoming); saveSet(set); }
  else { const all = Sets.all(); all.push({ id: uid(), name, questions: incoming }); Sets.save(all); }
  renderSets();
  if (errors.length) openModal((card, close) => card.append(el('h2', null, 'Imported ' + incoming.length + ' questions'),
    el('p', null, errors.length + ' row(s) were skipped because they don’t match the template. Fix these rows (their Check column should say OK) and import them again:'),
    rowList(),
    el('div', { class: 'spin-buttons' }, el('button', { class: 'btn btn-primary', onclick: () => close() }, 'OK'))));
  else toast('Imported ' + incoming.length + ' questions.');
}

/* ---- Report tab ---- */
function reportRows(r) {
  const qs = r.questions.slice().sort((a, b) => a.n - b.n);
  const studs = Object.entries(r.students).sort((a, b) => naturalSort(a[1].name, b[1].name));
  const detail = [['Student', 'Question #', 'Type', 'Question', 'Answer', 'Correct', 'Time']];
  const summary = [['Student', 'Questions answered', 'Correct', 'Percent correct', 'Times shared on mic', 'Check-ins']];
  for (const [sid, s] of studs) {
    let answered = 0, correct = 0, ungraded = 0;
    for (const q of qs) {
      const a = (r.answers[q.qid] || {})[sid];
      if (a) { answered++; if (a.correct) correct++; }
      const graded = q.type !== 'draw' && q.graded !== false;
      if (a && !graded) answered--, ungraded++;
      detail.push([s.name, q.label || q.n, TYPE_LABEL[q.type], q.text, a ? a.a : '(no answer)', a && graded ? (a.correct ? 'Yes' : 'No') : '', a ? new Date(a.t).toLocaleTimeString() : '']);
    }
    const checks = Object.values(r.checkins || {}).map(c => c.votes[sid]).filter(Boolean).map(v => (CHECKIN.find(c => c.v === v) || {}).label);
    summary.push([s.name, answered + ungraded, correct, answered ? Math.round(100 * correct / answered) + '%' : '', s.shared || 0, checks.join(', ')]);
  }
  for (const m of r.manual || []) summary.push([m.name + ' (added by teacher)', '', '', '', m.shared || 0, '']);
  return { detail, summary };
}
function tableFrom(rows) {
  return el('div', { class: 'table-wrap' }, el('table', null,
    el('thead', null, el('tr', null, rows[0].map(h => el('th', { text: h })))),
    el('tbody', null, rows.slice(1).map(r => el('tr', null, r.map((c, i) => el('td', { class: rows[0][i] === 'Correct' ? (c === 'Yes' ? 'ok' : c === 'No' ? 'no' : '') : '', text: String(c) })))))));
}
function renderReport() {
  const p = $('#tab-report'); p.replaceChildren();
  const r = lsGet(KEYS.report, null);
  if (!r || !Object.keys(r.students || {}).length) { p.append(el('div', { class: 'empty' }, 'No report yet. Reports appear here after a session with students.')); return; }
  const { detail, summary } = reportRows(r);
  const stamp = dateStamp();
  p.append(el('h2', null, 'Report: ' + r.lesson), el('p', { class: 'muted', text: 'Started ' + new Date(r.started).toLocaleString() + ' · room ' + r.code + ' · saved on this device only' }),
    el('div', { class: 'toolbar' },
      el('button', { class: 'btn btn-primary', onclick: () => download('sidekick-live-answers-' + stamp + '.csv', toCSV(detail)) }, 'Download answers CSV'),
      el('button', { class: 'btn', onclick: () => download('sidekick-live-summary-' + stamp + '.csv', toCSV(summary)) }, 'Download summary CSV'),
      r.questions.some(q => q.type === 'draw') ? el('button', { class: 'btn', onclick: async () => {
        const lesson = r.lessonId ? await Lessons.get(r.lessonId).catch(() => null) : null;
        downloadDrawings(r.questions.filter(q => q.type === 'draw').map(q => q.qid), r, lesson || { items: [] });
      } }, '⬇ Download drawings') : null,
      el('button', { class: 'btn btn-danger', onclick: async () => { if (await confirmBox('Delete this report?', 'Download the CSVs first if you need them. This can’t be undone.')) { localStorage.removeItem(KEYS.report); renderReport(); } } }, 'Delete report')),
    el('h3', null, 'Summary'), tableFrom(summary), el('h3', null, 'Answers'), tableFrom(detail));
}

/* ---- Settings tab ---- */
function renderSettings() {
  const p = $('#tab-settings'); p.replaceChildren();
  const rate = el('select', { id: 'set-rate' }, [[150, 'Gentle (best for slow home internet)'], [375, 'Normal (recommended)'], [750, 'Fast (strong school or office internet)']].map(([v, t]) => el('option', { value: v }, t)));
  rate.value = String([150, 375, 750].includes(settings.rateKB) ? settings.rateKB : 375);
  const mode = el('select', { id: 'set-mode' }, el('option', { value: 'round' }, 'Everyone gets a turn first'), el('option', { value: 'weighted' }, 'Weighted (all stay in)'));
  mode.value = settings.spinMode;
  const save = () => { settings.rateKB = Number(rate.value); settings.spinMode = mode.value; lsSet(KEYS.settings, { rateKB: settings.rateKB, spinMode: settings.spinMode }); toast('Settings saved.'); };
  rate.addEventListener('change', save); mode.addEventListener('change', save);
  p.append(el('div', { class: 'q-card' },
    el('label', { for: 'set-rate' }, 'Slide sending speed'), rate,
    el('p', { class: 'muted' }, 'How fast slides travel from your computer to students before and during class. “Normal” uses about 3 Mbps of your upload and leaves room for Class video.'),
    el('label', { for: 'set-mode' }, 'Share spinner default'), mode,
    el('p', { class: 'muted' }, 'The Teacher PIN is set in script.js. Lessons, question sets and reports are saved only in this browser on this device.')), gamesSettings(),
    el('div', { class: 'q-card' }, el('h3', null, '📄 Family help sheet'), el('p', { class: 'muted' }, 'Steps for students and Learning Coaches when Sidekick Live won’t connect, ending with “watch in LL.” Send it to families before class or post it on your class page.'),
      el('button', { class: 'btn', onclick: () => downloadHelp('') }, '⬇ Download the help sheet')));
}

/* =====================================================================
   12. LESSON BUILDER
   ===================================================================== */
let B = null;   // { lesson, urls: [] }
async function openBuilder(id) {
  const lesson = await Lessons.get(id); if (!lesson) { toast('Lesson not found.'); return; }
  B = { lesson, urls: [], saveT: null };
  show('screen-builder'); $('#bld-title').textContent = lesson.name; $('#bld-status').textContent = '';
  renderBuilder();
}
function saveLessonSoon() {
  clearTimeout(B.saveT);
  B.saveT = setTimeout(() => Lessons.put(B.lesson).then(() => { $('#bld-status').textContent = 'Saved'; }).catch(() => { $('#bld-status').textContent = 'Could not save — storage may be full.'; }), 400);
  $('#bld-status').textContent = 'Saving…';
}
function renderBuilder() {
  B.urls.forEach(u => URL.revokeObjectURL(u)); B.urls = [];
  const list = $('#bld-list'); list.replaceChildren();
  const items = B.lesson.items;
  const blobUrl = b => { const u = URL.createObjectURL(b); B.urls.push(u); return u; };
  if (!items.length) list.append(el('li', { class: 'empty', style: 'display:block' }, 'Add your exported slides (images or a PDF), then add questions, drawing questions and check-ins between them.'));
  items.forEach((it, i) => {
    let thumb;
    if (it.kind === 'slide') thumb = el('img', { class: 'thumb', src: blobUrl(it.blob), alt: 'Slide ' + (i + 1) });
    else if (it.kind === 'draw') thumb = it.bg ? el('div', { class: 'thumb thumb-draw' }, el('img', { src: blobUrl(it.bg), alt: '' }), el('span', null, '✏️ Drawing')) : el('div', { class: 'thumb' }, '✏️ Drawing (blank)');
    else if (it.kind === 'dots') thumb = it.bg ? el('div', { class: 'thumb thumb-draw' }, el('img', { src: blobUrl(it.bg), alt: '' }), el('span', null, '📍 Dot map')) : el('div', { class: 'thumb' }, '📍 Dot map');
    else if (it.kind === 'q' && it.img) thumb = el('div', { class: 'thumb thumb-draw' }, el('img', { src: blobUrl(it.img), alt: '' }), el('span', null, '❓ ' + TYPE_LABEL[it.q.type]));
    else thumb = el('div', { class: 'thumb' }, { text: '📝 Text slide', q: '❓ ' + TYPE_LABEL[it.q && it.q.type], check: '😀 Check-in' }[it.kind]);
    const fields = el('div', { class: 'bld-fields' });
    const field = (label, key, multi, max) => {
      const inp = el(multi ? 'textarea' : 'input', { maxlength: max || 600, rows: multi ? 2 : null }); inp.value = it[key] || '';
      inp.addEventListener('input', () => { it[key] = inp.value; saveLessonSoon(); });
      fields.append(el('label', null, label), inp);
    };
    if (it.kind === 'text') { field('Title', 'title', false, 120); field('Text', 'body', true, 2000); }
    if (it.kind === 'check') field('Check-in question', 'prompt', false, 200);
    if (it.kind === 'draw') field('Drawing question (what students should draw or mark)', 'prompt', false, 200);
    if (it.kind === 'dots') {
      field('Dot map question (what students should tap)', 'prompt', false, 200);
      const sz = el('input', { type: 'checkbox' }); sz.checked = it.showZones !== false; sz.addEventListener('change', () => { it.showZones = sz.checked; saveLessonSoon(); });
      fields.append(el('div', { class: 'row-inline' }, el('button', { class: 'btn btn-small', onclick: () => editZones(it) }, '▭ Edit areas (' + (it.zones || []).length + ')'),
        el('label', { class: 'check small' }, sz, 'Students see the areas')));
    }
    if (it.kind === 'q') {
      fields.append(el('div', null, el('span', { class: 'tag', text: TYPE_LABEL[it.q.type] }), ' ', it.q.text));
      fields.append(el('div', { class: 'row-inline' }, it.img
        ? el('button', { class: 'btn btn-small', onclick: () => { delete it.img; delete it.imgW; delete it.imgH; saveLessonSoon(); renderBuilder(); } }, 'Remove picture')
        : fileButton('🖼 Add picture', 'image/*', async f => { try { const bmp = await createImageBitmap(f); const r = await toSlideBlob(bmp, bmp.width, bmp.height, 960, 0.8); it.img = r.blob; it.imgW = r.w; it.imgH = r.h; saveLessonSoon(); renderBuilder(); } catch { toast('Could not read that picture.'); } })));
    }
    if (it.kind === 'slide' || it.kind === 'text' || it.kind === 'draw' || it.kind === 'dots') field('Read-aloud text (students tap 🔊)', 'read', true, 600);
    field('Teacher notes (only you see these)', 'notes', true, 1000);
    const su = el('input', { type: 'checkbox' }); su.checked = !!it.signup;
    su.addEventListener('change', () => { it.signup = su.checked; saveLessonSoon(); });
    fields.append(el('label', { class: 'check small' }, su, '✋ Open share sign-up when I get here'));
    const move = (dd) => { const j = i + dd; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; saveLessonSoon(); renderBuilder(); };
    list.append(el('li', null, thumb, fields, el('div', { class: 'bld-actions' },
      el('button', { class: 'btn btn-small', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, '▲'),
      el('button', { class: 'btn btn-small', 'aria-label': 'Move down', disabled: i === items.length - 1, onclick: () => move(1) }, '▼'),
      it.kind === 'slide' ? el('button', { class: 'btn btn-small', title: 'Add a drawing question right after this slide, with this slide as the picture', onclick: () => {
        items.splice(i + 1, 0, { id: uid(), kind: 'draw', prompt: 'Mark up this slide.', bg: it.blob, bgW: it.w, bgH: it.h, read: '', notes: '' });
        saveLessonSoon(); renderBuilder(); toast('Drawing question added after this slide.'); } }, '✏️ Draw on it') : null,
      it.kind === 'slide' ? el('button', { class: 'btn btn-small', title: 'Add a dot map right after this slide, using this slide', onclick: () => addDotsModal(it) }, '📍 Dot map on it') : null,
      el('button', { class: 'btn btn-small btn-danger', 'aria-label': 'Remove item', onclick: () => { items.splice(i, 1); saveLessonSoon(); renderBuilder(); } }, '✕'))));
  });
}
function addDrawModal() {
  const slides = B.lesson.items.filter(x => x.kind === 'slide');
  openModal((card, close) => {
    const prompt = el('input', { maxlength: 200, value: '' }); prompt.value = 'Draw your answer.';
    let bg = null, bgW = 0, bgH = 0, mode = 'blank';
    const opts = el('div', { class: 'spin-opts' });
    const choose = el('div');
    const radio = (v, label) => { const r = el('input', { type: 'radio', name: 'draw-bg', value: v }); if (v === mode) r.checked = true; r.addEventListener('change', () => { mode = v; paint(); }); return el('label', { class: 'check small' }, r, label); };
    opts.append(radio('blank', 'Blank page'), slides.length ? radio('slide', 'One of my slides') : null, radio('image', 'A picture from my computer'));
    const paint = () => {
      choose.replaceChildren();
      if (mode === 'slide') {
        const sel = el('select', { 'aria-label': 'Which slide' }, slides.map((s, k) => el('option', { value: String(k) }, 'Slide ' + (B.lesson.items.indexOf(s) + 1))));
        const set = () => { const s = slides[+sel.value]; bg = s.blob; bgW = s.w; bgH = s.h; };
        sel.addEventListener('change', set); set(); choose.append(sel);
      } else if (mode === 'image') {
        bg = null;
        choose.append(fileButton('Choose picture', 'image/*', async f => { try { const bmp = await createImageBitmap(f); const r = await toSlideBlob(bmp, bmp.width, bmp.height); bg = r.blob; bgW = r.w; bgH = r.h; toast('Picture ready.'); } catch { toast('Could not read that picture.'); } }));
      } else bg = null;
    };
    paint();
    card.append(el('h2', null, 'Add a drawing question'), el('label', null, 'What should students draw or mark?'), prompt,
      el('label', null, 'Background'), opts, choose,
      el('div', { class: 'spin-buttons' },
        el('button', { class: 'btn btn-primary', onclick: () => {
          if (mode !== 'blank' && !bg) { toast('Choose a picture first.'); return; }
          B.lesson.items.push({ id: uid(), kind: 'draw', prompt: cleanText(prompt.value, 200).trim() || 'Draw your answer.', bg: mode === 'blank' ? null : bg, bgW, bgH, read: '', notes: '' });
          saveLessonSoon(); renderBuilder(); close(); toast('Drawing question added at the end. Use ▲ to move it.');
        } }, 'Add'),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}
async function addSlideFiles(files) {
  const status = $('#bld-status');
  const imgs = files.filter(f => f.type.startsWith('image/')).sort((a, b) => naturalSort(a.name, b.name));
  const pdfs = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  let added = 0;
  try {
    for (const f of imgs) { status.textContent = 'Preparing image ' + (added + 1) + ' of ' + imgs.length + '…'; const s = await imageFileToSlide(f); B.lesson.items.push({ id: uid(), kind: 'slide', blob: s.blob, w: s.w, h: s.h, read: '', notes: '' }); added++; }
    for (const f of pdfs) {
      const slides = await pdfToSlides(f, (i, n) => { status.textContent = 'Reading PDF page ' + i + ' of ' + n + '…'; });
      for (const s of slides) { B.lesson.items.push({ id: uid(), kind: 'slide', blob: s.blob, w: s.w, h: s.h, read: '', notes: '' }); added++; }
    }
  } catch (e) { toast(e.message || 'Could not read that file.'); }
  const slides = B.lesson.items.filter(i => i.kind === 'slide');
  if (slides.length > 60) toast('Heads up: ' + slides.length + ' slides is a lot to send to 60 students. About 60 or fewer works best.');
  saveLessonSoon(); renderBuilder();
  const kb = Math.round(slides.reduce((a, s) => a + s.blob.size, 0) / 1024);
  status.textContent = 'Added ' + added + ' slide' + (added === 1 ? '' : 's') + '. Deck size: ' + (kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB') + ' per student.';
}
function addQuestionsModal() {
  const sets = Sets.all().filter(s => s.questions.length);
  if (!sets.length) { toast('Import a question set first (Question sets tab).'); return; }
  openModal((card, close) => {
    const pick = el('select', { 'aria-label': 'Question set' }, sets.map(s => el('option', { value: s.id }, s.name)));
    const list = el('div', { class: 'spot-list' });
    const draw = () => { const set = sets.find(s => s.id === pick.value); list.replaceChildren(...set.questions.map((q, i) => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: String(i) }), el('span', null, el('span', { class: 'tag', text: TYPE_LABEL[q.type] }), ' ', q.text)))); };
    pick.addEventListener('change', draw); draw();
    card.append(el('h2', null, 'Add questions'), pick, list, el('div', { class: 'spin-buttons' },
      el('button', { class: 'btn btn-primary', onclick: () => {
        const set = sets.find(s => s.id === pick.value);
        const idx = [...list.querySelectorAll('input:checked')].map(c => +c.value);
        if (!idx.length) { toast('Tick at least one question.'); return; }
        idx.forEach(i => B.lesson.items.push({ id: uid(), kind: 'q', q: JSON.parse(JSON.stringify(set.questions[i])), notes: '' }));
        saveLessonSoon(); renderBuilder(); close(); toast('Added ' + idx.length + ' question' + (idx.length === 1 ? '' : 's') + ' at the end. Use ▲ to move them.');
      } }, 'Add selected'),
      el('button', { class: 'btn', onclick: () => list.querySelectorAll('input').forEach(c => { c.checked = true; }) }, 'Select all'),
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel')));
  });
}

/* =====================================================================
   13. STARTUP & EVENT WIRING
   ===================================================================== */
function init() {
  applyPrefs();
  $('#pref-big').checked = !!prefs.big; $('#pref-read').checked = !!prefs.read;
  $('#pref-big').addEventListener('change', e => { prefs.big = e.target.checked; lsSet(KEYS.prefs, prefs); applyPrefs(); });
  $('#pref-read').addEventListener('change', e => { prefs.read = e.target.checked; lsSet(KEYS.prefs, prefs); });

  // Teacher Mode: Alt+Shift+T or triple-click the top-left corner
  let clicks = 0, ct;
  // invisible bottom-left corner (same as the game bank); listens on the page so it never blocks taps
  document.addEventListener('click', e => {
    if (e.clientX > 40 || e.clientY < window.innerHeight - 40) { clicks = 0; return; }
    clicks++; clearTimeout(ct); ct = setTimeout(() => { clicks = 0; }, 700);
    if (clicks >= 3) { clicks = 0; openTeacher(); }
  });
  document.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && e.code === 'KeyT') { e.preventDefault(); openTeacher(); return; }
    if (H && !$('#screen-host').hidden && $('#spin-overlay').hidden && $('#spot-overlay').hidden && $('#modal-overlay').hidden && $('#tools-overlay').hidden && $('#game-host').hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); hostGo(H.pos + 1); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); hostGo(H.pos - 1); }
    }
  });
  $('#pin-form').addEventListener('submit', checkPin);
  $('#pin-cancel').addEventListener('click', () => { $('#pin-overlay').hidden = true; });

  // Join form
  const code = $('#join-code');
  code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const c = code.value.trim().toUpperCase(), f = $('#join-first').value.trim(), i = $('#join-initial').value.trim();
    const err = $('#join-error');
    if (c.length !== 4 || [...c].some(ch => !CODE_CHARS.includes(ch))) { err.textContent = 'Check the 4-letter room code. Codes never use O, 0, I, 1, L, S, 5, Z, 2, B or 8.'; return; }
    if (!makeName(f, i)) { err.textContent = 'Type your first name and the first letter of your last name.'; return; }
    if (typeof Peer === 'undefined') { err.textContent = 'Sidekick Live couldn’t load. Check your internet and refresh.'; return; }
    err.textContent = ''; $('#join-btn').disabled = true;
    studentJoin(c, f, i, null);
  });

  // Student dock
  $('#st-vol').addEventListener('click', toggleVol);
  document.querySelectorAll('.rx').forEach(b => b.addEventListener('click', () => {
    const now = Date.now(); if (now - S.lastRx < 3000) return;
    if (sendHost({ t: 'rx', e: b.dataset.e })) {
      S.lastRx = now; document.querySelectorAll('.rx').forEach(x => { x.disabled = true; });
      setTimeout(() => document.querySelectorAll('.rx').forEach(x => { x.disabled = false; }), 3000);
    }
  }));
  const step = d => {
    if (!S.deck.length) return;
    let cur = S.reviewIdx;
    if (cur == null) { cur = S.deck.indexOf(S.view && S.view.sid); if (cur < 0) cur = d < 0 ? S.deck.length : -1; }
    S.reviewIdx = Math.min(S.deck.length - 1, Math.max(0, cur + d)); renderStudent();
  };
  $('#st-prev').addEventListener('click', () => step(-1));
  $('#st-next').addEventListener('click', () => step(1));
  $('#st-follow').addEventListener('click', () => { S.reviewIdx = null; renderStudent(); });
  document.addEventListener('visibilitychange', () => {
    if (!S.active || S.leaving) return;
    sendHost({ t: 'vis', h: document.hidden });
    if (!document.hidden) reconnectNow();
  });
  window.addEventListener('online', () => { if (S.active) reconnectNow(); });

  // Dashboard
  document.querySelectorAll('#screen-dash .tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  $('#dash-exit').addEventListener('click', () => { ssDel(KEYS.teacherOk); show('screen-join'); });
  $('#bld-back').addEventListener('click', () => { if (B) { clearTimeout(B.saveT); Lessons.put(B.lesson).finally(() => enterDash('lessons')); } });
  $('#bld-start').addEventListener('click', async () => { clearTimeout(B.saveT); await Lessons.put(B.lesson); beginSession(B.lesson); });
  $('#bld-files').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) addSlideFiles(f); });
  $('#bld-add-text').addEventListener('click', () => { B.lesson.items.push({ id: uid(), kind: 'text', title: '', body: '', read: '', notes: '' }); saveLessonSoon(); renderBuilder(); });
  $('#bld-add-check').addEventListener('click', () => { B.lesson.items.push({ id: uid(), kind: 'check', prompt: 'How are you feeling about this?', notes: '' }); saveLessonSoon(); renderBuilder(); });
  $('#bld-add-q').addEventListener('click', addQuestionsModal);

  // Host controls
  $('#h-prev').addEventListener('click', () => hostGo(H.pos - 1));
  $('#h-next').addEventListener('click', () => hostGo(H.pos + 1));
  $('#h-end').addEventListener('click', endSession);
  $('#h-safe').addEventListener('change', e => document.body.classList.toggle('safe', e.target.checked));
  $('#h-pause').addEventListener('click', e => toggleFlag('paused', e.currentTarget));
  $('#h-look').addEventListener('click', e => toggleFlag('look', e.currentTarget));
  $('#h-review').addEventListener('click', e => toggleFlag('review', e.currentTarget));
  $('#h-signup').addEventListener('click', () => setSignup(!H.signup));
  $('#h-tools').addEventListener('click', () => openTools());
  $('#h-wb').addEventListener('click', () => wbStart());
  $('#h-gametime').addEventListener('click', openGameLauncher);
  $('#h-boss').addEventListener('click', bossSetup);
  $('#h-race').addEventListener('click', raceSetup);
  $('#h-game').addEventListener('click', () => showGameHost(true));
  $('#game-host-back').addEventListener('click', () => showGameHost(false));
  $('#game-host-end').addEventListener('click', endGame);
  window.addEventListener('message', onGameMessage);
  $('#h-timer').addEventListener('click', () => openTools('timer'));
  $('#h-score').addEventListener('click', () => openTools('score'));
  $('#tools-close').addEventListener('click', closeTools);
  document.querySelectorAll('#tools-tabs .tab').forEach(b => b.addEventListener('click', () => { toolsTab = b.dataset.tool; renderTools(); }));
  $('#bld-add-draw').addEventListener('click', addDrawModal);
  $('#bld-add-dots').addEventListener('click', () => addDotsModal(null));
  $('#h-spin-open').addEventListener('click', openSpinner);
  $('#h-spot-open').addEventListener('click', openSpotlight);
  const copyBtn = el('button', { class: 'btn btn-small', onclick: () => {
    const link = joinURL() + '?room=' + H.code;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Join link copied — paste it in the LL chat.'), () => toast(link));
  } }, 'Copy join link');
  $('.join-info').append(' ', copyBtn, ' ', el('button', { class: 'btn btn-small', title: 'Open a pretend student in its own window to share in LL', onclick: openDemoStudent }, '🧸 Demo student'));

  // Spinner overlay (teacher)
  $('#spin-go').addEventListener('click', doSpin);
  $('#spin-skip').addEventListener('click', skipPick);
  $('#spin-close').addEventListener('click', closeSpinner);
  $('#spin-reset').addEventListener('click', () => { H.spin.round = []; renderSpinPool(); saveHostSnap(); toast('New round: everyone can be picked again.'); });
  document.querySelectorAll('input[name="spin-mode"]').forEach(r => r.addEventListener('change', () => { H.spin.mode = r.value; renderSpinPool(); saveHostSnap(); }));
  $('#spin-headsup').addEventListener('change', e => { H.spin.headsUp = e.target.checked; saveHostSnap(); });
  $('#spin-showpool').addEventListener('change', e => { H.spin.showPool = e.target.checked; saveHostSnap(); });
  $('#spin-add').addEventListener('submit', e => {
    e.preventDefault(); const v = cleanText($('#spin-add-name').value, 24).trim(); if (!v) return;
    H.manual.push({ id: 'm-' + uid(6), name: v, shared: 0 }); $('#spin-add-name').value = '';
    renderSpinPool(); renderHostSide(); saveHostSnap();
  });
  $('#spot-show').addEventListener('click', showSpotlight);
  $('#spot-hide').addEventListener('click', hideSpotlight);
  $('#spot-close').addEventListener('click', () => { $('#spot-overlay').hidden = true; });

  window.addEventListener('beforeunload', e => { if (H && !H.ended) { saveReport(); e.preventDefault(); e.returnValue = ''; } });

  // Where do we start?
  const room = QS.get('room'); if (room) code.value = room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (QS.get('demo') === '1' && /^[A-Z0-9]{4}$/i.test(QS.get('room') || '')) { startDemoStudent(QS.get('room').toUpperCase()); return; }
  const saved = ssGet(KEYS.student, null);
  if (saved && saved.room && saved.first) { studentJoin(saved.room, saved.first, saved.initial, saved.token); return; }
  const snap = ssGet(KEYS.host, null);
  if (snap && ssGet(KEYS.teacherOk, false)) { resumeHost(snap); return; }
  show('screen-join');
  if (typeof Peer === 'undefined') { $('#join-error').textContent = 'Sidekick Live couldn’t load its connection tool. '; $('#join-error').append(el('button', { class: 'btn btn-small', type: 'button', onclick: openHelpModal }, 'What to try')); }
  $('#join-help').addEventListener('click', openHelpModal);
}

// For automated tests only: read-only peek at state.
window.SidekickLive = { host: () => H, student: () => S };
init();
