// Selene — landscape evolution on the cube-sphere.
// Stream-power fluvial incision (dh/dt = U − K·A^m·S) solved implicitly per cell, with
// multiple-flow-direction drainage accumulated iteratively on the GPU (after Schott et al. 2023,
// "Large-scale terrain authoring through interactive erosion simulation"), plus hillslope
// diffusion, talus (thermal) collapse and depression filling. Runs coarse-to-fine: each finer
// level re-injects the original high-frequency relief the coarse level could not represent.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const FLOW = `
uniform sampler2DArray uH; uniform float uR, uSea, uP;
out vec4 o;
void main() {
  vec3 p = cellDir(); float h = at(uH).r;
  if (h < uSea) { o = vec4(0.0, 0.0, h, 1.0); return; }
  float sumW = 0.0, smax = 0.0, hr = h, dr = 1.0;
  for (int k = 0; k < 8; k++) {
    ivec3 c = wrapTexel(uFace, cellXY() + N8[k], uN);
    float hk = texelFetch(uH, c, 0).r;
    float d = gcDist(p, texelDir(c.z, vec2(c.xy) + 0.5, uN)) * uR;
    float s = (h - hk) / d;
    if (s > 0.0) { sumW += pow(s, uP); if (s > smax) { smax = s; hr = hk; dr = d; } }
  }
  o = vec4(sumW, smax, hr, dr);
}`;

  const DRAIN = `
uniform sampler2DArray uH, uW, uA, uRain; uniform float uR, uP, uUseRain;
out vec4 o;
void main() {
  vec3 p = cellDir(); float h = at(uH).r;
  vec3 px = texelDir(uFace, gl_FragCoord.xy + vec2(1.0, 0.0), uN), py = texelDir(uFace, gl_FragCoord.xy + vec2(0.0, 1.0), uN);
  float area = gcDist(p, px) * gcDist(p, py) * uR * uR * 1e-6;   // km²
  float rain = uUseRain > 0.5 ? max(0.05, sampleDir(uRain, p).r) : 1.0;
  float A = area * rain;
  for (int k = 0; k < 8; k++) {
    ivec3 c = wrapTexel(uFace, cellXY() + N8[k], uN);
    float hk = texelFetch(uH, c, 0).r;
    if (hk <= h) continue;
    vec4 wk = texelFetch(uW, c, 0);
    if (wk.x <= 0.0) continue;
    float d = gcDist(p, texelDir(c.z, vec2(c.xy) + 0.5, uN)) * uR;
    A += pow((hk - h) / d, uP) / wk.x * texelFetch(uA, c, 0).r;
  }
  o = vec4(A);
}`;

  const ERODE = `
uniform sampler2DArray uH, uW, uA, uT;
uniform float uR, uSea, uK, uM, uUplift, uKd, uTalus, uThermal, uFill, uSeaSmooth, uAc;
out vec4 o;
void main() {
  vec3 p = cellDir(); float h = at(uH).r; vec4 w = at(uW);
  float hmin = 1e20, lap = 0.0, th = 0.0;
  for (int k = 0; k < 8; k++) {
    ivec3 c = wrapTexel(uFace, cellXY() + N8[k], uN);
    float hk = texelFetch(uH, c, 0).r;
    float d = gcDist(p, texelDir(c.z, vec2(c.xy) + 0.5, uN)) * uR;
    hmin = min(hmin, hk);
    if (k < 4) lap += hk - h;
    float dz = hk - h, lim = uTalus * d;
    if (dz > lim) th += dz - lim; else if (-dz > lim) th -= -dz - lim;
  }
  if (h < uSea) {                        // sea floor: only slow smoothing (sediment drape)
    o = vec4(h + uSeaSmooth * lap * 0.25 + uThermal * th * 0.125);
    return;
  }
  float U = uUplift * sampleDir(uT, p).r;
  float hn;
  if (w.y > 0.0) {
    float A = max(0.0, at(uA).r - uAc);           // only channels (not hillslopes) incise
    float ke = uK * pow(A, uM) / w.w;
    float base = max(w.z, uSea);
    hn = (h + U + ke * base) / (1.0 + ke);
    hn = max(hn, base);
  } else {
    hn = min(max(h + U, hmin + 0.05), h + U + uFill);   // fill depressions so rivers can drain
  }
  hn += uKd * lap * 0.25 + uThermal * th * 0.125;
  o = vec4(max(hn, uSea + 0.5));                  // land never erodes below sea level (coastal plains)
}`;

  // Coarse-to-fine re-injection of the original detail, damped where the coarse level eroded
  // deep valleys (so their floors stay smooth instead of regaining noise).
  const INJECT = `
uniform sampler2DArray uHc, uP0, uPc; uniform float uFade;
out vec4 o;
void main() {
  vec3 p = cellDir();
  float hc = sampleDirCubic(uHc, p);
  float pc = sampleDirCubic(uPc, p);
  float detail = at(uP0).r - pc;
  float eroded = max(0.0, pc - hc);
  o = vec4(hc + detail * exp(-eroded / uFade));
}`;

  function levelsFor(N, minN) {
    const lv = [];
    for (let n = N; n >= minN; n >>= 1) lv.unshift(n);
    if (!lv.length) lv.push(N);
    return lv;
  }

  // ctx: {gpu, ops, N, R, P}; H: full-res height field (modified in place); T: tectonic field.
  async function run(ctx, H, T, report, p0 = 0.1, p1 = 0.5, rain = null) {
    const { gpu, ops, P } = ctx;
    const iters = Math.round(P.erosionIterations || 0);
    if (!iters || !P.erosion) return null;
    const flow = gpu.program('ero.flow', FLOW), drain = gpu.program('ero.drain', DRAIN), erode = gpu.program('ero.erode', ERODE), inject = gpu.program('ero.inject', INJECT);
    const minN = Math.min(ctx.N, P.erosionBaseRes || 128);
    const levels = levelsFor(ctx.N, minN).slice(-5);
    // original relief pyramid
    const pyr = levels.map((n) => (n === ctx.N ? H : gpu.field(n, 'r32f')));
    for (let i = levels.length - 2; i >= 0; i--) ops.resample(pyr[i + 1], pyr[i]);
    const sea = P.ocean ? 0 : -1e9;
    let Hc = null, A = null;
    // total work budget spread so coarse levels (cheap) get the most iterations
    const weights = levels.map((_, i) => Math.pow(0.55, levels.length - 1 - i));
    const wsum = weights.reduce((a, b) => a + b, 0);
    let done = 0;
    const totalIt = levels.map((_, i) => Math.max(8, Math.round(iters * levels.length * weights[i] / wsum)));
    const allIt = totalIt.reduce((a, b) => a + b, 0);
    for (let li = 0; li < levels.length; li++) {
      const n = levels[li];
      const cell = (Math.PI / 2 / n) * ctx.R;
      const h1 = gpu.field(n, 'r32f'), h2 = gpu.field(n, 'r32f'), W = gpu.field(n, 'rgba32f');
      const a1 = gpu.field(n, 'r32f'), a2 = gpu.field(n, 'r32f');
      if (!Hc) ops.copy(pyr[li], h1);
      else gpu.run(inject, h1, { uHc: Hc, uP0: pyr[li], uPc: pyr[li - 1], uFade: P.detailFade || 150 });
      if (A) ops.resample(A, a1, false); else ops.scaleOffset(h1, a1, [0, 0, 0, 0], [cell * cell * 1e-6, 0, 0, 0]);
      if (Hc) { gpu.free(Hc); gpu.free(A); }
      // physical rates scaled per level so each iteration does comparable work on every grid
      // ke = K·√A/d with d ≈ cell  →  incision per step ≈ strength·5e-5·√A(km²), same on every grid
      const Kl = P.erosionStrength * 5e-5 * cell;
      const U = {
        uR: ctx.R, uSea: sea, uP: P.flowExponent || 2.0, uK: Kl, uM: 0.5,
        uUplift: (P.uplift || 0) * (cell / 10000), uKd: P.hillslope ?? 0.02, uAc: 3 * cell * cell * 1e-6, uTalus: P.talus || 0.6,
        uThermal: 0.35, uFill: P.fillRate ?? 1e9, uSeaSmooth: 0.02, uT: T, uRain: rain || T, uUseRain: rain ? 1 : 0,
      };
      let hs = h1, ht = h2, as = a1, at = a2;
      const it = totalIt[li];
      for (let k = 0; k < it; k++) {
        gpu.run(flow, W, { ...U, uH: hs });
        gpu.run(drain, at, { ...U, uH: hs, uW: W, uA: as });
        [as, at] = [at, as];
        gpu.run(erode, ht, { ...U, uH: hs, uW: W, uA: as });
        [hs, ht] = [ht, hs];
        if (n >= 1024 || k % 4 === 3) {   // big grids: wait every step so no submission gets long
          await gpu.sync();
          report(`Eroding river valleys (${n}² per face, step ${k + 1}/${it})`, p0 + (p1 - p0) * (done + k) / allIt);
        }
      }
      done += it;
      gpu.free(ht); gpu.free(at); gpu.free(W);
      Hc = hs; A = as;
    }
    for (let i = 0; i < pyr.length - 1; i++) gpu.free(pyr[i]);
    ops.copy(Hc, H);
    gpu.free(Hc);
    return A; // drainage area (km²) at full resolution
  }

  S.Erosion = { run };
})();
