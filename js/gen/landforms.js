// Selene — procedural landforms for rocky, icy and volcanic worlds (Mars, Venus, Moon, Mercury,
// Europa, Enceladus, Ganymede, Io, lava worlds ...). SpaceEngine-style: every texel evaluates a
// stack of feature functions, but each function is modelled on the real landform (crater
// morphometry, shield volcanoes with basal scarps, double-ridge lineae, grooved terrain, chaos
// blocks, coronae, tesserae, paterae, canyon systems, polar layered deposits).
//   stage 0: ancient crust — provinces, hills, mountains, old craters, basins, volcanoes, maria
//   (erosion may run here)
//   stage 1: younger overprint — fresh craters, rays, canyons, fractures, chaos, paterae, dunes,
//   lava seas, polar caps.
// Outputs height (m) and a material field M = (fresh ejecta, dark material, secondary material,
// ice-or-emission) used by the colour stage.
// Each feature group is its own small shader pass, compiled only when the world uses it: one giant
// shader is fine on Linux/macOS drivers but Windows (ANGLE -> HLSL) can take minutes to compile it.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});
  const MAXF = 64;

  // feature types in the list
  const F = { BASIN: 1, SHIELD: 2, RAYED: 3, LINEA: 4, PLUME: 5, CORONA: 6, PATERA: 7, DOME: 9, CANYON: 10, STRIPE: 11, CHASMA: 12 };


  // ---------------------------------------------------------------- GLSL
  const COMMON = String.raw`
#define MAXF ${MAXF}
uniform sampler2DArray uHin, uMin, uProv;
uniform float uSeed, uR, uTex, uThr;
uniform vec4 uF[MAXF]; uniform vec4 uFP[MAXF]; uniform int uFCount;
uniform float uBaseFreq, uBaseWarp, uDicho, uHighH, uLowH, uTrans, uLowRough, uBaseAmp;
uniform vec3 uDichoDir;
uniform float uHillsAmp, uHillsScale, uErode, uMontesAmp, uMontesScale, uMontesCover;
uniform float uPatchy, uMariaCraters;
uniform float uGrooveBright, uRiftBelt, uFlowUnits, uFlowScale;
uniform float uLowCraters, uBrightFrac, uLinNet, uLinScale, uLinWidth, uLaneAmp, uLaneScale, uLaneWidth, uLaneGrooves, uFracLow, uLaneCover;
uniform float uCraterDens, uOldCraters, uCraterMax, uCraterFresh, uDt, uCraterSfd, uFloorDark, uEjecta, uCraterAmp;
uniform int uCraterOct, uScarpN;
uniform float uCanyonAmp, uCanyonScale, uCanyonCover;
uniform float uCrackAmp, uCrackScale, uCrackCover;
uniform float uGrooveAmp, uGrooveScale, uGrooveCover, uGroovePatch;
uniform float uChaosAmp, uChaosCover, uChaosScale;
uniform float uTessAmp, uTessCover, uWrinkle, uShieldDens, uShieldAmp;
uniform float uPateraDens, uPateraAmp, uMtnAmp, uMtnCover;
uniform float uPlains, uPvDunes, uFine, uBasinDust, uRiseDust, uChTrib;
uniform vec4 uIS0, uIS1; // ice sheet: centre xyz + radius (rad); elongation, cell km, level m, brightness
uniform float uChDepth, uChIslands, uChFlow, uChGraben, uChFloor, uChWall, uChLaby, uChChaos; uniform int uChFloorCh; uniform int uChOn;
uniform vec4 uVT0[12], uVT1[12]; uniform int uVTn;
uniform float uDunes, uTerrace, uMare, uMareLevel, uLavaLevel, uLavaCracks;
uniform float uCapH, uCapLat;
uniform float uScarpAmp, uScarpScale, uScarpLip, uRubble;
uniform float uSecondYoung;
uniform float uEqRidge, uEqWidth, uEqTilt, uEqCover, uEqBand, uEqBandW, uCanyonBand, uCanyonBandW, uCanyonDepth, uDimple, uDimpleSize, uDimpleCover;
uniform int uEqBandCh, uCanyonBandCh;
uniform float uMicro, uUnitScale, uJag, uFurrow, uPalimp, uPateraFlows;
layout(location = 0) out vec4 oH;
layout(location = 1) out vec4 oM;

vec3 SO;
float fr(float km) { return uR / (km * 1000.0); }            // noise frequency for a wavelength in km
float provinces(vec3 p) {
  float v = warped(p * uBaseFreq + SO, 6, uBaseWarp) + 0.4 * fbm(p * uBaseFreq * 0.5 - SO, 3);
  return v + uDicho * dot(p, uDichoDir);
}
// thresholded province value (>0 highland) from the low-resolution province map
float provAt(vec3 p) { return sampleDir(uProv, p).r; }
float fracMaskAt(vec3 p) { return mix(1.0, 1.0 - sstep(-uTrans, uTrans, provAt(p)), uFracLow); }
// flooded plains are never flat: buried relief shows through as ghost craters and swells, plus low
// undulations and a fine flow texture
float plains(vec3 p, float buried, float salt) {
  if (uPlains <= 0.0) return 0.0;
  float fP = fr(40.0);
  return 0.2 * min(uPlains / 250.0, 1.5) * max(buried, -2500.0)
       + uPlains * (2.0 * fbm(p * fr(500.0) + SO * 1.9 + salt, 3) + 1.4 * erodedFbm(p * fP - SO + salt, octaves(fP, uTex), 2.0, 0.55, 1.0));
}
float azimuth(vec3 p, vec3 c) { vec3 e = eastOf(c), n = cross(c, e); vec3 v = p - c; return atan(dot(v, n), dot(v, e)); }

#ifdef USE_CRATERS
// cellular crater population, octave by octave (largest first); loops use run-time bounds
void craterField(vec3 p, float dens, float freshExp, float amp, uint seed, float lowK, bool young, inout float h, inout vec4 m) {
  float f = 0.34 / uCraterMax;
  for (int o = 0; o < uCraterOct; o++) {
    vec3 q = p * f;
    ivec3 c0 = ivec3(floor(q));
    uint sd = seed + uint(o) * 7919u;
    float dO = min(0.92, dens * pow(uCraterSfd, float(o)));
    for (int n = 0; n < uL27; n++) {
      ivec3 cc = c0 + ivec3(n % 3, (n / 3) % 3, n / 9) - 1;
      vec3 hh = hash33(cc, sd);
      if (hh.x > dO) continue;
      vec3 ctr = vec3(cc) + hash33(cc, sd + 1u);
      float cl = length(ctr);
      if (abs(cl - f) > 0.5) continue;
      vec3 cd = ctr / cl;
      float rr = mix(0.1, 0.34, pow(hh.y, 2.2)) / f;
      vec3 dv = p - cd;
      if (dot(dv, dv) > sq(rr * 3.2)) continue;
      if (lowK < 1.0 && hh.x > dO * mix(lowK, 1.0, sstep(-uTrans, uTrans, provAt(cd)))) continue;       // sparser on young lowland plains
      if (young && uMariaCraters < 1.0) { vec4 mc = sampleDir(uMin, cd); if (hh.x > dO * mix(1.0, uMariaCraters, max(mc.g, mc.b * uSecondYoung))) continue; } // young maria: fewer craters
      if (uPatchy > 0.0 && hh.x > dO * mix(1.0 - uPatchy, 1.0, sstep(-0.25, 0.25, fbm(cd * 3.0 + SO * 0.3, 3)))) continue; // regional ages
      float dist = gcDist(p, cd);
      float Dkm = 2.0 * rr * uR * 0.001;
      float fresh = pow(hh.z, freshExp);
      float ang = azimuth(p, cd);
      float az = snoise(vec3(cos(ang) * 1.3, sin(ang) * 1.3, hh.x * 40.0 + float(o)));
      float d = dist / rr * (1.0 + 0.07 * az);
      // shape variety: polygonal craters (straight wall segments along old fractures) and oblique,
      // elongated impacts; complex craters on ice sometimes have a central pit instead of a peak
      vec3 hs = hash33(cc, sd + 9u);
      if (hs.x < 0.3 && Dkm > 6.0) {
        float nS = 5.0 + floor(hs.y * 4.0), sec = 6.28318 / nS;
        float ar = mod(ang + hs.z * 6.28318, sec) - 0.5 * sec;
        d = mix(d, d * cos(ar) / cos(0.5 * sec), 0.8);
      } else if (hs.x > 0.9) {
        vec3 ce = eastOf(cd), cn = cross(cd, ce), dvv = p - cd;
        float th = hs.y * 3.14159;
        vec2 v2 = vec2(dot(dvv, ce), dot(dvv, cn));
        v2 = vec2(cos(th) * v2.x + sin(th) * v2.y, -sin(th) * v2.x + cos(th) * v2.y);
        d = length(vec2(v2.x / (1.25 + 0.4 * hs.z), v2.y)) / rr * (1.0 + 0.07 * az);
      }
      float cv = craterProfile(d, Dkm, uDt, fresh, az, hh.y);
      if (hs.z > 0.8 && Dkm > uDt * 1.5) cv -= 120.0 * uDt * sstep(0.18, 0.08, d) * fresh;   // central pit
      h += amp * cv;
      m.r = max(m.r, uEjecta * ejectaBright(d, ang, sstep(1.0 - uBrightFrac, 1.0 - uBrightFrac * 0.3, hash13(cc, sd + 5u)), hh.x * 97.0) * sstep(2.9, 1.8, d));
      m.b = max(m.b, uFloorDark * (1.0 - fresh) * sstep(0.8, 0.35, d) * sstep(4.0, 20.0, Dkm));
      // palimpsests: big old craters on ice relax into bright, flat, ragged discs
      if (uPalimp > 0.0 && fresh < 0.35 && Dkm > 25.0) m.r = max(m.r, uPalimp * sstep(0.35, 0.0, fresh) * sstep(1.25, 0.8, d + 0.15 * jag(p, fr(Dkm * 0.3), uTex)));
    }
    f *= 2.0;
  }
}
#endif
`;

  // One GLSL block per feature. `init` blocks start from scratch; all others read uHin/uMin.
  const BLOCKS = {
    // ------------------------------------------------ stage 0
    base: { init: true, code: String.raw`
    float h; vec4 m = vec4(0.0);
    float e = provinces(p) - uThr;
    float hi = sstep(-uTrans, uTrans, e + 0.05 * fbm(p * fr(80.0) + SO, 3));
    h = mix(uLowH, uHighH, hi) + uBaseAmp * (0.8 * fbm(p * 1.2 + SO * 0.7, 3) + fbm(p * 3.0 - SO, 7, 2.0, 0.52));   // swells at every scale: no flat plateaus
    if (uRiftBelt > 0.0) {                       // chasmata and stepped scarps along the highland edge
      float x = (e - uTrans * 1.2) / (uTrans * 0.6);
      float belt = exp(-x * x);
      float steps = floor(belt * 4.0) / 4.0 + sstep(0.6, 1.0, fract(belt * 4.0)) / 4.0;
      h -= uRiftBelt * mix(belt, steps, 0.6) * (0.7 + 0.3 * fbm(p * fr(200.0) + SO, 3));
      h += uRiftBelt * 0.25 * exp(-sq((e - uTrans * 2.4) / (uTrans * 0.5)));
    }
    float kscarp = sstep(uTrans * 2.5, 0.0, abs(e));   // knobby / fretted terrain along the scarp
    if (kscarp > 0.0) { Cell kb = cellular(p * fr(90.0) + SO, 17u); h += kscarp * (uHighH - uLowH) * 0.25 * sstep(0.45, 0.2, kb.f1) * (hi < 0.5 ? 1.0 : -0.5); }
    float fH = fr(uHillsScale);
    h += uHillsAmp * mix(uLowRough, 1.0, hi) * erodedFbm(p * fH + SO * 1.3, octaves(fH, uTex), 2.0, 0.5, uErode);
    // fine relief everywhere: a rough (gain 0.62) spectrum from a third of the hill size down to the texel,
    // so no plateau or plain is ever smooth at close range
    if (uFine > 0.0) { float fF = fr(uHillsScale * 0.33); h += uFine * (0.7 + 0.3 * hi) * erodedFbm(p * fF + SO * 2.7, octaves(fF, uTex), 2.0, 0.62, 1.2); }
` },
    provinces: { on: (U) => U.pvOn, code: String.raw`
    for (int i = 0; i < L(3); i++) {             // detail concentrated in great provinces and along their edges
      vec3 pv = provinceAt(i, p, uR, uTex, SO);
      if (pv.x + pv.z <= 0.001) continue;
      vec4 B = uPv1[i];
      h += uPv3[i].x * pv.x;                   // raised plateaus or sunken basins, so colour and relief agree
      float fD = fr(uPv0[i].z * 0.02);
      int oc = octaves(fD, uTex);
      float det;
      if (int(uPv0[i].x + 0.5) == 2) det = 0.9 * pv.y + 0.45 * (ridgedEroded(p * fD * 1.5 + SO * float(i + 5), oc, 2.1, 0.55, 1.0) - 0.3);
      else det = ridgedEroded(p * fD + SO * float(i + 5), oc, 2.1, 0.58, 1.3) - 0.3 + 0.35 * erodedFbm(p * fD * 3.0 - SO, max(1, oc - 1), 2.0, 0.55, 2.0);
      h += B.x * pv.x * det;
      h += B.y * pv.z * (ridged(p * fD * 2.0 + SO * 3.1, max(1, oc - 1), 2.1, 0.6) - 0.3);
    }
` },
    montes: { on: (U) => U.uMontesAmp > 0, code: String.raw`
    { float fM = fr(uMontesScale);
      float mask = sstep(1.0 - uMontesCover, 1.0 - uMontesCover + 0.25, 0.5 + 0.6 * fbm(p * 4.0 + SO * 0.7, 4));
      if (mask > 0.0) h += uMontesAmp * mask * ridgedEroded(p * fM - SO, octaves(fM, uTex), 2.03, 0.5, uErode * 0.5); }
` },
    scarps: { on: (U) => U.uScarpAmp > 0, code: String.raw`
    for (int k = 0; k < uScarpN; k++) {          // stepped plateaus with lobate, fractal escarpments
      float fS = fr(uScarpScale / (1.0 + 0.7 * float(k)));
      vec3 q = p * fS + SO * float(k + 2);
      q += 0.45 * warpVec(q * 0.35, 3);
      float nS = fbm(q, octaves(fS, uTex), 2.0, 0.56);
      float edge = 0.12 * float(k) - 0.08;
      float w = 0.012 + 0.004 * float(k);
      float cliff = sstep(edge - w, edge + w, nS);
      float lip = exp(-sq((nS - edge - 1.6 * w) / (1.2 * w)));
      h += uScarpAmp * (cliff + uScarpLip * lip) / (1.0 + 0.35 * float(k));
      m.b = max(m.b, 0.35 * lip * uScarpLip);
    }
` },
    rubble: { on: (U) => U.uRubble > 0, code: String.raw`
    { float fR = fr(12.0); h += uRubble * (ridged(p * fR + SO * 2.2, octaves(fR, uTex), 2.1, 0.55) - 0.35); }
` },
    tesserae: { on: (U) => U.uTessAmp > 0, code: String.raw`
    { float mask = sstep(1.0 - uTessCover, 1.0 - uTessCover + 0.12, 0.5 + 0.6 * warped(p * 2.5 + SO * 1.9, 4, 0.8));
      if (mask > 0.0) {                         // two crossing ridge sets on raised, deformed plateaus
        Cell tc = cellular(p * fr(700.0) + SO, 91u);
        vec3 a1 = normalize(hash33(ivec3(tc.c1 * 7.0), 5u) - 0.5), a2 = normalize(cross(a1, p) + 0.4 * a1);
        float f = fr(18.0);
        float r1 = pow(1.0 - abs(snoise(vec3(dot(p, a1) * f, dot(p, cross(p, a1)) * f * 0.05, tc.id * 9.0))), 3.0);
        float r2 = pow(1.0 - abs(snoise(vec3(dot(p, a2) * f * 0.6, dot(p, cross(p, a2)) * f * 0.04, tc.id * 7.0))), 3.0);
        h += mask * (uTessAmp * (0.6 + 0.4 * fbm(p * 20.0, 3)) + uTessAmp * 0.25 * (r1 + 0.7 * r2));
        m.b = max(m.b, mask * 0.8);
      } }
` },
    shields: { on: (U) => U.uShieldDens > 0, code: String.raw`
    { float f = fr(60.0);                       // fields of small shield volcanoes with summit pits
      for (int o = 0; o < L(3); o++) {
        Cell c = cellular(p * f + SO, 311u + uint(o));
        if (c.id < uShieldDens) {
          float r = 0.25 + 0.15 * fract(c.id * 13.7);
          float d = c.f1 / r;
          if (d < 1.0) h += uShieldAmp * (pow(1.0 - d, 1.8) - 0.25 * sstep(0.15, 0.05, d)) / (1.0 + float(o));
        }
        f *= 2.3;
      } }
` },
    blocks: { on: (U) => U.uMtnAmp > 0, code: String.raw`
    { Cell mc = cellular(p * fr(700.0) + SO * 2.0, 55u);   // Io: isolated tilted crustal blocks
      if (mc.id < uMtnCover) {
        float blk = sstep(0.55, 0.3, mc.f1 + 0.12 * fbm(p * fr(120.0), 4));
        vec3 tilt = normalize(hash33(ivec3(mc.c1 * 3.0), 8u) - 0.5);
        float slopeT = 0.5 + 0.5 * dot(normalize(p * fr(700.0) + SO * 2.0 - mc.c1), tilt);
        h += uMtnAmp * (0.4 + 0.6 * fract(mc.id * 7.3)) * blk * (0.4 + 0.6 * slopeT) * (0.8 + 0.4 * ridged(p * fr(60.0), 4));
      } }
` },
    oldCraters: { on: (U) => U.uOldCraters > 0 && U.uCraterOct > 0, def: 'USE_CRATERS', code: String.raw`
    craterField(p, uOldCraters, uCraterFresh * 3.0, uCraterAmp, 1000u, uLowCraters, false, h, m);
` },
    list0: { on: (U) => U.types0, code: String.raw`
    for (int i = 0; i < uFCount; i++) {
      vec4 A = uF[i], B = uFP[i];
      int t = int(B.x + 0.5);
      if (t != 1 && t != 6 && t != 9) continue;
      vec3 c = A.xyz; float r = A.w;
      float d = gcDist(p, c) / r;
      if (t == 1) {                             // impact basin (multi-ring). B = (type, depth, rings, flood)
        if (d > 3.0) continue;
        float depth = B.y;
        float bowl = d < 1.0 ? -depth * (1.0 - d * d) * (0.75 + 0.25 * (1.0 - d)) : 0.0;
        float rim = depth * 0.12 * exp(-sq((d - 1.0) / 0.12));
        float ring = B.z > 0.5 ? depth * 0.1 * (exp(-sq((d - 0.62) / 0.05)) + 0.7 * sstep(1.45, 1.35, d) * sstep(1.0, 1.1, d)) : 0.0;
        float ang = azimuth(p, c);
        float sculpt = depth * 0.08 * sstep(3.0, 1.2, d) * sstep(0.95, 1.2, d) * (0.5 + ridged(vec3(ang * 4.0, d * 3.0, float(i)), 3));
        h += bowl + rim + ring + sculpt;
        if (uBasinDust > 0.0 && B.w <= 0.0) m.r = max(m.r, uBasinDust * sstep(1.05, 0.55, d + 0.12 * fbm(p * fr(r * uR * 0.0004) + float(i), 4)));   // dust-filled floor (Hellas)
        if (B.w > 0.0 && d < 1.15) {              // lava-flooded floor (mare)
          float ref = mix(uLowH, uHighH, sstep(-uTrans, uTrans, provAt(c)));
          float level = ref - depth * (1.0 - B.w) * 0.85 + 150.0 * fbm(p * 4.0 + float(i), 2);
          if (h < level) {
            float k = sstep(0.0, 80.0, level - h) * sstep(1.02, 0.88, d + 0.04 * snoise(p * fr(150.0)));
            float wr = pow(1.0 - abs(snoise(p * fr(70.0) + SO + float(i))), 10.0) * 150.0;
            h = mix(h, level + wr + plains(p, h - level, float(i)), k);
            m.g = max(m.g, k);
          }
        }
      } else if (t == 6) {                      // corona (Venus). B = (type, height, fracture, 0)
        if (d > 1.5) continue;
        float ang = azimuth(p, c);
        float rim = exp(-sq((d - 0.85) / 0.12));
        float conc = pow(abs(sin(d * 28.0 + snoise(p * fr(80.0)) * 2.0)), 6.0) * sstep(1.25, 0.95, d) * sstep(0.5, 0.75, d);
        float radial = pow(abs(sin(ang * 40.0)), 12.0) * sstep(1.4, 1.0, d) * sstep(0.1, 0.3, d);
        h += B.y * (rim - 0.35 * sstep(0.7, 0.0, d)) + B.z * (conc * 250.0 - radial * 150.0);
      } else {                                  // broad volcanic rise (Tharsis). B = (type, height, 0, 0)
        if (d > 1.5) continue;
        h += B.y * sstep(1.5, 0.0, d) * (0.85 + 0.15 * fbm(p * 6.0 + SO, 3));
        if (uRiseDust > 0.0) m.r = max(m.r, uRiseDust * sstep(1.2, 0.3, d + 0.2 * fbm(p * fr(r * uR * 0.0003) - float(i), 4)));   // dust-mantled bulge (Tharsis)
      }
    }
` },
    mare: { on: (U) => U.uMare > 0, code: String.raw`
    { float level = uMareLevel + 300.0 * fbm(p * 2.0 + SO, 3);  // flooded lowland plains
      float region = sstep(0.45, 0.6, 0.5 + 0.5 * fbm(p * 1.5 - SO * 2.0, 3) + uMare - 0.5);
      if (h < level && region > 0.0) {
        float k = region * sstep(0.0, 150.0, level - h);
        float wr = pow(1.0 - abs(snoise(p * fr(90.0) + SO)), 8.0) * 120.0;
        h = mix(h, level + wr + plains(p, h - level, 0.0), k);
        m.g = max(m.g, k);
      } }
` },
    wrinkle: { on: (U) => U.uWrinkle > 0, code: String.raw`
    h += uWrinkle * pow(1.0 - abs(snoise(p * fr(120.0) + SO * 3.0)), 10.0) * (1.0 - m.b);
` },
    // ------------------------------------------------ stage 1
    valles: { on: (U) => U.uVTn > 0, code: String.raw`
    // Valles Marineris template, scalable: every trough is defined in system units (u = -1..1 west to east
    // along the system, y = cross-track in trough half-widths), so the same layout works at any size.
    for (int i = 0; i < uFCount; i++) {
      vec4 A = uF[i], B = uFP[i];
      if (int(B.x + 0.5) != 12) continue;
      vec3 c = A.xyz; float r = A.w, W = B.z;          // system half-length, trough half-width (rad)
      vec3 e = eastOf(c), n = cross(c, e);
      vec3 tg = cos(B.y) * e + sin(B.y) * n;
      vec3 ax = normalize(cross(c, tg));
      float along = atan(dot(p, tg), dot(p, c));
      float fi = float(i), Wkm = W * uR * 0.001;
      float xs = dot(p, ax) - sin(B.w) + W * 0.6 * snoise(vec3(along / r * 1.3, fi, 1.0));
      float u = along / r, y = xs / W, LW = r / W;
      if (abs(u) > 1.35 || abs(y) > 11.0) continue;
      float jA = jag(p + fi, fr(Wkm * 0.9), uTex), jB = jag(p - fi, fr(Wkm * 0.22), uTex), jC = jag(p + 2.0 * fi, fr(Wkm * 0.06), uTex);
      // the rim is scalloped at every scale: big theatre-shaped alcoves, gullies, small notches
      float alc = ridged(vec3(u * LW * 0.9, y * 0.35, fi), 3, 2.1, 0.55);
      float edgeN = uJag * (0.22 * jA + 0.09 * jB + 0.045 * jC) + 0.12 * alc - 0.06;
      // troughs blend through a soft minimum of their distances, so there are no seams where they meet
      float ws = 1e-30, depW = 0.0, islW = 0.0;
      for (int k = 0; k < uVTn; k++) {
        vec4 S0 = uVT0[k], S1 = uVT1[k];
        float tt = sat((u - S0.x) / max(S0.y - S0.x, 1e-3));
        float yc = mix(S0.z, S0.w, tt) + 0.22 * snoise(vec3(u * 5.0, float(k), fi));
        float wk = S1.x * (1.0 + 0.2 * snoise(vec3(u * 8.0, float(k) + 20.0, fi)));
        float du = max(max(S0.x - u, u - S0.y), 0.0) * LW;          // rounded, ragged ends
        float wg = exp(-8.0 * length(vec2(du, y - yc)) / wk);
        ws += wg; depW += wg * S1.y; islW += wg * S1.z;
      }
      // Noctis Labyrinthus: a maze of intersecting grabens and pits at the western end
      float blob = snoise(p * fr(Wkm * 5.0) + fi * 2.3) + 0.4 * snoise(p * fr(Wkm * 2.0) - fi);
      float noct = uChLaby * sstep(0.0, 0.3, 1.0 - length(vec2((u + 0.84) / 0.32, (y - 0.4) / 4.2)) + 0.3 * blob + 0.12 * jA);
      if (noct > 0.01) {
        vec3 qn = p * fr(Wkm * 1.7) + fi * 7.0 + 0.25 * warpVec(p * fr(Wkm * 4.0), 2);
        Cell cn = cellular(qn, 811u);
        float qn1 = (cellEdge(cn, qn) + 0.06 * jB) / 0.26;
        float qn2 = cn.id > 0.45 ? cn.f1 / 0.4 : 9.0;
        float wg = exp(-8.0 * (min(qn1, qn2) + 1.2 * (1.0 - noct)));
        ws += wg; depW += wg * 0.6;
      }
      // chaos where the eastern troughs end: the floor breaks into jumbled, tilted blocks
      float chaosR = uChChaos * sstep(0.0, 0.3, 1.0 - length(vec2((u - 1.03) / 0.12, (y - 0.5) / 3.0)) - 0.3 * blob + 0.12 * jB);
      float chaosB = 0.0;
      if (chaosR > 0.01) {
        vec3 qc = p * fr(Wkm * 0.5) + fi * 5.0;
        Cell cb = cellular(qc, 919u);
        chaosB = sstep(0.62, 0.42, cb.f1 + 0.12 * jB) * (0.35 + 0.55 * fract(cb.id * 7.31)) * chaosR;
        float wg = exp(-8.0 * 1.4 * (1.0 - chaosR));
        ws += wg; depW += wg * 0.75;
      }
      // tributary canyons: short theatre-headed side canyons cutting back into the plateau from the walls
      float q0 = -log(ws) / 8.0;
      if (uChTrib > 0.0 && q0 > 0.6 && q0 < 4.0) {
        float bx0 = u * LW / 1.7 + 0.45 * snoise(vec3(q0 * 0.9, u * LW * 0.3, fi + 11.0));
        float h0 = fract(sin(floor(bx0) * 12.9898 + fi * 78.233 + sign(y) * 5.1) * 43758.55);
        float bx = bx0 + (h0 - 0.5) * 0.9 * (q0 - 1.0), bi = floor(bx);   // each branch leaves the wall at its own angle
        float h1 = fract(sin(bi * 12.9898 + fi * 78.233 + sign(y) * 5.1) * 43758.55), h2 = fract(h1 * 91.7 + 0.31);
        float blen = 0.3 + 1.5 * h2 * h2 * h2;
        float dx = abs(fract(bx) - 0.5) * 1.7 + 0.15 * jB + 0.1 * jA;
        float bw = 0.22 * (0.5 + 0.5 * sat(1.0 - (q0 - 1.0) / blen));
        float qb = length(vec2(dx, max(q0 - 1.0 - blen, 0.0))) / bw;
        float wg = step(1.0 - uChTrib * 0.6, h1) * exp(-8.0 * qb);
        ws += wg; depW += wg * 0.55;
      }
      float q = -log(ws) / 8.0 + edgeN;
      float dep = depW / ws, islK = islW / ws;
      float best = sstep(1.0, 0.5, q);                    // 0 on the plateau, 1 on the floor
      // interior layered deposits: bright mesas and mounds in the wide troughs
      float ild = islK * uChIslands * sstep(0.22, 0.38, fbm(p * fr(Wkm * 1.7) + fi * 3.1, 4) + 0.07 * jB + 0.03 * jC) * sstep(0.7, 0.2, q);
      float inside = best * (1.0 - ild) * (1.0 - chaosB);
      // walls: sharp rim and steep upper cliffs, benches, then a gentler talus apron at the foot
      float w1 = 1.0 - pow(1.0 - inside, 1.5);
      float t3 = w1 * 3.0;
      float prof = mix(w1, floor(t3) / 3.0 + sstep(0.7, 1.0, fract(t3)) / 3.0, 0.35);
      float depth = uChDepth * dep * (0.85 + 0.2 * snoise(vec3(u * 3.0, fi, 9.0)));
      // floor: hummocky, with landslide lobes grooved across their length
      float sIn = max(0.5 - q, 0.0) / 0.5;                // 0 at the foot of the wall, 1 on the trough axis
      float lobe = sstep(0.05, 0.45, snoise(p * fr(Wkm * 1.3) + fi * 1.7));
      float reach = 0.5 * lobe + 0.01;
      float slide = lobe * sstep(reach, reach * 0.3, sIn) * best;
      float groove = pow(1.0 - abs(snoise(vec3(u * LW * 3.5, sIn * 1.5, fi))), 4.0);
      float fH = fr(Wkm * 0.2);
      float hum = erodedFbm(p * fH - fi, octaves(fH, uTex), 2.0, 0.6, 1.0);
      float hFloor = 0.15 * h - depth + uChFlow * (0.5 * fbm(p * fr(Wkm * 0.5) - fi, 3) + 0.7 * hum + slide * (1.4 * (1.0 - sIn / reach) + 0.9 * groove));
      h = mix(h, hFloor, prof);
      h += depth * 0.04 * exp(-sq((q - 1.2) / 0.3)) * (1.0 - best);
      // spur-and-gully walls: sharp ribs running down the slopes, gullies between them
      float wallZ = sstep(0.02, 0.2, prof) * sstep(0.99, 0.8, prof);
      float spur = ridged(vec3(u * LW * 4.0, q * 1.5, fi + 4.0), 4, 2.0, 0.55);
      h -= depth * 0.1 * wallZ * (spur - 0.4);
      // colour: layered wall strata (not a painted outline), bright layered deposits, dark floor sand
      float bands = sstep(0.35, 0.65, fract(prof * 6.0 + 0.4 * jA + 0.2 * jB));
      m.r = max(m.r, uChWall * wallZ * sstep(0.1, 0.35, prof) * (0.25 + 0.75 * bands) * (0.7 + 0.3 * spur));
      m.r = max(m.r, 0.7 * uChWall * ild * best);
      float fl = uChFloor * sstep(0.8, 0.98, prof) * (1.0 - 0.5 * slide) * (0.55 + 0.45 * sat(0.5 + fbm(p * fr(Wkm * 0.3), 4) + 0.5 * hum));
      if (uChFloorCh == 0) m.r = max(m.r, fl); else if (uChFloorCh == 1) m.g = max(m.g, fl); else m.b = max(m.b, fl);
      // fossae and pit-crater chains parallel to the system on the plateau either side
      if (uChGraben > 0.0 && best < 0.99) {
        float gp = (abs(y) - 6.2) / 0.85 + 0.35 * snoise(p * fr(Wkm * 2.5) + fi);
        float gi = floor(gp);
        float seg = sstep(-0.1, 0.3, snoise(vec3(u * LW * 0.25, gi, fi * 5.0)));
        float bead = sstep(0.0, 0.3, snoise(vec3(u * LW * 0.08, gi + 9.0, fi)));   // some become pit chains
        float gw = 0.09 + 0.04 * snoise(vec3(u * LW, gi, fi));
        float line = sstep(gw + 0.04, gw, abs(fract(gp) - 0.5));
        float pits = sstep(0.3, 0.15, length(vec2(fract(u * LW * 1.6 + gi * 0.37) - 0.5, (fract(gp) - 0.5) * 1.6)));
        float gr = mix(line, pits, bead) * seg * step(0.0, gp) * sstep(4.5, 2.0, gp) * sstep(1.25, 0.8, abs(u)) * (1.0 - best);
        h -= uChGraben * depth * 0.12 * gr;
      }
    }
` },
    iceSheet: { on: (U) => U.uIS0[3] > 0, code: String.raw`
    { // ice-sheet basin (Sputnik Planitia): a huge smooth plain of soft ice, broken into convection cells
      vec3 c = uIS0.xyz; float R = uIS0.w;
      vec3 e = eastOf(c), n = cross(c, e), v = p - c;
      vec2 lp = vec2(dot(v, e) / uIS1.x, dot(v, n) * uIS1.x);
      float Rkm = R * uR * 0.001;
      float d = length(lp) / R + 0.18 * snoise(p * fr(Rkm * 0.8) + 3.3) + uJag * (0.08 * jag(p, fr(Rkm * 0.25), uTex) + 0.03 * jag(p + 1.1, fr(Rkm * 0.06), uTex));
      if (dot(p, c) < cos(min(R * 2.2, 3.0))) d = 9.0;         // far side: the flat projection is only valid nearby
      if (d < 1.6) {
        float k = sstep(1.0, 0.9, d);                       // the ice surface ends at a ragged shoreline
        vec3 qc = p * fr(uIS1.y) + 0.3 * warpVec(p * fr(uIS1.y * 3.0), 2);
        Cell cc = cellular(qc, 1601u);
        float trough = sstep(0.12, 0.03, cellEdge(cc, qc));   // cell boundaries: shallow troughs
        float dome = 1.0 - sat(cc.f1 * 1.4);
        float margin = sstep(0.55, 0.9, d);                  // cells fade out toward the margin: pitted, featureless ice
        float pits = sstep(0.28, 0.18, cellular(p * fr(uIS1.y * 0.15) + 7.7, 1603u).f1) * margin;
        float sw = fbm(p * fr(Rkm * 0.35) + 5.1, 4);              // the ice surface is never level: broad swells, flow bulges
        float level = uIS1.z + 250.0 * sw + 140.0 * dome * (1.0 - margin) - 200.0 * trough * (1.0 - margin) - 120.0 * pits
                    + 90.0 * erodedFbm(p * fr(uIS1.y * 0.3) - 2.2, octaves(fr(uIS1.y * 0.3), uTex), 2.0, 0.55, 1.0);
        h = mix(h, level, k);
        h += 0.45 * (uIS1.z - h) * sstep(1.45, 1.0, d) * (1.0 - k) * (0.6 + 0.4 * snoise(p * fr(Rkm * 0.2)));   // the rim slopes down into the basin, broken by valleys
        m.a = max(m.a, k * uIS1.w * (0.85 + 0.15 * dome - 0.25 * trough * (1.0 - margin)));
        m.g = max(m.g, k * 0.5 * trough * (1.0 - margin));       // dark debris collects in the troughs
        m.b *= 1.0 - k; m.r *= 1.0 - 0.8 * k;                     // young ice: no craters, no ejecta
      }
    }
` },
    chasmata: { on: (U) => U.uChOn > 0 && U.uVTn === 0, code: String.raw`
    // Great canyon systems (Valles Marineris, Charon's chasmata): wide troughs with flat, resurfaced
    // floors carrying their own flow texture and colour, scalloped terraced walls, remnant plateau islands,
    // en-echelon parallel troughs and graben fields on the surrounding plateau.
    for (int i = 0; i < uFCount; i++) {
      vec4 A = uF[i], B = uFP[i];
      if (int(B.x + 0.5) != 12) continue;
      vec3 c = A.xyz; float r = A.w, W = B.z;         // half-length, half-width (rad)
      vec3 e = eastOf(c), n = cross(c, e);
      vec3 tg = cos(B.y) * e + sin(B.y) * n;
      vec3 ax = normalize(cross(c, tg));
      float along = atan(dot(p, tg), dot(p, c));
      if (abs(along) > r * 1.25 + W * 6.0) continue;
      float Wkm = W * uR * 0.001, fi = float(i);
      float wob = W * (1.4 * snoise(vec3(along / W * 0.06, fi, 1.0)) + 0.35 * snoise(p * fr(Wkm * 1.5) + fi));
      float xs = dot(p, ax) - sin(B.w) + wob;                        // signed cross-track distance
      if (abs(xs) > W * 7.0) continue;
      float endT = sat((r - abs(along)) / (r * 0.35));                 // tapering, splitting ends
      float wv = (1.0 + 0.4 * snoise(vec3(along / W * 0.12, fi, 3.0)) + 0.18 * snoise(vec3(along / W * 0.5, fi, 7.0))) * mix(0.25, 1.0, sqrt(endT));
      float ax1 = abs(xs) / (W * max(wv, 0.15));
      // scalloped, fractal wall line: alcoves at several scales
      float xe = ax1 + uJag * (0.2 * jag(p + fi, fr(Wkm * 0.9), uTex) + 0.06 * jag(p - fi, fr(Wkm * 0.2), uTex));
      // remnant plateau islands (inselbergs / mesas) standing inside the trough
      float isl = uChIslands * sstep(0.26, 0.4, fbm(p * fr(Wkm * 1.8) + fi * 3.1, 4) + 0.07 * jag(p, fr(Wkm * 0.3), uTex)) * sstep(0.9, 0.3, ax1);
      xe = max(xe, isl * 1.35);
      float inside = sstep(1.02, 0.78, xe) * sstep(0.0, 0.08, endT);
      float t3 = inside * 3.0;
      float prof = mix(inside, floor(t3) / 3.0 + sstep(0.62, 1.0, fract(t3)) / 3.0, 0.55);   // terraced walls
      // resurfaced floor: subdued old relief, flow lineations parallel to the trough that swirl round islands
      vec3 fq = vec3(along * uR / 1000.0 / (Wkm * 1.2), xs / W * 1.6, fi);
      fq += 0.35 * warpVec(p * fr(Wkm * 0.7) + fi, 2);
      float lin = ridged(vec3(fq.x * 2.5, fq.y * 14.0, fq.z), 5, 2.0, 0.55) - 0.35;
      float swell = fbm(p * fr(Wkm * 0.5) - fi, 4);
      float depth = uChDepth * (0.8 + 0.25 * snoise(vec3(along / W * 0.08, fi, 9.0))) * mix(0.6, 1.0, endT);
      float hFloor = 0.2 * h - depth + uChFlow * (lin + 0.8 * swell);
      h = mix(h, hFloor, prof);
      h += depth * 0.05 * exp(-sq((xe - 1.2) / 0.3)) * (1.0 - inside);           // slightly raised rim flanks
      // wall exposures (bright layered bands) and the floor's own material
      float wallB = sstep(0.05, 0.3, prof) * sstep(0.97, 0.7, prof) * (0.6 + 0.4 * sstep(-0.2, 0.3, snoise(vec3(along / W * 2.0, prof * 6.0, fi))));
      m.r = max(m.r, uChWall * wallB);
      float fl = uChFloor * sstep(0.75, 0.97, prof) * (0.75 + 0.25 * sat(0.5 + lin + 0.3 * swell));
      if (uChFloorCh == 0) m.r = max(m.r, fl); else if (uChFloorCh == 1) m.g = max(m.g, fl); else m.b = max(m.b, fl);
      // graben fields: narrow flat-floored troughs parallel to the canyon on the plateau alongside
      if (uChGraben > 0.0) {
        float gp = (abs(xs) / W - 1.3) / 0.6 + 0.35 * snoise(p * fr(Wkm * 2.0) + fi);
        float gi = floor(gp);
        float seg = sstep(-0.05, 0.3, snoise(vec3(along / W * 0.7, gi, fi * 5.0)));
        float gw = 0.1 + 0.05 * snoise(vec3(along / W * 2.0, gi, fi));
        float gr = sstep(gw + 0.04, gw, abs(fract(gp) - 0.5)) * seg * sstep(5.5, 2.0, gp) * step(0.0, gp) * (1.0 - inside);
        h -= uChGraben * depth * 0.12 * gr * endT;
      }
    }
` },
    craters: { on: (U) => U.uCraterDens > 0 && U.uCraterOct > 0, def: 'USE_CRATERS', code: String.raw`
    craterField(p, uCraterDens, uCraterFresh, uCraterAmp, 2000u, mix(uLowCraters, 1.0, 0.5), true, h, m);
` },
    list1: { on: (U) => U.types1, code: String.raw`
    for (int i = 0; i < uFCount; i++) {
      vec4 A = uF[i], B = uFP[i];
      int t = int(B.x + 0.5);
      vec3 c = A.xyz; float r = A.w;
      if (t == 4 || t == 10 || t == 11) {       // arcs. B = (type, orientation, width rad, curvature)
        vec3 e = eastOf(c), n = cross(c, e);
        vec3 tg = cos(B.y) * e + sin(B.y) * n;
        vec3 ax = normalize(cross(c, tg));
        float along = atan(dot(p, tg), dot(p, c));
        if (abs(along) > r * 1.1) continue;
        float wob = snoise(p * fr(300.0) + float(i)) * B.z * 0.8 + snoise(p * fr(60.0) - float(i)) * B.z * 0.25;
        float dist = abs(dot(p, ax) - sin(B.w) + wob * (t == 10 ? 1.5 : 1.0));
        float x = dist / B.z;
        float win = sstep(r * 1.1, r * 0.8, abs(along));
        if (t == 4) {                           // Europan double ridge with central trough + brown halo
          h += win * 180.0 * (exp(-sq((x - 0.55) / 0.28)) - 0.7 * exp(-sq(x / 0.18)));
          m.g = max(m.g, win * (0.55 * sstep(2.6, 0.3, x) + 0.45 * sstep(0.7, 0.1, x)));
        } else if (t == 11) {                   // tiger stripe: deep fissure with raised flanks
          h += win * (exp(-sq((x - 0.8) / 0.4)) * 250.0 - 450.0 * exp(-sq(x / 0.35)));
          m.g = max(m.g, win * sstep(2.5, 0.2, x));
        } else {                                // canyon: flat floor, terraced walls, side ravines
          float wn = x + 0.25 * fbm(p * fr(40.0) + float(i), 3);
          float wall = sstep(0.55, 1.0, wn);
          float steps = floor(wall * 5.0) / 5.0 + sstep(0.6, 1.0, fract(wall * 5.0)) / 5.0;
          float prof = -(1.0 - mix(wall, steps, 0.5));
          float gully = sstep(1.0, 1.8, wn) * sstep(2.6, 1.6, wn) * pow(max(0.0, snoise(vec3(along / B.z * 1.5, float(i), 0.0))), 2.0);
          h += win * (prof * uCanyonDepth - uCanyonDepth * 0.2 * gully) * sstep(0.0, 0.2, 1.0 - abs(along) / r);
          m.b = max(m.b, win * 0.6 * sstep(0.9, 0.4, wn));
          if (uCanyonBand > 0.0) {                // deposits spread either side: streaks across the canyon, ragged edges
            float streak = 0.55 + 0.45 * snoise(vec3(along / B.z * 0.35, x * 0.04, float(i) * 3.0)) + 0.3 * snoise(vec3(along / B.z * 1.3, x * 0.15, float(i)));
            float reach = uCanyonBandW * (0.6 + 0.6 * (0.5 + 0.5 * snoise(vec3(along / B.z * 0.12, float(i), 5.0))));
            float band = sat(uCanyonBand * win * sstep(reach + 0.4 * reach * jag(p, fr(60.0), uTex), 0.3 * reach, x) * sat(streak));
            band = frayed(band, jag(p + 1.7, fr(25.0), uTex), 1.0);
            if (uCanyonBandCh == 0) m.r = max(m.r, band); else if (uCanyonBandCh == 1) m.g = max(m.g, band); else m.b = max(m.b, band);
          }
        }
        continue;
      }
      if (t != 2 && t != 3 && t != 5 && t != 7) continue;
      float d = gcDist(p, c) / r;
      if (t == 2) {                             // giant shield volcano. B = (type, height, caldera, scarp)
        if (d > 4.5) continue;
        float ang = azimuth(p, c);
        vec2 cs = vec2(cos(ang), sin(ang));       // lobate flow fields radiating from the edifice
        float reach = 1.5 + 2.2 * (0.5 + 0.5 * snoise(vec3(cs * 1.6, float(i) * 3.1)));
        float lobe = snoise(vec3(cs * 2.8, d * 0.45 + float(i))) + 0.35 * fbm(p * fr(40.0) + float(i), 4);
        float tongue = sstep(-0.1, 0.05, lobe) * sstep(reach, reach * 0.85, d + 0.15 * snoise(p * fr(60.0))) * sstep(0.7, 1.0, d);
        float kindF = step(0.0, snoise(vec3(cs * 2.0, d * 0.3 - float(i))));
        m.g = max(m.g, tongue * (1.0 - kindF) * 0.4);
        m.r = max(m.r, tongue * kindF * 0.15);
        h += 50.0 * tongue;
        if (d > 1.6) continue;
        float flows = ridged(vec3(ang * 18.0, d * 6.0, float(i)), 4);
        float cone = pow(sat(1.0 - d), 1.25) * (1.0 + 0.04 * flows);
        float scarp = B.w * sstep(1.02, 0.94, d);          // basal escarpment (Olympus Mons)
        float cal = 0.0;
        for (int k = 0; k < L(3); k++) { vec3 o = normalize(c + (eastOf(c) * cos(float(k) * 2.1) + northOf(c) * sin(float(k) * 2.1)) * r * B.z * 0.4); float dk = gcDist(p, o) / (r * B.z * (0.6 + 0.2 * float(k))); cal = max(cal, sstep(1.0, 0.8, dk)); }
        h += B.y * (cone * (1.0 - B.w) + scarp * pow(sat(1.0 - d), 0.6) * 0.7) - B.y * 0.12 * cal;
        h += B.y * 0.03 * sstep(1.6, 1.0, d) * sstep(0.9, 1.05, d) * ridged(p * fr(40.0), 3);   // aureole
        m.g = max(m.g, 0.25 * flows * sstep(1.1, 0.3, d));
      } else if (t == 3) {                      // young rayed crater. B = (type, D km, ray strength, seed)
        if (d > 14.0) continue;
        float ang = azimuth(p, c);
        float az = snoise(vec3(cos(ang), sin(ang), B.w));
        float dd = d * (1.0 + 0.05 * az);
        h += craterProfile(dd, B.y, uDt, 1.0, az, fract(B.w));
        m.r = max(m.r, B.z * ejectaBright(dd, ang, 1.0, B.w));
      } else if (t == 5) {                      // plume deposit (Io). B = (type, kind, width, strength)
        if (d > 1.4) continue;
        float ang = azimuth(p, c);
        float wig = 0.06 * snoise(vec3(cos(ang), sin(ang), float(i)) * 2.0) + uJag * 0.05 * jag(p, fr(r * uR * 0.0004), uTex);
        if (B.y < 0.5) m.b = max(m.b, B.w * (exp(-sq((d + wig - 0.85) / B.z)) + 0.25 * sstep(0.9, 0.1, d + wig)));
        else m.r = max(m.r, B.w * 0.6 * exp(-sq((d + wig) / 0.55)));
      } else {                                  // large patera (Io). B = (type, depth, lava lake, 0)
        if (d > 1.3) continue;
        float ang = azimuth(p, c);
        float edge = 1.0 + 0.2 * snoise(vec3(cos(ang), sin(ang), float(i)) * 1.7) + 0.08 * snoise(vec3(cos(ang), sin(ang), float(i) + 5.0) * 6.0);
        float inside = sstep(1.0, 0.94, d / edge);
        h = mix(h, h - B.y, inside);
        m.g = max(m.g, inside * 0.9);
        m.a = max(m.a, inside * B.z * sstep(0.2, 0.8, snoise(p * fr(20.0) + float(i)) + 0.5));
        m.b = max(m.b, 0.5 * sstep(1.4, 1.0, d / edge) * (1.0 - inside));
      }
    }
` },
    eqRidge: { on: (U) => U.uEqRidge !== 0, code: String.raw`
    { float tl = radians(uEqTilt);                // equatorial ridge: a segmented mountain chain around a great circle
      vec3 ax = normalize(vec3(0.0, cos(tl), sin(tl)));
      vec3 b1 = normalize(cross(ax, vec3(0.0, 0.0, 1.0) + vec3(0.3, 0.0, 0.0))), b2 = cross(ax, b1);
      float lonA = atan(dot(p, b2), dot(p, b1));
      vec3 ring = vec3(cos(lonA), sin(lonA), 0.0);
      float offKm = asin(clamp(dot(p, ax), -1.0, 1.0)) * uR * 0.001;
      float wob = uEqWidth * (0.9 * fbm(ring * 2.0 + SO, 3) + 0.25 * fbm(ring * 9.0 - SO, 3));
      float x = (offKm - wob) / uEqWidth;
      float seg = sstep(1.0 - uEqCover, 1.0 - uEqCover + 0.25, 0.5 + 0.6 * fbm(ring * 5.0 + SO * 2.0, 4));
      float peaks = 0.45 + 0.75 * ridgedEroded(p * fr(uEqWidth * 0.5) + SO, octaves(fr(uEqWidth * 0.5), uTex), 2.05, 0.55, 0.8);
      float chain = exp(-x * x * 1.4) * peaks + 0.25 * exp(-x * x * 0.25) * (0.5 + 0.5 * fbm(p * fr(uEqWidth * 2.0), 4));
      h += uEqRidge * seg * chain;
      if (uEqBand > 0.0) {                         // the ridge carries its own colour band, frayed and streaky
        float bw = uEqBandW / uEqWidth;
        float streak = 0.6 + 0.5 * snoise(ring * 14.0 + vec3(0.0, 0.0, x * 0.3)) + 0.3 * snoise(ring * 40.0 + vec3(0.0, 0.0, x));
        float band = sat(uEqBand * sstep(bw * 1.1, bw * 0.3, abs(x) + 0.35 * bw * jag(p, fr(80.0), uTex)) * sat(streak) * mix(0.35, 1.0, seg));
        band = frayed(band, jag(p - 2.3, fr(30.0), uTex), 1.0);
        if (uEqBandCh == 0) m.r = max(m.r, band); else if (uEqBandCh == 1) m.g = max(m.g, band); else m.b = max(m.b, band);
      } }
` },
    dimples: { on: (U) => U.uDimple > 0, code: String.raw`
    { vec3 q = p * fr(uDimpleSize) + SO * 1.7 + 0.25 * warpVec(p * fr(uDimpleSize * 6.0), 2);   // cantaloupe terrain
      float region = sstep(1.0 - uDimpleCover, 1.0 - uDimpleCover + 0.12, 0.5 + 0.6 * warped(p * 2.2 + SO * 3.3, 3, 0.8));
      if (region > 0.0) {
        Cell c = cellular(q, 707u);
        float ed = cellEdge(c, q) + 0.03 * jag(p, fr(uDimpleSize * 0.3), uTex);
        float pit = 1.0 - sstep(0.0, 0.5, c.f1);
        float rim = sstep(0.09, 0.0, ed);
        h += uDimple * region * (0.55 * rim - 0.7 * pit * (0.6 + 0.4 * c.id));
        m.b = max(m.b, region * rim * 0.35);
      } }
` },
    lineaeNet: { on: (U) => U.uLinNet > 0, code: String.raw`
    { float fracMask = fracMaskAt(p);          // long, curving, crossing ridge families of different ages
      for (int k = 0; k < L(5); k++) {
        float f = fr(uLinScale) * pow(1.45, float(k));
        vec3 dirK = normalize(hash33(ivec3(k, 3, 7), uint(uSeed) + 11u) - 0.5);
        vec3 q = p * f + SO * (1.3 * float(k + 1));
        q -= dirK * dot(q, dirK) * 0.96;
        vec3 g; float nv = snoiseGrad(q, g);
        vec3 gt = g - p * dot(g, p);
        float distKm = abs(nv) / max(length(gt), 0.05) / f * uR * 0.001;
        float wk = uLinWidth * (0.6 + 0.8 * fract(float(k) * 0.618 + 0.3)) * (0.7 + 0.3 * snoise(q * 0.5));
        float x = distKm / wk;
        float seg = sstep(-0.15, 0.35, snoise(q * 0.3 + 7.0)) * fracMask;
        float age = 1.0 - 0.12 * float(k);
        h += uLinNet * seg * (exp(-sq((x - 0.9) / 0.5)) - 0.6 * exp(-sq(x / 0.35))) / (1.0 + 0.4 * float(k));
        m.g = max(m.g, seg * age * (0.3 * exp(-sq(x / 3.0)) + 0.7 * exp(-sq(x / 0.9))));
      } }
` },
    lanes: { on: (U) => U.uLaneAmp > 0, code: String.raw`
    { vec3 q = p * fr(uLaneScale) + 0.25 * warpVec(p * 2.0 + SO, 3);   // bright grooved lanes (sulci)
      float tq = uTex * fr(uLaneScale);                                  // one texel in q units
      float jn = uJag * (0.05 * jag(p, fr(uLaneScale * 0.06), uTex) + 0.03 * snoise(q * 3.0));
      Cell c = cellular(q, 555u);
      float ed = cellEdge(c, q) + jn;
      float along = 0.6 + 0.8 * (0.5 + 0.5 * fbm(q * 1.7 + c.id * 9.0, 3));   // width varies along the lane
      float wL = uLaneWidth * (0.35 + 1.1 * fract(c.id * 13.0 + c.id2 * 7.0)) * along;
      float lane = sstep(wL + tq, wL - tq, ed) * step(1.0 - uLaneCover, fract(c.id * 5.3 + c.id2 * 5.3));
      vec3 q2 = q * 2.1 + 11.0;
      Cell c2 = cellular(q2, 556u);
      float ed2 = cellEdge(c2, q2) + jn * 2.1;
      float lane2 = sstep(wL * 0.6 + tq * 2.1, wL * 0.6 - tq * 2.1, ed2) * step(1.0 - uLaneCover * 0.5, fract(c2.id * 9.1 + c2.id2 * 3.3));
      float Lw = max(lane, 0.85 * lane2);
      // grooves run parallel to the lane, in sets that are broken, offset and of mixed spacing
      float e0 = lane >= lane2 ? ed : ed2;
      float setv = fbm(q * 5.0 + 3.0, 2);
      float gph = e0 * uLaneGrooves * (0.7 + 0.6 * step(0.0, setv)) + 0.5 * snoise(q * 6.0) + 2.0 * step(0.0, setv);
      float gro = pow(abs(sin(gph * PI)), 0.8) * (0.55 + 0.45 * sstep(-0.2, 0.3, snoise(q * 9.0 + 5.0)));
      float bound = sstep(0.0, tq * 2.0, abs(e0 - wL) ) ;                 // small scarp where lane meets dark terrain
      h += uLaneAmp * Lw * (0.6 * gro - 0.5) + uLaneAmp * 0.25 * (1.0 - bound) * Lw;
      float laneTone = 0.65 + 0.35 * fract((lane >= lane2 ? c.id + c.id2 : c2.id * 3.0 + c2.id2) * 17.3);
      laneTone *= 0.85 + 0.15 * sstep(-0.3, 0.3, jag(p, fr(uLaneScale * 0.03), uTex));
      m.b = max(m.b, Lw * laneTone * (0.8 + 0.2 * gro) * (0.9 + 0.1 * snoise(q * 12.0)));
      // arcuate furrow systems in the old dark terrain (remnants of ancient multi-ring impacts)
      if (uFurrow > 0.0) {
        vec3 qf = p * fr(uLaneScale * 1.6) + SO * 1.3;
        Cell cf = cellular(qf, 561u);
        float rr = length(qf - cf.c1);
        float ph = rr * 45.0 + 1.5 * fbm(qf * 3.0, 3);
        float fur = pow(sstep(0.75, 1.0, abs(sin(ph))), 1.5) * sstep(0.2, 0.6, rr) * sstep(1.2, 0.8, rr);
        fur *= sstep(-0.1, 0.3, snoise(qf * 4.0 + 2.0)) * (1.0 - Lw);
        h -= uFurrow * fur;
        m.r = max(m.r, 0.25 * fur);
      }
    }
` },
    flows: { on: (U) => U.uFlowUnits > 0, code: String.raw`
    { float lowMask = 1.0 - 0.8 * sstep(-uTrans, uTrans, provAt(p));   // lava-flow fields on the plains
      // each flow is one lobate sheet with a single tone, fronts ragged; later layers overlap earlier ones
      for (int k = 0; k < L(3); k++) {
        float fS = fr(uFlowScale / (1.0 + 0.8 * float(k)));
        vec3 q = p * fS + SO * float(k + 3);
        q += 0.55 * warpVec(q * 0.45, 3);
        Cell c = cellular(q, 610u + uint(k));
        if (c.id > uFlowUnits) continue;
        float front = c.f1 + 0.22 * fbm(q * 2.2, 3) + 0.06 * uJag * jag(p, fS * 10.0, uTex);
        float rr = 0.45 + 0.3 * fract(c.id * 17.0);
        float unit = sstep(rr + uTex * fS, rr - uTex * fS, front) * lowMask;
        if (unit <= 0.0) continue;
        h += 45.0 * unit / (1.0 + 0.5 * float(k));
        float tone = fract(c.id * 37.0 + float(k) * 0.31);
        float tint = 0.12 + 0.35 * fract(c.id * 53.0);
        if (tone < 0.55) m.g = mix(m.g, tint, unit); else m.r = mix(m.r, tint * 0.5, unit);
      } }
` },
    cracks: { on: (U) => U.uCrackAmp > 0, code: String.raw`
    { float fracMask = fracMaskAt(p);          // polygonal fracture troughs at several scales
      float f = fr(uCrackScale);
      for (int o = 0; o < L(3); o++) {
        vec3 q = p * f + 0.35 * warpVec(p * f * 0.25 + SO, 2);
        Cell c = cellular(q, 400u + uint(o));
        float ed = cellEdge(c, q);
        float mask = fracMask * sstep(1.0 - uCrackCover, 1.0 - uCrackCover + 0.2, 0.5 + 0.7 * fbm(p * 3.0 + SO * float(o + 1), 3));
        float w = 0.03 + 0.03 * fract(c.id * 11.0 + c.id2 * 7.0);
        float tr = sstep(w * 1.5, 0.0, ed);
        h -= uCrackAmp * mask * tr / (1.0 + float(o));
        h += uCrackAmp * 0.35 * mask * sstep(w * 3.0, w * 1.4, ed) * sstep(w * 0.6, w * 1.4, ed) / (1.0 + float(o));
        m.g = max(m.g, mask * sstep(w * 2.5, 0.0, ed) * 0.8 / (1.0 + 0.5 * float(o)));
        f *= 2.4;
      } }
` },
    grooves: { on: (U) => U.uGrooveAmp > 0, code: String.raw`
    { vec3 q = p * fr(uGroovePatch) + 0.3 * warpVec(p * 3.0 + SO, 3);   // polygons of parallel ridges
      Cell c = cellular(q, 777u);
      float mask = fracMaskAt(p) * sstep(1.0 - uGrooveCover, 1.0 - uGrooveCover + 0.05, fract(c.id * 3.7));
      if (mask > 0.0) {
        vec3 dir = normalize(hash33(ivec3(floor(c.c1 * 3.0)), 9u) - 0.5);
        float fg = fr(uGrooveScale);
        float ph = dot(p, dir) * fg + 3.0 * fbm(p * fr(uGroovePatch * 0.5) + SO, 3);
        float gr = pow(abs(sin(ph)), 0.6) * (0.7 + 0.3 * sin(ph * 2.7 + 1.0));
        float edge = sstep(0.0, 0.08, cellEdge(c, q));
        h += uGrooveAmp * mask * edge * (gr - 0.5) * (0.6 + 0.4 * fract(c.id * 17.0));
        m.r = max(m.r, mask * edge * uGrooveBright * fract(c.id * 5.1));
      } }
` },
    chaos: { on: (U) => U.uChaosAmp > 0, code: String.raw`
    { float region = sstep(1.0 - uChaosCover, 1.0 - uChaosCover + 0.1, 0.5 + 0.6 * warped(p * 3.5 + SO * 2.5, 4, 0.9));
      if (region > 0.0) {                       // disrupted crust: tilted rafts in a hummocky matrix
        Cell c = cellular(p * fr(uChaosScale) + SO, 123u);
        float raft = sstep(0.62, 0.42, c.f1 + 0.1 * snoise(p * fr(uChaosScale * 0.2)));
        float matrix = 0.5 + 0.5 * fbm(p * fr(uChaosScale * 0.3), 4);
        h = mix(h, h - uChaosAmp * 0.5 + uChaosAmp * (raft * (0.6 + 0.4 * c.id) + 0.3 * matrix), region);
        m.b = max(m.b, region * (1.0 - raft * 0.7));
      } }
` },
    canyonNet: { on: (U) => U.uCanyonAmp > 0, code: String.raw`
    { vec3 q = p * fr(uCanyonScale) + 0.5 * warpVec(p * 2.0 + SO, 3);   // canyon networks on cell edges
      Cell c = cellular(q, 2024u);
      float ed = cellEdge(c, q);
      float mask = sstep(1.0 - uCanyonCover, 1.0 - uCanyonCover + 0.15, 0.5 + 0.6 * fbm(p * 2.5 + SO * 4.0, 3));
      float w = 0.06 * (0.6 + 0.8 * fbm(p * fr(uCanyonScale * 0.3), 3));
      float wall = sstep(w * 0.4, w, ed + 0.02 * fbm(p * fr(30.0), 3));
      float steps = floor(wall * 4.0) / 4.0 + sstep(0.6, 1.0, fract(wall * 4.0)) / 4.0;
      h -= uCanyonAmp * mask * (1.0 - mix(wall, steps, 0.5));
      m.b = max(m.b, mask * sstep(w, w * 0.3, ed) * 0.5); }
` },
    paterae: { on: (U) => U.uPateraDens > 0, code: String.raw`
    { float f = fr(260.0);                      // Io paterae: scalloped calderas, dark lava floors, flows, haloes
      for (int o = 0; o < L(2); o++) {
        vec3 q = p * f + SO;
        Cell c = cellular(q, 900u + uint(o));
        if (c.id < uPateraDens) {
          vec3 u = normalize(q - c.c1);
          float tq = uTex * f;
          // scalloped outline: arcuate bites + straight fault-controlled segments + fractal fringe
          float ang = atan(u.y, u.x) + u.z;
          float scal = 1.0 - 0.18 * pow(abs(sin(ang * (3.0 + floor(fract(c.id * 17.0) * 4.0)) + c.id * 20.0)), 0.5);
          float lob = scal * (1.0 + 0.2 * snoise(u * 1.6 + c.id * 50.0));
          float rr = (0.04 + 0.2 * pow(fract(c.id * 31.0), 2.0)) * lob;
          float dj = c.f1 + uJag * 0.25 * rr * jag(p, f * 6.0, uTex);
          float inside = sstep(rr + tq, rr - tq, dj);
          float kind = fract(c.id * 91.0);
          // floor: mottled cooled-lava tones, fresh dark patches, occasional hot spots
          float floorTone = 0.55 + 0.45 * sstep(-0.2, 0.3, jag(p, f * 10.0, uTex) + 0.3 * (kind - 0.5));
          h -= uPateraAmp * inside * (0.5 + fract(c.id * 7.0));
          h += 40.0 * sstep(rr * 1.25, rr, dj) * (1.0 - inside);           // low raised rim
          m.g = max(m.g, inside * floorTone);
          m.a = max(m.a, inside * sstep(0.7, 0.95, kind) * sstep(0.1, 0.6, snoise(q * 8.0) + 0.3 * jag(p, f * 12.0, uTex)));
          // lobate lava flows spilling out: fingers of varying reach and darkness
          if (uPateraFlows > 0.0 && rr > 0.08) {
            // one or two broad lobate fans of dark lava, with ragged fronts
            float fl = 0.0;
            for (int k = 0; k < L(2); k++) {
              float a0 = fract(c.id * (7.0 + 5.0 * float(k))) * TAU;
              float da = abs(atan(sin(ang - a0), cos(ang - a0)));
              float wid = 0.45 + 0.5 * fract(c.id * (11.0 + float(k)));
              float reach = rr * (1.8 + 3.0 * fract(c.id * (13.0 + 3.0 * float(k)))) * sat(1.0 - sq(da / wid));
              float front = dj + rr * 0.35 * jag(p, f * 5.0, uTex) * uJag;
              fl = max(fl, sstep(reach + tq, reach - tq, front) * step(float(k), fract(c.id * 29.0) * 1.6));
            }
            float flow = fl * (1.0 - inside) * uPateraFlows;
            m.g = max(m.g, flow * (0.3 + 0.35 * fract(c.id * 5.7)) * (0.75 + 0.25 * floorTone));
            h += 25.0 * flow;
          }
          float halo = frayed(sstep(rr * 2.6, rr, dj) * (1.0 - inside), jag(p, f * 4.0, uTex), 1.0);
          float hk = fract(c.id * 57.0);
          if (hk < 0.1) m.b = max(m.b, halo * 0.4); else if (hk < 0.2) m.r = max(m.r, halo * 0.3);
        }
        f *= 2.2;
      } }
` },
    texture: { on: (U) => U.uMicro > 0, code: String.raw`
    { vec3 tu = terrainUnits(p, SO, uR, uTex, uUnitScale);     // geological units with ragged contacts
      float smoothU = 1.0 - tu.x - tu.y;
      float fM = fr(uUnitScale * 0.08);
      int oM = octaves(fM, uTex);
      float hum = ridgedEroded(p * fM + SO * 3.3, oM, 2.1, 0.58, 1.5) - 0.3;   // hummocky, blocky
      float pits = erodedFbm(p * fM * 2.0 - SO, max(1, oM - 1), 2.0, 0.55, 2.0);
      // lineated fabric: fine parallel ridges whose direction changes from unit to unit
      vec3 dirU = normalize(hash33(ivec3(int(tu.z), 7, 3), 41u) - 0.5);
      float fl = fr(uUnitScale * 0.03);
      float li = pow(abs(sin(dot(p, dirU) * fl + 2.0 * fbm(p * fl * 0.1, 3))), 0.7) - 0.5;
      li *= 0.6 + 0.4 * sstep(-0.3, 0.3, snoise(p * fl * 0.08));
      h += uMicro * (tu.x * hum + tu.y * (0.6 * li + 0.3 * pits) + smoothU * 0.25 * pits);
      // contacts: the rougher unit stands slightly proud with a ragged edge
      h += uMicro * 0.6 * (tu.x + 0.5 * tu.y);
    }
` },
    pvDunes: { on: (U) => U.uPvDunes > 0, code: String.raw`
    for (int i = 0; i < L(3); i++) {             // dune seas filling great provinces (Titan's equatorial sand seas)
      if (uPv3[i].y <= 0.0) continue;
      vec3 pv = provinceAt(i, p, uR, uTex, SO);
      if (pv.x < 0.005) continue;
      vec3 e = eastOf(p), q = p - e * dot(p, e) * 0.85;            // wind-aligned: stretched east-west
      float lat = asin(clamp(p.y, -1.0, 1.0));
      float sp = 3000.0 / uR;                                       // longitudinal dunes ~3 km apart
      float ph = lat / sp * 6.2832 + 5.0 * fbm(q * fr(80.0) + SO, 3);
      float crest = pow(1.0 - abs(sin(ph * 0.5)), 3.0) * sstep(2.5, 5.0, sp / uTex);
      float fF = fr(30.0);                                          // dune-field texture seen from orbit
      float field = 0.5 + 0.5 * fbm(q * fF - SO * 2.0, octaves(fF, uTex), 2.1, 0.55);
      h += uPv3[i].y * pv.x * (0.7 * crest * sstep(0.25, 0.6, field) + 0.8 * field - 0.4);
    }
` },
    dunes: { on: (U) => U.uDunes > 0, code: String.raw`
    { float fd = fr(2.5);                       // transverse dunes in low, flat, sandy ground
      vec3 wd = normalize(eastOf(p) + 0.3 * northOf(p) * snoise(p * 4.0));
      float ph = dot(p, wd) * fd + 4.0 * fbm(p * fr(40.0), 3);
      float dune = pow(0.5 + 0.5 * sin(ph), 3.0);
      float field = sstep(0.1, 0.5, m.b + 0.4 * fbm(p * 5.0 + SO, 3));
      h += uDunes * field * dune; }
` },
    terraces: { on: (U) => U.uTerrace > 0, code: String.raw`
    { float st = 250.0 + 150.0 * fbm(p * 3.0, 2);   // layered deposits
      float v = h / st, fl = floor(v);
      float mask = sstep(0.2, 0.5, fbm(p * 4.0 + SO * 5.0, 3)) * uTerrace;
      h = mix(h, (fl + sstep(0.3, 0.7, fract(v))) * st, mask); }
` },
    lava: { on: (U) => U.uLavaLevel > -1e8 || U.uLavaCracks > 0, code: String.raw`
    if (uLavaLevel > -1e8 && h < uLavaLevel) {  // lava seas: molten lowlands with drifting crust rafts
      float depth = uLavaLevel - h;
      vec3 qc = p * fr(220.0) + SO + 0.3 * warpVec(p * fr(900.0), 2);
      Cell c = cellular(qc, 66u);
      float crust = sstep(0.0, 0.06, cellEdge(c, qc) + 0.02 * snoise(qc * 6.0));
      h = uLavaLevel - 30.0 * crust;
      m.g = max(m.g, crust);
      m.a = max(m.a, (1.0 - crust * 0.85) * sstep(0.0, 200.0, depth));
    }
    if (uLavaCracks > 0.0) {                     // glowing fissures in the crust
      vec3 q = p * fr(160.0) + 0.4 * warpVec(p * 6.0 + SO, 3);
      Cell c = cellular(q, 71u);
      float glow = sstep(0.035, 0.0, cellEdge(c, q) + 0.01 * snoise(q * 8.0)) * sstep(0.3, 0.7, 0.5 + fbm(p * 3.0 - SO, 3)) * step(0.45, fract(c.id * 7.0 + c.id2 * 3.0));
      m.a = max(m.a, uLavaCracks * glow);
    }
` },
    caps: { on: (U) => U.uCapH > 0, code: String.raw`
    { float lat = abs(p.y);                     // polar layered deposits: domes cut by spiral troughs
      float capEdge = uCapLat + 0.02 * fbm(p * 10.0 + SO, 3);
      float cap = sstep(capEdge - 0.01, capEdge + 0.02, lat);
      if (cap > 0.0) {
        vec3 pole = vec3(0.0, sign(p.y), 0.0);
        float colat = gcDist(p, pole);
        float th = atan(p.z, p.x) * sign(p.y);
        float spiral = sin(th * 2.0 + log(max(colat, 1e-3)) * 7.0 + fbm(p * 8.0, 2) * 1.5);
        float trough = sstep(0.85, 1.0, spiral) * sstep(0.02, 0.08, colat);
        float dome = uCapH * pow(sat(1.0 - colat / max(1e-3, acos(capEdge))), 0.5);
        h += cap * (dome - trough * uCapH * 0.25);
        m.a = max(m.a, cap * (1.0 - trough * 0.8));
      } }
` },
  };

  // Passes: feature groups sharing one small shader. Heavy features get a pass of their own.
  const STAGE0 = [['base', 'montes', 'rubble'], ['provinces'], ['scarps'], ['tesserae', 'shields', 'blocks'], ['oldCraters'], ['list0', 'mare', 'wrinkle']];
  const STAGE1 = [['texture'], ['lanes'], ['lineaeNet'], ['eqRidge', 'dimples'], ['chasmata'], ['valles'], ['craters'], ['list1'], ['flows', 'cracks'], ['grooves', 'chaos', 'canyonNet'], ['paterae'], ['iceSheet'], ['dunes', 'pvDunes', 'terraces', 'lava', 'caps']];

  function passSource(names) {
    const defs = [...new Set(names.map((n) => BLOCKS[n].def).filter(Boolean))].map((d) => `#define ${d} 1`).join('\n');
    const init = BLOCKS[names[0]].init;
    return `${defs}\n//#include planet\n${COMMON}\nvoid main() {\n  vec3 p = cellDir();\n  SO = seedOff(uSeed);\n` +
      (init ? '' : '  float h = at(uHin).r; vec4 m = at(uMin);\n') +
      names.map((n) => BLOCKS[n].code).join('\n') + '\n  oH = vec4(h);\n  oM = m;\n}\n';
  }

    // ---------------------------------------------------------------- CPU: feature lists
  function arcFeature(r, type, lenRad, widthRad, curv) {
    const c = S.randDir(r);
    return { A: [...c, lenRad], B: [type, r() * Math.PI * 2, widthRad, curv] };
  }
  function makeFeatures(P, R, seed) {
    const r = S.rng(seed * 977 + 13), out = [];
    const km = (x) => x * 1000 / R;
    for (let i = 0; i < (P.basins | 0); i++) {
      const rad = km(P.craterMax * (0.6 + 1.4 * r())) ;
      out.push({ A: [...S.randDir(r), rad], B: [F.BASIN, P.basinDepth * (0.6 + 0.5 * r()), r() < 0.6 ? 1 : 0, r() < (P.basinFlood ?? 0) ? 0.45 + 0.4 * r() : 0] });
    }
    for (let i = 0; i < (P.rises | 0); i++) out.push({ A: [...S.randDir(r), km(P.riseSize * (0.7 + 0.5 * r()))], B: [F.DOME, P.riseHeight * (0.6 + 0.4 * r()), 0, 0] });
    for (let i = 0; i < (P.giantVolcanoes | 0); i++) {
      const big = i === 0;
      out.push({ A: [...S.randDir(r), km((big ? 300 : 120 + 120 * r()) * (P.volcanoWidth || 1))], B: [F.SHIELD, P.volcanoHeight * (big ? 1 : 0.35 + 0.4 * r()), 0.12 + 0.05 * r(), big ? P.volcanoScarp : P.volcanoScarp * 0.3] });
    }
    for (let i = 0; i < (P.coronae | 0); i++) out.push({ A: [...S.randDir(r), km(100 + 400 * r() * r())], B: [F.CORONA, 600 + 900 * r(), 1, 0] });
    for (let i = 0; i < (P.rayed | 0); i++) {
      const D = P.rayedSize * (0.25 + 0.75 * r() * r());
      out.push({ A: [...S.randDir(r), km(D / 2)], B: [F.RAYED, D, (0.6 + 0.4 * r()) * (P.rayBrightness ?? 1), r() * 100] });
    }
    for (let i = 0; i < (P.lineae | 0); i++) out.push(arcFeature(r, F.LINEA, 0.2 + 0.6 * r(), km(3 + 6 * r()), (r() - 0.5) * 0.08));
    for (let i = 0; i < (P.canyons | 0); i++) {
      const f = arcFeature(r, F.CANYON, km(P.canyonLength * (0.4 + 0.6 * r())) / 2, km((40 + 60 * r()) * (P.canyonWidth ?? 1)), (r() - 0.5) * 0.1);
      if (i === 0 && P.canyonEquator) {            // the great canyon runs along the equator (or the ridge line)
        const tl = (P.eqTilt || 0) * Math.PI / 180, lon = r() * Math.PI * 2;
        const ax = [0, Math.cos(tl), Math.sin(tl)], b1 = S.vnorm(S.vcross(ax, [0.3, 0, 1])), b2 = S.vcross(ax, b1);
        const c = S.vnorm([b1[0] * Math.cos(lon) + b2[0] * Math.sin(lon), b1[1] * Math.cos(lon) + b2[1] * Math.sin(lon), b1[2] * Math.cos(lon) + b2[2] * Math.sin(lon)]);
        const e = S.vnorm([c[2], 0, -c[0]]), nn = S.vcross(c, e), t = S.vcross(ax, c);
        f.A = [...c, km(P.canyonLength) / 2]; f.B[1] = Math.atan2(S.vdot(t, nn), S.vdot(t, e)); f.B[3] = 0;
      }
      out.push(f);
    }
    if (P.tigerStripes) {
      const c = [0, -0.98, 0.2]; const cn = S.vnorm(c);
      for (let k = 0; k < 4; k++) { const off = S.vnorm([cn[0] + (k - 1.5) * 0.06, cn[1], cn[2] + (k - 1.5) * 0.05]); out.push({ A: [...off, km(70)], B: [F.STRIPE, 0.6, km(2.5), 0] }); }
    }
    for (let i = 0; i < (P.plumes | 0); i++) out.push({ A: [...S.randDir(r), km(250 + 450 * r())], B: [F.PLUME, i < (P.redPlumes ?? 1) ? 0 : 1, 0.05 + 0.04 * r(), 0.5 + 0.5 * r()] });
    for (let i = 0; i < (P.bigPaterae | 0); i++) out.push({ A: [...S.randDir(r), km(60 + 90 * r())], B: [F.PATERA, 800 + 800 * r(), r() < 0.5 ? 0.9 : 0.3, 0] });
    // great canyon systems: own rng so adding them never reshuffles the other features
    const rc = S.rng(seed * 331 + 71);
    for (let i = 0; i < (P.chasmata | 0); i++) {
      const valles = (P.chasmaStyle | 0) === 1;
      const W = km((P.chasmaWidth ?? 150) * (valles ? 1 : 0.8 + 0.4 * rc()) / 2), L = km((P.chasmaLength ?? 3000) * (valles ? 1 : 0.7 + 0.5 * rc())) / 2;
      const f = arcFeature(rc, F.CHASMA, L, W, valles ? 0 : (rc() - 0.5) * 0.12);
      if (valles && i === 0 && P.chasmaEquator) {              // lie along a line of latitude, west to east
        const lon = rc() * Math.PI * 2, la = (P.chasmaLat || 0) * Math.PI / 180;
        f.A = [Math.cos(la) * Math.cos(lon), Math.sin(la), Math.cos(la) * Math.sin(lon), L]; f.B[1] = 0;
      }
      out.unshift(f);
      if (valles) continue;
      for (let k = 0; k < (P.chasmaParallel | 0); k++) {          // smaller en-echelon trough alongside
        const side = rc() < 0.5 ? -1 : 1;
        const g = { A: [...f.A], B: [...f.B] };
        g.A[3] = L * (0.35 + 0.3 * rc()); g.B[2] = W * (0.35 + 0.25 * rc());
        g.B[3] = f.B[3] + side * W * (3.2 + 1.5 * k + rc());
        out.unshift(g);
      }
    }
    if (P.tharsis) marsLayout(P, out);
    return out.slice(0, MAXF);
  }
  // Real-Mars layout for the big features, in angles (so it scales with the planet): Tharsis rise with
  // Olympus and the three Tharsis Montes, Valles Marineris starting at Noctis Labyrinthus on the rise's
  // east flank, Hellas and Argyre basins.
  function marsLayout(P, out) {
    const lon0 = P.tharsisLon ?? -113, c0 = S.latLonDir(0, lon0);
    const e0 = S.vnorm([c0[2], 0, -c0[0]]), n0 = S.vcross(c0, e0);
    const at = (xkm, ykm) => {
      const x = xkm / 3389.5, y = ykm / 3389.5, d = Math.hypot(x, y) || 1e-9, s = Math.sin(d) / d;
      return S.vnorm([0, 1, 2].map((k) => c0[k] * Math.cos(d) + (e0[k] * x + n0[k] * y) * s));
    };
    const shields = out.filter((f) => f.B[0] === F.SHIELD), domes = out.filter((f) => f.B[0] === F.DOME), basins = out.filter((f) => f.B[0] === F.BASIN);
    const vpos = [[-1240, 1060], [-470, -530], [-60, 0], [480, 650], [200, 2300]];
    shields.forEach((f, i) => { if (i < vpos.length) f.A = [...at(...vpos[i]), f.A[3]]; });
    if (shields[4]) { shields[4].A[3] *= 2.2; shields[4].B[1] *= 0.25; }          // Alba Mons: vast, very low
    if (domes[0]) domes[0].A = [...at(250, 150), domes[0].A[3]];
    if (basins[0]) { basins[0].A = [...S.latLonDir(-42, lon0 + 183), 1150 / 3389.5]; basins[0].B[3] = 0; }   // Hellas
    if (basins[1]) { basins[1].A = [...S.latLonDir(-50, lon0 + 70), 430 / 3389.5]; basins[1].B[3] = 0; }     // Argyre
    const ch = out.find((f) => f.B[0] === F.CHASMA);
    if (ch) { ch.A = [...at(770 + ch.A[3] * 3389.5 * 0.84, -470), ch.A[3]]; ch.B[1] = 0; ch.B[3] = 0; }
  }

  // Valles Marineris layout, in system units. S0 = (u start, u end, y at start, y at end),
  // S1 = (half-width, relative depth, interior-deposit amount, 0). North is +y.
  const VALLES = [
    [[-0.62, -0.17, 0.35, 0.0], [0.85, 0.85, 0.15, 0]],   // Ius
    [[-0.6, -0.16, 2.3, 2.0], [0.5, 0.75, 0.0, 0]],       // Tithonium
    [[-0.2, 0.1, 0.0, -0.1], [1.75, 1.0, 0.8, 0]],        // Melas
    [[-0.21, 0.05, 2.1, 2.2], [1.35, 0.95, 0.9, 0]],      // Candor
    [[-0.05, 0.1, 3.3, 3.1], [0.8, 0.9, 0.6, 0]],         // Ophir
    [[-0.3, -0.13, 5.3, 5.2], [0.55, 0.8, 0.9, 0]],       // Hebes (closed)
    [[0.29, 0.36, 5.4, 5.9], [0.5, 0.7, 0.3, 0]],         // Juventae (closed)
    [[0.06, 0.72, -0.1, -0.7], [0.9, 0.95, 0.15, 0]],     // Coprates
    [[0.68, 1.0, -0.7, -1.6], [1.5, 0.75, 0.3, 0]],       // Eos
    [[0.7, 0.98, 0.1, 0.9], [1.25, 0.75, 0.4, 0]],        // Capri
    [[0.74, 0.98, 1.4, 3.9], [0.95, 0.7, 0.4, 0]],        // Ganges
  ];
  function vallesUniforms(P) {
    const a = new Float32Array(48), b = new Float32Array(48);
    VALLES.forEach(([s0, s1], k) => { a.set(s0, k * 4); b.set(s1, k * 4); });
    const on = (P.chasmata | 0) > 0 && (P.chasmaStyle | 0) === 1;
    return { uVT0: a, uVT1: b, uVTn: on ? VALLES.length : 0, uChLaby: +(P.chasmaLabyrinth ?? 0.8), uChChaos: +(P.chasmaChaos ?? 0.8) };
  }

  function iceSheetUniforms(P, ctx) {
    if (!P.iceSheet) return { uIS0: [0, 1, 0, 0], uIS1: [1, 50, 0, 0] };
    const c = S.latLonDir(P.iceSheetLat ?? 20, P.iceSheetLon ?? 0);
    return { uIS0: [...c, (P.iceSheetSize ?? 1000) * 500 / ctx.R], uIS1: [P.iceSheetStretch ?? 1.3, P.iceSheetCells ?? 30, P.iceSheetLevel ?? -2500, P.iceSheetBright ?? 0.9] };
  }

  // great-province layers (shared with the colour stage)
  function provinceUniforms(P) {
    const a = new Float32Array(12), b = new Float32Array(12), c = new Float32Array(12), d = new Float32Array(12), l = new Float32Array(12);
    let on = false, dunes = 0;
    for (let k = 0; k < 3; k++) {
      const g = (x, d = 0) => (P['pv' + (k + 1) + x] ?? d);
      const st = +g('Style');
      if (st > 0) on = true;
      a.set([st, +g('Cover', 0.3), +g('Size', 1500), +g('Jag', 1)], k * 4);
      b.set([+g('Detail'), +g('EdgeDetail'), +g('Stretch'), +g('Seed', k + 1)], k * 4);
      c.set([+g('LatC'), +g('LatW', 30), +g('LatBias'), +g('Variety', 0.6)], k * 4);
      d.set([+g('Relief'), st > 0 ? +g('Dunes') : 0, +g('Follow'), +g('Soft')], k * 4);
      l.set([+g('LonC'), +g('LonW', 40), +g('LonBias'), 0], k * 4);
      if (st > 0 && +g('Dunes') > 0) dunes = 1;
    }
    return { uPv0: a, uPv1: b, uPv2: c, uPv3: d, uPv4: l, pvOn: on, uPvDunes: dunes };
  }
  S.provinceUniforms = provinceUniforms;

  function uniforms(P, ctx) {
    const f = makeFeatures(P, ctx.R, ctx.seed);
    const a = new Float32Array(MAXF * 4), b = new Float32Array(MAXF * 4);
    f.forEach((x, i) => { a.set(x.A, i * 4); b.set(x.B, i * 4); });
    const d = P.dichoDir ? S.vnorm(P.dichoDir) : S.randDir(S.rng(ctx.seed + 5));
    const n = (v, def = 0) => (v === undefined || v === null ? def : +v);
    const craterMaxRad = n(P.craterMax, 150) * 500 / ctx.R, tex = Math.PI / 2 / ctx.N;
    const types = new Set(f.map((x) => x.B[0]));
    return {
      uCraterOct: Math.max(0, Math.min(14, Math.floor(Math.log2(craterMaxRad / (tex * 1.1))) + 1)), uScarpN: Math.round(n(P.scarpLevels, 3)),
      types0: [F.BASIN, F.CORONA, F.DOME].some((t) => types.has(t)), types1: [F.SHIELD, F.RAYED, F.LINEA, F.PLUME, F.PATERA, F.CANYON, F.STRIPE].some((t) => types.has(t)),
      uF: a, uFP: b, uFCount: f.length, uSeed: (ctx.seed % 10007) + 0.5, uR: ctx.R, uTex: Math.PI / 2 / ctx.N,
      uBaseFreq: n(P.continentScale, 1.3), uBaseWarp: n(P.continentWarp, 0.8), uDicho: n(P.dichotomy), uDichoDir: d,
      uHighH: n(P.highlandHeight, 1500), uLowH: n(P.lowlandHeight, -2500), uTrans: n(P.provinceSharpness, 0.08), uLowRough: n(P.lowlandRoughness, 0.35), uBaseAmp: n(P.undulation, 800),
      uHillsAmp: n(P.roughness, 600), uHillsScale: n(P.hillScale, 250), uErode: n(P.erodedLook, 1.0),
      uMontesAmp: n(P.mountainHeight), uMontesScale: n(P.mountainScale, 180), uMontesCover: n(P.mountainCover, 0.3),
      uCraterDens: P.craters ? n(P.craterDensity) : 0, uOldCraters: P.craters ? n(P.oldCraters) : 0, uCraterMax: n(P.craterMax, 150) * 500 / ctx.R,
      uCraterFresh: n(P.craterFreshness, 1.0), uLowCraters: n(P.lowlandCraters, 1), uBrightFrac: n(P.brightCraters, 0.02),
      uLinNet: n(P.lineaeNet), uLinScale: n(P.lineaeScale, 400), uLinWidth: n(P.lineaeWidth, 4), uLaneAmp: n(P.lanes), uLaneScale: n(P.laneScale, 900), uLaneWidth: n(P.laneWidth, 0.12), uLaneGrooves: n(P.laneGrooves, 40), uLaneCover: n(P.laneCover, 0.7), uFracLow: n(P.fracturesInLowlands), uDt: n(P.transitionDiameter, 15), uCraterSfd: n(P.craterSfd, 1.0), uFloorDark: n(P.floorDark),
      uEjecta: n(P.ejectaBright, 1), uCraterAmp: n(P.craterDepth, 1),
      uCanyonAmp: n(P.canyonNet), uCanyonScale: n(P.canyonScale, 900), uCanyonCover: n(P.canyonCover, 0.2),
      uCrackAmp: n(P.cracks), uCrackScale: n(P.crackScale, 300), uCrackCover: n(P.crackCover, 0.5),
      uGrooveAmp: n(P.grooves), uGrooveScale: n(P.grooveSpacing, 8), uGrooveCover: n(P.grooveCover, 0.5), uGroovePatch: n(P.groovePatch, 400), uGrooveBright: n(P.grooveBright, 0.35), uRiftBelt: n(P.riftBelt), uPatchy: n(P.craterPatchiness), uMariaCraters: n(P.mariaCraters, 1), uFlowUnits: n(P.flowUnits), uFlowScale: n(P.flowScale, 500),
      uChaosAmp: n(P.chaos), uChaosCover: n(P.chaosCover, 0.15), uChaosScale: n(P.chaosBlock, 30),
      uTessAmp: n(P.tesserae), uTessCover: n(P.tesseraeCover, 0.15), uWrinkle: n(P.wrinkleRidges), uShieldDens: n(P.shieldFields), uShieldAmp: n(P.shieldHeight, 800),
      uPateraDens: n(P.paterae) / 200, uPateraAmp: n(P.pateraDepth, 800), uMtnAmp: n(P.blockMountains), uMtnCover: n(P.blockCover, 0.08),
      ...vallesUniforms(P), uChOn: (P.chasmata | 0) > 0 ? 1 : 0, uChDepth: n(P.chasmaDepth, 5000), uChIslands: n(P.chasmaIslands, 0.5), uChFlow: n(P.chasmaFlow, 150), uChGraben: n(P.chasmaGraben, 0.5), uChFloor: n(P.chasmaFloor, 0.6), uChFloorCh: n(P.chasmaFloorMaterial, 2), uChWall: n(P.chasmaWall, 0.3),
      uDunes: n(P.dunes), uTerrace: n(P.terraces), uMare: n(P.maria), uPlains: n(P.plainsRelief, 350), uChTrib: n(P.chasmaTributaries, 0.6), ...iceSheetUniforms(P, ctx), uBasinDust: n(P.basinDust), uRiseDust: n(P.riseDust), uFine: n(P.fineRelief, 350), uMareLevel: n(P.mareLevel, -1500),
      uLavaLevel: P.lavaSea ? n(P.lavaLevel, -500) : -1e9, uLavaCracks: n(P.lavaCracks),
      uScarpAmp: n(P.scarps), uScarpScale: n(P.scarpScale, 600), uScarpLip: n(P.scarpLip, 0.3), uRubble: n(P.rubble), uMicro: n(P.microRelief), uUnitScale: n(P.unitScale, 250), uJag: n(P.edgeJag, 1), uFurrow: n(P.furrows), uPalimp: n(P.palimpsests), uPateraFlows: n(P.pateraFlows), uSecondYoung: n(P.youngSecondary),
      uEqRidge: n(P.eqRidge), uEqWidth: n(P.eqRidgeWidth, 80), uEqTilt: n(P.eqTilt), uEqCover: n(P.eqRidgeCover, 0.8), uEqBand: n(P.eqBand), uEqBandW: n(P.eqBandWidth, 250), uEqBandCh: Math.round(n(P.eqBandMaterial)),
      uCanyonBand: n(P.canyonBand), uCanyonBandW: n(P.canyonBandWidth, 4), uCanyonBandCh: Math.round(n(P.canyonBandMaterial)), uCanyonDepth: n(P.canyonDepth, 7000),
      uDimple: n(P.dimples), uDimpleSize: n(P.dimpleSize, 40), uDimpleCover: n(P.dimpleCover, 0.5),
      ...provinceUniforms(P),
      uCapH: P.iceCaps ? n(P.capHeight, 2500) : 0, uCapLat: Math.sin((90 - n(P.capSize, 8)) * Math.PI / 180),
    };
  }


  async function runPasses(ctx, groups, U, H, M, report, label, p0, p1) {
    const { gpu } = ctx;
    const passes = groups.map((g) => g.filter((n) => BLOCKS[n].init || !BLOCKS[n].on || BLOCKS[n].on(U))).filter((g) => g.length);
    let src = { H, M }, dst = { H: gpu.field(ctx.N, 'r32f'), M: gpu.field(ctx.N, 'rgba16f') };
    for (let k = 0; k < passes.length; k++) {
      const names = passes[k];
      report(`${label} — compiling shaders`, p0 + (p1 - p0) * k / passes.length);
      const prog = await gpu.programAsync('lf.' + names.join('+'), passSource(names));
      await gpu.runTiled(prog, [dst.H, dst.M], { ...U, uHin: src.H, uMin: src.M, uProv: ctx.prov }, {
        progress: (f) => report(`${label} (${k + 1}/${passes.length})`, p0 + (p1 - p0) * (k + f) / passes.length),
      });
      [src, dst] = [dst, src];
    }
    if (src.H !== H) { ctx.ops.copy(src.H, H); ctx.ops.copy(src.M, M); }
    gpu.free(dst.H === H ? src.H : dst.H); gpu.free(dst.M === M ? src.M : dst.M);
  }

  const PROVFS = String.raw`uniform int uMode;
void main() {
  vec3 p = cellDir(); SO = seedOff(uSeed);
  float e = provinces(p);
  oH = vec4(uMode == 0 ? e : e - uThr); oM = vec4(0.0);
}`;

  async function build(ctx, report) {
    const { gpu, P } = ctx;
    const U = uniforms(P, ctx);
    report('Mapping highlands and lowlands — compiling', 0.02);
    const prog = await gpu.programAsync('lf.prov', `//#include planet\n${COMMON}\n${PROVFS}`);
    const cN = 64, calH = gpu.field(cN, 'rgba32f'), calM = gpu.field(cN, 'rgba16f');
    gpu.run(prog, [calH, calM], { ...U, uMode: 0 });
    const raw = gpu.readField(calH); gpu.free(calH); gpu.free(calM);
    U.uThr = S.quantile(raw, 1 - (P.landFraction ?? 0.5));
    // low-resolution province map, used by later passes instead of re-evaluating the noise
    const pN = Math.min(ctx.N, 256);
    ctx.prov = gpu.field(pN, 'r32f', 'provinces');
    const provM = gpu.field(pN, 'rgba16f');
    await gpu.runTiled(prog, [ctx.prov, provM], { ...U, uMode: 1 });
    gpu.free(provM);
    ctx.landU = U;
    const H = gpu.field(ctx.N, 'r32f', 'H'), M = gpu.field(ctx.N, 'rgba16f', 'M');
    await runPasses(ctx, STAGE0, U, H, M, report, 'Building the ancient crust', 0.04, 0.1);
    return { H, M };
  }

  async function overlay(ctx, H, M, report) {
    await runPasses(ctx, STAGE1, ctx.landU, H, M, report, 'Young craters, fractures and volcanism', 0.62, 0.72);
    ctx.gpu.free(ctx.prov); ctx.prov = null;
  }

  S.Landforms = { build, overlay, F };
})();
