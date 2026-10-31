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
  settings: NS + 'settings', host: NS + 'hostsession', student: NS + 'student', teacherOk: NS + 'teacherok'
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
const TYPE_LABEL = { mc: 'Multiple choice', tf: 'True/False', type: 'Type the answer', wordbank: 'Word bank', order: 'Put in order', match: 'Match', sort: 'Sort' };
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
    case 'match': { const pr = pairs(q); p.lefts = pr.map(x => x[0]); p.rights = shuffle([...new Set(pr.map(x => x[1]))]); break; }
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
  if (head.includes('type') && head.includes('question')) {
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
  lastRx: 0, pendingAns: null, ackQid: null, stars: 0
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
function setConn(state, text) { const p = $('#st-conn'); p.dataset.state = state; p.textContent = text; }
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
    c.send({ t: 'hello', v: 1, token: S.token, first: S.first, initial: S.initial, have: completeSids() });
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
      $('#spin-overlay').hidden = true;
      if (S.pendingAns) { sendHost(S.pendingAns); }
      break;
    case 'reject':
      failJoin(m.why === 'full' ? 'This class is full. Tell your teacher.' : 'Please type your first name and last initial.');
      break;
    case 'view':
      S.view = m; if (!m.review) S.reviewIdx = null;
      if (S.pendingAns && !(m.k === 'q' && m.q.qid === S.pendingAns.qid && m.phase === 'open')) S.pendingAns = null;
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
  }
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
    if (v && ((v.k === 'slide' && v.sid === m.sid) || (S.reviewIdx != null && S.deck[S.reviewIdx] === m.sid))) renderStudent();
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
  if (!v) {
    if (!S.everConnected && S.firstTimer && performanceWaitedLong()) {
      stage.append(msgCard('📡', 'Still trying to reach your class',
        'Your internet may be blocking the connection. Keep this page open — it keeps trying. You can still join in on Class: use reactions and raise your hand, and your teacher can add you to the share spinner.'));
    } else stage.append(msgCard('⏳', 'Joining your class…', 'Hang on a moment.'));
    return;
  }
  if (v.k === 'end') { stage.append(msgCard('👋', 'Class is over!', 'Great work today. You can close this page.')); S.leaving = true; ssDel(KEYS.student); try { S.peer && S.peer.destroy(); } catch { /* ignore */ } setConn('ok', 'Finished'); return; }
  if (v.paused) { stage.append(msgCard('👀', 'Eyes on your teacher', 'Your screen will come back soon.')); return; }
  if (v.look) { stage.append(msgCard('📺', 'Look at Class', 'Your teacher is showing something in Class right now.')); return; }

  if (v.review && S.reviewIdx != null && S.deck.length) {
    stage.append(slideEl(S.deck[S.reviewIdx]));
    stage.append(el('p', { class: 'muted' }, 'Reviewing slide ' + (S.reviewIdx + 1) + ' of ' + S.deck.length));
  } else {
    switch (v.k) {
      case 'wait': stage.append(msgCard('⏳', 'You’re in!', 'Waiting for your teacher…')); break;
      case 'slide':
        stage.append(slideEl(v.sid, v.read));
        if (prefs.read && v.read) stage.append(readBtn(() => v.read));
        break;
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
    items.map(i => el('div', { class: 'spot-item' }, i.by ? el('span', { class: 'by', text: i.by }) : el('span', { class: 'by', text: 'A classmate' }), i.text)));
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
  const n = $('#q-sent'); if (!n || !S.view || S.view.k !== 'q') return;
  if (S.ackQid === S.view.q.qid) n.textContent = 'Answer sent ✓ You can change it until results are shown.';
}
function buildStudentQ(v) {
  const q = v.q, locked = v.phase !== 'open';
  const card = el('div', { class: 'q-card' });
  card.append(el('div', { class: 'q-text', text: q.type === 'wordbank' ? 'Fill in the blanks.' : q.text }));
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
  } else if (q.type === 'wordbank') {
    const n = q.parts.length - 1;
    const fill = new Array(n).fill(null);        // {word, ci}
    const used = new Set();
    if (Array.isArray(mine)) mine.forEach((w, i) => { const ci = q.bank.findIndex((b, j) => b === w && !used.has(j)); if (ci >= 0 && i < n) { fill[i] = { word: w, ci }; used.add(ci); } });
    let target = null;
    const sentence = el('div', { class: 'wb-sentence' }); const bank = el('div', { class: 'bank', role: 'group', 'aria-label': 'Word bank' });
    const draw = () => {
      sentence.replaceChildren(); bank.replaceChildren();
      const nextEmpty = target != null ? target : fill.findIndex(f => !f);
      q.parts.forEach((p, i) => {
        sentence.append(p);
        if (i < n) sentence.append(el('button', { class: 'blank' + (i === nextEmpty && !locked ? ' next' : ''), type: 'button', disabled: locked,
          'aria-label': fill[i] ? 'Blank ' + (i + 1) + ': ' + fill[i].word + '. Tap to clear.' : 'Blank ' + (i + 1) + ', empty',
          onclick: () => { if (fill[i]) { used.delete(fill[i].ci); fill[i] = null; target = i; } else target = i; draw(); } }, fill[i] ? fill[i].word : '\u00a0'));
      });
      q.bank.forEach((w, ci) => bank.append(el('button', { class: 'chip', type: 'button', disabled: locked || used.has(ci),
        onclick: () => { const slot = target != null && !fill[target] ? target : fill.findIndex(f => !f); if (slot < 0) return; fill[slot] = { word: w, ci }; used.add(ci); target = null; draw(); } }, w)));
    };
    draw(); body.append(sentence, bank);
    getAnswer = () => fill.map(f => f && f.word); complete = () => fill.every(Boolean);
  } else if (q.type === 'order') {
    let order = Array.isArray(mine) && mine.length === q.items.length ? mine.slice() : q.items.slice();
    const list = el('ol', { class: 'order-list' });
    const draw = (focusIdx, dir) => {
      list.replaceChildren();
      order.forEach((it, i) => list.append(el('li', null, el('span', null, it),
        el('button', { class: 'btn', type: 'button', 'aria-label': 'Move ' + it + ' up', disabled: locked || i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(i - 1, 'up'); } }, '▲'),
        el('button', { class: 'btn', type: 'button', 'aria-label': 'Move ' + it + ' down', disabled: locked || i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(i + 1, 'down'); } }, '▼'))));
      if (focusIdx != null) { const b = list.children[focusIdx].querySelectorAll('button')[dir === 'up' ? 0 : 1]; if (b && !b.disabled) b.focus(); else list.children[focusIdx].querySelector('button:not(:disabled)')?.focus(); }
    };
    draw(); body.append(list);
    getAnswer = () => order.slice(); complete = () => true;
  } else if (q.type === 'match') {
    const sel = {};
    q.lefts.forEach(l => {
      const s = el('select', { 'aria-label': 'Match for ' + l, disabled: locked },
        el('option', { value: '' }, 'Choose…'), q.rights.map(r => el('option', { value: r }, r)));
      if (mine && mine[l]) s.value = mine[l];
      sel[l] = s; body.append(el('div', { class: 'pair-row' }, el('span', { class: 'left' }, l), s));
    });
    getAnswer = () => { const o = {}; for (const l of q.lefts) o[l] = sel[l].value; return o; };
    complete = () => q.lefts.every(l => sel[l].value);
  } else if (q.type === 'sort') {
    const pick = {};
    q.items.forEach(it => {
      if (mine && mine[it]) pick[it] = mine[it];
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Group for ' + it });
      const btns = q.groups.map(g => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pick[it] === g), disabled: locked,
        onclick: () => { pick[it] = g; btns.forEach((b, k) => b.setAttribute('aria-pressed', String(q.groups[k] === g))); } }, g));
      seg.append(...btns);
      body.append(el('div', { class: 'sort-row' }, el('div', { class: 'item' }, it), seg));
    });
    getAnswer = () => ({ ...pick }); complete = () => q.items.every(it => pick[it]);
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
      res.append(hideBtn());
    });
  } else if (m.ph === 'ready-open') {
    clearInterval(studentSpinTimer);
    vis.replaceChildren(el('div', { class: 'mystery', 'aria-hidden': 'true' }, '🎤'));
    const b = el('button', { class: 'vol-toggle', 'aria-pressed': String(S.vol), onclick: () => { toggleVol(); b.setAttribute('aria-pressed', String(S.vol)); } },
      el('span', { class: 'vol-box', 'aria-hidden': 'true' }), el('span', null, 'I’d like to share on the mic 🎤'));
    res.replaceChildren(el('span', { class: 'sub' }, 'The share spinner is open.'), b, hideBtn());
  } else if (m.ph === 'skip') {
    res.replaceChildren(el('span', { class: 'sub' }, 'Let’s spin again!'));
  }
}
function hideBtn() { return el('div', null, el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { $('#spin-overlay').hidden = true; } }, 'Back to the lesson')); }
function toggleVol() {
  S.vol = !S.vol; renderVol();
  if (!sendHost({ t: 'vol', on: S.vol })) { S.vol = !S.vol; renderVol(); toast('Not connected yet — try again in a moment.'); }
  else toast(S.vol ? 'You’re on the share list 🎤' : 'You’re off the share list.');
}
function youCard() { return el('div', { class: 'you-card' }, 'That’s you! 🎤 Go to Class and unmute when your teacher says. Come back here after.'); }
function studentYou() {
  S.you = true;
  if (S.spinDone) $('#spin-result').append(youCard());
  if (prefs.read) speak('That is you! Go to Class and unmute when your teacher says.');
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
    report: null, netState: 'connecting', ended: false, ticker: null, reconnTimer: null
  };
  H.report = snap ? (lsGet(KEYS.report, null) || newReport(lesson, H.code)) : newReport(lesson, H.code);
  if (snap) for (const s of snap.students || []) {
    const st = mkStudent(s.id, s.token, s.name); st.vol = !!s.vol; st.shared = s.shared || 0;
    H.students.set(st.id, st); H.byToken.set(st.token, st);
  }
  for (const it of H.items) {
    if (it.kind !== 'slide' || !it.blob) continue;
    const buf = new Uint8Array(await it.blob.arrayBuffer());
    let pv = null; try { pv = await makePreview(it.blob); } catch { /* preview is optional */ }
    const pbuf = pv ? new Uint8Array(await pv.arrayBuffer()) : null;
    H.slideData.set(it.id, { buf, size: buf.length, mime: it.blob.type || 'image/webp', pbuf, psize: pbuf ? pbuf.length : 0, pmime: pv ? pv.type : '' });
    H.urls.set(it.id, URL.createObjectURL(it.blob));
    H.sids.push(it.id);
  }
  document.body.classList.remove('safe'); $('#h-safe').checked = false;
  show('screen-host');
  updateHostHeader();
  hostConnectPeer(0);
  H.ticker = makeTicker(250, hostTick);
  const it = currentItem(); if (it && it.kind === 'q') { if (!H.phase[it.id]) H.phase[it.id] = 'open'; ensureReportQuestion(it); }
  renderHostStage(); renderHostSide(); saveReport(); saveHostSnap();
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
function onlineStudents() { return [...H.students.values()].filter(s => s.online); }
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
    case 'vol': if (st.vol !== !!m.on) { st.vol = !!m.on; H.rosterDirty = true; renderSpinPool(); saveHostSnap(); } break;
    case 'rx': hostReaction(st, m.e); break;
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
  if (!H.report.students[st.id]) H.report.students[st.id] = { name: st.name, shared: st.shared };
  if (st.conn && st.conn !== conn) { const old = st.conn; old._sk.st = null; try { old.close(); } catch { /* ignore */ } }
  st.conn = conn; conn._sk.st = st; conn._sk.hello = true;
  st.online = true; st.lastSeen = Date.now(); st.hidden = false; st.quiet = false;
  st.have = new Set((Array.isArray(m.have) ? m.have : []).filter(x => H.slideData.has(x)));
  st.sent = new Map(); st.havePrev = new Set(); st.sentPrev = new Map();
  send(st, { t: 'welcome', id: st.id, token: st.token, name: st.name, deck: H.sids, vol: st.vol, stars: H.stars });
  send(st, viewMsg(st));
  send(st, liveMsg());
  if (H.spotlight) send(st, { t: 'spot', items: H.spotlight });
  H.rosterDirty = true; H.liveDirty = true; H.deckDirty = true; H.reportDirty = true;
  renderSpinPool(); saveHostSnap();
}

/* ---- views ---- */
function currentItem() { return H.items[H.pos] || null; }
function getPub(it) { if (!H.pub[it.id]) H.pub[it.id] = publicQ(it.q, it.id); return H.pub[it.id]; }
function resultsFor(it) {
  const ans = H.report.answers[it.id] || {}; const recs = Object.values(ans);
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
  const base = { t: 'view', paused: H.paused, look: H.look, review: H.review, pos: H.pos, total: H.items.length };
  if (H.ended) return { t: 'view', k: 'end' };
  const it = currentItem();
  if (!it) return { ...base, k: 'wait' };
  switch (it.kind) {
    case 'slide': return { ...base, k: 'slide', sid: it.id, read: it.read || '' };
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
  if (it && it.kind === 'q') answered = Object.keys(H.report.answers[it.id] || {}).length;
  return { t: 'live', answered, online: onlineStudents().length, stars: H.stars, rx: H.rx };
}

/* ---- student actions ---- */
function ensureReportQuestion(it) {
  if (H.report.questions.some(q => q.qid === it.id)) return;
  const n = H.items.filter(x => x.kind === 'q').indexOf(it) + 1;
  H.report.questions.push({ qid: it.id, n, type: it.q.type, text: it.q.text });
  H.reportDirty = true;
}
function hostAnswer(st, m) {
  const it = currentItem();
  if (!it || it.kind !== 'q' || m.qid !== it.id || (H.phase[it.id] || 'open') !== 'open') return;
  const a = sanitizeAnswer(it.q, m.a); if (a == null) return;
  const correct = grade(it.q, a);
  (H.report.answers[it.id] ||= {})[st.id] = { raw: a, a: answerText(it.q, a), correct, t: Date.now() };
  ensureReportQuestion(it);
  send(st, { t: 'ack', qid: it.id });
  H.liveDirty = true; H.reportDirty = true;
  const online = onlineStudents().length, answered = Object.keys(H.report.answers[it.id]).length;
  if (online > 0 && !H.goalHit.has(it.id) && answered / online >= GOAL_PCT) {
    H.goalHit.add(it.id); H.stars++; broadcast({ t: 'star', stars: H.stars }); toast('The class earned a star! ⭐'); saveHostSnap();
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
  const idx = H.items.map((it, i) => (it.kind === 'slide' && H.slideData.has(it.id)) ? i : -1).filter(i => i >= 0);
  const fwd = idx.filter(i => i >= H.pos), back = idx.filter(i => i < H.pos).reverse();
  H._order = [...fwd, ...back].map(i => H.items[i].id); H._orderPos = H.pos;
  return H._order;
}
function pumpSlides(now) {
  const dt = Math.min(1, (now - H.lastTick) / 1000); H.lastTick = now;
  H.bucket = Math.min(H.rate * 0.5, H.bucket + H.rate * dt);
  if (!H.sids.length) return;
  const list = [...H.students.values()].filter(s => s.online && s.conn && s.conn.open && s.have.size < H.sids.length);
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
  const cur = currentItem();
  if (cur && cur.kind === 'slide' && H.slideData.has(cur.id) && !st.have.has(cur.id)) {
    const d = H.slideData.get(cur.id);
    if (d.pbuf && !st.havePrev.has(cur.id) && !st.sent.has(cur.id)) return { sid: cur.id, prev: true, level: 0 };
    return { sid: cur.id, prev: false, level: 1 };
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
  H.pos = pos; H.spotlight = null; H.rx = {}; H.rxDirty = true; H.liveDirty = true;
  const it = currentItem();
  if (it && it.kind === 'q') { if (!H.phase[it.id]) H.phase[it.id] = 'open'; ensureReportQuestion(it); }
  broadcast({ t: 'spot', items: null });
  broadcastView(); renderHostStage(); renderHostSide(); saveHostSnap();
}
function setPhase(ph) {
  const it = currentItem(); if (!it || it.kind !== 'q') return;
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
      manual: H.manual, spin: H.spin, stars: H.stars, goalHit: [...H.goalHit]
    });
  }, 400);
}
function saveReport() {
  if (!H) return;
  for (const st of H.students.values()) H.report.students[st.id] = { name: st.name, shared: st.shared };
  H.report.manual = H.manual.map(m => ({ name: m.name, shared: m.shared }));
  H.reportDirty = false; lsSet(KEYS.report, H.report);
}
async function endSession() {
  if (!(await confirmBox('End this session?', 'Students will see “Class is over.” Your report is saved on this device.', 'End session'))) return;
  H.ended = true; broadcast({ t: 'view', k: 'end' }); saveReport();
  ssDel(KEYS.host);
  if (H.ticker) H.ticker.stop();
  clearTimeout(H.reconnTimer);
  const peer = H.peer;
  for (const u of H.urls.values()) URL.revokeObjectURL(u);
  setTimeout(() => { try { peer && peer.destroy(); } catch { /* ignore */ } }, 1500);
  $('#spin-overlay').hidden = true; $('#spot-overlay').hidden = true;
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
  }
  return '';
}
function hostQPreview(it) {
  const q = it.q, p = getPub(it);
  const card = el('div', { class: 'q-card' }, el('div', { class: 'tag', text: TYPE_LABEL[q.type] }), el('div', { class: 'q-text', text: q.text }));
  const list = p.options || p.items || p.bank || (p.lefts ? p.lefts.map((l, i) => l + '  ·  ' + (p.rights[i] || '')) : null);
  if (list) card.append(el('ul', { class: 'q-preview' }, list.map(x => el('li', { text: x }))));
  if (p.groups) card.append(el('p', { class: 'muted', text: 'Groups: ' + p.groups.join(', ') }));
  return card;
}
function renderHostStage() {
  if (!H) return;
  const stage = $('#h-stage'); stage.replaceChildren();
  stage.classList.toggle('pointing', H.pointer);
  const it = currentItem();
  if (!it) {
    stage.append(msgCard('🎤', 'Activities-only session', 'Use the share spinner, spotlight, pause and reactions. Students see a waiting screen.'));
  } else if (it.kind === 'slide') {
    const frame = el('div', { class: 'slide-frame' });
    const img = el('img', { src: H.urls.get(it.id), alt: 'Current slide' });
    img.addEventListener('click', e => {
      if (!H.pointer) return;
      const r = img.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      broadcast({ t: 'pt', x: +x.toFixed(3), y: +y.toFixed(3) }); showPointer(stage, x, y);
    });
    frame.append(img); stage.append(frame);
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
  if (it && it.kind === 'q') {
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
  const all = [...H.students.values()], on = all.filter(s => s.online);
  const inClass = on.filter(s => s.hidden).length;
  $('#h-count').textContent = on.length + (on.length === 1 ? ' student' : ' students') + (inClass ? ' (' + inClass + ' in Class)' : '');
  if (H.sids.length) {
    const ready = on.filter(s => s.have.size >= H.sids.length).length;
    $('#h-deck').hidden = false; $('#h-deck').textContent = 'Slides ready: ' + ready + '/' + on.length;
  } else $('#h-deck').hidden = true;
  const vols = all.filter(s => s.vol && s.online).length + H.manual.length;
  $('#h-vol-count').textContent = String(vols);
  const ul = $('#h-roster'); ul.replaceChildren();
  all.sort((a, b) => naturalSort(a.name, b.name)).forEach(s => {
    let dot = 'dot', status = '';
    if (!s.online) { dot += ' off'; status = 'left'; }
    else if (s.hidden) { dot += ' away'; status = '🎤 in Class'; }
    else if (s.quiet) { dot += ' away'; status = 'no signal'; }
    ul.append(el('li', null, el('span', { class: dot }), el('span', { class: 'rname', text: s.name }),
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
  const it = currentItem(); const list = $('#spot-list'); list.replaceChildren();
  if (!it || it.kind !== 'q') { list.append(el('p', { class: 'muted' }, 'Spotlight works on a question. Go to a question first.')); }
  else {
    const ans = H.report.answers[it.id] || {};
    const rows = Object.entries(ans).filter(([, r]) => r.a);
    if (!rows.length) list.append(el('p', { class: 'muted' }, 'No answers yet.'));
    rows.forEach(([sid, r]) => {
      const st = H.students.get(sid);
      const cb = el('input', { type: 'checkbox', value: sid });
      list.append(el('label', { class: 'check' }, cb, el('span', null, el('strong', { class: 'sname', text: (st ? st.name : 'Student') + ': ' }), r.a)));
    });
  }
  $('#spot-overlay').hidden = false;
}
function showSpotlight() {
  const it = currentItem(); if (!it || it.kind !== 'q') return;
  const anon = document.querySelector('input[name="spot-mode"]:checked').value === 'anon';
  const ans = H.report.answers[it.id] || {};
  const picked = [...document.querySelectorAll('#spot-list input:checked')].map(c => c.value);
  if (!picked.length) { toast('Tick at least one answer.'); return; }
  H.spotlight = picked.map(sid => {
    const st = H.students.get(sid);
    return { text: ans[sid] ? ans[sid].a : '', by: anon || !st ? null : st.name.replace(/\s\(\d+\)$/, '').split(' ')[0] };
  });
  broadcast({ t: 'spot', items: H.spotlight });
  $('#spot-overlay').hidden = true; toast('Spotlight is showing on student screens.');
}
function hideSpotlight() { H.spotlight = null; broadcast({ t: 'spot', items: null }); $('#spot-overlay').hidden = true; toast('Spotlight hidden.'); }

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
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
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
    if (it.kind === 'slide') { const { blob, ...rest } = it; items.push({ ...rest, data: await blobToDataURL(blob) }); }
    else items.push(it);
  }
  download(l.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.sidekick-lesson.json',
    JSON.stringify({ app: APP, kind: 'lesson', version: 1, name: l.name, items }), 'application/json');
}
async function importLesson(file) {
  try {
    if (file.size > 60 * 1024 * 1024) throw new Error('That file is too large.');
    const d = JSON.parse(await file.text());
    if (d.app !== APP || d.kind !== 'lesson' || !Array.isArray(d.items)) throw new Error('This isn’t a Sidekick Live lesson file.');
    const items = [];
    for (const it of d.items.slice(0, 200)) {
      const base = { id: uid(), notes: cleanText(it.notes, 1000), read: cleanText(it.read, 600) };
      if (it.kind === 'slide' && typeof it.data === 'string' && /^data:image\/(webp|jpeg|png);base64,/.test(it.data)) {
        const blob = await (await fetch(it.data)).blob(); items.push({ ...base, kind: 'slide', blob, w: +it.w || 0, h: +it.h || 0 });
      } else if (it.kind === 'text') items.push({ ...base, kind: 'text', title: cleanText(it.title, 120), body: cleanText(it.body, 2000) });
      else if (it.kind === 'check') items.push({ ...base, kind: 'check', prompt: cleanText(it.prompt, 200) });
      else if (it.kind === 'q' && it.q) items.push({ ...base, kind: 'q', q: normalizeQuestion({ ...it.q, question: it.q.text }) });
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
    el('button', { class: 'btn', onclick: () => download('sidekick-live-question-template.csv', toCSV(CSV_TEMPLATE)) }, 'Download CSV template')));
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
async function importSetFile(file, intoId) {
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('That file is too large.');
    const text = await file.text();
    let incoming = [], errors = [], name = file.name.replace(/\.(csv|json)$/i, '');
    if (/\.json$/i.test(file.name) || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      const d = JSON.parse(text);
      const raw = Array.isArray(d) ? d : (d.questions || []);
      if (d.name) name = cleanText(d.name, 60);
      raw.forEach((q, i) => { try { incoming.push(normalizeQuestion({ ...q, question: q.question ?? q.text })); } catch (e) { errors.push('Question ' + (i + 1) + ': ' + e.message); } });
    } else ({ questions: incoming, errors } = questionsFromCSV(text));
    if (!incoming.length) throw new Error(errors[0] || 'No questions found.');
    if (intoId) { const set = Sets.get(intoId); set.questions.push(...incoming); saveSet(set); }
    else { const all = Sets.all(); all.push({ id: uid(), name, questions: incoming }); Sets.save(all); }
    renderSets();
    if (errors.length) openModal((card, close) => card.append(el('h2', null, 'Imported ' + incoming.length + ' questions'),
      el('p', null, errors.length + ' row(s) were skipped:'), el('ul', null, errors.slice(0, 20).map(e => el('li', { text: e }))),
      el('div', { class: 'spin-buttons' }, el('button', { class: 'btn btn-primary', onclick: () => close() }, 'OK'))));
    else toast('Imported ' + incoming.length + ' questions.');
  } catch (e) { toast('Import failed: ' + e.message); }
}

/* ---- Report tab ---- */
function reportRows(r) {
  const qs = r.questions.slice().sort((a, b) => a.n - b.n);
  const studs = Object.entries(r.students).sort((a, b) => naturalSort(a[1].name, b[1].name));
  const detail = [['Student', 'Question #', 'Type', 'Question', 'Answer', 'Correct', 'Time']];
  const summary = [['Student', 'Questions answered', 'Correct', 'Percent correct', 'Times shared on mic', 'Check-ins']];
  for (const [sid, s] of studs) {
    let answered = 0, correct = 0;
    for (const q of qs) {
      const a = (r.answers[q.qid] || {})[sid];
      if (a) { answered++; if (a.correct) correct++; }
      detail.push([s.name, q.n, TYPE_LABEL[q.type], q.text, a ? a.a : '(no answer)', a ? (a.correct ? 'Yes' : 'No') : '', a ? new Date(a.t).toLocaleTimeString() : '']);
    }
    const checks = Object.values(r.checkins || {}).map(c => c.votes[sid]).filter(Boolean).map(v => (CHECKIN.find(c => c.v === v) || {}).label);
    summary.push([s.name, answered, correct, answered ? Math.round(100 * correct / answered) + '%' : '', s.shared || 0, checks.join(', ')]);
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
    el('p', { class: 'muted' }, 'The Teacher PIN is set in script.js. Lessons, question sets and reports are saved only in this browser on this device.')));
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
  if (!items.length) list.append(el('li', { class: 'empty', style: 'display:block' }, 'Add your exported slides (images or a PDF), then add questions and check-ins between them.'));
  items.forEach((it, i) => {
    let thumb;
    if (it.kind === 'slide') { const u = URL.createObjectURL(it.blob); B.urls.push(u); thumb = el('img', { class: 'thumb', src: u, alt: 'Slide ' + (i + 1) }); }
    else thumb = el('div', { class: 'thumb' }, { text: '📝 Text slide', q: '❓ ' + TYPE_LABEL[it.q && it.q.type], check: '😀 Check-in' }[it.kind]);
    const fields = el('div', { class: 'bld-fields' });
    const field = (label, key, multi, max) => {
      const inp = el(multi ? 'textarea' : 'input', { maxlength: max || 600, rows: multi ? 2 : null }); inp.value = it[key] || '';
      inp.addEventListener('input', () => { it[key] = inp.value; saveLessonSoon(); });
      fields.append(el('label', null, label), inp);
    };
    if (it.kind === 'text') { field('Title', 'title', false, 120); field('Text', 'body', true, 2000); }
    if (it.kind === 'check') field('Check-in question', 'prompt', false, 200);
    if (it.kind === 'q') fields.append(el('div', null, el('span', { class: 'tag', text: TYPE_LABEL[it.q.type] }), ' ', it.q.text));
    if (it.kind === 'slide' || it.kind === 'text') field('Read-aloud text (students tap 🔊)', 'read', true, 600);
    field('Teacher notes (only you see these)', 'notes', true, 1000);
    const move = (d) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; saveLessonSoon(); renderBuilder(); };
    list.append(el('li', null, thumb, fields, el('div', { class: 'bld-actions' },
      el('button', { class: 'btn btn-small', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, '▲'),
      el('button', { class: 'btn btn-small', 'aria-label': 'Move down', disabled: i === items.length - 1, onclick: () => move(1) }, '▼'),
      el('button', { class: 'btn btn-small btn-danger', 'aria-label': 'Remove item', onclick: () => { items.splice(i, 1); saveLessonSoon(); renderBuilder(); } }, '✕'))));
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
    if (H && !$('#screen-host').hidden && $('#spin-overlay').hidden && $('#spot-overlay').hidden && $('#modal-overlay').hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
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
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
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
  $('#h-pointer').addEventListener('click', e => { H.pointer = !H.pointer; e.currentTarget.setAttribute('aria-pressed', String(H.pointer)); $('#h-stage').classList.toggle('pointing', H.pointer); if (H.pointer) toast('Click the slide to point.'); });
  $('#h-spin-open').addEventListener('click', openSpinner);
  $('#h-spot-open').addEventListener('click', openSpotlight);
  const copyBtn = el('button', { class: 'btn btn-small', onclick: () => {
    const link = joinURL() + '?room=' + H.code;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Join link copied — paste it in Class chat.'), () => toast(link));
  } }, 'Copy join link');
  $('.join-info').append(' ', copyBtn);

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
  const saved = ssGet(KEYS.student, null);
  if (saved && saved.room && saved.first) { studentJoin(saved.room, saved.first, saved.initial, saved.token); return; }
  const snap = ssGet(KEYS.host, null);
  if (snap && ssGet(KEYS.teacherOk, false)) { resumeHost(snap); return; }
  show('screen-join');
  if (typeof Peer === 'undefined') $('#join-error').textContent = 'Sidekick Live couldn’t load. Check your internet and refresh.';
}

// For automated tests only: read-only peek at state.
window.SidekickLive = { host: () => H, student: () => S };
init();
