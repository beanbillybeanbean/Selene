// Selene — base relief: tectonic plates, continental crust, orogens, trenches, rifts, mid-ocean
// ridges, shield volcanoes and multi-scale fractal roughness. Produces the initial height field
// (metres) and a tectonic field T = (uplift, continental factor, boundary proximity, convergence).
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});
  const MAXP = 40, MAXV = 48;

  const FS = String.raw`
#define MAXP ${MAXP}
#define MAXV ${MAXV}
uniform vec4 uPlate[MAXP];    // xyz centre, w additive weight (rad)
uniform vec4 uPlateVel[MAXP]; // xyz angular velocity, w continental bias
uniform int uPlateCount;
uniform vec4 uVolc[MAXV];     // xyz centre, w radius (rad)
uniform vec4 uVolcP[MAXV];    // x height (m), y caldera fraction, z profile exponent, w flank roughness
uniform int uVolcCount;
uniform int uMode;            // 0: calibration (writes raw crust value), 1: full relief
uniform float uSeed, uR, uThresh;
uniform float uTect;          // 1 = plate tectonics on
uniform float uContFreq, uContWarp, uShelf, uOceanDepth, uMountain, uRidge, uRough, uOrogenW;
uniform float uTrench, uRift, uOld, uCellAng, uDicho, uHills, uPlateau;
uniform vec3 uDichoDir;
layout(location = 0) out vec4 oH;
layout(location = 1) out vec4 oT;

float km(float x) { return x * 1000.0 / uR; }
int octFor(float f0) { return clamp(int(log2((0.30 / uCellAng) / f0)) + 1, 1, 12); }

void plates(vec3 p, out int i1, out int i2, out float b) {
  float d1 = 1e9, d2 = 1e9; i1 = 0; i2 = 0;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uPlateCount) break;
    float d = acos(clamp(dot(p, uPlate[i].xyz), -1.0, 1.0)) - uPlate[i].w;
    if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; } else if (d < d2) { d2 = d; i2 = i; }
  }
  b = 0.5 * (d2 - d1);
}

float crust(vec3 p, vec3 so) {
  float v = warped(p * uContFreq + so, 7, uContWarp);
  v += 0.35 * fbm(p * uContFreq * 0.5 - so, 3);
  return v + uDicho * dot(p, uDichoDir);
}

void main() {
  vec3 p = cellDir();
  vec3 so = seedOff(uSeed);
  // plates are sampled on a warped sphere so boundaries meander like real ones
  vec3 pw = normalize(p + 0.10 * warpVec(p * 2.0 + so * 0.37, 4) + 0.025 * warpVec(p * 8.0 - so, 3));
  int i1 = 0, i2 = 0; float b = 10.0;
  vec3 n = vec3(0.0);
  float bias1 = 0.0, bias2 = 0.0;
  if (uTect > 0.5 && uPlateCount > 1) {
    plates(pw, i1, i2, b);
    vec3 dv = uPlate[i2].xyz - uPlate[i1].xyz;
    n = normalize(dv - p * dot(dv, p));
    bias1 = uPlateVel[i1].w; bias2 = uPlateVel[i2].w;
  }
  float nearB = 1.0 - sstep(0.0, 0.2, b);
  float e = crust(p, so) + mix(bias1, 0.5 * (bias1 + bias2), nearB * 0.5) - uThresh;
  if (uMode == 0) { oH = vec4(e); oT = vec4(0.0); return; }

  float cHere = sstep(-0.04, 0.03, e);
  float U = 0.0, dH = 0.0, cv = 0.0;
  float ridgeK = 0.0;
  if (uTect > 0.5 && uPlateCount > 1) {
    vec3 v1 = cross(uPlateVel[i1].xyz, p), v2 = cross(uPlateVel[i2].xyz, p);
    cv = clamp(dot(v1 - v2, n), -1.5, 1.5);
    vec3 po = rotAxis(p, normalize(cross(p, n)), 2.0 * b + km(60.0));
    float eo = crust(po, so) + bias2 - uThresh;
    float cOther = sstep(-0.04, 0.03, eo);
    float W = uOrogenW;
    // along-boundary noise so belts vary in strength (real ranges are segmented)
    float seg = 0.55 + 0.45 * fbm(p * 9.0 + so * 1.7, 3) + 0.25 * fbm(p * 3.0 - so, 2);
    if (cv > 0.0) {
      float c = cv * seg;
      if (cHere > 0.5 && cOther > 0.5) {                 // continent-continent collision: high plateau + range
        float w = km(W * 1.7);
        U += c * (1.0 - sstep(0.35 * w, 1.25 * w, b)) * (0.8 + 0.4 * uPlateau);
      } else if (cHere > 0.5) {                           // ocean subducts beneath us: Andean cordillera
        U += c * exp(-sq((b - km(W * 0.55)) / km(W * 0.75)));
      } else if (cOther > 0.5) {                          // we subduct beneath a continent: trench
        dH -= uTrench * c * exp(-sq((b - km(90.0)) / km(70.0)));
      } else {                                            // ocean-ocean: island arc or trench
        bool over = hash11(uint(min(i1, i2) * 131 + max(i1, i2) * 7)) < 0.5 ? (i1 < i2) : (i1 > i2);
        if (over) U += 0.75 * c * exp(-sq((b - km(170.0)) / km(70.0))) * sstep(0.1, 0.6, fbm(p * 30.0 + so, 3) + 0.4);
        else dH -= uTrench * c * exp(-sq((b - km(80.0)) / km(60.0)));
      }
    } else {
      float dv = -cv * seg;
      if (cHere > 0.5) {                                  // continental rift: graben with raised shoulders
        dH -= uRift * dv * exp(-sq(b / km(30.0)));
        U += 0.3 * dv * exp(-sq((b - km(80.0)) / km(50.0)));
      }
      ridgeK = dv;
    }
    // transform boundaries leave a subtle linear scarp
    dH += 250.0 * sat(1.0 - abs(cv)) * exp(-sq(b / km(20.0))) * (fbm(p * 60.0, 2));
  }
  // ancient eroded orogens inside continents (Appalachians, Urals)
  float oldBelt = ridged(p * 2.6 + so * 1.3, 3);
  U += uOld * cHere * sstep(0.45, 0.85, oldBelt) * 0.45;
  // broad continental swells and basins
  float swell = fbm(p * 4.0 + so * 0.7, 4);

  // --- hypsometry
  float inland = sstep(0.0, 0.3, e);
  float hc = mix(-uShelf, 20.0, sstep(-0.04, 0.0, e)) + uHills * inland * (0.15 + 1.1 * sstep(-0.45, 0.55, swell));
  float fAb = uR / 18000.0;                                // abyssal hills ~ 20 km
  float ho = -uOceanDepth * (0.78 + 0.22 * sstep(0.0, km(2500.0), b));
  ho += uRidge * ridgeK * (0.55 * exp(-b / km(700.0)) + 0.45 * exp(-sq(b / km(120.0))));
  ho += 280.0 * (ridged(p * fAb + so, octFor(fAb)) - 0.4) + 400.0 * fbm(p * 12.0 - so, 3);
  float cs = sstep(-0.085, -0.035, e);                     // continental slope and rise
  float h = mix(ho, hc, cs);

  // --- mountains: ridged multifractal, stretched along the belt so ridges run parallel to it
  float fM = uR / 160000.0;
  vec3 q = p * fM + so * 2.1 + n * (b * fM * 2.0);
  float mr = ridged(q, octFor(fM), 2.03, 0.5);
  float Uc = sat(U * 1.3);
  h += uMountain * Uc * (0.3 + 0.9 * mr) * (0.85 + 0.3 * swell);
  h += dH;
  // plains and hills everywhere on land: heterogeneous roughness (flat cratons, rough shields)
  float fR = uR / 60000.0;
  float roughMask = sstep(-0.2, 0.5, fbm(p * 5.0 - so * 1.9, 3));
  h += uRough * cs * (0.35 + roughMask) * fbm(p * fR + so * 3.1, octFor(fR), 2.1, 0.55);
  // small bodies / non-tectonic worlds: fractal crust
  if (uTect < 0.5) h += uRough * 0.7 * ridged(p * fR * 0.3 - so, octFor(fR * 0.3), 2.0, 0.55);

  // --- shield volcanoes / hotspot chains
  for (int i = 0; i < MAXV; i++) {
    if (i >= uVolcCount) break;
    vec4 v = uVolc[i], vp = uVolcP[i];
    float d = gcDist(p, v.xyz) / v.w;
    if (d > 1.3) continue;
    float flank = 1.0 + vp.w * (fbm(p * (uR / 25000.0) + float(i) * 3.3, 4) * 0.35 + 0.25 * ridged(p * uR / 8000.0, 3));
    float cone = pow(sat(1.0 - d), vp.z) * flank;
    float cal = vp.y > 0.0 ? sstep(vp.y * 1.15, vp.y * 0.85, d) : 0.0;
    float apron = 0.06 * sstep(1.3, 1.0, d) * sstep(0.0, 1.0, d); // lava apron
    h += vp.x * (cone + apron) - vp.x * 0.22 * cal;
    U += 0.15 * sat(1.0 - d);
  }

  oH = vec4(h);
  oT = vec4(U, cs, nearB, cv);
}
`;

  // Spread plate centres with best-candidate sampling; random sizes, spins and crust bias.
  function makePlates(r, count, contBias) {
    const pts = [];
    for (let k = 0; k < count; k++) {
      let best = null, bestD = -1;
      for (let c = 0; c < 10; c++) {
        const d = S.randDir(r);
        let md = 9; for (const q of pts) md = Math.min(md, Math.acos(Math.max(-1, Math.min(1, S.vdot(d, q.dir)))));
        if (md > bestD) { bestD = md; best = d; }
      }
      const axis = S.randDir(r), speed = 0.35 + 0.65 * r();
      pts.push({ dir: best, weight: (r() - 0.5) * 0.35, omega: axis.map((a) => a * speed), bias: (r() - 0.5) * 2 * contBias });
    }
    return pts;
  }

  function volcanoUniforms(list) {
    const a = new Float32Array(MAXV * 4), b = new Float32Array(MAXV * 4);
    list.slice(0, MAXV).forEach((v, i) => { a.set([...v.dir, v.radius], i * 4); b.set([v.height, v.caldera, v.shape, v.rough], i * 4); });
    return { uVolc: a, uVolcP: b, uVolcCount: Math.min(MAXV, list.length) };
  }

  // Generate volcano descriptors (hotspot chains for ocean worlds, giant shields for dry ones).
  function makeVolcanoes(r, P, R) {
    const out = [];
    const n = Math.round(P.volcanoes || 0);
    for (let i = 0; i < n && out.length < MAXV; i++) {
      const big = i < (P.giantVolcanoes || 0);
      const d = S.randDir(r);
      const hgt = big ? P.volcanoHeight * (0.6 + 0.4 * r()) : P.volcanoHeight * (0.08 + 0.3 * r() * r());
      const rad = (big ? 250e3 + 250e3 * r() : 30e3 + 90e3 * r()) * (P.volcanoWidth || 1) / R;
      out.push({ dir: d, radius: rad, height: hgt, caldera: big ? 0.05 + 0.04 * r() : 0.08 * r(), shape: big ? 1.1 : 1.4 + r(), rough: 0.5 });
      if (P.hotspotChains && !big) { // chain trailing away like Hawaii–Emperor
        const ax = S.vnorm(S.vcross(d, S.randDir(r)));
        const len = 3 + Math.floor(r() * 5);
        for (let k = 1; k < len && out.length < MAXV; k++) {
          const a = k * rad * 1.6;
          const c = Math.cos(a), s = Math.sin(a), cr = S.vcross(ax, d);
          const q = S.vnorm([d[0] * c + cr[0] * s, d[1] * c + cr[1] * s, d[2] * c + cr[2] * s]);
          out.push({ dir: q, radius: rad * (1 - k * 0.07), height: hgt * Math.pow(0.72, k), caldera: 0.05, shape: 1.6, rough: 0.6 });
        }
      }
    }
    return out;
  }

  // ctx: {gpu, ops, N, P (params), R (geological radius m), seed}
  async function build(ctx, report) {
    const { gpu, P } = ctx;
    const prog = gpu.program('terrain', FS);
    const r = S.rng(ctx.seed * 31 + 7);
    const plates = P.tectonics ? makePlates(r, Math.round(P.plates), P.continentBias ?? 0.18) : [];
    const pl = new Float32Array(MAXP * 4), pv = new Float32Array(MAXP * 4);
    plates.slice(0, MAXP).forEach((q, i) => { pl.set([...q.dir, q.weight], i * 4); pv.set([...q.omega, q.bias], i * 4); });
    const vr = S.rng(ctx.seed * 131 + 3);
    ctx.volcanoes = makeVolcanoes(vr, P, ctx.R);
    const dd = S.randDir(r);
    const U = {
      uPlate: pl, uPlateVel: pv, uPlateCount: Math.min(MAXP, plates.length),
      ...volcanoUniforms(ctx.volcanoes),
      uSeed: (ctx.seed % 10007) + 0.5, uR: ctx.R, uTect: P.tectonics ? 1 : 0,
      uContFreq: P.continentScale, uContWarp: P.continentWarp, uShelf: P.shelfDepth, uOceanDepth: P.oceanDepth,
      uMountain: P.mountainHeight, uRidge: P.ridgeHeight, uRough: P.roughness, uOrogenW: P.orogenWidth,
      uTrench: P.trenchDepth, uRift: P.riftDepth, uOld: P.oldMountains, uDicho: P.dichotomy || 0, uDichoDir: dd,
      uHills: P.continentHeight, uPlateau: P.plateaus ?? 0.5,
    };
    // 1) calibrate the crust threshold so the requested fraction of the surface is land/highland
    report('Calibrating continents', 0.02);
    const cN = 64;
    const calH = gpu.field(cN, 'rgba32f'), calT = gpu.field(cN, 'rgba16f');
    gpu.run(prog, [calH, calT], { ...U, uMode: 0, uThresh: 0, uCellAng: Math.PI / 2 / cN });
    const raw = gpu.readField(calH);
    gpu.free(calH); gpu.free(calT);
    const thr = S.quantile(raw, 1 - P.landFraction);
    // 2) full-resolution relief
    report('Raising continents and mountain belts', 0.05);
    const H = gpu.field(ctx.N, 'r32f', 'H0'), T = gpu.field(ctx.N, 'rgba16f', 'T');
    gpu.run(prog, [H, T], { ...U, uMode: 1, uThresh: thr, uCellAng: Math.PI / 2 / ctx.N });
    await gpu.sync();
    ctx.plates = plates;
    return { H, T };
  }

  S.Terrain = { build, MAXV };
})();
