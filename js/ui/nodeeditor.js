// Selene — node editor (Blender-style). Boxes with their own controls, wires between sockets.
//   drag a node's title to move it      drag from an output ● to an input ● to connect
//   drag a connected input ● to unplug  drag empty space to pan, mouse wheel to zoom
//   × on a node (or Delete key) removes it
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  class NodeEditor {
    constructor(root, getGraph, onChange) {
      this.root = root; this.getGraph = getGraph; this.onChange = onChange;
      this.view = { x: 20, y: 20, z: 0.85 };
      this.sel = null;
      root.innerHTML = `
        <div class="ne-bar">
          <b>Nodes</b>
          <span class="ne-add"></span>
          <select class="ne-examples"><option value="">Examples…</option></select>
          <button class="ne-tidy" title="Arrange nodes neatly in columns">Tidy</button>
          <button class="ne-fit" title="Fit all nodes in view">Fit</button>
          <span class="ne-hint">drag ● → ● to connect · drag a plugged input to unplug · drag background to pan · wheel to zoom</span>
        </div>
        <div class="ne-view"><div class="ne-canvas"><svg class="ne-wires"></svg></div></div>`;
      this.viewEl = root.querySelector('.ne-view');
      this.canvas = root.querySelector('.ne-canvas');
      this.svg = root.querySelector('.ne-wires');
      const add = root.querySelector('.ne-add');
      for (const t of S.Nodes.ADDABLE) {
        const d = S.Nodes.DEFS[t];
        const b = document.createElement('button');
        b.textContent = '+ ' + d.title; b.title = d.desc;
        b.style.setProperty('--h', d.hue); b.style.setProperty('--s', (d.sat ?? 55) + '%');
        b.onclick = () => this.addNode(t);
        add.appendChild(b);
      }
      const ex = root.querySelector('.ne-examples');
      for (const name of Object.keys(S.Nodes.EXAMPLES)) ex.add(new Option(name, name));
      ex.onchange = () => {
        if (!ex.value) return;
        const g = S.Nodes.EXAMPLES[ex.value]();
        Object.assign(this.getGraph(), g);
        ex.value = '';
        this.render(); requestAnimationFrame(() => { this.tidy(); this.changed(true); });
      };
      root.querySelector('.ne-fit').onclick = () => this.fit();
      root.querySelector('.ne-tidy').onclick = () => this.tidy();
      this._bindView();
      window.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel != null && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && this.root.offsetParent) {
          this.removeNode(this.sel);
        }
      });
    }

    graph() { return this.getGraph(); }
    changed(structural) { this.drawWires(); this.onChange(structural); }

    // ---------------------------------------------------------------- nodes
    addNode(type) {
      const g = this.graph();
      if ((type === 'output' || type === 'world') && g.nodes.some((n) => n.type === type) && type === 'output') { this.flash('There can only be one Output node.'); return; }
      const r = this.viewEl.getBoundingClientRect();
      const x = (r.width * 0.45 - this.view.x) / this.view.z + (Math.random() - 0.5) * 60;
      const y = (r.height * 0.3 - this.view.y) / this.view.z + (Math.random() - 0.5) * 60;
      const params = {};
      for (const p of S.Nodes.DEFS[type].params) params[p.id] = p.value;
      const n = { id: g.nextId++, type, x: Math.round(x), y: Math.round(y), params };
      g.nodes.push(n);
      this.sel = n.id;
      this.render();
      this.changed(true);
    }
    removeNode(id) {
      const g = this.graph();
      const n = g.nodes.find((q) => q.id === id);
      if (!n || n.type === 'output') { if (n) this.flash('The Output node can’t be removed.'); return; }
      g.nodes = g.nodes.filter((q) => q.id !== id);
      g.links = g.links.filter((l) => l.from[0] !== id && l.to[0] !== id);
      this.sel = null;
      this.render();
      this.changed(true);
    }
    flash(msg) {
      const h = this.root.querySelector('.ne-hint');
      const old = h.dataset.old || h.textContent; h.dataset.old = old;
      h.textContent = msg; h.classList.add('warn');
      clearTimeout(this._ft); this._ft = setTimeout(() => { h.textContent = old; h.classList.remove('warn'); }, 2500);
    }

    render() {
      const g = this.graph();
      this.canvas.querySelectorAll('.ne-node').forEach((e) => e.remove());
      this.els = new Map();
      for (const n of g.nodes) this.canvas.appendChild(this.nodeEl(n));
      this.applyView();
      requestAnimationFrame(() => this.drawWires());
    }

    nodeEl(n) {
      const def = S.Nodes.DEFS[n.type];
      const el = document.createElement('div');
      el.className = 'ne-node' + (this.sel === n.id ? ' sel' : '');
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
      el.style.setProperty('--h', def.hue); el.style.setProperty('--s', (def.sat ?? 55) + '%');
      el.innerHTML = `<div class="ne-head" title="${def.desc}"><span>${def.title}</span>${n.type === 'output' ? '' : '<button class="ne-x" title="Remove">×</button>'}</div>`;
      const body = document.createElement('div'); body.className = 'ne-body';
      // sockets: outputs first (right), then inputs (left), like Blender
      for (const o of def.outputs) body.appendChild(this.sockRow(n, o, 'out'));
      for (const i of def.inputs) body.appendChild(this.sockRow(n, i, 'in'));
      for (const p of def.params) body.appendChild(this.paramEl(n, p));
      el.appendChild(body);
      const head = el.querySelector('.ne-head');
      head.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('ne-x')) return;
        e.stopPropagation();
        this.select(n.id);
        const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
        head.setPointerCapture(e.pointerId);
        const mv = (ev) => { n.x = Math.round(ox + (ev.clientX - sx) / this.view.z); n.y = Math.round(oy + (ev.clientY - sy) / this.view.z); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; this.drawWires(); };
        const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); };
        head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
      });
      const x = el.querySelector('.ne-x');
      if (x) x.onclick = () => this.removeNode(n.id);
      el.addEventListener('pointerdown', () => this.select(n.id));
      this.els.set(n.id, el);
      return el;
    }
    select(id) {
      this.sel = id;
      this.canvas.querySelectorAll('.ne-node').forEach((e) => e.classList.remove('sel'));
      const el = this.els.get(id); if (el) el.classList.add('sel');
    }

    sockRow(n, s, dir) {
      const row = document.createElement('div');
      row.className = 'ne-row ' + dir;
      row.innerHTML = `<span class="ne-sock ${s.kind}" data-node="${n.id}" data-sock="${s.id}" data-dir="${dir}"></span><span class="ne-lbl">${s.label}</span>`;
      const dot = row.querySelector('.ne-sock');
      dot.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.startWire(e, n.id, s.id, dir); });
      return row;
    }

    paramEl(n, p) {
      const row = document.createElement('div');
      row.className = 'ne-param';
      const val = n.params[p.id] ?? p.value;
      const set = (v, structural) => { n.params[p.id] = v; this.changed(structural); };
      if (p.type === 'select') {
        row.innerHTML = `<label>${p.label}</label>`;
        const s = document.createElement('select');
        for (const [v, t] of p.options) s.add(new Option(t, v));
        s.value = val; s.onchange = () => set(+s.value, true);
        row.appendChild(s);
      } else if (p.type === 'color') {
        row.innerHTML = `<label>${p.label}</label>`;
        const c = document.createElement('input'); c.type = 'color'; c.value = val;
        c.oninput = () => set(c.value, false);
        row.appendChild(c);
      } else if (p.type === 'check') {
        row.classList.add('check');
        row.innerHTML = `<label><input type="checkbox"> ${p.label}</label>`;
        const c = row.querySelector('input'); c.checked = !!val; c.onchange = () => set(c.checked, true);
      } else {
        row.innerHTML = `<label>${p.label}</label><div class="ne-rng"><input type="range"><input type="number"></div>`;
        const [r, num] = row.querySelectorAll('input');
        // sliders cover the useful span; the number box accepts the full range
        const lo = p.min, hi = p.max;
        for (const x of [r, num]) { x.min = lo; x.max = hi; x.step = p.step; x.value = val; }
        r.oninput = () => { num.value = r.value; set(+r.value, false); };
        num.onchange = () => { const v = Math.min(hi, Math.max(lo, +num.value)); num.value = v; r.value = v; set(v, false); };
      }
      row.addEventListener('pointerdown', (e) => e.stopPropagation());
      row.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      return row;
    }

    // ---------------------------------------------------------------- wires
    sockPos(nodeId, sockId, dir) {
      const el = this.els && this.els.get(nodeId);
      const dot = el && el.querySelector(`.ne-sock[data-sock="${sockId}"][data-dir="${dir}"]`);
      if (!dot) return null;
      const cr = this.canvas.getBoundingClientRect(), r = dot.getBoundingClientRect();
      return [(r.left + r.width / 2 - cr.left) / this.view.z, (r.top + r.height / 2 - cr.top) / this.view.z];
    }
    path(a, b) {
      const dx = Math.max(40, Math.abs(b[0] - a[0]) * 0.5);
      return `M${a[0]},${a[1]} C${a[0] + dx},${a[1]} ${b[0] - dx},${b[1]} ${b[0]},${b[1]}`;
    }
    drawWires(temp) {
      const g = this.graph();
      let html = '';
      for (const l of g.links) {
        const a = this.sockPos(l.from[0], l.from[1], 'out'), b = this.sockPos(l.to[0], l.to[1], 'in');
        if (!a || !b) continue;
        const fromN = g.nodes.find((n) => n.id === l.from[0]);
        const kind = fromN && S.Nodes.DEFS[fromN.type].outputs.find((o) => o.id === l.from[1]);
        html += `<path class="ne-wire ${kind ? kind.kind : ''}" d="${this.path(a, b)}"/>`;
      }
      if (temp) html += `<path class="ne-wire temp" d="${this.path(temp[0], temp[1])}"/>`;
      this.svg.innerHTML = html;
    }
    startWire(e, nodeId, sockId, dir) {
      const g = this.graph();
      let from;
      if (dir === 'in') {                      // unplug: pick up the existing wire by its far end
        const i = g.links.findIndex((l) => l.to[0] === nodeId && l.to[1] === sockId);
        if (i < 0) return;
        from = g.links[i].from;
        g.links.splice(i, 1);
        this.changed(true);
      } else from = [nodeId, sockId];
      const a = this.sockPos(from[0], from[1], 'out');
      const cr = () => this.canvas.getBoundingClientRect();
      const mv = (ev) => { const r = cr(); this.drawWires([a, [(ev.clientX - r.left) / this.view.z, (ev.clientY - r.top) / this.view.z]]); };
      const up = (ev) => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const dot = t && (t.classList.contains('ne-sock') ? t : t.closest && t.closest('.ne-row.in') && t.closest('.ne-row.in').querySelector('.ne-sock'));
        if (dot && dot.dataset.dir === 'in') this.connect(from, [+dot.dataset.node, dot.dataset.sock]);
        else this.drawWires();
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      mv(e);
    }
    connect(from, to) {
      const g = this.graph();
      if (from[0] === to[0]) { this.drawWires(); return; }
      const trial = g.links.filter((l) => !(l.to[0] === to[0] && l.to[1] === to[1])).concat([{ from, to }]);
      // refuse loops
      const reach = (a, b, seen = new Set()) => { if (a === b) return true; if (seen.has(a)) return false; seen.add(a); return trial.some((l) => l.from[0] === a && reach(l.to[0], b, seen)); };
      if (reach(to[0], from[0])) { this.flash('That would make a loop.'); this.drawWires(); return; }
      g.links = trial;
      this.changed(true);
    }

    // Columns by data-flow depth (sources left, Output right), stacked by real box heights.
    tidy() {
      const g = this.graph();
      const depth = new Map();
      const d = (id, seen = new Set()) => {
        if (depth.has(id)) return depth.get(id);
        if (seen.has(id)) return 0; seen.add(id);
        const ins = g.links.filter((l) => l.to[0] === id);
        const v = ins.length ? 1 + Math.max(...ins.map((l) => d(l.from[0], seen))) : 0;
        depth.set(id, v); return v;
      };
      g.nodes.forEach((n) => d(n.id));
      const out = g.nodes.find((n) => n.type === 'output');
      const maxD = Math.max(0, ...g.nodes.filter((n) => n !== out).map((n) => depth.get(n.id)));
      if (out) depth.set(out.id, maxD + 1);
      const cols = new Map();
      for (const n of g.nodes) { const k = depth.get(n.id); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(n); }
      for (const [k, list] of cols) {
        let y = 0;
        list.sort((a, b) => a.y - b.y);
        for (const n of list) {
          n.x = k * 250; n.y = y;
          const el = this.els.get(n.id);
          y += (el ? el.offsetHeight : 200) + 24;
        }
      }
      this.render();
      requestAnimationFrame(() => this.fit());
    }

    // ---------------------------------------------------------------- pan / zoom
    applyView() { this.canvas.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.z})`; }
    _bindView() {
      const v = this.viewEl;
      v.addEventListener('pointerdown', (e) => {
        if (e.target !== v && e.target !== this.canvas && e.target !== this.svg) return;
        this.select(null);
        const sx = e.clientX, sy = e.clientY, ox = this.view.x, oy = this.view.y;
        v.setPointerCapture(e.pointerId);
        const mv = (ev) => { this.view.x = ox + ev.clientX - sx; this.view.y = oy + ev.clientY - sy; this.applyView(); };
        const up = () => { v.removeEventListener('pointermove', mv); v.removeEventListener('pointerup', up); };
        v.addEventListener('pointermove', mv); v.addEventListener('pointerup', up);
      });
      v.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = v.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        const z0 = this.view.z, z = Math.min(1.6, Math.max(0.3, z0 * Math.exp(-e.deltaY * 0.0012)));
        this.view.x = mx - (mx - this.view.x) * z / z0; this.view.y = my - (my - this.view.y) * z / z0; this.view.z = z;
        this.applyView(); this.drawWires();
      }, { passive: false });
    }
    fit() {
      const g = this.graph(); if (!g.nodes.length) return;
      const xs = g.nodes.map((n) => n.x), ys = g.nodes.map((n) => n.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs) + 230, y0 = Math.min(...ys);
      const y1 = Math.max(...g.nodes.map((n) => n.y + ((this.els && this.els.get(n.id)) ? this.els.get(n.id).offsetHeight : 300)));
      const r = this.viewEl.getBoundingClientRect();
      const z = Math.min(1.1, Math.max(0.62, Math.min(r.width / (x1 - x0 + 40), r.height / (y1 - y0 + 40))));
      this.view = { z, x: (r.width - (x1 - x0) * z) / 2 - x0 * z, y: 16 - y0 * z };
      this.applyView(); requestAnimationFrame(() => this.drawWires());
    }
  }
  S.NodeEditor = NodeEditor;
})();
