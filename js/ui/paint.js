// Selene — painting on the globe. A paint layer (RGBA16F cube field) holds three brush masks (r, g, b)
// and height edits in metres (a). Everything you do is recorded as a list of operations in the
// settings, so it replays exactly on regenerate, at any resolution, and is saved with your preset.
//   mask brushes 1–3, eraser, raise / lower, click-to-place crater / volcano, drag-to-cut canyon.
// Use the masks in the node editor with the "Painted" node.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const DAB = String.raw`//#include planet
uniform vec3 uC, uC2; uniform float uRad, uStr, uHard, uR, uDepth; uniform int uMode;
layout(location = 0) out vec4 o;
void main() {
  vec3 p = cellDir();
  float a = gcDist(p, uC);
  if (uMode <= 4) {                                     // brushes
    float d = a / uRad; if (d >= 1.0) discard;
    float f = (1.0 - sstep(uHard * 0.98, 1.0, d)) * uStr;
    vec4 v = vec4(0.0);
    if (uMode == 0) v.r = f; else if (uMode == 1) v.g = f; else if (uMode == 2) v.b = f;
    else if (uMode == 3) v.rgb = vec3(-f); else v.a = f;   // mode 4: height (uStr in metres, signed)
    o = v; return;
  }
  if (uMode == 5) {                                     // crater: real morphology, uRad = radius (rad)
    float d = a / uRad; if (d > 3.2) discard;
    float az = snoise(vec3(normalize(p - uC) * 3.0));
    float Dkm = 2.0 * uRad * uR * 0.001;
    o = vec4(0.0, 0.0, 0.0, uDepth * craterProfile(d * (1.0 + 0.05 * az), Dkm, 15.0, 1.0, az, 0.4)); return;
  }
  if (uMode == 6) {                                     // shield volcano with caldera and flank texture
    float d = a / uRad; if (d > 1.4) discard;
    float cone = pow(sat(1.0 - d), 1.3) * (1.0 + 0.05 * ridged(vec3(atan(dot(p - uC, northOf(uC)), dot(p - uC, eastOf(uC))) * 16.0, d * 5.0, 3.0), 3));
    float cal = sstep(0.14, 0.1, d);
    o = vec4(0.0, 0.0, 0.0, uDepth * (cone - 0.15 * cal)); return;
  }
  // mode 7: canyon along the great-circle segment uC -> uC2, uRad = half width (rad)
  vec3 ab = uC2 - uC; float t = clamp(dot(p - uC, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
  float dist = gcDist(p, normalize(uC + ab * t));
  float x = dist / uRad + 0.25 * fbm(p * (uR / 40000.0), 3);
  if (x > 2.6) discard;
  float wall = sstep(0.55, 1.0, x);
  float steps = floor(wall * 5.0) / 5.0 + sstep(0.6, 1.0, fract(wall * 5.0)) / 5.0;
  float ends = sstep(0.0, 0.08, t) * sstep(1.0, 0.92, t);
  o = vec4(0.0, 0.0, 0.0, -uDepth * (1.0 - mix(wall, steps, 0.5)) * mix(0.3, 1.0, ends));
}`;
  const CLAMP = `uniform sampler2DArray uSrc; out vec4 o; void main() { vec4 v = at(uSrc); o = vec4(clamp(v.rgb, 0.0, 1.0), v.a); }`;

  function ensureLayer(world) {
    if (!world.paint) {
      world.paint = world.ctx.gpu.field(world.N, 'rgba16f', 'paint');
      world.ctx.ops.scaleOffset(world.baseH, world.paint, [0, 0, 0, 0], [0, 0, 0, 0]);
    }
    return world.paint;
  }
  // op: { t: 'mask'|'erase'|'height'|'crater'|'volcano'|'canyon', c:[x,y,z], c2, r (km), s (strength), h (hardness), ch (channel), dep (m) }
  function drawOp(world, op) {
    const gpu = world.ctx.gpu, prog = gpu.program('paint.dab', DAB);
    const km = (x) => x * 1000 / world.R;
    const mode = { mask: op.ch, erase: 3, height: 4, crater: 5, volcano: 6, canyon: 7 }[op.t];
    // only faces the stamp can touch
    const reach = km(op.r) * (op.t === 'crater' ? 3.3 : op.t === 'canyon' ? 3 : 1.5) + (op.c2 ? Math.acos(Math.max(-1, Math.min(1, S.vdot(op.c, op.c2)))) : 0);
    const normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const faces = [];
    normals.forEach((n, f) => { const ang = Math.acos(Math.max(-1, Math.min(1, S.vdot(n, op.c)))); if (ang - reach < Math.PI / 2 * 1.05) faces.push(f); });
    gpu.run(prog, ensureLayer(world), {
      uC: op.c, uC2: op.c2 || op.c, uRad: km(op.r), uStr: op.t === 'height' ? op.s : op.s, uHard: op.h ?? 0.5, uR: world.R, uDepth: op.dep ?? 1000, uMode: mode,
    }, { blend: 'add', faces });
  }
  function clampLayer(world) {
    const gpu = world.ctx.gpu, tmp = gpu.field(world.N, 'rgba16f');
    gpu.run(gpu.program('paint.clamp', CLAMP), tmp, { uSrc: world.paint });
    world.ctx.ops.copy(tmp, world.paint); gpu.free(tmp);
  }
  async function replay(world, ops) {
    if (!ops || !ops.length) return;
    ensureLayer(world);
    for (let i = 0; i < ops.length; i++) {
      drawOp(world, ops[i]);
      if (ops[i].end) clampLayer(world);
      if (i % 40 === 39) await world.ctx.gpu.sync();
    }
    clampLayer(world);
  }

  // ---------------------------------------------------------------- tool
  class PaintTool {
    constructor(ui) {
      this.ui = ui;                    // { world(), P(), preview, refresh() }
      this.mode = 'mask'; this.ch = 0; this.size = 150; this.strength = 0.35; this.hard = 0.4; this.featSize = 120; this.featDepth = 2000;
      this.stroke = null;
    }
    radius() { const w = this.ui.world(); if (!w) return 0; const r = this.mode === 'crater' || this.mode === 'volcano' || this.mode === 'canyon' ? this.featSize / (this.mode === 'canyon' ? 2 : 1) : this.size; return r * 1000 / w.R; }
    ops() { const P = this.ui.P(); P.paint = P.paint || []; return P.paint; }
    add(op) { const w = this.ui.world(); this.ops().push(op); drawOp(w, op); }
    down(d, e) {
      const w = this.ui.world(); if (!w || !d) return;
      this.last = d; this.start = d;
      if (this.mode === 'canyon') return;
      if (this.mode === 'crater' || this.mode === 'volcano') {
        this.add({ t: this.mode, c: d, r: this.featSize / (this.mode === 'crater' ? 2 : 1), dep: this.mode === 'crater' ? this.featDepth / 2000 : this.featDepth, end: 1 });
        this.ui.refresh(true); return;
      }
      this.dab(d, e);
    }
    dab(d, e) {
      const lower = e && (e.altKey || e.ctrlKey);
      const op = this.mode === 'mask' ? { t: 'mask', ch: this.ch, c: d, r: this.size, s: this.strength, h: this.hard }
        : this.mode === 'erase' ? { t: 'erase', c: d, r: this.size, s: this.strength, h: this.hard }
          : { t: 'height', c: d, r: this.size, s: (this.mode === 'lower' || lower ? -1 : 1) * this.strength * 400, h: this.hard };
      this.add(op);
      this.ui.refresh(false);
    }
    move(d, e) {
      if (!d || !this.last) return;
      if (this.mode === 'canyon' || this.mode === 'crater' || this.mode === 'volcano') return;
      const w = this.ui.world();
      const ang = Math.acos(Math.max(-1, Math.min(1, S.vdot(d, this.last))));
      if (ang * w.R / 1000 < this.size * 0.3) return;
      this.last = d; this.dab(d, e);
    }
    up(d) {
      const w = this.ui.world(); if (!w) return;
      if (this.mode === 'canyon' && this.start && d) {
        this.add({ t: 'canyon', c: this.start, c2: d, r: this.featSize / 2, dep: this.featDepth, end: 1 });
      } else if (this.ops().length) { this.ops()[this.ops().length - 1].end = 1; clampLayer(w); }
      this.last = null; this.start = null;
      this.ui.refresh(true);
    }
  }

  S.Paint = { ensureLayer, replay, drawOp, clampLayer, PaintTool };
})();
