// Selene — user interface: preset & parameter panel, generation, preview controls, export.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});
  const $ = (id) => document.getElementById(id);

  let gpu, preview, world = null, P, busy = false;

  function showError(e) {
    const el = $('error');
    el.textContent = String(e && e.stack ? e.message + '\n\n' + e.stack : e);
    el.hidden = false;
    el.onclick = () => { el.hidden = true; };
    console.error(e);
  }

  // ------------------------------------------------------------------ parameter panel
  const closed = new Set(['Tectonics', 'Erosion', 'Climate', 'Colouring', 'Palette']);
  function buildPanel() {
    $('presetDesc').textContent = P.userPreset ? `Your preset “${P.userPreset}” (based on ${S.PRESETS[P.preset] ? S.PRESETS[P.preset].name : P.preset}).` : S.PRESETS[P.preset] ? S.PRESETS[P.preset].desc : '';
    const root = $('groups');
    root.innerHTML = '';
    const groups = new Map();
    for (const it of S.SCHEMA) {
      if (it.key === 'seed' || it.key === 'resolution') continue;
      if (it.show && !it.show(P)) continue;
      if (!(it.key in P)) continue;
      if (!groups.has(it.group)) groups.set(it.group, []);
      groups.get(it.group).push(it);
    }
    for (const [name, items] of groups) root.appendChild(groupEl(name, items.map(control)));
    // palette
    const pal = document.createElement('div');
    pal.className = 'pal';
    const keys = P.model === 'terran' ? Object.keys(P.colors || {}) : S.WORLD_COLORS_USED;
    for (const k of keys) {
      if (!P.colors[k]) P.colors[k] = S.Surface.defaultColor(k, P.colors);
      const c = document.createElement('input');
      c.type = 'color'; c.value = P.colors[k];
      c.oninput = () => { P.colors[k] = c.value; paramsChanged(); };
      const l = document.createElement('span'); l.textContent = S.COLOR_LABELS[k] || k;
      pal.append(c, l);
    }
    root.appendChild(groupEl('Palette', [pal]));
  }
  function groupEl(name, children) {
    const g = document.createElement('div');
    g.className = 'group' + (closed.has(name) ? ' closed' : '');
    const h = document.createElement('h4'); h.textContent = name;
    h.onclick = () => { g.classList.toggle('closed'); if (g.classList.contains('closed')) closed.add(name); else closed.delete(name); };
    const b = document.createElement('div'); b.className = 'body';
    children.forEach((c) => b.appendChild(c));
    g.append(h, b);
    return g;
  }
  function control(it) {
    const el = document.createElement('div');
    const help = it.help ? `<span class="help" title="${it.help.replace(/"/g, '&quot;')}">ⓘ</span>` : '';
    if (it.type === 'bool') {
      el.className = 'ctl bool';
      el.innerHTML = `<input type="checkbox"> <span>${it.label}</span> ${help}`;
      const cb = el.querySelector('input'); cb.checked = !!P[it.key];
      cb.onchange = () => { P[it.key] = cb.checked; buildPanel(); paramsChanged(); };
      return el;
    }
    if (it.type === 'select' || it.type === 'text') {
      el.className = 'ctl ' + it.type;
      el.innerHTML = `<div class="lbl"><span>${it.label}</span>${help}</div>`;
      const inp = document.createElement(it.type === 'select' ? 'select' : 'input');
      if (it.type === 'select') for (const [v, t] of it.options) inp.add(new Option(t, v));
      inp.value = P[it.key];
      inp.onchange = () => { P[it.key] = it.type === 'select' ? +inp.value : inp.value; paramsChanged(); };
      el.appendChild(inp);
      return el;
    }
    el.className = 'ctl';
    el.innerHTML = `<div class="lbl"><span>${it.label}</span>${help}</div><input type="range"><input type="number">`;
    const [rg, nm] = el.querySelectorAll('input');
    for (const x of [rg, nm]) { x.min = it.min; x.max = it.max; x.step = it.step; x.value = P[it.key]; }
    const set = (v, from) => {
      v = Math.min(it.max, Math.max(it.min, +v)); if (it.type === 'int') v = Math.round(v);
      P[it.key] = v; if (from !== rg) rg.value = v; if (from !== nm) nm.value = v;
      paramsChanged();
      if (/^(craters|basins|rises|giantVolcanoes|canyons|canyonNet|cracks|grooves|chaos|scarps|paterae|tesserae|shieldFields|blockMountains|maria|rayed)$/.test(it.key)) scheduleRebuild();
    };
    rg.oninput = () => set(rg.value, rg);
    nm.onchange = () => set(nm.value, nm);
    return el;
  }
  let rebuildT = 0;
  function scheduleRebuild() { clearTimeout(rebuildT); rebuildT = setTimeout(buildPanel, 400); }

  // ------------------------------------------------------------------ user presets (browser storage)
  const UP_KEY = 'selene.userPresets';
  function userPresets() { try { return JSON.parse(localStorage.getItem(UP_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function storeUserPresets(o) {
    try { localStorage.setItem(UP_KEY, JSON.stringify(o)); return true; }
    catch (e) { showError(new Error('Could not save the preset: the browser storage is full (images in Image nodes take a lot of space). Use “Save settings…” to save it as a file instead.')); return false; }
  }
  function fillPresetMenu(select) {
    const sel = $('preset'); sel.innerHTML = '';
    const g1 = document.createElement('optgroup'); g1.label = 'World types';
    for (const [id, pr] of Object.entries(S.PRESETS)) g1.appendChild(new Option(pr.name, id));
    sel.appendChild(g1);
    const ups = Object.keys(userPresets()).sort((a, b) => a.localeCompare(b));
    if (ups.length) { const g2 = document.createElement('optgroup'); g2.label = 'My presets'; for (const n of ups) g2.appendChild(new Option('★ ' + n, 'user:' + n)); sel.appendChild(g2); }
    if (select) sel.value = select;
    $('delPreset').hidden = !String(sel.value).startsWith('user:');
  }
  function saveUserPreset() {
    const name = (prompt('Name for this preset:', P.userPreset || '') || '').trim();
    if (!name) return;
    const all = userPresets();
    if (all[name] && !confirm(`Replace your preset “${name}”?`)) return;
    P.seed = $('seed').value; P.resolution = +$('res').value;
    const copy = JSON.parse(JSON.stringify({ ...P, userPreset: name }));
    all[name] = copy;
    if (!storeUserPresets(all)) return;
    P.userPreset = name;
    fillPresetMenu('user:' + name);
    buildPanel();
    progress(`Saved preset “${name}”`, 1);
  }
  function deleteUserPreset() {
    const v = $('preset').value; if (!v.startsWith('user:')) return;
    const name = v.slice(5);
    if (!confirm(`Delete your preset “${name}”?`)) return;
    const all = userPresets(); delete all[name]; storeUserPresets(all);
    fillPresetMenu(P.preset);
    delete P.userPreset;
    buildPanel();
  }

  function setPreset(id) {
    if (String(id).startsWith('user:')) {
      const u = userPresets()[id.slice(5)];
      if (!u) return;
      const base = S.preset(S.PRESETS[u.preset] ? u.preset : 'mars');
      P = { ...base, ...JSON.parse(JSON.stringify(u)), colors: { ...base.colors, ...(u.colors || {}) } };
      if (!P.nodes) P.nodes = S.Nodes.defaultGraph();
      if (!P.paint) P.paint = [];
      $('seed').value = P.seed; $('res').value = P.resolution;
      $('delPreset').hidden = false;
      if (editor) { editor.render(); editor.fit(); }
      buildPanel();
      return;
    }
    $('delPreset').hidden = true;
    const keepSeed = P ? P.seed : 'selene', keepRes = P ? P.resolution : 512, keepNodes = P ? P.nodes : null, keepPaint = P ? P.paint : null;
    P = S.preset(id);
    P.seed = keepSeed; P.resolution = keepRes;
    P.nodes = keepNodes || S.Nodes.defaultGraph();         // node graph and painting survive switching world type
    P.paint = keepPaint || [];
    if (editor) editor.render();
    $('seed').value = P.seed;
    $('res').value = P.resolution;
    buildPanel();
  }

  // ------------------------------------------------------------------ generation
  function progress(msg, f) {
    $('progtxt').textContent = msg;
    $('progfill').style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
  }
  // Live preview: a quick low-resolution rebuild shortly after you stop changing settings.
  let liveT = 0, liveQueued = false;
  function paramsChanged() {
    if (!$('live').checked || !world) return;
    clearTimeout(liveT);
    liveT = setTimeout(() => { if (busy) { liveQueued = true; return; } generate({ live: true }); }, 450);
  }
  async function generate(opts = {}) {
    if (busy) return;
    const live = !!opts.live;
    busy = true; $('gen').disabled = !live; $('exGo').disabled = true;
    preview.busy = true;
    try {
      P.seed = $('seed').value; P.resolution = +$('res').value;
      const Q = JSON.parse(JSON.stringify(P));
      if (live) { Q.resolution = Math.min(Q.resolution, 128); Q.erosionIterations = Math.min(Q.erosionIterations || 0, 60); }
      if (!live && world) { world.dispose(); world = null; preview.setWorld(null); }   // free GPU memory before a full build
      const w = await S.generate(gpu, Q, live ? (m, f) => progress('Live preview: ' + m, f) : progress);
      if (world) world.dispose();
      world = w; world.live = live;
      preview.setWorld(w);
      $('empty').hidden = true;
      progress(live ? `Live preview (low resolution, ${w.seconds.toFixed(1)} s) — press Generate for full quality` : `Done in ${w.seconds.toFixed(1)} s`, 1);
      updateStats();
      fillWidths();
    } catch (e) { showError(e); progress('Failed — see error', 0); }
    busy = false; $('gen').disabled = false; $('exGo').disabled = false; preview.busy = false; preview.dirty = true;
    if (liveQueued) { liveQueued = false; paramsChanged(); }
  }

  function updateStats() {
    const w = world; if (!w) return;
    const nodesOn = (w.H !== w.baseH ? ' · node graph applied' : '') + (w.live ? ' · live preview' : '');
    $('stats').innerHTML = `${P.userPreset ? '★ ' + P.userPreset : S.PRESETS[P.preset] ? S.PRESETS[P.preset].name : ''} · seed “${P.seed}”${nodesOn}<br>relief ${(w.ctx.hmin / 1000).toFixed(1)} … ${(w.ctx.hmax / 1000).toFixed(1)} km on a ${(w.R / 1000).toFixed(0)} km world<br>${w.N}² × 6 cube faces · GPU memory ${gpu.memoryMB().toFixed(0)} MB`;
  }

  // ------------------------------------------------------------------ painting
  let paintTool = null, paintT = 0, paintBusy = false;
  function paintRefresh(final) {
    if (!world) return;
    if (final) world.paintVersion = (world.paintVersion || 0) + 1;
    preview.dirty = true;
    clearTimeout(paintT);
    paintT = setTimeout(async () => {
      if (paintBusy) { paintRefresh(false); return; }
      paintBusy = true; preview.busy = true;
      try { world.P.paint = P.paint; await S.Nodes.apply(world, P.nodes); updateStats(); } catch (e) { showError(e); }
      paintBusy = false; preview.busy = false; preview.dirty = true;
    }, final ? 30 : 220);
  }
  function togglePaint(open) {
    const panel = $('paintPanel');
    open = open ?? panel.hidden;
    if (open && !world) { progress('Generate a planet first, then paint on it', 0); return; }
    panel.hidden = !open;
    $('paintBtn').classList.toggle('on', open);
    $('view').classList.toggle('painting', open);
    if (!paintTool) paintTool = new S.Paint.PaintTool({ world: () => world, P: () => P, refresh: paintRefresh });
    preview.tool = open ? paintTool : null;
    if (open) { preview.spin = false; $('spin').checked = false; }
    preview.dirty = true;
    updatePaintUI();
  }
  function updatePaintUI() {
    if (!paintTool) return;
    const m = paintTool.mode, feat = m === 'crater' || m === 'volcano' || m === 'canyon';
    document.querySelectorAll('#paintPanel .pp-brush').forEach((e) => (e.style.display = feat ? 'none' : ''));
    document.querySelectorAll('#paintPanel .pp-feat').forEach((e) => (e.style.display = feat ? '' : 'none'));
    document.querySelectorAll('#paintPanel label').forEach((l) => { const i = l.querySelector('input'); l.querySelector('span').textContent = i.value; });
    const hint = {
      mask: 'Paint a mask, then use it in the node editor: Painted node → Paint (colour) or any “Where” input.',
      erase: 'Erases all three masks.', raise: 'Drag to build up terrain (Alt/Ctrl lowers).', lower: 'Drag to dig down.',
      crater: 'Click to place a crater with a real crater shape. Height/depth 2000 = natural depth.', volcano: 'Click to place a shield volcano.', canyon: 'Drag from one end of the canyon to the other.',
    }[m];
    document.querySelector('#paintPanel .pp-hint').textContent = hint + ' Shift+drag or right-drag rotates the view.';
  }

  // ------------------------------------------------------------------ node editor
  let editor = null, nodeT = 0;
  function nodesChanged() {
    clearTimeout(nodeT);
    nodeT = setTimeout(async () => {
      if (!world || busy) return;
      preview.busy = true;                       // don't interleave preview frames with the node pass
      try {
        world.P.nodes = JSON.parse(JSON.stringify(P.nodes));
        await S.Nodes.apply(world, P.nodes);
        updateStats();
      } catch (e) { showError(e); }
      preview.busy = false; preview.dirty = true;
    }, 180);
  }
  function toggleNodes(open) {
    const panel = $('nodePanel');
    open = open ?? panel.hidden;
    panel.hidden = !open;
    document.getElementById('stage').classList.toggle('nodes-open', open);
    $('nodesBtn').classList.toggle('on', open);
    if (open && !editor) editor = new S.NodeEditor($('npBody'), () => P.nodes, nodesChanged);
    if (open) { editor.render(); setTimeout(() => editor.fit(), 30); }
    preview.dirty = true;
  }

  function fillWidths() {
    const sel = $('exW'), cur = +sel.value;
    const N = world ? world.N : +$('res').value;
    sel.innerHTML = '';
    for (const w of [1024, 2048, 4096, 8192, 16384]) {
      if (w > Math.min(16384, N * 16)) continue;
      sel.add(new Option(`${w} × ${w / 2}${w > N * 4 ? ' (upsampled)' : ''}`, w));
    }
    sel.value = cur && [...sel.options].some((o) => +o.value === cur) ? cur : Math.min(8192, N * 4);
  }

  // ------------------------------------------------------------------ export
  async function doExport() {
    if (!world || busy) return;
    if (world.live) { await generate(); if (!world || world.live) return; }   // never export the low-res live preview
    busy = true; $('exGo').disabled = true; $('gen').disabled = true; preview.busy = true;
    const ep = (m) => { $('exProg').textContent = m; };
    try {
      const E = S.Export, W = +$('exW').value, Hh = W / 2;
      const name = ($('exName').value || 'Selene').replace(/[^\w\-]+/g, '_');
      const hs = +$('exHScale').value || 1, lon = +$('exLon').value || 0;
      const radiusKm = +$('exRadius').value || world.R / 1000;
      const files = [], fn = {};
      const opts = { lonShift: lon };
      const add = async (nm, blob) => { files.push({ name: nm, blob }); };
      const pct = (label) => (f) => ep(`${label} ${Math.round(f * 100)}%`);
      // 1) exact height range of the exported map
      let mn = Infinity, mx = -Infinity;
      await E.streamMap(world, 'height', W, Hh, opts, [async (rows) => { for (let i = 0; i < rows.length; i++) { const v = rows[i] * hs; if (v < mn) mn = v; if (v > mx) mx = v; } }], pct('Measuring heights'));
      const mm = { min: mn, max: mx };
      // 2) height maps, streamed
      const e16 = $('mH16').checked ? new E.PNGStream(W, Hh, 1, 16) : null, e8 = $('mH8').checked ? new E.PNGStream(W, Hh, 1, 8) : null;
      const eS = world.P.ocean && e16 ? new E.PNGStream(W, Hh, 1, 16) : null;   // Blender-friendly: sea surface flat
      if (e16 || e8) {
        await E.streamMap(world, 'height', W, Hh, opts, [async (rows, y0, h) => {
          if (hs !== 1) for (let i = 0; i < rows.length; i++) rows[i] *= hs;
          if (e16) await e16.addRows(E.heightTo16(rows, mn, mx), h);
          if (e8) await e8.addRows(E.heightTo8(rows, mn, mx, true), h);
          if (eS) await eS.addRows(E.heightTo16(rows.map((v) => Math.max(v, 0)), mn, mx), h);
        }], pct('Height maps'));
        if (e16) { fn.height16 = `${name}_height16.png`; await add(fn.height16, await e16.finish()); }
        if (e8) { fn.height8 = `${name}_height8.png`; await add(fn.height8, await e8.finish()); }
        if (eS) { fn.heightSurface16 = `${name}_surface16.png`; await add(fn.heightSurface16, await eS.finish()); }
      }
      // 3) colour + ocean mask
      if ($('mColor').checked || $('mSpec').checked) {
        const eC = $('mColor').checked ? new E.PNGStream(W, Hh, 3, 8) : null, eP = $('mSpec').checked ? new E.PNGStream(W, Hh, 1, 8) : null;
        await E.streamMap(world, 'albedo', W, Hh, opts, [async (rows, y0, h) => { if (eC) await eC.addRows(E.rgbaToRGB(rows), h); if (eP) await eP.addRows(E.channel(rows, 3), h); }], pct('Colour'));
        if (eC) { fn.color = `${name}_color.png`; await add(fn.color, await eC.finish()); }
        if (eP) { fn.spec = `${name}_specular.png`; await add(fn.spec, await eP.finish()); }
      }
      // 4) other maps
      const simple = async (check, layer, key, suffix, label, channels, o2 = {}) => {
        if (!check) return;
        const enc = new E.PNGStream(W, Hh, channels, 8);
        await E.streamMap(world, layer, W, Hh, { ...opts, ...o2 }, [async (rows, y0, h) => {
          await enc.addRows(channels === 3 ? E.rgbaToRGB(rows) : channels === 1 ? E.channel(rows, 0) : (() => { const n = rows.length / 4, o = new Uint8Array(n * 2); for (let i = 0; i < n; i++) { o[i * 2] = rows[i * 4]; o[i * 2 + 1] = rows[i * 4 + 3]; } return o; })(), h);
        }], pct(label));
        fn[key] = `${name}_${suffix}.png`; await add(fn[key], await enc.finish());
      };
      await simple($('mNormal').checked, 'normal', 'normal', 'normal', 'Normals', 3, { normalStrength: (+$('exNorm').value || 1) * hs * (world.R / 1000) / radiusKm, flatSea: world.P.ocean });
      await simple($('mEmit').checked && world.P.emissive, 'emission', 'emission', 'emission', 'Emission', 3);
      await simple($('mRough').checked, 'roughness', 'roughness', 'roughness', 'Roughness', 1);
      await simple($('mAO').checked, 'ao', 'ao', 'ao', 'Ambient occlusion', 1, { aoStrength: 1 });
      await simple($('mClouds').checked, 'clouds', 'clouds', 'clouds', 'Clouds', 2, { cloudCover: +$('exCloud').value, cloudScale: 4 });
      await simple($('mLights').checked, 'lights', 'lights', 'night_lights', 'Night lights', 3, { lights: +$('exLights').value });
      const info = { name, files: fn, hmin: mm.min, hmax: mm.max, radiusKm, ocean: !!world.P.ocean, emissive: !!world.P.emissive };
      if ($('mKsp').checked) await add(`${name}_Kopernicus.cfg`, new Blob([S.Integrations.kopernicusCfg(info)], { type: 'text/plain' }));
      if ($('mBlender').checked) await add(`${name}_blender_import.py`, new Blob([S.Integrations.blenderScript(info)], { type: 'text/plain' }));
      const txt = `Selene export — ${name}\nWorld type: ${world.P.preset}  seed: ${world.P.seed}\nMaps: ${W} x ${Hh} equirectangular, column 0 = 180°W (+ offset ${lon}°), top row = north.\n` +
        `Height range (exported metres): ${mm.min.toFixed(2)} … ${mm.max.toFixed(2)}  (span ${(mm.max - mm.min).toFixed(2)})\n` +
        `16-bit value v -> height = ${mm.min.toFixed(4)} + v / 65535 * ${(mm.max - mm.min).toFixed(4)}\n8-bit value v -> height = ${mm.min.toFixed(4)} + v / 255 * ${(mm.max - mm.min).toFixed(4)}\n` +
        `Height scale applied: ${hs}   In-game radius: ${radiusKm} km   Geological scale: ${(world.R / 1000).toFixed(0)} km\n`;
      await add(`${name}_info.txt`, new Blob([txt], { type: 'text/plain' }));
      await add(`${name}_settings.json`, new Blob([JSON.stringify(world.P, null, 2)], { type: 'application/json' }));
      ep('Zipping…');
      const zip = await E.makeZip(files);
      download(zip, `${name}.zip`);
      ep(`Exported ${files.length} files (${(zip.size / 1048576).toFixed(1)} MB)`);
    } catch (e) { showError(e); ep('Export failed'); }
    busy = false; $('exGo').disabled = false; $('gen').disabled = false; preview.busy = false; preview.dirty = true;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // ------------------------------------------------------------------ boot
  function init() {
    try {
      gpu = new S.GPU($('view'));
      preview = new S.Preview(gpu);
      gpu.onLost = () => { preview.busy = true; showError(new Error('The GPU driver reset (WebGL context lost). Reload the page (F5) to continue. A lower resolution helps if it happens again.')); progress('GPU reset — reload the page', 0); };
    } catch (e) { showError(e); return; }
    S.WORLD_COLORS_USED = S.Surface.WORLD_COLORS;
    fillPresetMenu();
    const resIt = S.SCHEMA.find((x) => x.key === 'resolution');
    for (const [v, t] of resIt.options) $('res').add(new Option(t, v));
    $('preset').value = 'mars';
    setPreset('mars');
    $('preset').onchange = () => setPreset($('preset').value);
    $('savePreset').onclick = saveUserPreset;
    $('delPreset').onclick = deleteUserPreset;
    $('dice').onclick = () => { $('seed').value = Math.random().toString(36).slice(2, 8); P.seed = $('seed').value; };
    $('res').onchange = () => { P.resolution = +$('res').value; fillWidths(); };
    $('gen').onclick = () => generate();
    $('exGo').onclick = doExport;
    $('exGo').disabled = true;
    $('exAuto').onclick = () => { if (world) $('exHScale').value = (+$('exRadius').value * 1000 / world.R).toPrecision(3); };
    document.querySelectorAll('#viewMode button').forEach((b) => b.onclick = () => {
      document.querySelectorAll('#viewMode button').forEach((x) => x.classList.toggle('on', x === b));
      preview.view = +b.dataset.v; preview.dirty = true;
    });
    $('nodesBtn').onclick = () => toggleNodes();
    $('paintBtn').onclick = () => togglePaint();
    $('refFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const im = new Image(); im.src = URL.createObjectURL(f); await im.decode();
        preview.setReference(im); preview.split = 0.5;
        document.querySelector('.refbtn').classList.add('on'); $('refOff').hidden = false;
        if (Math.abs(im.width / im.height - 2) > 0.05) progress('Tip: the reference should be a 2:1 equirectangular map', 0);
      } catch (err) { showError(err); }
      e.target.value = '';
    };
    $('refOff').onclick = () => { preview.setReference(null); document.querySelector('.refbtn').classList.remove('on'); $('refOff').hidden = true; };
    document.querySelectorAll('#paintPanel .pp-tools button').forEach((b) => b.onclick = () => {
      document.querySelectorAll('#paintPanel .pp-tools button').forEach((x) => x.classList.toggle('on', x === b));
      if (!paintTool) return;
      paintTool.mode = b.dataset.m; paintTool.ch = +(b.dataset.ch || 0);
      updatePaintUI();
    });
    for (const [id, k] of [['ppSize', 'size'], ['ppStr', 'strength'], ['ppFSize', 'featSize'], ['ppFDep', 'featDepth']]) $(id).oninput = () => { if (paintTool) paintTool[k] = +$(id).value; updatePaintUI(); };
    $('ppHard').oninput = () => { if (paintTool) paintTool.hard = 1 - +$('ppHard').value; updatePaintUI(); };
    const repaint = async () => {
      if (!world) return;
      if (world.paint) { world.ctx.gpu.free(world.paint); world.paint = null; }
      await S.Paint.replay(world, P.paint);
      if (!world.paint) S.Paint.ensureLayer(world);
      paintRefresh(true);
    };
    $('ppUndo').onclick = async () => {
      const ops = P.paint || []; if (!ops.length) return;
      ops.pop(); while (ops.length && !ops[ops.length - 1].end) ops.pop();
      await repaint();
    };
    $('ppClear').onclick = async () => { if (!confirm('Remove all painting, sculpting and placed features?')) return; P.paint = []; await repaint(); };
    { // resizable node panel
      const h = $('npResize');
      h.addEventListener('pointerdown', (e) => {
        h.setPointerCapture(e.pointerId);
        const stage = document.getElementById('stage'), r = stage.getBoundingClientRect();
        const mv = (ev) => { const f = Math.min(0.85, Math.max(0.2, (r.bottom - ev.clientY) / r.height)); stage.style.setProperty('--np-h', (f * 100).toFixed(1) + '%'); preview.dirty = true; if (editor) editor.drawWires(); };
        const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
      });
    }
    $('layer').onchange = () => { preview.layer = +$('layer').value; preview.dirty = true; };
    $('exag').oninput = () => { preview.exag = +$('exag').value; preview.dirty = true; };
    $('sun').oninput = () => { preview.sunAz = +$('sun').value; preview.dirty = true; };
    $('spin').onchange = () => { preview.spin = $('spin').checked; };
    $('saveCfg').onclick = () => { P.seed = $('seed').value; download(new Blob([JSON.stringify(P, null, 2)], { type: 'application/json' }), `selene_${P.preset}_${P.seed}.json`); };
    $('loadCfg').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const q = JSON.parse(await f.text());
        const base = S.preset(q.preset && S.PRESETS[q.preset] ? q.preset : 'mars');
        P = { ...base, ...q, colors: { ...base.colors, ...(q.colors || {}) } };
        if (!P.nodes) P.nodes = S.Nodes.defaultGraph();
        if (editor) { editor.render(); editor.fit(); }
        $('preset').value = P.preset; $('seed').value = P.seed; $('res').value = P.resolution;
        buildPanel();
      } catch (err) { showError(err); }
      e.target.value = '';
    };
    fillWidths();
    window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate(); });
  }
  window.addEventListener('DOMContentLoaded', init);
  S.ui = { get world() { return world; }, get P() { return P; }, generate, setPreset };
})();
