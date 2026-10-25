// Solid to SCAD web app: load the default export, add one changed export per value, learn what
// each value moves, preview, and export one .scad.

import {
  parseSTL, indexMesh, openEdgeCount, bounds, simplifyMesh, coordinateTables,
  applyChanges, safeRange, exportLearnedScad,
} from './src/core/index.js';
import { Viewer } from './viewer.js';

const SPACING = 5;
const GOOD_FIT = 0.05;  // mm: within this the learned change reproduces the changed export
const BAD_FIT = 0.5;    // mm: beyond this the change is not something the app can learn
const KEEP = 0.05;      // no gap between coordinates may shrink below 5% of its default length
const SUGGEST_KEEP = 0.25; // suggested ranges keep at least a quarter, so they stay useful
const $ = id => document.getElementById(id);

const state = {
  parts: [],   // {id, name, fileName, mesh, tables, index, open, error}
  params: [],  // {id, name, base, variant, min, max, step, rangeEdited, preview, slots: {partId: Slot}}
};
// Slot: {fileName, mesh, status: 'learning'|'done'|'error', progress, learned, error}

let nextId = 1;
const viewer = new Viewer($('view'));

// ---------- learning (in a worker, one job at a time) ----------

const worker = new Worker(new URL('./learn-worker.js', import.meta.url), { type: 'module' });
const jobs = new Map();
let queue = Promise.resolve();

worker.onmessage = ({ data }) => {
  const job = jobs.get(data.id);
  if (!job) return;
  if ('progress' in data) { job.onProgress(data.progress); return; }
  jobs.delete(data.id);
  if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
};

function learn(base, variant, onProgress) {
  const run = () => new Promise((resolve, reject) => {
    const id = nextId++;
    jobs.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, base, variant });
  });
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---------- loading ----------

async function readMesh(file) {
  return indexMesh(parseSTL(await file.arrayBuffer()));
}

async function addParts(files) {
  files = [...files].filter(f => /\.stl$/i.test(f.name));
  if (!files.length) return;
  for (const file of files) {
    setStatus(`Reading ${file.name}…`);
    const part = { id: nextId++, name: uniquePartName(partName(file.name)), fileName: file.name };
    try {
      const raw = await readMesh(file);
      part.open = openEdgeCount(raw);
      if (part.open) throw new Error(`has ${part.open} open edges. Export it as a closed solid.`);
      setStatus(`Simplifying ${file.name}…`);
      part.mesh = await simplifyMesh(raw);
      Object.assign(part, coordinateTables(part.mesh));
    } catch (e) {
      part.error = e.message;
    }
    state.parts.push(part);
  }
  setStatus('');
  viewer.reset();
  renderAll();
}

async function setSlot(param, part, file) {
  const slot = { fileName: file.name, status: 'learning', progress: 0 };
  param.slots[part.id] = slot;
  renderParams();
  try {
    const mesh = await readMesh(file);
    const open = openEdgeCount(mesh);
    if (open) throw new Error(`has ${open} open edges. Export it as a closed solid.`);
    slot.learned = await learn(
      { points: part.mesh.points, faces: part.mesh.faces },
      { points: mesh.points, faces: mesh.faces },
      p => { slot.progress = p; refreshSlot(param, part); },
    );
    slot.status = 'done';
  } catch (e) {
    slot.status = 'error';
    slot.error = e.message;
  }
  if (param.slots[part.id] !== slot) return; // replaced while learning
  suggestRange(param);
  renderParams();
  renderExport();
  updateView();
}

// Turn "Box v2 (parametric).stl" into "box", and keep part names unique.
function partName(fileName) {
  let n = fileName.replace(/\.stl$/i, '').toLowerCase();
  n = n.replace(/\b(parametric|stl|v\d+|default)\b/g, ' ').trim();
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  n = words.join('_') || 'part';
  return /^\d/.test(n) ? `part_${n}` : n;
}

function uniquePartName(base, except) {
  let name = base, i = 2;
  while (state.parts.some(p => p !== except && p.name === name)) name = `${base}_${i++}`;
  return name;
}

// Match dropped files to parts by shared words in the file names.
function matchFiles(files) {
  const words = s => new Set(s.toLowerCase().replace(/\.stl$/, '').split(/[^a-z]+/).filter(w => w.length > 1));
  const parts = usableParts();
  const pairs = [];
  const used = new Set();
  for (const file of files) {
    const fw = words(file.name);
    let best = null, bestScore = -1;
    for (const part of parts) {
      if (used.has(part.id)) continue;
      const pw = new Set([...words(part.fileName), ...words(part.name)]);
      const score = [...fw].filter(w => pw.has(w)).length;
      if (score > bestScore) { best = part; bestScore = score; }
    }
    if (best) { used.add(best.id); pairs.push([best, file]); }
  }
  return pairs;
}

function usableParts() { return state.parts.filter(p => p.mesh); }

// ---------- parameters ----------

function addParam(init = {}) {
  const n = state.params.length + 1;
  const param = {
    id: nextId++, name: init.name ?? `value_${n}`, base: init.base ?? null, variant: init.variant ?? null,
    min: null, max: null, step: null, rangeEdited: false, preview: null, slots: {},
  };
  state.params.push(param);
  renderAll();
  return param;
}

const learnedSlots = param => usableParts()
  .map(part => ({ part, slot: param.slots[part.id] }))
  .filter(({ slot }) => slot?.status === 'done' && slot.learned.fit.max <= BAD_FIT);

const valuesSet = p => Number.isFinite(p.base) && Number.isFinite(p.variant) && p.base !== p.variant;

function niceStep(delta) {
  const d = Math.abs(delta);
  return d >= 10 ? 0.5 : d >= 1 ? 0.1 : d >= 0.1 ? 0.01 : 0.001;
}

// Range of s (0 = default export, 1 = changed export) where no part folds.
function safeAmounts(param, keep = KEEP) {
  let lo = -Infinity, hi = Infinity;
  for (const { slot } of learnedSlots(param)) {
    const [a, b] = safeRange(slot.learned.tables, slot.learned.delta, keep);
    lo = Math.max(lo, a); hi = Math.min(hi, b);
  }
  return [lo, hi];
}

// Default Customizer range: as far as the model can go without folding, up to 2x the example
// change below the default and 3x above it.
function suggestRange(param) {
  if (param.rangeEdited || !valuesSet(param) || !learnedSlots(param).length) return;
  const d = param.variant - param.base;
  const step = niceStep(d);
  const [lo, hi] = safeAmounts(param, SUGGEST_KEEP);
  const sLo = Math.max(lo, -2), sHi = Math.min(hi, 3);
  let a = param.base + sLo * d, b = param.base + sHi * d;
  if (a > b) [a, b] = [b, a];
  const round = (v, f) => +(f(v / step) * step).toFixed(6);
  param.step = step;
  param.min = round(a, Math.ceil);
  param.max = round(b, Math.floor);
  if (param.preview === null) param.preview = param.base;
}

const amount = (param, value) => (value - param.base) / (param.variant - param.base);

function problems(param) {
  const out = [];
  const err = text => out.push({ level: 'error', text });
  const warn = text => out.push({ level: 'warn', text });
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(param.name)) err('The name can only use letters, digits and _, and cannot start with a digit.');
  if (state.params.some(q => q !== param && q.name === param.name)) err('Another value has the same name.');
  if (!valuesSet(param)) err(param.base === param.variant && Number.isFinite(param.base)
    ? 'The default and changed values are the same.' : 'Enter the default value and the changed value.');
  const slots = Object.values(param.slots);
  if (!slots.length) err('Add the changed export of at least one part.');
  if (slots.some(s => s.status === 'learning')) err('Still comparing the exports…');
  for (const part of usableParts()) {
    const s = param.slots[part.id];
    if (s?.status === 'error') err(`${part.name}: ${s.fileName} ${s.error}`);
    if (s?.status === 'done' && s.learned.fit.max > BAD_FIT) {
      err(`${part.name}: the changed export can't be reached by moving and stretching the default one ` +
        `(off by up to ${fmt(s.learned.fit.max)} mm). This happens when a value changes how many of something ` +
        'there are, rotates or bends something, or the files are different models.');
    } else if (s?.status === 'done' && s.learned.fit.max > GOOD_FIT) {
      warn(`${part.name}: close but not exact (off by up to ${fmt(s.learned.fit.max)} mm). ` +
        'Check the preview, especially at the ends of the range.');
    }
  }
  if (valuesSet(param) && learnedSlots(param).length && [param.min, param.max, param.step].every(Number.isFinite)) {
    if (!(param.min < param.max) || param.step <= 0) err('The range needs min < max and a positive step.');
    else if (param.min > param.base || param.max < param.base) err('The range must include the default value.');
    else {
      const [lo, hi] = safeAmounts(param);
      const sMin = Math.min(amount(param, param.min), amount(param, param.max));
      const sMax = Math.max(amount(param, param.min), amount(param, param.max));
      if (sMin < lo - 1e-9 || sMax > hi + 1e-9) {
        const v = s => fmt(param.base + s * (param.variant - param.base));
        const [a, b] = [v(lo), v(hi)].map(Number).sort((x, y) => x - y);
        err(`Parts would fold inside out outside ${Number.isFinite(a) ? a : '−∞'} to ${Number.isFinite(b) ? b : '∞'}. Narrow the range.`);
      }
    }
  }
  return out;
}

// Parameters that change the same part can fold it together even when each is safe alone:
// check every gap at the worst corner of all the ranges.
function comboProblems(params) {
  const out = [];
  for (const part of usableParts()) {
    const ps = params.filter(p => p.slots[part.id]?.status === 'done');
    if (ps.length < 2) continue;
    const ranges = ps.map(p => [amount(p, p.min), amount(p, p.max)]);
    let bad = false;
    for (let k = 0; k < 3 && !bad; k++) {
      const t = part.tables[k];
      for (let i = 0; i + 1 < t.length; i++) {
        const g = t[i + 1] - t[i];
        let worst = g;
        ps.forEach((p, j) => {
          const d = p.slots[part.id].learned.delta[k];
          const dg = d[i + 1] - d[i];
          worst += Math.min(ranges[j][0] * dg, ranges[j][1] * dg);
        });
        if (worst < KEEP * g) { bad = true; break; }
      }
    }
    if (bad) out.push(`${part.name} folds when ${ps.map(p => p.name).join(', ')} are all near the ends of their ranges. Narrow one of the ranges.`);
  }
  return out;
}

// ---------- rendering ----------

function renderAll() {
  renderParts();
  renderParams();
  renderExport();
  updateView();
}

function renderParts() {
  $('empty').hidden = state.parts.length > 0;
  const ul = $('parts');
  ul.innerHTML = '';
  for (const part of state.parts) {
    const li = document.createElement('li');
    const meta = part.error
      ? `<span class="bad">${escapeHTML(part.fileName)} ${escapeHTML(part.error)}</span>`
      : `${escapeHTML(part.fileName)} · ${part.mesh.faces.length / 3} triangles`;
    li.innerHTML = `<input type="text" value="${escapeHTML(part.name)}" aria-label="Part name" ${part.error ? 'disabled' : ''}>
      <span class="meta">${meta}</span><button type="button" title="Remove">×</button>`;
    const input = li.querySelector('input');
    input.addEventListener('change', () => {
      const v = input.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      part.name = uniquePartName(/^[a-z_]/.test(v) ? v : `part_${v}`, part);
      renderAll();
    });
    li.querySelector('button').addEventListener('click', () => {
      state.parts = state.parts.filter(p => p !== part);
      for (const param of state.params) delete param.slots[part.id];
      viewer.reset();
      renderAll();
    });
    ul.appendChild(li);
  }
  $('params-section').hidden = !usableParts().length;
  if (usableParts().length && !state.params.length) addParam();
}

function renderParams() {
  const box = $('params');
  box.innerHTML = '';
  for (const param of state.params) box.appendChild(paramCard(param));
}

function paramCard(param) {
  const card = document.createElement('div');
  card.className = 'param';
  card.dataset.id = param.id;
  const num = v => (v === null || v === undefined ? '' : v);
  card.innerHTML = `
    <div class="head">
      <input type="text" class="name" value="${escapeHTML(param.name)}" aria-label="Value name">
      <button type="button" class="remove" title="Remove this value">×</button>
    </div>
    <div class="grid two">
      <label>Default value<input type="number" class="base" step="any" value="${num(param.base)}"></label>
      <label>Changed value<input type="number" class="variant" step="any" value="${num(param.variant)}"></label>
    </div>
    <p class="hint">Changed exports, one per part. Leave a part empty if this value doesn't change it.</p>
    <div class="slots"></div>
    <div class="range" hidden>
      <div class="grid">
        <label>Min<input type="number" class="min" step="any" value="${num(param.min)}"></label>
        <label>Max<input type="number" class="max" step="any" value="${num(param.max)}"></label>
        <label>Step<input type="number" class="step" step="any" value="${num(param.step)}"></label>
      </div>
      <div class="preview"><span>Preview</span><input type="range"><output></output></div>
    </div>
    <div class="msgs"></div>`;
  const slots = card.querySelector('.slots');
  for (const part of usableParts()) slots.appendChild(slotRow(param, part));

  // Dropping several files on the card matches them to parts by name.
  card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('over'); });
  card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('over'); });
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('over');
    const files = [...e.dataTransfer.files].filter(f => /\.stl$/i.test(f.name));
    const target = e.target.closest('.slot');
    if (target && files.length === 1) {
      const part = state.parts.find(p => p.id === +target.dataset.part);
      if (part) setSlot(param, part, files[0]);
      return;
    }
    for (const [part, file] of matchFiles(files)) setSlot(param, part, file);
  });

  const name = card.querySelector('.name');
  name.addEventListener('change', () => { param.name = name.value.trim(); renderParams(); renderExport(); });
  card.querySelector('.remove').addEventListener('click', () => {
    state.params = state.params.filter(p => p !== param);
    renderAll();
  });
  for (const key of ['base', 'variant']) {
    const input = card.querySelector(`.${key}`);
    input.addEventListener('change', () => {
      param[key] = input.value === '' ? null : +input.value;
      if (!param.rangeEdited) { param.preview = null; suggestRange(param); }
      renderParams(); renderExport(); updateView();
    });
  }
  for (const key of ['min', 'max', 'step']) {
    const input = card.querySelector(`.${key}`);
    input.addEventListener('change', () => {
      param[key] = input.value === '' ? null : +input.value;
      param.rangeEdited = true;
      param.preview = clamp(param.preview ?? param.base, param.min, param.max);
      refreshCard(card, param); renderExport(); updateView();
    });
  }
  const slider = card.querySelector('input[type=range]');
  slider.addEventListener('input', () => {
    param.preview = +slider.value;
    card.querySelector('output').textContent = fmt(param.preview);
    updateView();
  });
  refreshCard(card, param);
  return card;
}

function slotRow(param, part) {
  const row = document.createElement('label');
  row.className = 'slot';
  row.dataset.part = part.id;
  row.innerHTML = `<input type="file" accept=".stl" hidden><span class="pname">${escapeHTML(part.name)}</span>
    <span class="file"></span><span class="state"></span>`;
  row.querySelector('input').addEventListener('change', e => {
    if (e.target.files[0]) setSlot(param, part, e.target.files[0]);
  });
  fillSlot(row, param, part);
  return row;
}

function fillSlot(row, param, part) {
  const s = param.slots[part.id];
  const file = row.querySelector('.file'), st = row.querySelector('.state');
  row.classList.remove('good', 'warn', 'bad');
  if (!s) { file.innerHTML = '<u>choose file</u> or drop it here'; st.textContent = 'not changed'; return; }
  file.textContent = s.fileName;
  if (s.status === 'learning') { st.textContent = `comparing ${Math.round(s.progress * 100)}%`; return; }
  if (s.status === 'error') { row.classList.add('bad'); st.textContent = 'error'; return; }
  const fit = s.learned.fit.max;
  row.classList.add(fit <= GOOD_FIT ? 'good' : fit <= BAD_FIT ? 'warn' : 'bad');
  st.textContent = fit <= BAD_FIT ? `matches within ${fmt(Math.max(fit, 0.001))} mm` : `doesn't match (${fmt(fit)} mm)`;
}

function refreshSlot(param, part) {
  const row = document.querySelector(`.param[data-id="${param.id}"] .slot[data-part="${part.id}"]`);
  if (row) fillSlot(row, param, part);
}

function refreshCard(card, param) {
  const ready = valuesSet(param) && learnedSlots(param).length > 0 &&
    [param.min, param.max, param.step].every(Number.isFinite);
  card.querySelector('.range').hidden = !ready;
  if (ready) {
    const slider = card.querySelector('input[type=range]');
    slider.min = param.min; slider.max = param.max; slider.step = param.step;
    slider.value = param.preview ?? param.base;
    card.querySelector('output').textContent = fmt(+slider.value);
  }
  const msgs = card.querySelector('.msgs');
  msgs.innerHTML = '';
  for (const m of problems(param)) {
    if (m.text.startsWith('Still comparing')) continue;
    const p = document.createElement('p');
    p.className = `msg ${m.level}`;
    p.textContent = m.text;
    msgs.appendChild(p);
  }
}

function readyParams() {
  return state.params.filter(p => !problems(p).some(m => m.level === 'error'));
}

function renderExport() {
  const parts = usableParts();
  $('export-section').hidden = !parts.length;
  if (!parts.length) return;
  if (!$('title').value) $('title').value = defaultTitle();
  const msgs = [];
  const blocked = state.params.filter(p => problems(p).some(m => m.level === 'error'));
  for (const p of blocked) msgs.push(`“${p.name}” isn't ready yet, so it is left out.`);
  const ready = readyParams();
  const combos = comboProblems(ready);
  msgs.push(...combos);
  $('export-msgs').innerHTML = msgs.map(m => `<p class="msg ${combos.includes(m) ? 'error' : 'warn'}">${escapeHTML(m)}</p>`).join('');
  $('export').disabled = !ready.length || combos.length > 0;
  $('export-info').textContent = ready.length
    ? `${ready.length} value${ready.length > 1 ? 's' : ''} and ${parts.length} part${parts.length > 1 ? 's' : ''}.` : '';
}

function defaultTitle() {
  const n = usableParts().map(p => p.name).join(' + ');
  return n ? `Parametric ${n}` : 'Parametric model';
}

// ---------- preview and export ----------

function previewMesh(part, params) {
  const ps = params.filter(p => p.slots[part.id]?.status === 'done');
  if (!ps.length) return part.mesh;
  return applyChanges(part.mesh, part, ps.map(p => amount(p, p.preview ?? p.base)), ps.map(p => p.slots[part.id].learned.delta));
}

function updateView() {
  const params = readyParams();
  let cursor = null;
  const shown = usableParts().map(part => {
    const mesh = previewMesh(part, params);
    const [lo, hi] = bounds(mesh);
    const offsetX = cursor === null ? 0 : cursor - lo[0];
    cursor = (cursor === null ? hi[0] : cursor + hi[0] - lo[0]) + SPACING;
    return { mesh, offsetX };
  });
  viewer.show(shown);
}

function buildScad() {
  const params = readyParams();
  return exportLearnedScad({
    title: $('title').value.trim() || defaultTitle(),
    spacing: SPACING,
    params: params.map(p => ({ name: p.name, base: p.base, variant: p.variant, min: p.min, max: p.max, step: p.step })),
    parts: usableParts().map(part => ({
      name: part.name, mesh: part.mesh, tables: part.tables, index: part.index,
      deltas: Object.fromEntries(params.filter(p => p.slots[part.id]?.status === 'done')
        .map(p => [p.name, p.slots[part.id].learned.delta])),
    })),
  });
}

$('export').addEventListener('click', () => {
  let scad;
  try { scad = buildScad(); } catch (e) { alert(e.message); return; }
  const name = ($('title').value.trim() || 'model').replace(/[^\w-]+/g, '_').toLowerCase();
  const url = URL.createObjectURL(new Blob([scad], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.scad` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('export-info').textContent = `Saved ${name}.scad (${Math.round(scad.length / 1024)} KB).`;
});

$('add-param').addEventListener('click', () => addParam());

// ---------- file input and drag and drop ----------

$('files').addEventListener('change', e => { addParts(e.target.files); e.target.value = ''; });
const drop = $('drop');
for (const el of [drop, $('view')]) {
  el.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  el.addEventListener('dragleave', () => drop.classList.remove('over'));
  el.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addParts(e.dataTransfer.files); });
}

// Sample: a box and lid exported from a parametric CAD program at 35 x 105 x 30, and one changed export per value.
$('sample').addEventListener('click', async () => {
  setStatus('Loading sample…');
  const get = async n => new File([await (await fetch(`samples/${n}`)).arrayBuffer()], n);
  try {
    state.parts = []; state.params = [];
    await addParts([await get('box.stl'), await get('lid.stl')]);
    state.params = [];
    const [box, lid] = state.parts;
    for (const [name, base, variant, parts] of [
      ['width', 35, 50, [box, lid]], ['length', 105, 136.5, [box, lid]], ['height', 30, 40, [box]],
    ]) {
      const param = addParam({ name, base, variant });
      for (const part of parts) setSlot(param, part, await get(`${part.name}_${name}_${variant}.stl`));
    }
    $('title').value = 'Parametric container';
  } catch (e) {
    alert(`Could not load the sample: ${e.message}`);
  }
  setStatus('');
});

function setStatus(text) { $('status').textContent = text; }
function fmt(v) { return String(Math.round(v * 1000) / 1000); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }
