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
    $('presetDesc').textContent = S.PRESETS[P.preset] ? S.PRESETS[P.preset].desc : '';
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
    for (const k of Object.keys(P.colors || {})) {
      if (P.model !== 'terran' && !S.WORLD_COLORS_USED.includes(k)) continue;
      const c = document.createElement('input');
      c.type = 'color'; c.value = P.colors[k];
      c.oninput = () => { P.colors[k] = c.value; };
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
      cb.onchange = () => { P[it.key] = cb.checked; buildPanel(); };
      return el;
    }
    if (it.type === 'select' || it.type === 'text') {
      el.className = 'ctl ' + it.type;
      el.innerHTML = `<div class="lbl"><span>${it.label}</span>${help}</div>`;
      const inp = document.createElement(it.type === 'select' ? 'select' : 'input');
      if (it.type === 'select') for (const [v, t] of it.options) inp.add(new Option(t, v));
      inp.value = P[it.key];
      inp.onchange = () => { P[it.key] = it.type === 'select' ? +inp.value : inp.value; };
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
      if (/^(craters|basins|rises|giantVolcanoes|canyons|canyonNet|cracks|grooves|chaos|scarps|paterae|tesserae|shieldFields|blockMountains|maria|rayed)$/.test(it.key)) scheduleRebuild();
    };
    rg.oninput = () => set(rg.value, rg);
    nm.onchange = () => set(nm.value, nm);
    return el;
  }
  let rebuildT = 0;
  function scheduleRebuild() { clearTimeout(rebuildT); rebuildT = setTimeout(buildPanel, 400); }

  function setPreset(id) {
    const keepSeed = P ? P.seed : 'selene', keepRes = P ? P.resolution : 512;
    P = S.preset(id);
    P.seed = keepSeed; P.resolution = keepRes;
    $('seed').value = P.seed;
    $('res').value = P.resolution;
    buildPanel();
  }

  // ------------------------------------------------------------------ generation
  function progress(msg, f) {
    $('progtxt').textContent = msg;
    $('progfill').style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
  }
  async function generate() {
    if (busy) return;
    busy = true; $('gen').disabled = true; $('exGo').disabled = true;
    preview.busy = true;
    try {
      P.seed = $('seed').value; P.resolution = +$('res').value;
      if (world) { world.dispose(); world = null; preview.setWorld(null); }
      const w = await S.generate(gpu, JSON.parse(JSON.stringify(P)), progress);
      world = w;
      preview.setWorld(w);
      $('empty').hidden = true;
      progress(`Done in ${w.seconds.toFixed(1)} s`, 1);
      const R = w.R / 1000;
      $('stats').innerHTML = `${S.PRESETS[P.preset] ? S.PRESETS[P.preset].name : ''} · seed “${P.seed}”<br>relief ${(w.ctx.hmin / 1000).toFixed(1)} … ${(w.ctx.hmax / 1000).toFixed(1)} km on a ${R.toFixed(0)} km world<br>${w.N}² × 6 cube faces · GPU memory ${gpu.memoryMB().toFixed(0)} MB`;
      fillWidths();
    } catch (e) { showError(e); progress('Failed — see error', 0); }
    busy = false; $('gen').disabled = false; $('exGo').disabled = false; preview.busy = false; preview.dirty = true;
  }

  function fillWidths() {
    const sel = $('exW'), cur = +sel.value;
    const N = world ? world.N : +$('res').value;
    sel.innerHTML = '';
    for (const w of [1024, 2048, 4096, 8192, 16384]) {
      if (w > Math.min(16384, N * 8)) continue;
      if (w === 16384 && N < 2048) continue;
      sel.add(new Option(`${w} × ${w / 2}${w > N * 4 ? ' (upsampled)' : ''}`, w));
    }
    sel.value = cur && [...sel.options].some((o) => +o.value === cur) ? cur : Math.min(8192, N * 4);
  }

  // ------------------------------------------------------------------ export
  async function doExport() {
    if (!world || busy) return;
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
      // height
      ep('Resampling height…');
      let hf = await E.equirect(world, 'height', W, Hh, opts, (f) => ep(`Height ${Math.round(f * 100)}%`));
      if (hs !== 1) for (let i = 0; i < hf.length; i++) hf[i] *= hs;
      const mm = E.minMax(hf);
      if ($('mH16').checked) { ep('Encoding 16-bit height…'); fn.height16 = `${name}_height16.png`; await add(fn.height16, await E.encodePNG(E.heightTo16(hf, mm.min, mm.max), W, Hh, 1, 16)); }
      if ($('mH8').checked) { ep('Encoding 8-bit height…'); fn.height8 = `${name}_height8.png`; await add(fn.height8, await E.encodePNG(E.heightTo8(hf, mm.min, mm.max, true), W, Hh, 1, 8)); }
      if (world.P.ocean && $('mH16').checked) { // Blender-friendly version with the ocean surface flat at sea level
        const hs2 = hf.map((v) => Math.max(v, 0));
        fn.heightSurface16 = `${name}_surface16.png`;
        await add(fn.heightSurface16, await E.encodePNG(E.heightTo16(hs2, mm.min, mm.max), W, Hh, 1, 16));
      }
      hf = null;
      // colour
      if ($('mColor').checked || $('mSpec').checked) {
        ep('Resampling colour…');
        const alb = await E.equirect(world, 'albedo', W, Hh, opts, (f) => ep(`Colour ${Math.round(f * 100)}%`));
        if ($('mColor').checked) { ep('Encoding colour…'); fn.color = `${name}_color.png`; await add(fn.color, await E.encodePNG(E.rgbaToRGB(alb), W, Hh, 3, 8)); }
        if ($('mSpec').checked) { fn.spec = `${name}_specular.png`; await add(fn.spec, await E.encodePNG(E.channel(alb, 3), W, Hh, 1, 8)); }
      }
      if ($('mNormal').checked) {
        ep('Computing normal map…');
        const k = (+$('exNorm').value || 1) * hs * (world.R / 1000) / radiusKm;
        const nrm = await E.equirect(world, 'normal', W, Hh, { ...opts, normalStrength: k, flatSea: world.P.ocean }, (f) => ep(`Normals ${Math.round(f * 100)}%`));
        fn.normal = `${name}_normal.png`; await add(fn.normal, await E.encodePNG(E.rgbaToRGB(nrm), W, Hh, 3, 8));
      }
      if ($('mEmit').checked && world.P.emissive) {
        ep('Resampling emission…');
        const em = await E.equirect(world, 'emission', W, Hh, opts);
        fn.emission = `${name}_emission.png`; await add(fn.emission, await E.encodePNG(E.rgbaToRGB(em), W, Hh, 3, 8));
      }
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
    for (const [id, pr] of Object.entries(S.PRESETS)) $('preset').add(new Option(pr.name, id));
    const resIt = S.SCHEMA.find((x) => x.key === 'resolution');
    for (const [v, t] of resIt.options) $('res').add(new Option(t, v));
    $('preset').value = 'mars';
    setPreset('mars');
    $('preset').onchange = () => setPreset($('preset').value);
    $('dice').onclick = () => { $('seed').value = Math.random().toString(36).slice(2, 8); P.seed = $('seed').value; };
    $('res').onchange = () => { P.resolution = +$('res').value; fillWidths(); };
    $('gen').onclick = generate;
    $('exGo').onclick = doExport;
    $('exGo').disabled = true;
    $('exAuto').onclick = () => { if (world) $('exHScale').value = (+$('exRadius').value * 1000 / world.R).toPrecision(3); };
    document.querySelectorAll('#viewMode button').forEach((b) => b.onclick = () => {
      document.querySelectorAll('#viewMode button').forEach((x) => x.classList.toggle('on', x === b));
      preview.view = +b.dataset.v; preview.dirty = true;
    });
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
