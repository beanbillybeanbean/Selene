// Selene — climate: mean annual temperature (latitude, lapse rate, ocean moderation) and
// precipitation from a moisture-transport model. Water vapour evaporates off the oceans, is carried
// by the prevailing wind belts (trade winds, westerlies, polar easterlies), rains out where air is
// forced upward over mountains or rises in the ITCZ and polar front, is suppressed under the
// subtropical highs, and is partly recycled by land. This gives rain shadows, dry continental
// interiors, west-coast deserts and wet windward slopes without painting any of them by hand.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const COMMON = `
uniform float uT0, uDT, uLapse, uSeed, uWindNoise;
float latDeg(vec3 p) { return degrees(asin(clamp(p.y, -1.0, 1.0))); }
float seaTemp(vec3 p) { float s = p.y * p.y; return uT0 + uDT * (1.0 / 3.0 - s); }
vec2 windEN(vec3 p) {
  float lat = latDeg(p), a = abs(lat), sg = lat < 0.0 ? -1.0 : 1.0;
  float t1 = sstep(24.0, 36.0, a), t2 = sstep(54.0, 66.0, a);
  float u = mix(mix(-0.85, 1.0, t1), -0.55, t2);
  float vTrade = -0.4 * (1.0 - t1) * sstep(0.0, 10.0, a);
  float vWest = 0.25 * t1 * (1.0 - t2);
  float vPolar = -0.25 * t2;
  vec2 w = vec2(u, sg * (vTrade + vWest + vPolar));
  vec3 so = seedOff(uSeed + 9.0);
  w += uWindNoise * vec2(fbm(p * 3.0 + so, 3), fbm(p * 3.0 - so, 3));
  return w;
}
float qsat(float T) { return exp(0.068 * (T - 15.0)); }
`;

  // gradient of the (smoothed) terrain + ocean mask + land temperature
  const PREP = COMMON + `
uniform sampler2DArray uH, uOceanLo; uniform float uR, uSea;
out vec4 o;
void main() {
  vec3 p = cellDir(); float h = at(uH).r;
  vec3 e = eastOf(p), n = northOf(p);
  float d = texelAngle(uN) * uR;
  float hx = sampleDir(uH, normalize(p + e * texelAngle(uN))).r - sampleDir(uH, normalize(p - e * texelAngle(uN))).r;
  float hy = sampleDir(uH, normalize(p + n * texelAngle(uN))).r - sampleDir(uH, normalize(p - n * texelAngle(uN))).r;
  vec2 g = vec2(hx, hy) / (2.0 * d);
  float oceanic = sampleDir(uOceanLo, p).r;             // large-scale fraction of ocean nearby
  float T = seaTemp(p) - uLapse * max(h - max(uSea, 0.0), 0.0) * 0.001;
  // continental interiors are colder in the mean at mid/high latitude (Siberia, Canada)
  T -= 7.0 * (1.0 - oceanic) * sstep(0.2, 0.8, abs(p.y)) * (h > uSea ? 1.0 : 0.0);
  T += 1.5 * fbm(p * 5.0 + seedOff(uSeed), 3);
  o = vec4(g, T, h > uSea ? 0.0 : 1.0);
}`;

  const STEP = COMMON + `
uniform sampler2DArray uQ, uPrep; uniform float uStep, uRate, uOro, uRecycle, uEvap, uAccum;
out vec4 o;
void main() {
  vec3 p = cellDir();
  vec4 pr = at(uPrep);
  vec2 w = windEN(p);
  vec3 e = eastOf(p), n = northOf(p);
  vec3 dep = normalize(p - (w.x * e + w.y * n) * uStep);
  vec4 s = sampleDir(uQ, dep);
  float q = s.r, acc = at(uQ).g;
  float T = pr.b;
  float qs = qsat(T);
  float ocean = pr.a;
  if (ocean > 0.5) q += (qs - q) * uEvap;
  float lat = abs(latDeg(p));
  // large-scale vertical motion: ITCZ and polar front rise, subtropical highs and poles sink
  float z = 0.35 + 1.3 * exp(-sq(lat / 9.0)) + 0.55 * exp(-sq((lat - 55.0) / 13.0)) - 0.28 * exp(-sq((lat - 27.0) / 9.0)) - 0.2 * sstep(70.0, 90.0, lat);
  float lift = max(0.0, dot(w, pr.xy)) * uOro;           // air forced up the slope
  float rate = sat(uRate * max(z, 0.05) + lift);
  float P = q * rate + max(0.0, q - qs) * 0.5;
  q -= P;
  if (ocean < 0.5) q += P * uRecycle;                   // evapotranspiration feeds downwind rain
  o = vec4(max(q, 0.0), acc + P * uAccum, 0.0, 1.0);
}`;

  const FINAL = COMMON + `
uniform sampler2DArray uQ, uPrep, uH; uniform float uScale;
out vec4 o;
void main() {
  vec4 pr = at(uPrep);
  o = vec4(pr.b, at(uQ).g * uScale, at(uH).r, pr.a);   // T °C, P mm/yr, smoothed height, ocean
}`;

  const OCEANMASK = `uniform sampler2DArray uH; uniform float uSea; out vec4 o; void main() { o = vec4(at(uH).r < uSea ? 1.0 : 0.0); }`;

  async function run(ctx, H, report) {
    const { gpu, ops, P } = ctx;
    const Nc = Math.max(32, Math.min(256, ctx.N / 4));
    const sea = P.ocean ? 0 : -1e9;
    const Hc = gpu.field(Nc, 'r32f');
    // box-downsample possibly in two hops (keeps the per-texel loop small)
    let src = H;
    while (src.N / Nc > 16) { const t = gpu.field(src.N / 8, 'r32f'); ops.resample(src, t); if (src !== H) gpu.free(src); src = t; }
    ops.resample(src, Hc); if (src !== H) gpu.free(src);
    // large-scale ocean fraction
    const om = gpu.field(Nc, 'r32f'), omLo = gpu.field(8, 'r32f');
    gpu.run(gpu.program('clim.ocean', OCEANMASK), om, { uH: Hc, uSea: sea });
    const tmp16 = gpu.field(Nc / 2 >= 16 ? 16 : 8, 'r32f');
    ops.resample(om, tmp16); ops.resample(tmp16, omLo);
    gpu.free(tmp16); gpu.free(om);
    const common = { uT0: P.temperature, uDT: P.tempContrast, uLapse: 6.5, uSeed: (ctx.seed % 997) + 0.5, uWindNoise: 0.35, uR: ctx.R, uSea: sea };
    const prep = gpu.field(Nc, 'rgba32f');
    gpu.run(gpu.program('clim.prep', PREP), prep, { ...common, uH: Hc, uOceanLo: omLo });
    gpu.free(omLo);
    let qa = gpu.field(Nc, 'rgba32f'), qb = gpu.field(Nc, 'rgba32f');
    const wet = !!P.ocean;
    ops.scaleOffset(prep, qa, [0, 0, 0, 0], [0.3, 0, 0, 1]);
    const step = gpu.program('clim.step', STEP);
    const steps = wet ? 320 : 0, cellA = Math.PI / 2 / Nc;
    for (let k = 0; k < steps; k++) {
      gpu.run(step, qb, { ...common, uQ: qa, uPrep: prep, uStep: cellA * 0.9, uRate: 0.035, uOro: 25.0 * (P.orographic ?? 1), uRecycle: 0.55, uEvap: 0.25, uAccum: k > steps / 3 ? 1 : 0 });
      [qa, qb] = [qb, qa];
      if (k % 40 === 39) { await gpu.sync(); report('Simulating winds and rainfall', 0.55 + 0.1 * k / steps); }
    }
    // normalise so the global mean matches the requested wetness
    const st = ops.fieldStats(qa, 1, 32);
    const scale = wet ? (P.precipitation || 1000) / Math.max(1e-6, st.mean) : 0;
    const clim = gpu.field(Nc, 'rgba32f', 'climate');
    gpu.run(gpu.program('clim.final', FINAL), clim, { ...common, uQ: qa, uPrep: prep, uH: Hc, uScale: scale });
    gpu.free(qa); gpu.free(qb); gpu.free(prep); gpu.free(Hc);
    return clim;
  }

  S.Climate = { run };
})();
