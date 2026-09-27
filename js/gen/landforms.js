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
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});
  const MAXF = 64;

  // feature types in the list
  const F = { BASIN: 1, SHIELD: 2, RAYED: 3, LINEA: 4, PLUME: 5, CORONA: 6, PATERA: 7, DOME: 9, CANYON: 10, STRIPE: 11 };

  const FS = String.raw`
//#include planet
#define MAXF ${MAXF}
uniform sampler2DArray uHin, uMin;
uniform int uStage;
uniform float uSeed, uR, uTex, uThr;
uniform vec4 uF[MAXF]; uniform vec4 uFP[MAXF]; uniform int uFCount;
uniform float uBaseFreq, uBaseWarp, uDicho, uHighH, uLowH, uTrans, uLowRough, uBaseAmp;
uniform vec3 uDichoDir;
uniform float uHillsAmp, uHillsScale, uErode, uMontesAmp, uMontesScale, uMontesCover;
uniform float uPatchy, uMariaCraters;
uniform float uGrooveBright, uRiftBelt, uFlowUnits, uFlowScale;
uniform float uLowCraters, uBrightFrac, uLinNet, uLinScale, uLinWidth, uLaneAmp, uLaneScale, uLaneWidth, uLaneGrooves, uFracLow, uLaneCover;
uniform float uCraterDens, uOldCraters, uCraterMax, uCraterFresh, uDt, uCraterSfd, uFloorDark, uEjecta, uCraterAmp;
uniform float uCanyonAmp, uCanyonScale, uCanyonCover;
uniform float uCrackAmp, uCrackScale, uCrackCover;
uniform float uGrooveAmp, uGrooveScale, uGrooveCover, uGroovePatch;
uniform float uChaosAmp, uChaosCover, uChaosScale;
uniform float uTessAmp, uTessCover, uWrinkle, uShieldDens, uShieldAmp;
uniform float uPateraDens, uPateraAmp, uMtnAmp, uMtnCover;
uniform float uDunes, uTerrace, uMare, uMareLevel, uLavaLevel, uLavaCracks;
uniform float uCapH, uCapLat, uFrost;
uniform float uScarpAmp, uScarpScale, uScarpLevels, uScarpLip, uRubble;
layout(location = 0) out vec4 oH;
layout(location = 1) out vec4 oM;

vec3 SO;
float fr(float km) { return uR / (km * 1000.0); }            // noise frequency for a wavelength in km
float rad(float km) { return km * 1000.0 / uR; }             // km -> radians

// cheap low-frequency version (same large shapes) for per-crater decisions
float provincesLo(vec3 p) {
  float v = warped(p * uBaseFreq + SO, 3, uBaseWarp) + 0.4 * fbm(p * uBaseFreq * 0.5 - SO, 2);
  return v + uDicho * dot(p, uDichoDir) - uThr;
}
float provinces(vec3 p) {
  float v = warped(p * uBaseFreq + SO, 6, uBaseWarp) + 0.4 * fbm(p * uBaseFreq * 0.5 - SO, 3);
  return v + uDicho * dot(p, uDichoDir);
}

// local tangent frame angle around a centre direction
float azimuth(vec3 p, vec3 c) { vec3 e = eastOf(c), n = cross(c, e); vec3 v = p - c; return atan(dot(v, n), dot(v, e)); }

// ---------------------------------------------------------------- cellular crater population
void craterField(vec3 p, float dens, float freshExp, float amp, uint seed, float lowK, inout float h, inout vec4 m) {
  if (dens <= 0.0) return;
  float f = 0.34 / uCraterMax;
  for (int o = 0; o < 14; o++) {
    if (0.34 / f < uTex * 1.1) break;
    vec3 q = p * f;
    ivec3 c0 = ivec3(floor(q));
    uint sd = seed + uint(o) * 7919u;
    float dO = min(0.92, dens * pow(uCraterSfd, float(o)));
    for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec3 cc = c0 + ivec3(i, j, k);
      vec3 hh = hash33(cc, sd);
      if (hh.x > dO) continue;
      vec3 ctr = vec3(cc) + hash33(cc, sd + 1u);
      float cl = length(ctr);
      if (abs(cl - f) > 0.5) continue;
      vec3 cd = ctr / cl;
      float rr = mix(0.1, 0.34, pow(hh.y, 2.2)) / f;
      vec3 dv = p - cd;
      if (dot(dv, dv) > sq(rr * 3.2)) continue;
      if (lowK < 1.0 && hh.x > dO * mix(lowK, 1.0, sstep(-uTrans, uTrans, provincesLo(cd)))) continue;   // sparser on young lowland plains
      if (uStage == 1 && uMariaCraters < 1.0 && hh.x > dO * mix(1.0, uMariaCraters, sampleDir(uMin, cd).g)) continue; // young maria: fewer craters
      if (uPatchy > 0.0 && hh.x > dO * mix(1.0 - uPatchy, 1.0, sstep(-0.25, 0.25, fbm(cd * 3.0 + SO * 0.3, 3)))) continue; // regional surface ages
      float dist = gcDist(p, cd);
      float Dkm = 2.0 * rr * uR * 0.001;
      float fresh = pow(hh.z, freshExp);
      float ang = azimuth(p, cd);
      float az = snoise(vec3(cos(ang) * 1.3, sin(ang) * 1.3, hh.x * 40.0 + float(o)));
      float d = dist / rr * (1.0 + 0.07 * az);
      h += amp * craterProfile(d, Dkm, uDt, fresh, az, hh.y);
      m.r = max(m.r, uEjecta * ejectaBright(d, ang, sstep(1.0 - uBrightFrac, 1.0 - uBrightFrac * 0.3, hash13(cc, sd + 5u)), hh.x * 97.0) * sstep(2.9, 1.8, d));
      m.b = max(m.b, uFloorDark * (1.0 - fresh) * sstep(0.8, 0.35, d) * sstep(4.0, 20.0, Dkm));
    }
    f *= 2.0;
  }
}

// small volcanic cones / shields with summit pits (Venus shield fields, Mars small volcanoes)
float shieldField(vec3 p, float dens, float amp) {
  if (dens <= 0.0) return 0.0;
  float f = fr(60.0), h = 0.0;
  for (int o = 0; o < 3; o++) {
    Cell c = cellular(p * f + SO, 311u + uint(o));
    if (c.id < dens) {
      float r = 0.25 + 0.15 * fract(c.id * 13.7);
      float d = c.f1 / r;
      if (d < 1.0) { h += amp * (pow(1.0 - d, 1.8) - 0.25 * sstep(0.15, 0.05, d)) / (1.0 + float(o)); }
    }
    f *= 2.3;
  }
  return h;
}

// ---------------------------------------------------------------- the feature list
void listFeatures(vec3 p, int stage, inout float h, inout vec4 m) {
  for (int i = 0; i < MAXF; i++) {
    if (i >= uFCount) break;
    vec4 A = uF[i], B = uFP[i];
    int t = int(B.x + 0.5);
    vec3 c = A.xyz; float r = A.w;
    if (t == 4 || t == 10 || t == 11) {
      // arcs: lineae / canyon systems / tiger stripes. B = (type, orientation, width rad, curvature)
      if (stage != 1) continue;
      vec3 e = eastOf(c), n = cross(c, e);
      vec3 tg = cos(B.y) * e + sin(B.y) * n;
      vec3 ax = normalize(cross(c, tg));
      float along = atan(dot(p, tg), dot(p, c));
      if (abs(along) > r * 1.1 || dot(p, c) < 0.0) continue;
      float wob = snoise(p * fr(300.0) + float(i)) * B.z * 0.8 + snoise(p * fr(60.0) - float(i)) * B.z * 0.25;
      float dist = abs(dot(p, ax) - sin(B.w) + wob * (t == 10 ? 1.5 : 1.0));
      float x = dist / B.z;
      float win = sstep(r * 1.1, r * 0.8, abs(along));
      if (t == 4) {                          // Europan double ridge with central trough + brown halo
        float ridge = exp(-sq((x - 0.55) / 0.28)) - 0.7 * exp(-sq(x / 0.18));
        h += win * 180.0 * ridge;
        m.g = max(m.g, win * (0.55 * sstep(2.6, 0.3, x) + 0.45 * sstep(0.7, 0.1, x)));
      } else if (t == 11) {                  // Enceladus tiger stripe: deep fissure with raised flanks
        float v = exp(-sq((x - 0.8) / 0.4)) * 250.0 - 450.0 * exp(-sq(x / 0.35));
        h += win * v;
        m.g = max(m.g, win * sstep(2.5, 0.2, x));
      } else {                                // canyon: flat floor, terraced walls, side ravines
        float wn = x + 0.25 * fbm(p * fr(40.0) + float(i), 3);
        float wall = sstep(0.55, 1.0, wn);
        float steps = floor(wall * 5.0) / 5.0 + sstep(0.6, 1.0, fract(wall * 5.0)) / 5.0;
        float prof = -(1.0 - mix(wall, steps, 0.5));
        float gully = sstep(1.0, 1.8, wn) * sstep(2.6, 1.6, wn) * pow(max(0.0, snoise(vec3(along / B.z * 1.5, float(i), 0.0))), 2.0);
        h += win * A.w * 0.0 + win * B.z * uR * 0.0;       // (keep uniforms live)
        h += win * (prof * 7000.0 - 1500.0 * gully) * sstep(0.0, 0.2, 1.0 - abs(along) / r);
        m.b = max(m.b, win * 0.6 * sstep(0.9, 0.4, wn));
      }
      continue;
    }
    float d = gcDist(p, c) / r;
    if (t == 1) {                             // impact basin (multi-ring). B = (type, depth, rings, rim)
      if (stage != 0 || d > 3.0) continue;
      float depth = B.y;
      float bowl = d < 1.0 ? -depth * (1.0 - d * d) * (0.75 + 0.25 * (1.0 - d)) : 0.0;
      float rim = depth * 0.12 * exp(-sq((d - 1.0) / 0.12));
      float ring = B.z > 0.5 ? depth * 0.1 * (exp(-sq((d - 0.62) / 0.05)) + 0.7 * sstep(1.45, 1.35, d) * sstep(1.0, 1.1, d)) : 0.0;
      float ang = azimuth(p, c);
      float sculpt = depth * 0.08 * sstep(3.0, 1.2, d) * sstep(0.95, 1.2, d) * (0.5 + ridged(vec3(ang * 4.0, d * 3.0, float(i)), 3));
      h += bowl + rim + ring + sculpt;
    } else if (t == 2) {                      // giant shield volcano (young: built after erosion). B = (type, height, caldera, scarp)
      if (stage != 1 || d > 4.5) continue;
      float ang = azimuth(p, c);
      // lobate lava-flow fields radiating from the edifice (radar-bright/dark flows on Venus, dark on Mars)
      vec2 cs = vec2(cos(ang), sin(ang));
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
      for (int k = 0; k < 3; k++) { vec3 o = normalize(c + (eastOf(c) * cos(float(k) * 2.1) + northOf(c) * sin(float(k) * 2.1)) * r * B.z * 0.4); float dk = gcDist(p, o) / (r * B.z * (0.6 + 0.2 * float(k))); cal = max(cal, sstep(1.0, 0.8, dk)); }
      h += B.y * (cone * (1.0 - B.w) + scarp * pow(sat(1.0 - d), 0.6) * 0.7) - B.y * 0.12 * cal;
      h += B.y * 0.03 * sstep(1.6, 1.0, d) * sstep(0.9, 1.05, d) * ridged(p * fr(40.0), 3);   // aureole
      m.g = max(m.g, 0.25 * flows * sstep(1.1, 0.3, d));
    } else if (t == 3) {                      // young rayed crater. B = (type, D km, rays scale, seed)
      if (stage != 1 || d > 14.0) continue;
      float ang = azimuth(p, c);
      float az = snoise(vec3(cos(ang), sin(ang), B.w));
      float dd = d * (1.0 + 0.05 * az);
      h += craterProfile(dd, B.y, uDt, 1.0, az, fract(B.w));
      m.r = max(m.r, B.z * ejectaBright(dd, ang, 1.0, B.w));
    } else if (t == 5) {                      // plume deposit ring (Io). B = (type, kind, width, strength)
      if (stage != 1 || d > 1.4) continue;
      float ang = azimuth(p, c);
      float wig = 0.06 * snoise(vec3(cos(ang), sin(ang), float(i)) * 2.0);
      if (B.y < 0.5) m.b = max(m.b, B.w * (exp(-sq((d + wig - 0.85) / B.z)) + 0.25 * sstep(0.9, 0.1, d + wig)));   // Pele-type red ring
      else m.r = max(m.r, B.w * 0.6 * exp(-sq((d + wig) / 0.55)));                                                  // diffuse bright halo
    } else if (t == 6) {                      // corona (Venus). B = (type, height, fracture, 0)
      if (stage != 0 || d > 1.5) continue;
      float ang = azimuth(p, c);
      float rim = exp(-sq((d - 0.85) / 0.12));
      float conc = pow(abs(sin(d * 28.0 + snoise(p * fr(80.0)) * 2.0)), 6.0) * sstep(1.25, 0.95, d) * sstep(0.5, 0.75, d);
      float radial = pow(abs(sin(ang * 40.0)), 12.0) * sstep(1.4, 1.0, d) * sstep(0.1, 0.3, d);
      h += B.y * (rim - 0.35 * sstep(0.7, 0.0, d)) + B.z * (conc * 250.0 - radial * 150.0);
    } else if (t == 7) {                      // large patera (Io). B = (type, depth, lava lake, 0)
      if (stage != 1 || d > 1.3) continue;
      float ang = azimuth(p, c);
      float edge = 1.0 + 0.2 * snoise(vec3(cos(ang), sin(ang), float(i)) * 1.7) + 0.08 * snoise(vec3(cos(ang), sin(ang), float(i) + 5.0) * 6.0);
      float inside = sstep(1.0, 0.94, d / edge);
      h = mix(h, h - B.y, inside);
      m.g = max(m.g, inside * 0.9);
      m.a = max(m.a, inside * B.z * sstep(0.2, 0.8, snoise(p * fr(20.0) + float(i)) + 0.5));
      m.b = max(m.b, 0.5 * sstep(1.4, 1.0, d / edge) * (1.0 - inside));
    } else if (t == 9) {                      // broad volcanic rise (Tharsis). B = (type, height, 0, 0)
      if (stage != 0 || d > 1.5) continue;
      h += B.y * sstep(1.5, 0.0, d) * (0.85 + 0.15 * fbm(p * 6.0 + SO, 3));
    }
  }
}

// lava-flood the floors of basins that carry a fill fraction (maria)
void floodBasins(vec3 p, inout float h, inout vec4 m) {
  for (int i = 0; i < MAXF; i++) {
    if (i >= uFCount) break;
    vec4 A = uF[i], B = uFP[i];
    if (int(B.x + 0.5) != 1 || B.w <= 0.0) continue;
    float d = gcDist(p, A.xyz) / A.w;
    if (d > 1.15) continue;
    float ref = mix(uLowH, uHighH, sstep(-uTrans, uTrans, provincesLo(A.xyz)));
    float level = ref - B.y * (1.0 - B.w) * 0.85 + 150.0 * fbm(p * 4.0 + float(i), 2);
    if (h < level) {
      float k = sstep(0.0, 80.0, level - h) * sstep(1.02, 0.88, d + 0.04 * snoise(p * fr(150.0)));
      float wr = pow(1.0 - abs(snoise(p * fr(70.0) + SO + float(i))), 10.0) * 150.0;
      h = mix(h, level + wr, k);
      m.g = max(m.g, k);
    }
  }
}

void main() {
  vec3 p = cellDir();
  SO = seedOff(uSeed);
  if (uStage < 0) { oH = vec4(provinces(p)); oM = vec4(0.0); return; }
  float h; vec4 m;
  if (uStage == 0) {
    m = vec4(0.0);
    float e = provinces(p) - uThr;
    float hi = sstep(-uTrans, uTrans, e + 0.05 * fbm(p * fr(80.0) + SO, 3));
    h = mix(uLowH, uHighH, hi) + uBaseAmp * fbm(p * 3.0 - SO, 4);
    // fretted / knobby terrain along the highland scarp
    if (uRiftBelt > 0.0) {
      float x = (e - uTrans * 1.2) / (uTrans * 0.6);
      float belt = exp(-x * x);
      float steps = floor(belt * 4.0) / 4.0 + sstep(0.6, 1.0, fract(belt * 4.0)) / 4.0;
      h -= uRiftBelt * mix(belt, steps, 0.6) * (0.7 + 0.3 * fbm(p * fr(200.0) + SO, 3));
      h += uRiftBelt * 0.25 * exp(-sq((e - uTrans * 2.4) / (uTrans * 0.5)));
    }
    float scarp = sstep(uTrans * 2.5, 0.0, abs(e));
    if (scarp > 0.0) { Cell kb = cellular(p * fr(90.0) + SO, 17u); h += scarp * (uHighH - uLowH) * 0.25 * sstep(0.45, 0.2, kb.f1) * (hi < 0.5 ? 1.0 : -0.5); }
    float fH = fr(uHillsScale);
    h += uHillsAmp * mix(uLowRough, 1.0, hi) * erodedFbm(p * fH + SO * 1.3, octaves(fH, uTex), 2.0, 0.5, uErode);
    if (uMontesAmp > 0.0) {
      float fM = fr(uMontesScale);
      float mask = sstep(1.0 - uMontesCover, 1.0 - uMontesCover + 0.25, 0.5 + 0.6 * fbm(p * 4.0 + SO * 0.7, 4));
      h += uMontesAmp * mask * ridgedEroded(p * fM - SO, octaves(fM, uTex), 2.03, 0.5, uErode * 0.5);
    }
    // Venus tesserae: two crossing sets of ridges on raised, deformed plateaus
    if (uTessAmp > 0.0) {
      float mask = sstep(1.0 - uTessCover, 1.0 - uTessCover + 0.12, 0.5 + 0.6 * warped(p * 2.5 + SO * 1.9, 4, 0.8));
      if (mask > 0.0) {
        Cell tc = cellular(p * fr(700.0) + SO, 91u);
        vec3 a1 = normalize(hash33(ivec3(tc.c1 * 7.0), 5u) - 0.5), a2 = normalize(cross(a1, p) + 0.4 * a1);
        float f = fr(18.0);
        float r1 = pow(1.0 - abs(snoise(vec3(dot(p, a1) * f, dot(p, cross(p, a1)) * f * 0.05, tc.id * 9.0))), 3.0);
        float r2 = pow(1.0 - abs(snoise(vec3(dot(p, a2) * f * 0.6, dot(p, cross(p, a2)) * f * 0.04, tc.id * 7.0))), 3.0);
        h += mask * (uTessAmp * (0.6 + 0.4 * fbm(p * 20.0, 3)) + uTessAmp * 0.25 * (r1 + 0.7 * r2));
        m.b = max(m.b, mask * 0.8);
      }
    }
    // stepped plateaus: lobate, fractal escarpments (mesas, layered plains, lava-plain margins)
    if (uScarpAmp > 0.0) {
      for (int k = 0; k < 6; k++) {
        if (float(k) >= uScarpLevels) break;
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
    }
    // rubbly small-scale texture everywhere (blocks, knobs, hummocks down to the texel)
    if (uRubble > 0.0) {
      float fR = fr(12.0);
      h += uRubble * (ridged(p * fR + SO * 2.2, octaves(fR, uTex), 2.1, 0.55) - 0.35);
    }
    h += shieldField(p, uShieldDens, uShieldAmp);
    // Io mountains: isolated tilted crustal blocks with scarps
    if (uMtnAmp > 0.0) {
      Cell mc = cellular(p * fr(700.0) + SO * 2.0, 55u);
      if (mc.id < uMtnCover) {
        float blk = sstep(0.55, 0.3, mc.f1 + 0.12 * fbm(p * fr(120.0), 4));
        vec3 tilt = normalize(hash33(ivec3(mc.c1 * 3.0), 8u) - 0.5);
        float slopeT = 0.5 + 0.5 * dot(normalize(p * fr(700.0) + SO * 2.0 - mc.c1), tilt);
        h += uMtnAmp * (0.4 + 0.6 * fract(mc.id * 7.3)) * blk * (0.4 + 0.6 * slopeT) * (0.8 + 0.4 * ridged(p * fr(60.0), 4));
      }
    }
    craterField(p, uOldCraters, uCraterFresh * 3.0, uCraterAmp, 1000u, uLowCraters, h, m);
    listFeatures(p, 0, h, m);
    floodBasins(p, h, m);
    // lava-flooded maria / smooth plains in lowlands and basins
    if (uMare > 0.0) {
      float level = uMareLevel + 300.0 * fbm(p * 2.0 + SO, 3);
      float region = sstep(0.45, 0.6, 0.5 + 0.5 * fbm(p * 1.5 - SO * 2.0, 3) + uMare - 0.5);
      if (h < level && region > 0.0) {
        float k = region * sstep(0.0, 150.0, level - h);
        float wr = pow(1.0 - abs(snoise(p * fr(90.0) + SO)), 8.0) * 120.0;   // wrinkle ridges
        h = mix(h, level + wr, k);
        m.g = max(m.g, k);
      }
    }
    if (uWrinkle > 0.0) h += uWrinkle * pow(1.0 - abs(snoise(p * fr(120.0) + SO * 3.0)), 10.0) * (1.0 - m.b);
  } else {
    h = at(uHin).r; m = at(uMin);
    craterField(p, uCraterDens, uCraterFresh, uCraterAmp, 2000u, mix(uLowCraters, 1.0, 0.5), h, m);
    listFeatures(p, 1, h, m);
    // tectonic resurfacing can be confined to the lowland provinces (e.g. Enceladus' fractured plains)
    float fracMask = mix(1.0, 1.0 - sstep(-uTrans, uTrans, provincesLo(p)), uFracLow);
    // lineae network: isolines of several noise fields = long, curving, crossing ridges of different ages
    if (uLinNet > 0.0) {
      for (int k = 0; k < 5; k++) {
        float f = fr(uLinScale) * pow(1.45, float(k));
        // each family is stretched along its own direction, so its lines run long and nearly parallel
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
      }
    }
    // bright grooved lanes (sulci) between dark polygons, grooves running parallel to the lanes
    if (uLaneAmp > 0.0) {
      vec3 q = p * fr(uLaneScale) + 0.25 * warpVec(p * 2.0 + SO, 3);
      Cell c = cellular(q, 555u);
      float ed = cellEdge(c, q);
      float wL = uLaneWidth * (0.35 + 1.1 * fract(c.id * 13.0 + c.id2 * 7.0));
      float lane = sstep(wL, wL * 0.75, ed + 0.03 * snoise(q * 4.0)) * step(1.0 - uLaneCover, fract(c.id * 5.3 + c.id2 * 5.3));
      vec3 q2 = q * 2.1 + 11.0;
      Cell c2 = cellular(q2, 556u);
      float ed2 = cellEdge(c2, q2);
      float lane2 = sstep(wL * 0.7, wL * 0.45, ed2 + 0.03 * snoise(q2 * 4.0)) * step(1.0 - uLaneCover * 0.5, fract(c2.id * 9.1 + c2.id2 * 3.3));
      float L = max(lane, 0.85 * lane2);
      float gph = (lane >= lane2 ? ed : ed2) * uLaneGrooves + 0.5 * snoise(q * 6.0);
      float gro = pow(abs(sin(gph * PI)), 0.8);
      h += uLaneAmp * L * (0.6 * gro - 0.5);
      float laneTone = 0.65 + 0.35 * fract((lane >= lane2 ? c.id + c.id2 : c2.id * 3.0 + c2.id2) * 17.3);
      m.b = max(m.b, L * laneTone * (0.8 + 0.2 * gro) * (0.9 + 0.1 * snoise(q * 12.0)));
    }
    // lobate lava-flow units on the plains: sharp-edged sheets, alternately dark and bright,
    // each standing a few tens of metres proud with a steep flow front
    if (uFlowUnits > 0.0) {
      float lowMask = 1.0 - 0.8 * sstep(-uTrans, uTrans, provincesLo(p));
      for (int k = 0; k < 3; k++) {
        vec3 q = p * fr(uFlowScale / (1.0 + float(k))) + SO * float(k + 3);
        q += 0.6 * warpVec(q * 0.5, 3);
        float nF = fbm(q, min(5, octaves(fr(uFlowScale / (1.0 + float(k))), uTex)), 2.2, 0.55);
        float th = 0.55 - uFlowUnits * 0.9;
        float unit = sstep(th, th + 0.015, nF) * lowMask;
        if (unit <= 0.0) continue;
        h += 45.0 * unit / (1.0 + float(k));
        float tone = fract(float(k) * 0.37 + 0.2 * fbm(q * 0.2, 2));
        if (tone < 0.5) m.g = max(m.g, unit * (0.35 + 0.3 * tone)); else m.r = max(m.r, unit * 0.18);
      }
    }
    // fracture networks: polygonal troughs at several scales
    if (uCrackAmp > 0.0) {
      float f = fr(uCrackScale);
      for (int o = 0; o < 3; o++) {
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
      }
    }
    // grooved / ridged terrain: polygons filled with parallel ridges (Ganymede sulci, Europa ridged plains)
    if (uGrooveAmp > 0.0) {
      vec3 q = p * fr(uGroovePatch) + 0.3 * warpVec(p * 3.0 + SO, 3);
      Cell c = cellular(q, 777u);
      float mask = fracMask * sstep(1.0 - uGrooveCover, 1.0 - uGrooveCover + 0.05, fract(c.id * 3.7));
      if (mask > 0.0) {
        vec3 dir = normalize(hash33(ivec3(floor(c.c1 * 3.0)), 9u) - 0.5);
        float fg = fr(uGrooveScale);
        float ph = dot(p, dir) * fg + 3.0 * fbm(p * fr(uGroovePatch * 0.5) + SO, 3);
        float gr = pow(abs(sin(ph)), 0.6) * (0.7 + 0.3 * sin(ph * 2.7 + 1.0));
        float edge = sstep(0.0, 0.08, cellEdge(c, q));
        h += uGrooveAmp * mask * edge * (gr - 0.5) * (0.6 + 0.4 * fract(c.id * 17.0));
        m.r = max(m.r, mask * edge * uGrooveBright * fract(c.id * 5.1));
      }
    }
    // chaos terrain: disrupted crust, tilted rafts in a hummocky dark matrix
    if (uChaosAmp > 0.0) {
      float region = sstep(1.0 - uChaosCover, 1.0 - uChaosCover + 0.1, 0.5 + 0.6 * warped(p * 3.5 + SO * 2.5, 4, 0.9));
      if (region > 0.0) {
        Cell c = cellular(p * fr(uChaosScale) + SO, 123u);
        float raft = sstep(0.62, 0.42, c.f1 + 0.1 * snoise(p * fr(uChaosScale * 0.2)));
        float matrix = 0.5 + 0.5 * fbm(p * fr(uChaosScale * 0.3), 4);
        h = mix(h, h - uChaosAmp * 0.5 + uChaosAmp * (raft * (0.6 + 0.4 * c.id) + 0.3 * matrix), region);
        m.b = max(m.b, region * (1.0 - raft * 0.7));
      }
    }
    // canyon networks (Valles-style) along the edges of large cells
    if (uCanyonAmp > 0.0) {
      vec3 q = p * fr(uCanyonScale) + 0.5 * warpVec(p * 2.0 + SO, 3);
      Cell c = cellular(q, 2024u);
      float ed = cellEdge(c, q);
      float mask = sstep(1.0 - uCanyonCover, 1.0 - uCanyonCover + 0.15, 0.5 + 0.6 * fbm(p * 2.5 + SO * 4.0, 3));
      float w = 0.06 * (0.6 + 0.8 * fbm(p * fr(uCanyonScale * 0.3), 3));
      float wall = sstep(w * 0.4, w, ed + 0.02 * fbm(p * fr(30.0), 3));
      float steps = floor(wall * 4.0) / 4.0 + sstep(0.6, 1.0, fract(wall * 4.0)) / 4.0;
      h -= uCanyonAmp * mask * (1.0 - mix(wall, steps, 0.5));
      m.b = max(m.b, mask * sstep(w, w * 0.3, ed) * 0.5);
    }
    // Io paterae: flat-floored volcanic depressions with dark lava floors, bright/red haloes
    if (uPateraDens > 0.0) {
      float f = fr(260.0);
      for (int o = 0; o < 2; o++) {
        vec3 q = p * f + SO;
        Cell c = cellular(q, 900u + uint(o));
        if (c.id < uPateraDens) {
          vec3 u = normalize(q - c.c1);
          float lob = 1.0 + 0.22 * snoise(u * 1.6 + c.id * 50.0) + 0.05 * snoise(u * 4.0 + c.id * 30.0);
          float rr = (0.05 + 0.2 * pow(fract(c.id * 31.0), 2.0)) * lob;
          float inside = sstep(rr, rr * 0.9, c.f1);
          h -= uPateraAmp * inside * (0.5 + fract(c.id * 7.0));
          float kind = fract(c.id * 91.0);
          m.g = max(m.g, inside * (0.6 + 0.4 * kind));
          m.a = max(m.a, inside * sstep(0.7, 0.95, kind) * (0.5 + 0.5 * snoise(q * 8.0)));
          float halo = sstep(rr * 2.6, rr, c.f1 + 0.05 * snoise(q * 5.0)) * (1.0 - inside);
          float hk = fract(c.id * 57.0);
          if (hk < 0.1) m.b = max(m.b, halo * 0.4); else if (hk < 0.18) m.r = max(m.r, halo * 0.3);
        }
        f *= 2.2;
      }
    }
    // dunes (only visible at high resolution): transverse ridges in low, flat ground
    if (uDunes > 0.0) {
      float fd = fr(2.5);
      vec3 wd = normalize(eastOf(p) + 0.3 * northOf(p) * snoise(p * 4.0));
      float ph = dot(p, wd) * fd + 4.0 * fbm(p * fr(40.0), 3);
      float dune = pow(0.5 + 0.5 * sin(ph), 3.0);
      float field = sstep(0.1, 0.5, m.b + 0.4 * fbm(p * 5.0 + SO, 3));
      h += uDunes * field * dune;
    }
    // terraced layered deposits
    if (uTerrace > 0.0) {
      float st = 250.0 + 150.0 * fbm(p * 3.0, 2);
      float v = h / st, fl = floor(v);
      float mask = sstep(0.2, 0.5, fbm(p * 4.0 + SO * 5.0, 3)) * uTerrace;
      h = mix(h, (fl + sstep(0.3, 0.7, fract(v))) * st, mask);
    }
    // lava seas: lowlands below the lava level are molten or freshly frozen
    if (uLavaLevel > -1e8) {
      float lv = uLavaLevel;
      if (h < lv) {
        float depth = lv - h;
        vec3 qc = p * fr(220.0) + SO + 0.3 * warpVec(p * fr(900.0), 2);
        Cell c = cellular(qc, 66u);
        float crust = sstep(0.0, 0.06, cellEdge(c, qc) + 0.02 * snoise(qc * 6.0));
        h = lv - 30.0 * crust;
        m.g = max(m.g, crust);
        m.a = max(m.a, (1.0 - crust * 0.85) * sstep(0.0, 200.0, depth));
      }
      if (uLavaCracks > 0.0) {
        vec3 q = p * fr(160.0) + 0.4 * warpVec(p * 6.0 + SO, 3);
        Cell c = cellular(q, 71u);
        float glow = sstep(0.035, 0.0, cellEdge(c, q) + 0.01 * snoise(q * 8.0)) * sstep(0.3, 0.7, 0.5 + fbm(p * 3.0 - SO, 3)) * step(0.45, fract(c.id * 7.0 + c.id2 * 3.0));
        m.a = max(m.a, uLavaCracks * glow);
      }
    }
    // polar layered deposits and ice caps (Mars): domes cut by spiral troughs
    if (uCapH > 0.0) {
      float lat = abs(p.y);
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
      }
    }
  }
  oH = vec4(h);
  oM = m;
}
`;

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
    for (let i = 0; i < (P.canyons | 0); i++) out.push(arcFeature(r, F.CANYON, km(P.canyonLength * (0.4 + 0.6 * r())) / 2, km(40 + 60 * r()), (r() - 0.5) * 0.1));
    if (P.tigerStripes) {
      const c = [0, -0.98, 0.2]; const cn = S.vnorm(c);
      for (let k = 0; k < 4; k++) { const off = S.vnorm([cn[0] + (k - 1.5) * 0.06, cn[1], cn[2] + (k - 1.5) * 0.05]); out.push({ A: [...off, km(70)], B: [F.STRIPE, 0.6, km(2.5), 0] }); }
    }
    for (let i = 0; i < (P.plumes | 0); i++) out.push({ A: [...S.randDir(r), km(250 + 450 * r())], B: [F.PLUME, i < (P.redPlumes ?? 1) ? 0 : 1, 0.05 + 0.04 * r(), 0.5 + 0.5 * r()] });
    for (let i = 0; i < (P.bigPaterae | 0); i++) out.push({ A: [...S.randDir(r), km(60 + 90 * r())], B: [F.PATERA, 800 + 800 * r(), r() < 0.5 ? 0.9 : 0.3, 0] });
    return out.slice(0, MAXF);
  }

  function uniforms(P, ctx) {
    const f = makeFeatures(P, ctx.R, ctx.seed);
    const a = new Float32Array(MAXF * 4), b = new Float32Array(MAXF * 4);
    f.forEach((x, i) => { a.set(x.A, i * 4); b.set(x.B, i * 4); });
    const d = S.randDir(S.rng(ctx.seed + 5));
    const n = (v, def = 0) => (v === undefined || v === null ? def : +v);
    return {
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
      uDunes: n(P.dunes), uTerrace: n(P.terraces), uMare: n(P.maria), uMareLevel: n(P.mareLevel, -1500),
      uLavaLevel: P.lavaSea ? n(P.lavaLevel, -500) : -1e9, uLavaCracks: n(P.lavaCracks),
      uScarpAmp: n(P.scarps), uScarpScale: n(P.scarpScale, 600), uScarpLevels: n(P.scarpLevels, 3), uScarpLip: n(P.scarpLip, 0.3), uRubble: n(P.rubble),
      uCapH: P.iceCaps ? n(P.capHeight, 2500) : 0, uCapLat: Math.sin((90 - n(P.capSize, 8)) * Math.PI / 180), uFrost: 0,
    };
  }

  async function build(ctx, report) {
    const { gpu, P } = ctx;
    const prog = gpu.program('landforms', FS);
    const U = uniforms(P, ctx);
    report('Mapping highlands and lowlands', 0.03);
    const cN = 64, calH = gpu.field(cN, 'rgba32f'), calM = gpu.field(cN, 'rgba16f');
    gpu.run(prog, [calH, calM], { ...U, uStage: -1, uThr: 0 });
    const raw = gpu.readField(calH); gpu.free(calH); gpu.free(calM);
    U.uThr = S.quantile(raw, 1 - (P.landFraction ?? 0.5));
    ctx.landU = U;
    report('Building the ancient crust', 0.06);
    const H = gpu.field(ctx.N, 'r32f', 'H'), M = gpu.field(ctx.N, 'rgba16f', 'M');
    await runTiled(gpu, prog, [H, M], { ...U, uStage: 0 });
    return { H, M };
  }

  async function overlay(ctx, H, M, report) {
    const { gpu } = ctx;
    report('Young craters, fractures and volcanic features', 0.66);
    const prog = gpu.program('landforms', FS);
    const H2 = gpu.field(ctx.N, 'r32f'), M2 = gpu.field(ctx.N, 'rgba16f');
    await runTiled(gpu, prog, [H2, M2], { ...ctx.landU, uStage: 1, uHin: H, uMin: M });
    ctx.ops.copy(H2, H); ctx.ops.copy(M2, M);
    gpu.free(H2); gpu.free(M2);
  }

  // one face at a time with a GPU sync in between keeps each submission short (no driver timeouts)
  async function runTiled(gpu, prog, targets, U) {
    for (let f = 0; f < 6; f++) { gpu.run(prog, targets, U, { faces: [f] }); await gpu.sync(); }
  }

  S.Landforms = { build, overlay, F };
})();
