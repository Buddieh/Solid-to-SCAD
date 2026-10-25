// Solid to SCAD web app: load STL parts, review the suggested stretch zones, export one .scad.

import {
  parseSTL, indexMesh, openEdgeCount, bounds, simplifyMesh, suggestModel,
  cleanRanges, mapValue, stretchMesh, exportScad,
} from './src/core/index.js';
import { Viewer } from './viewer.js';

const AXES = ['x', 'y', 'z'];
const SPACING = 5;
const $ = id => document.getElementById(id);

const state = {
  parts: [],   // {name, fileName, raw, mesh, open}
  params: [],  // from suggestModel, plus {enabled, preview}
  tolerance: 0.001,
};

const viewer = new Viewer($('view'));

// ---------- loading ----------

async function addFiles(fileList) {
  const files = [...fileList].filter(f => /\.stl$/i.test(f.name));
  if (!files.length) return;
  setStatus(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
  for (const file of files) {
    try {
      const raw = indexMesh(parseSTL(await file.arrayBuffer()));
      state.parts.push({ name: uniqueName(partName(file.name)), fileName: file.name, raw, mesh: null, open: openEdgeCount(raw) });
    } catch (e) {
      alert(`${file.name}: ${e.message}`);
    }
  }
  await processParts();
}

function partName(fileName) {
  let n = fileName.replace(/\.stl$/i, '').toLowerCase();
  n = n.replace(/\b(parametric|stl|v\d+)\b/g, ' ').trim();
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  n = words[words.length - 1] || 'part';
  return /^\d/.test(n) ? `part_${n}` : n;
}

function uniqueName(base, except) {
  let name = base, i = 2;
  while (state.parts.some(p => p !== except && p.name === name)) name = `${base}_${i++}`;
  return name;
}

async function processParts() {
  $('empty').hidden = state.parts.length > 0;
  for (const p of state.parts) {
    if (p.open) { p.mesh = null; continue; }
    setStatus(`Simplifying ${p.fileName}…`);
    try {
      p.mesh = await simplifyMesh(p.raw, state.tolerance);
    } catch (e) {
      p.mesh = null;
      p.error = e.message;
    }
  }
  suggest();
  setStatus('');
}

function usableParts() { return state.parts.filter(p => p.mesh); }

function suggest() {
  const parts = usableParts();
  if (!parts.length) { state.params = []; renderAll(); return; }
  const { params } = suggestModel(parts.map(p => ({ name: p.name, mesh: p.mesh })));
  state.params = params.map(p => ({ ...p, enabled: true, preview: p.base }));
  renderAll();
  viewer.reset();
  updateView();
}

// ---------- validation ----------

function linkedMeshes(param) {
  return usableParts().filter(p => param.parts.includes(p.name)).map(p => p.mesh);
}

function problems(param) {
  const out = [];
  const z = param.zone;
  if (!(z.b > z.a)) out.push({ level: 'error', text: 'The zone end must be after its start.' });
  if (param.min <= param.base - (z.b - z.a)) {
    out.push({ level: 'error', text: `Minimum must be above ${fmt(param.base - (z.b - z.a))} or the zone collapses.` });
  }
  if (!(param.max > param.min)) out.push({ level: 'error', text: 'Maximum must be above minimum.' });
  if (!(param.step > 0)) out.push({ level: 'error', text: 'Step must be above 0.' });
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(param.name)) out.push({ level: 'error', text: 'Name: letters, digits and _ only, not starting with a digit.' });
  else if (state.params.some(q => q !== param && q.enabled && q.name === param.name)) out.push({ level: 'error', text: 'Another size uses this name.' });
  else if (usableParts().some(p => p.name === param.name || param.name.startsWith(p.name + '_'))) {
    out.push({ level: 'error', text: 'Name clashes with a part name.' });
  }
  const inside = t => param.ranges.some(r => t >= r.lo && t <= r.hi);
  if (!inside(z.a) || !inside(z.b)) {
    out.push({ level: 'warn', text: 'A zone edge is outside the green ranges, so the shape will bend there.' });
  }
  if (!param.parts.length) out.push({ level: 'error', text: 'Pick at least one part.' });
  return out;
}

// ---------- rendering the panel ----------

function renderAll() {
  renderParts();
  renderParams();
  renderExport();
}

function renderParts() {
  const ul = $('parts');
  ul.replaceChildren();
  state.parts.forEach((p, i) => {
    const li = document.createElement('li');
    const name = Object.assign(document.createElement('input'), { type: 'text', value: p.name, title: 'Part name' });
    name.addEventListener('change', () => {
      const clean = name.value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1') || 'part';
      const next = uniqueName(clean, p);
      for (const q of state.params) q.parts = q.parts.map(n => (n === p.name ? next : n));
      p.name = next;
      renderAll();
    });
    const meta = document.createElement('span');
    meta.className = 'meta';
    if (p.open) {
      meta.innerHTML = `<span class="bad">Not watertight (${p.open} open edges), skipped</span>`;
    } else if (p.error) {
      meta.innerHTML = `<span class="bad">${escapeHTML(p.error)}</span>`;
    } else if (p.mesh) {
      const [lo, hi] = bounds(p.raw);
      const size = [0, 1, 2].map(a => fmt(hi[a] - lo[a])).join(' × ');
      meta.textContent = `${size} mm · ${p.raw.faces.length / 3} → ${p.mesh.faces.length / 3} triangles${i === 0 ? ' · reference' : ''}`;
    } else {
      meta.textContent = 'processing…';
    }
    const up = Object.assign(document.createElement('button'), { type: 'button', textContent: '↑', title: 'Make this the reference part' });
    up.hidden = i === 0;
    up.addEventListener('click', () => { state.parts.unshift(...state.parts.splice(i, 1)); suggest(); });
    const del = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Remove' });
    del.addEventListener('click', () => { state.parts.splice(i, 1); $('empty').hidden = state.parts.length > 0; suggest(); });
    li.append(name, meta, up, del);
    ul.append(li);
  });
  $('parts-hint').hidden = state.parts.length < 2;
}

function renderParams() {
  const box = $('params');
  box.replaceChildren();
  $('params-section').hidden = !state.params.length;
  for (const param of state.params) box.append(paramCard(param));
}

function paramCard(param) {
  const card = document.createElement('div');
  card.className = 'param' + (param.enabled ? '' : ' off');
  const axis = AXES[param.zone.axis];
  card.innerHTML = `
    <div class="head">
      <input type="checkbox" data-k="enabled" ${param.enabled ? 'checked' : ''} title="Include this size">
      <span class="axis ${axis}">${axis.toUpperCase()}</span>
      <input type="text" data-k="name" value="${escapeHTML(param.name)}" title="OpenSCAD variable name">
      <span class="hint">default ${fmt(param.base)} mm</span>
    </div>
    <div class="body">
      <svg class="strip" viewBox="0 0 360 34" preserveAspectRatio="none"></svg>
      <div class="grid">
        <label>Zone start<input type="number" data-k="a" step="0.1" value="${fmt(param.zone.a)}"></label>
        <label>Zone end<input type="number" data-k="b" step="0.1" value="${fmt(param.zone.b)}"></label>
        <label>Grows from<select data-k="anchor">
          <option value="0.5">both ends</option>
          <option value="0">high end (low fixed)</option>
          <option value="1">low end (high fixed)</option>
        </select></label>
        <label>Min<input type="number" data-k="min" step="any" value="${fmt(param.min)}"></label>
        <label>Max<input type="number" data-k="max" step="any" value="${fmt(param.max)}"></label>
        <label>Step<input type="number" data-k="step" step="any" value="${fmt(param.step)}"></label>
      </div>
      <div class="links">Changes:</div>
      <div class="preview">Preview <input type="range" step="any"> <output></output></div>
      <div class="msgs"></div>
    </div>`;
  card.querySelector('select').value = String(param.zone.anchor);

  card.querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.k;
    if (k === 'enabled') param.enabled = el.checked;
    else if (k === 'name') param.name = el.value.trim();
    else if (k === 'a' || k === 'b' || k === 'anchor') param.zone[k] = +el.value;
    else param[k] = +el.value;
    if (k === 'min' || k === 'max') param.preview = clamp(param.preview, param.min, param.max);
    refreshCard(card, param);
    updateView();
    renderExport();
  }));

  const links = card.querySelector('.links');
  for (const p of usableParts()) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" ${param.parts.includes(p.name) ? 'checked' : ''}> ${escapeHTML(p.name)}`;
    label.querySelector('input').addEventListener('change', e => {
      param.parts = e.target.checked
        ? usableParts().map(q => q.name).filter(n => n === p.name || param.parts.includes(n))
        : param.parts.filter(n => n !== p.name);
      const meshes = linkedMeshes(param);
      param.ranges = meshes.length ? cleanRanges(meshes, param.zone.axis) : [];
      refreshCard(card, param);
      updateView();
      renderExport();
    });
    links.append(label);
  }

  const range = card.querySelector('input[type=range]');
  range.addEventListener('input', () => {
    param.preview = +range.value;
    card.querySelector('output').textContent = `${fmt(param.preview)} mm`;
    updateView();
  });

  setupStrip(card, param);
  refreshCard(card, param);
  return card;
}

function refreshCard(card, param) {
  card.classList.toggle('off', !param.enabled);
  card.querySelector('[data-k=a]').value = fmt(param.zone.a);
  card.querySelector('[data-k=b]').value = fmt(param.zone.b);
  const range = card.querySelector('input[type=range]');
  Object.assign(range, { min: param.min, max: param.max });
  range.value = param.preview;
  card.querySelector('output').textContent = `${fmt(param.preview)} mm`;
  drawStrip(card, param);
  const msgs = card.querySelector('.msgs');
  msgs.replaceChildren(...problems(param).map(m => Object.assign(document.createElement('div'), {
    className: `msg ${m.level}`, textContent: m.text,
  })));
}

// The strip shows the axis span of the linked parts: green = clean cut, shaded = zone.
function stripDomain(param) {
  const meshes = linkedMeshes(param);
  if (!meshes.length) return [0, 1];
  let lo = Infinity, hi = -Infinity;
  for (const m of meshes) {
    const [l, h] = bounds(m);
    lo = Math.min(lo, l[param.zone.axis]);
    hi = Math.max(hi, h[param.zone.axis]);
  }
  return [lo, hi];
}

function drawStrip(card, param) {
  const svg = card.querySelector('svg');
  const [lo, hi] = stripDomain(param);
  const X = t => ((t - lo) / (hi - lo || 1)) * 360;
  const z = param.zone;
  svg.innerHTML = `
    <rect class="blocked" x="0" y="6" width="360" height="14" rx="3"></rect>
    ${param.ranges.map(r => `<rect class="clean" x="${X(r.lo)}" y="6" width="${Math.max(1, X(r.hi) - X(r.lo))}" height="14"></rect>`).join('')}
    <rect class="zone" x="${X(z.a)}" y="2" width="${Math.max(0, X(z.b) - X(z.a))}" height="22"></rect>
    <rect class="handle" data-h="a" x="${X(z.a) - 3}" y="0" width="6" height="26" rx="2"></rect>
    <rect class="handle" data-h="b" x="${X(z.b) - 3}" y="0" width="6" height="26" rx="2"></rect>
    <text x="0" y="33">${fmt(lo)}</text>
    <text x="360" y="33" text-anchor="end">${fmt(hi)}</text>`;
}

function setupStrip(card, param) {
  const svg = card.querySelector('svg');
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    const h = e.target.dataset?.h;
    if (!h) return;
    drag = h;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const [lo, hi] = stripDomain(param);
    const rect = svg.getBoundingClientRect();
    let t = lo + clamp((e.clientX - rect.left) / rect.width, 0, 1) * (hi - lo);
    // Snap into a clean range when close to one.
    const snap = (hi - lo) * 0.01;
    for (const r of param.ranges) {
      if (t < r.lo && r.lo - t < snap) t = r.lo + 0.05;
      if (t > r.hi && t - r.hi < snap) t = r.hi - 0.05;
    }
    param.zone[drag] = Math.round(t * 100) / 100;
    refreshCard(card, param);
    updateView();
  });
  const end = () => { if (drag) { drag = null; renderExport(); } };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

// ---------- preview ----------

function activeParams() {
  return state.params.filter(p => p.enabled && !problems(p).some(m => m.level === 'error'));
}

function updateView() {
  const parts = usableParts();
  const params = activeParams();
  let cursor = null;
  const shown = parts.map(p => {
    const changes = params.filter(q => q.parts.includes(p.name)).map(q => ({ zone: q.zone, d: q.preview - q.base }));
    const mesh = stretchMesh(p.mesh, changes);
    const [lo, hi] = bounds(mesh);
    const offsetX = cursor === null ? 0 : cursor - lo[0];
    cursor = (cursor === null ? hi[0] : cursor + hi[0] - lo[0]) + SPACING;
    return { mesh, offsetX };
  });
  const slabs = [];
  for (const q of params) {
    parts.forEach((p, i) => {
      if (!q.parts.includes(p.name)) return;
      const d = q.preview - q.base;
      slabs.push({ axis: q.zone.axis, lo: mapValue(q.zone.a, q.zone, d), hi: mapValue(q.zone.b, q.zone, d), part: i });
    });
  }
  viewer.show(shown, slabs);
}

// ---------- export ----------

function renderExport() {
  const ok = usableParts().length > 0;
  $('export-section').hidden = !ok;
  if (!ok) return;
  if (!$('title').value) $('title').value = state.parts[0].fileName.replace(/\.stl$/i, '');
  const bad = state.params.filter(p => p.enabled && problems(p).some(m => m.level === 'error'));
  $('export').disabled = bad.length > 0;
  $('export-info').textContent = bad.length
    ? `Fix ${bad.map(p => p.name || AXES[p.zone.axis]).join(', ')} first.`
    : `${activeParams().length} size${activeParams().length === 1 ? '' : 's'}, ${usableParts().length} part${usableParts().length === 1 ? '' : 's'}.`;
}

function buildScad() {
  return exportScad({
    title: $('title').value || 'Parametric model',
    parts: usableParts().map(p => ({ name: p.name, mesh: p.mesh })),
    params: activeParams(),
    spacing: SPACING,
  });
}

$('export').addEventListener('click', () => {
  let scad;
  try { scad = buildScad(); } catch (e) { alert(e.message); return; }
  const name = ($('title').value || 'model').replace(/[^\w.-]+/g, '_') + '.scad';
  const url = URL.createObjectURL(new Blob([scad], { type: 'text/plain' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('export-info').textContent = `Saved ${name} (${(scad.length / 1024).toFixed(0)} KB).`;
});

$('tolerance').addEventListener('change', async e => {
  state.tolerance = Math.max(0, +e.target.value || 0);
  const keep = state.params;
  await processParts();
  // Keep the user's zone edits when only the mesh detail changed.
  for (const p of state.params) {
    const old = keep.find(k => k.zone.axis === p.zone.axis);
    if (old) Object.assign(p, { ...old, ranges: p.ranges });
  }
  renderAll();
  updateView();
});

// ---------- inputs ----------

$('files').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
document.body.addEventListener('dragover', e => e.preventDefault());
document.body.addEventListener('drop', e => { e.preventDefault(); if (e.target !== drop) addFiles(e.dataTransfer.files); });

$('sample').addEventListener('click', async () => {
  setStatus('Loading sample…');
  const files = await Promise.all(['container-box.stl', 'container-lid.stl'].map(async n => {
    const res = await fetch(`samples/${n}`);
    return new File([await res.arrayBuffer()], n);
  }));
  state.parts = [];
  await addFiles(files);
  $('title').value = 'Container';
});

// ---------- helpers ----------

function setStatus(text) { $('status').textContent = text; }
function fmt(v) { return String(Math.round(v * 1000) / 1000); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }

window.solidToScad = { state, buildScad }; // handy for debugging and the smoke test
