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

  const WORLD_COLORS = ['low', 'high', 'alt', 'alt2', 'polar', 'hemi', 'cliff', 'dark', 'second', 'bright', 'ice', 'lava'];

  const FS = String.raw`
uniform sampler2DArray uH, uClim, uA, uMat;
uniform int uModel;
uniform float uSea, uR, uSeed, uHasA, uVar, uHmin, uHmax;
// terran palette (linear)
uniform vec3 uDeep, uMid, uShelf, uReef, uSeaIce, uSand, uRed, uDarkRock, uPale, uSteppe, uSavanna, uGrass,
             uForestT, uForestTr, uForestB, uTundra, uRock, uSnow;
uniform float uVegK, uSnowBias, uRiverK;
// world palette + controls
uniform vec3 uC[12];
uniform float uHeightK, uColorDist, uRegional, uRegScale, uRegTopo, uRegional2, uPolarK, uPolarLat, uHemiK;
uniform vec3 uHemiDir;
uniform float uSlopeK, uCurvK, uDarkK, uSecondK, uBrightK, uIceK, uEmissive, uMottle, uDustLow;
layout(location = 0) out vec4 o;
layout(location = 1) out vec4 oE;

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
    float dist = uColorDist * (0.6 * fbm(dp * 11.0 - so, 5) + 0.4 * fbm(dp * 40.0 + so, 4));
    float t = sat(hn + 0.2 * dist);
    c = mix(uC[0], uC[1], sstep(0.15, 0.85, t) * uHeightK + (1.0 - uHeightK) * 0.5);
    // regional albedo provinces: soft, blotchy, optionally tied to topography
    // large soft shapes; fine octaves only fray the edges
    float reg = warped(dp * uRegScale + so * 1.7, 3, 0.45) + 0.16 * fbm(dp * uRegScale * 6.0 + so, 5) + uRegTopo * (hn - 0.5) + 0.12 * dist;
    c = mix(c, uC[2], sstep(-0.12, 0.25, reg) * uRegional);
    float reg2 = warped(dp * uRegScale * 1.3 - so * 2.3, 3, 0.45) + 0.16 * fbm(dp * uRegScale * 7.0 - so, 5) - 0.08 * dist;
    c = mix(c, uC[3], sstep(0.02, 0.35, reg2) * uRegional2);
    // dust settles in lows (or highs when negative)
    c = mix(c, uC[2], sat(uDustLow * (0.5 - hn) * 2.0) * 0.6);
    // latitude and hemisphere tints
    float lat = abs(p.y);
    c = mix(c, uC[4], sstep(uPolarLat, 1.0, lat + 0.08 * dist) * uPolarK);
    c = mix(c, uC[5], sstep(-0.2, 0.9, dot(p, uHemiDir) + 0.2 * dist) * uHemiK);
    // relief-following colour: cliffs, ridges, hollows
    c = mix(c, uC[6], sstep(0.12, 0.5, slope) * uSlopeK);
    c *= 1.0 + uCurvK * curv;
    // material layers
    c = mix(c, uC[7], sat(m.g * uDarkK));
    c = mix(c, uC[8], sat(m.b * uSecondK));
    c = mix(c, uC[9], sat(m.r * uBrightK));
    if (uEmissive > 0.5) {
      float heat = sat(m.a);
      c = mix(c, uC[11], sstep(0.05, 0.6, heat));
      em = blackbody(heat) * sstep(0.02, 0.2, heat) * (0.7 + 0.3 * micro);
    } else {
      c = mix(c, uC[10] * (0.93 + 0.07 * micro), sat(m.a * uIceK));
    }
    // multi-scale mottling (keeps large flat areas from looking synthetic)
    c *= 1.0 + uMottle * (0.1 * micro + 0.07 * l2 + 0.05 * l1);
  }
  o = vec4(linearToSrgb(sat3(c)), water);
  oE = vec4(linearToSrgb(sat3(em)), 1.0);
}`;

  const hexLin = (hex) => {
    const v = parseInt(String(hex).replace('#', ''), 16);
    const s = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x / 255);
    return s.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  };

  function run(ctx, fields) {
    const { gpu, P } = ctx;
    const prog = gpu.program('surface', FS);
    const C = P.colors || {};
    const U = {};
    if (P.model === 'terran') for (const k in C) U['u' + k[0].toUpperCase() + k.slice(1)] = hexLin(C[k]);
    const arr = new Float32Array(36);
    WORLD_COLORS.forEach((k, i) => arr.set(hexLin(C[k] || '#808080'), i * 3));
    const n = (v, d = 0) => (v === undefined || v === null ? d : +v);
    const out = gpu.field(ctx.N, 'rgba8', 'albedo'), em = gpu.field(ctx.N, 'rgba8', 'emission');
    const hd = S.randDir(S.rng(ctx.seed + 99));
    gpu.run(prog, [out, em], {
      ...U, uC: arr,
      uH: fields.H, uClim: fields.clim || fields.H, uA: fields.A || fields.H, uMat: fields.M || fields.H,
      uHasA: fields.A ? 1 : 0, uModel: P.model === 'terran' ? 0 : 1,
      uSea: P.ocean ? 0 : -1e9, uR: ctx.R, uSeed: (ctx.seed % 991) + 0.5, uVar: n(P.colorVariation, 1),
      uVegK: n(P.vegetation, 1), uSnowBias: n(P.snowBias), uRiverK: n(P.riverGreen, 1),
      uHmin: ctx.hmin ?? -5000, uHmax: ctx.hmax ?? 5000,
      uHeightK: n(P.heightColor, 1), uColorDist: n(P.colorDistortion, 1), uRegional: n(P.regional), uRegScale: n(P.regionalScale, 2.5),
      uRegTopo: n(P.regionalTopo), uRegional2: n(P.regional2), uPolarK: n(P.polarTint), uPolarLat: n(P.polarLat, 0.7),
      uHemiK: n(P.hemiTint), uHemiDir: P.hemiDir || hd, uSlopeK: n(P.cliffColor), uCurvK: n(P.curvatureColor),
      uDarkK: n(P.darkMaterial, 1), uSecondK: n(P.secondMaterial, 1), uBrightK: n(P.brightMaterial, 1), uIceK: n(P.iceMaterial, 1),
      uEmissive: P.emissive ? 1 : 0, uMottle: n(P.colorVariation, 1), uDustLow: n(P.dustInLows),
    });
    return { albedo: out, emission: em };
  }

  S.Surface = { run, hexLin, WORLD_COLORS };
})();
