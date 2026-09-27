// Selene — CPU helpers (seeded RNG, sphere sampling, quantiles) and generic GPU field operations
// (copy, box downsample, bicubic upsample, statistics).
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  function rng(seed) {
    let a = (seed >>> 0) ^ 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randDir(r) {
    const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    return [s * Math.cos(a), z, s * Math.sin(a)];
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function latLonDir(latDeg, lonDeg) {
    const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
    return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
  }
  // value below which fraction q of samples lie (samples taken from channel `ch` of RGBA data)
  function quantile(data, q, ch = 0, stride = 4) {
    const n = data.length / stride, v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = data[i * stride + ch];
    v.sort();
    return v[Math.min(n - 1, Math.max(0, Math.floor(q * n)))];
  }
  function stats(data, ch = 0, stride = 4) {
    let mn = Infinity, mx = -Infinity, s = 0; const n = data.length / stride;
    for (let i = 0; i < n; i++) { const x = data[i * stride + ch]; if (x < mn) mn = x; if (x > mx) mx = x; s += x; }
    return { min: mn, max: mx, mean: s / n };
  }

  S.rng = rng; S.randDir = randDir; S.vdot = dot; S.vcross = cross; S.vnorm = norm; S.latLonDir = latLonDir;
  S.quantile = quantile; S.stats = stats;
  S.hashSeed = (s) => { s = String(s); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ------------------------------------------------------------------ generic GPU ops
  const FS = {
    copy: `uniform sampler2DArray uSrc; out vec4 o; void main() { o = at(uSrc); }`,
    // box-average a field whose face is k times larger (nested EAC grids line up exactly)
    down: `uniform sampler2DArray uSrc; uniform int uK; out vec4 o;
      void main() { ivec2 b = cellXY() * uK; vec4 s = vec4(0.0);
        for (int j = 0; j < 16; j++) { if (j >= uK) break; for (int i = 0; i < 16; i++) { if (i >= uK) break; s += texelFetch(uSrc, ivec3(b + ivec2(i, j), uFace), 0); } }
        o = s / float(uK * uK); }`,
    upCubic: `uniform sampler2DArray uSrc; out vec4 o; void main() { o = vec4(sampleDirCubic(uSrc, cellDir())); }`,
    upLinear: `uniform sampler2DArray uSrc; out vec4 o; void main() { o = sampleDir(uSrc, cellDir()); }`,
    scaleOffset: `uniform sampler2DArray uSrc; uniform vec4 uMul; uniform vec4 uAdd; out vec4 o; void main() { o = at(uSrc) * uMul + uAdd; }`,
  };

  class Ops {
    constructor(gpu) { this.gpu = gpu; }
    p(name) { return this.gpu.program('ops.' + name, FS[name]); }
    copy(src, dst) { this.gpu.run(this.p('copy'), dst, { uSrc: src }); }
    // resample src into dst whatever the sizes
    resample(src, dst, cubic = false) {
      if (src.N === dst.N) return this.copy(src, dst);
      if (src.N > dst.N && src.N % dst.N === 0 && src.N / dst.N <= 16) return this.gpu.run(this.p('down'), dst, { uSrc: src, uK: src.N / dst.N });
      this.gpu.run(this.p(cubic ? 'upCubic' : 'upLinear'), dst, { uSrc: src });
    }
    scaleOffset(src, dst, mul, add) { this.gpu.run(this.p('scaleOffset'), dst, { uSrc: src, uMul: mul, uAdd: add }); }
    // statistics of channel ch computed on a small copy of the field
    fieldStats(src, ch = 0, n = 64) {
      const g = this.gpu, tmp = g.field(Math.min(n, src.N), 'rgba32f');
      this.resample(src, tmp);
      const d = g.readField(tmp); g.free(tmp);
      return { ...stats(d, ch), data: d };
    }
    // exact min/max over the full-resolution field (reads it back face by face)
    fullMinMax(src, ch = 0) {
      let mn = Infinity, mx = -Infinity;
      for (let f = 0; f < 6; f++) { const d = this.gpu.readField(src, f); for (let i = ch; i < d.length; i += 4) { const x = d[i]; if (x < mn) mn = x; if (x > mx) mx = x; } }
      return { min: mn, max: mx };
    }
  }
  S.Ops = Ops;
})();
