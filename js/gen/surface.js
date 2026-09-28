// Selene — surface albedo (+ emission). No lighting is baked in: the map is what the ground looks
// like under flat, even illumination, so Blender / KSP light it correctly from any angle.
//   terran : oceans by depth (shelves, carbonate banks, sea ice); land from climate — moisture
//            index and temperature drive soil -> steppe -> grassland -> forest, tundra, ice.
//   world  : everything else. A layered material model where colour follows the terrain:
//            height ramp with colour distortion, soft regional albedo provinces (optionally tied to
//            topography), polar and hemispheric tints, cliff and slope colours, curvature (ridges
//            vs hollows), plus the material layers written by the landform stage (dark lava/maria/
//            lineae, secondary deposits, fresh ejecta and rays, ice caps) and hot lava emission.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const WORLD_COLORS = ['low', 'high', 'alt', 'alt2', 'polar', 'hemi', 'cliff', 'dark', 'second', 'bright', 'ice', 'lava', 'rough'];

  const FS = String.raw`
//#include planet
uniform sampler2DArray uH, uClim, uA, uMat, uHb, uHq, uH16, uRough;
uniform int uModel;
uniform float uSea, uR, uSeed, uHasA, uVar, uHmin, uHmax;
// terran palette (linear)
uniform vec3 uDeep, uMid, uShelf, uReef, uSeaIce, uSand, uRed, uDarkRock, uPale, uSteppe, uSavanna, uGrass,
             uForestT, uForestTr, uForestB, uTundra, uRock, uSnow;
uniform float uVegK, uSnowBias, uRiverK;
// world palette + controls
uniform vec3 uC[13];
uniform float uStreak, uStreakTex, uRoughK, uRoughDark, uRoughMean, uRel2K, uHueLock;
uniform float uPolarSide;
uniform float uHeightK, uColorDist, uRegional, uRegScale, uRegTopo, uRegional2, uPolarK, uPolarLat, uHemiK;
uniform vec3 uHemiDir;
uniform float uLSeed, uUnitScale, uUnitTone, uFray, uRelK, uRelScale, uTex;
uniform float uSlopeK, uCurvK, uDarkK, uSecondK, uBrightK, uIceK, uEmissive, uMottle, uDustLow;
layout(location = 0) out vec4 o;
layout(location = 1) out vec4 oE;

vec3 sq3(vec3 v) { return v * v; }
vec3 blackbody(float t) { // 0..1 -> dull red to yellow-white
  return mix(mix(vec3(0.35, 0.02, 0.0), vec3(1.0, 0.25, 0.02), sstep(0.0, 0.5, t)), vec3(1.0, 0.85, 0.45), sstep(0.5, 1.0, t));
}

void main() {
  vec3 p = cellDir();
  float h = at(uH).r;
  vec3 so = seedOff(uSeed + 3.0);
  float d = texelAngle(uN) * uR;
  float hE = nb(uH, ivec2(1, 0)).r, hW = nb(uH, ivec2(-1, 0)).r, hN = nb(uH, ivec2(0, 1)).r, hS = nb(uH, ivec2(0, -1)).r;
  float slopeRaw = length(vec2(hE - hW, hN - hS)) / (2.0 * d);
  float slope = slopeRaw * pow(max(d, 50.0) / 5000.0, 0.3);
  float lap = (hE + hW + hN + hS - 4.0 * h) / (d * d);           // 1/m
  float curv = clamp(-lap * d * 12.0, -1.0, 1.0);                  // + convex ridge, - hollow
  float micro = fbm(p * uR / 4000.0 + so, 4);
  float l1 = fbm(p * 7.0 + so, 5), l2 = fbm(p * 19.0 - so, 4), l3 = fbm(p * 2.5 + so * 0.3, 3);
  vec3 c; float water = 0.0; vec3 em = vec3(0.0);

  if (uModel == 0) {
    vec4 cl = sampleDir(uClim, p);
    float T = cl.r - 0.0065 * (max(h - uSea, 0.0) - max(cl.b - uSea, 0.0));
    float Pm = cl.g;
    if (h < uSea) {
      float depth = uSea - h;
      c = mix(uShelf, uMid, sstep(15.0, 350.0, depth));
      c = mix(c, uDeep, sstep(250.0, 3500.0, depth));
      c = mix(c, uReef, sstep(17.0, 25.0, T) * (1.0 - sstep(4.0, 45.0, depth)) * sstep(-0.2, 0.3, l2 + 0.3));
      c *= 1.0 + 0.07 * fbm(p * 9.0 - so, 4);
      float ice = sstep(-7.0, -11.0, T + 2.5 * fbm(p * 8.0 + so, 5));
      c = mix(c, uSeaIce * (0.93 + 0.07 * micro), ice);
      water = 1.0 - ice;
    } else {
      float Tp = max(T, 0.0);
      float W = Pm / (280.0 + 45.0 * Tp + 1.3 * Tp * Tp) * uVegK;
      if (uHasA > 0.5) {
        float lA = log(max(at(uA).r, 1e-3)) / log(10.0);
        W += uRiverK * sstep(3.3, 5.0, lA) * (1.0 - sstep(0.4, 1.0, W)) * 0.8;
      }
      vec3 soil = mix(uSand, uRed, sstep(-0.25, 0.35, l1 + 0.35 * l3));
      soil = mix(soil, uDarkRock, sstep(0.12, 0.55, l2 + 0.25 * l1) * 0.65);
      soil = mix(soil, uPale, sstep(0.25, 0.55, -l2 - 0.3 * l3) * sstep(0.03, 0.005, slope) * 0.7);
      float erg = sstep(0.14, 0.05, W) * sstep(0.04, 0.012, slope) * sstep(-0.1, 0.35, fbm(p * 4.0 + so * 2.0, 3));
      soil = mix(soil, uSand * 1.06, erg);
      float veg = sstep(0.1, 0.7, W) * sstep(-9.0, 1.0, T);
      float forest = sstep(0.5, 1.05, W + 0.08 * l2) * sstep(-5.0, 3.0, T);
      vec3 grass = mix(uSteppe, uGrass, sstep(0.3, 0.95, W));
      grass = mix(grass, uSavanna, sstep(14.0, 23.0, T) * (1.0 - sstep(0.7, 1.2, W)));
      vec3 fc = mix(uForestB, uForestT, sstep(1.0, 11.0, T));
      fc = mix(fc, uForestTr, sstep(17.0, 23.0, T) * sstep(0.8, 1.3, W));
      c = mix(soil, grass, veg);
      c = mix(c, fc, forest * (1.0 - 0.25 * sstep(0.2, 0.5, slope)));
      c = mix(c, uTundra, sstep(-2.0, -8.0, T) * (1.0 - forest * 0.5));
      float rock = sstep(0.16, 0.55, slope + 0.05 * l2) + 0.5 * sstep(-3.0, -9.0, T) * sstep(0.06, 0.2, slope);
      vec3 rc = mix(uRock, uDarkRock, sstep(-0.2, 0.45, l2 + 0.3 * l1));
      c = mix(c, rc, sat(rock) * 0.85);
      float sT = T - uSnowBias + 2.5 * fbm(p * 40.0 + so, 3);
      float sheet = sstep(-7.0, -12.0, sT);
      float mtn = sstep(-3.0, -8.0, sT) * (1.0 - sstep(0.35, 0.9, slope));
      c = mix(c, uSnow * (0.94 + 0.06 * micro), max(sheet, mtn));
    }
    c *= 1.0 + uVar * (0.12 * micro + 0.06 * l2);
  } else {
    vec4 m = at(uMat);
    float hn = sat((h - uHmin) / max(1.0, uHmax - uHmin));
    // colour distortion so colour boundaries never follow contour lines exactly
    vec3 dp = p + uColorDist * 0.08 * warpVec(p * 5.0 + so, 4);
    // wind streaking: albedo patterns are stretched along the local east-west wind direction
    vec3 ew = eastOf(p);
    vec3 ds = dp - ew * dot(dp, ew) * uStreak * 0.85;
    float dist = uColorDist * (0.6 * fbm(ds * 11.0 - so, 5) + 0.4 * fbm(ds * 40.0 + so, 4));
    float t = sat(hn + 0.2 * dist);
    c = mix(uC[0], uC[1], sstep(0.15, 0.85, t) * uHeightK + (1.0 - uHeightK) * 0.5);
    // regional albedo provinces: large soft shapes, streaked by wind, fine octaves fray the edges
    float reg = warped(ds * uRegScale + so * 1.7, 3, 0.45) + 0.16 * fbm(ds * uRegScale * 6.0 + so, 5) + uRegTopo * (hn - 0.5) + 0.12 * dist;
    float jA = jag(p, uR / 60000.0, uTex), jB = jag(p + 3.7, uR / 25000.0, uTex), jC = jag(p - 5.1, uR / 120000.0, uTex);
    c = mix(c, uC[2], frayed(sstep(-0.3, 0.35, reg), jA, uFray) * uRegional);
    float reg2 = warped(ds * uRegScale * 1.3 - so * 2.3, 3, 0.45) + 0.16 * fbm(ds * uRegScale * 7.0 - so, 5) - 0.08 * dist;
    c = mix(c, uC[3], frayed(sstep(-0.1, 0.4, reg2), jC, uFray) * uRegional2);
    // dust settles in lows (or highs when negative)
    c = mix(c, uC[2], sat(uDustLow * (0.5 - hn) * 2.0) * 0.6);
    // roughness: rough ground (blocky, fractured, fresh lava) takes the rough colour, smooth plains darken
    if (uRoughK > 0.0 || uRoughDark > 0.0) {
      float rough = sampleDir(uRough, p).r / max(uRoughMean, 1e-3);
      float rw = sstep(0.55, 1.9, rough + 0.25 * dist);
      c = mix(c, uC[12], rw * uRoughK);
      c *= 1.0 - uRoughDark * 0.25 * (1.0 - rw);
    }
    // relief-following colour: cliffs, ridges, hollows
    c = mix(c, uC[6], sstep(0.12, 0.5, slope) * uSlopeK);
    c *= 1.0 + uCurvK * curv;
    // material layers
    // fray only where a material actually changes (its gradient), so uniform tones stay clean
    vec4 mE = nb(uMat, ivec2(1, 0)), mW = nb(uMat, ivec2(-1, 0)), mN = nb(uMat, ivec2(0, 1)), mS = nb(uMat, ivec2(0, -1));
    float dkm = 2.0 * texelAngle(uN) * uR * 0.001;
    vec3 grd = sqrt(sq3(mE.gbr - mW.gbr) + sq3(mN.gbr - mS.gbr)) / dkm;
    vec3 fe = uFray * sat3(grd * 25.0);
    c = mix(c, uC[7], frayed(m.g * uDarkK, jB, fe.x));
    c = mix(c, uC[8], frayed(m.b * uSecondK, jA, fe.y));
    c = mix(c, uC[9], frayed(m.r * uBrightK, jC, fe.z));
    // geological units: each unit has its own slight tone, with the same ragged contacts as the relief
    if (uUnitTone > 0.0) {
      vec3 tu = terrainUnits(p, seedOff(uLSeed), uR, uTex, uUnitScale);
      float su = 1.0 - tu.x - tu.y;
      c *= 1.0 + uUnitTone * (0.08 * tu.x - 0.05 * su + 0.03 * tu.y + 0.08 * (fract(tu.z * 0.37) - 0.5));
    }
    // relief tone at two scales: knobs, crests and rims brighter; hollows and basins collect dark fines
    if (uRelK > 0.0) {
      float rel = h - sampleDirCubic(uHb, p);
      c *= 1.0 + uRelK * 0.14 * clamp(rel / uRelScale, -1.5, 1.5);
    }
    if (uRel2K > 0.0) {
      float rel2 = sampleDirCubic(uHq, p) - sampleDirCubic(uH16, p);
      c *= 1.0 + uRel2K * 0.12 * clamp(rel2 / (uRelScale * 2.5), -1.5, 1.5);
    }
    // unify hue: real planets vary mostly in brightness, not in hue
    if (uHueLock > 0.0) {
      vec3 ref = 0.5 * (uC[0] + uC[1]);
      c = mix(c, ref * (luma(c) / max(luma(ref), 1e-4)), uHueLock);
    }
    // latitude and hemisphere tints (after the hue lock, so caps and hemispheres keep their colour)
    float lat = uPolarSide == 0.0 ? abs(p.y) : p.y * uPolarSide;
    c = mix(c, uC[4], sstep(uPolarLat, 1.0, lat + 0.1 * dist + 0.1 * fbm(ds * 6.0 + so, 4) + 0.12 * fbm(ds * 2.5 - so, 3)) * uPolarK);
    c = mix(c, uC[5], sstep(-0.2, 0.9, dot(p, uHemiDir) + 0.2 * dist) * uHemiK);
    if (uEmissive > 0.5) {
      float heat = sat(m.a);
      c = mix(c, uC[11], sstep(0.3, 0.8, heat));
      em = blackbody(heat) * sstep(0.02, 0.2, heat) * (0.7 + 0.3 * micro);
    } else {
      c = mix(c, uC[10] * (0.93 + 0.07 * micro), sat(m.a * uIceK));
    }
    // multi-scale mottling (keeps large flat areas from looking synthetic)
    c *= 1.0 + uMottle * (0.1 * micro + 0.07 * l2 + 0.05 * l1);
    // fine wind-streak texture (dust tails and dark streaks behind obstacles)
    if (uStreakTex > 0.0) {
      vec3 sp = p * (uR / 40000.0); sp -= ew * dot(sp, ew) * 0.92;
      c *= 1.0 + uStreakTex * (0.09 * fbm(sp + so, 5) + 0.05 * fbm(sp * 3.1 - so, 4));
    }
  }
  o = vec4(linearToSrgb(sat3(c)), water);
  oE = vec4(linearToSrgb(sat3(em)), 1.0);
}`;

  // |height − smoothed height|: raw roughness, averaged down later
  const ABSHP = `uniform sampler2DArray uH, uHs; out vec4 o; void main() { o = vec4(abs(at(uH).r - sampleDirCubic(uHs, cellDir()))); }`;

  const hexLin = (hex) => {
    const v = parseInt(String(hex).replace('#', ''), 16);
    const s = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x / 255);
    return s.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  };

  async function run(ctx, fields, report = () => {}) {
    const { gpu, P } = ctx;
    const prog = await gpu.programAsync('surface', FS);
    const C = P.colors || {};
    const U = {};
    if (P.model === 'terran') for (const k in C) U['u' + k[0].toUpperCase() + k.slice(1)] = hexLin(C[k]);
    const arr = new Float32Array(39);
    WORLD_COLORS.forEach((k, i) => arr.set(hexLin(C[k] || (k === 'rough' ? (C.high || '#808080') : '#808080')), i * 3));
    const n = (v, d = 0) => (v === undefined || v === null ? d : +v);
    const out = gpu.field(ctx.N, 'rgba8', 'albedo'), em = gpu.field(ctx.N, 'rgba8', 'emission');
    // coarse copy of the height (1/8 resolution) for the local-relief tone
    const Hb = gpu.field(Math.max(16, ctx.N / 8), 'r32f');
    ctx.ops.resample(fields.H, Hb);
    // multi-scale relief (1/4 and 1/16 resolution) and a roughness map (mean |height − local mean|)
    const N = ctx.N, Hq = gpu.field(Math.max(16, N / 4), 'r32f'), H16 = gpu.field(Math.max(16, N / 16), 'r32f');
    ctx.ops.resample(fields.H, Hq);
    ctx.ops.resample(Hq, H16);
    const hp = gpu.field(N, 'r32f'), rough = gpu.field(Math.max(16, N / 8), 'r32f');
    await gpu.runTiled(await gpu.programAsync('surface.hp', ABSHP), hp, { uH: fields.H, uHs: Hq });
    ctx.ops.resample(hp, rough);
    gpu.free(hp);
    const rmean = ctx.ops.fieldStats(rough, 0, 32).mean;
    const hd = S.randDir(S.rng(ctx.seed + 99));
    await gpu.runTiled(prog, [out, em], {
      ...U, uC: arr,
      uH: fields.H, uClim: fields.clim || fields.H, uA: fields.A || fields.H, uMat: fields.M || fields.H,
      uHasA: fields.A ? 1 : 0, uModel: P.model === 'terran' ? 0 : 1,
      uSea: P.ocean ? 0 : -1e9, uR: ctx.R, uSeed: (ctx.seed % 991) + 0.5, uVar: n(P.colorVariation, 1),
      uVegK: n(P.vegetation, 1), uSnowBias: n(P.snowBias), uRiverK: n(P.riverGreen, 1),
      uHmin: ctx.hmin ?? -5000, uHmax: ctx.hmax ?? 5000,
      uHeightK: n(P.heightColor, 1), uColorDist: n(P.colorDistortion, 1), uRegional: n(P.regional), uRegScale: n(P.regionalScale, 2.5),
      uRegTopo: n(P.regionalTopo), uRegional2: n(P.regional2), uPolarK: n(P.polarTint), uPolarLat: n(P.polarLat, 0.7), uPolarSide: n(P.polarSide),
      uHemiK: n(P.hemiTint), uHemiDir: P.hemiDir || hd, uSlopeK: n(P.cliffColor), uCurvK: n(P.curvatureColor),
      uDarkK: n(P.darkMaterial, 1), uSecondK: n(P.secondMaterial, 1), uBrightK: n(P.brightMaterial, 1), uIceK: n(P.iceMaterial, 1),
      uEmissive: P.emissive ? 1 : 0, uHb: Hb, uLSeed: (ctx.seed % 10007) + 0.5, uUnitScale: n(P.unitScale, 250), uUnitTone: P.microRelief > 0 ? n(P.unitTone, 1) : 0,
      uFray: n(P.colorFray, 0.8), uRelK: n(P.reliefColor, 0.6), uRelScale: Math.max(50, ((ctx.hmax ?? 5000) - (ctx.hmin ?? -5000)) * 0.03), uTex: Math.PI / 2 / ctx.N, uMottle: n(P.colorVariation, 1), uDustLow: n(P.dustInLows),
      uHq: Hq, uH16: H16, uRough: rough, uRoughMean: rmean, uRoughK: n(P.roughColor), uRoughDark: n(P.smoothDark),
      uStreak: n(P.windStreaks), uStreakTex: n(P.streakTexture), uRel2K: n(P.broadRelief), uHueLock: n(P.hueLock),
    }, { progress: (f) => report('Painting the surface', 0.95 + 0.04 * f) });
    gpu.free(Hb); gpu.free(Hq); gpu.free(H16); gpu.free(rough);
    return { albedo: out, emission: em };
  }

  S.Surface = { run, hexLin, WORLD_COLORS };
})();
