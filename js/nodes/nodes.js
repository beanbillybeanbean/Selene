// Selene — node graph. Ten node types that remix a generated world: add terrain, craters,
// fractures, plateaus and volcanoes, build masks, do maths, paint colours. The graph compiles to one
// GLSL pass that reads the world's height/colour/materials and writes new height + colour, so edits
// re-run in a fraction of a second without regenerating the planet.
//
// Graph: { nodes: [{ id, type, x, y, params: {} }], links: [{ from: [id, out], to: [id, in] }], nextId }
// Values are floats (heights in metres, masks 0..1); colours are linear RGB.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const V = 'value', C = 'colour';
  const rng = (id, label, min, max, step, value, help) => ({ id, label, type: 'range', min, max, step, value, help });
  const sel = (id, label, options, value) => ({ id, label, type: 'select', options, value });
  const col = (id, label, value) => ({ id, label, type: 'color', value });
  const chk = (id, label, value) => ({ id, label, type: 'check', value });

  // ---------------------------------------------------------------- node types
  const DEFS = {
    world: {
      title: 'World', hue: 210, desc: 'The generated planet.',
      inputs: [],
      outputs: [{ id: 'height', label: 'Height', kind: V }, { id: 'colour', label: 'Colour', kind: C }, { id: 'h01', label: 'Height 0–1', kind: V },
        { id: 'slope', label: 'Slope', kind: V }, { id: 'dark', label: 'Dark material', kind: V }, { id: 'bright', label: 'Bright material', kind: V }],
      params: [],
      glsl: (n) => `${n.O.height} = baseH; ${n.O.colour} = baseC; ${n.O.h01} = sat((baseH - uHmin) / max(1.0, uHmax - uHmin));
  ${n.O.slope} = baseSlope; ${n.O.dark} = baseM.g; ${n.O.bright} = baseM.r;`,
    },
    terrain: {
      title: 'Terrain', hue: 120, desc: 'Adds fractal relief.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: '0.0' }, { id: 'where', label: 'Where', kind: V, def: '1.0' }],
      outputs: [{ id: 'height', label: 'Height', kind: V }, { id: 'mask', label: 'Pattern', kind: V }],
      params: [sel('style', 'Style', [[0, 'Rolling hills'], [1, 'Eroded hills'], [2, 'Mountains'], [3, 'Rubble'], [4, 'Mesas'], [5, 'Dunes']], 1),
        rng('size', 'Size (km)', 1, 3000, 1, 120), rng('amount', 'Height (m)', -5000, 8000, 10, 500), rng('seed', 'Seed', 0, 100, 1, 1)],
      glsl: (n) => `{ vec3 q = p * fr(${n.P.size}) + seedOff(uSeed + ${n.P.seed} * 17.0 + ${n.id}.0);
    int oc = octaves(fr(${n.P.size}), uTex); float v;
    ${['v = fbm(q, oc);', 'v = erodedFbm(q, oc, 2.0, 0.5, 1.2);', 'v = ridgedEroded(q, oc, 2.03, 0.5, 0.6) - 0.3;',
    'v = ridged(q, oc, 2.1, 0.55) - 0.35;',
    'float t = fbm(q, oc, 2.0, 0.55) * 4.0; float fl = floor(t); v = (fl + sstep(0.35, 0.65, fract(t))) * 0.25;',
    'vec3 wd = normalize(eastOf(p) + 0.3 * northOf(p) * snoise(q * 0.05)); v = pow(0.5 + 0.5 * sin(dot(p, wd) * fr(' + n.P.size + ') * 6.0 + 3.0 * fbm(q * 0.1, 3)), 3.0) - 0.3;'][n.sel.style]}
    ${n.O.mask} = sat(0.5 + v);
    ${n.O.height} = ${n.I.height} + ${n.I.where} * ${n.P.amount} * v; }`,
    },
    craters: {
      title: 'Craters', hue: 30, desc: 'Impact craters with real shapes.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: '0.0' }, { id: 'where', label: 'Where', kind: V, def: '1.0' }],
      outputs: [{ id: 'height', label: 'Height', kind: V }, { id: 'ejecta', label: 'Bright ejecta', kind: V }, { id: 'floors', label: 'Crater floors', kind: V }],
      params: [rng('density', 'Density', 0, 0.9, 0.01, 0.3), rng('largest', 'Largest (km)', 2, 1500, 1, 120), rng('age', 'Age', 0, 1, 0.01, 0.5),
        rng('depth', 'Depth ×', 0, 3, 0.01, 1), rng('rays', 'Fresh & rayed share', 0, 0.5, 0.005, 0.05), rng('seed', 'Seed', 0, 100, 1, 1)],
      lib: 'craters',
      glsl: (n) => `{ vec4 cr = nodeCraters(p, ${n.P.density}, ${n.P.largest}, ${n.P.age}, ${n.P.rays}, ${n.P.seed} + ${n.id}.0);
    float w = ${n.I.where};
    ${n.O.height} = ${n.I.height} + w * ${n.P.depth} * cr.x; ${n.O.ejecta} = w * cr.y; ${n.O.floors} = w * cr.z; }`,
    },
    fractures: {
      title: 'Fractures', hue: 280, desc: 'Cracks, ridges, lanes, canyons.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: '0.0' }, { id: 'where', label: 'Where', kind: V, def: '1.0' }],
      outputs: [{ id: 'height', label: 'Height', kind: V }, { id: 'lines', label: 'Lines', kind: V }],
      params: [sel('style', 'Style', [[0, 'Polygon cracks'], [1, 'Long ridges (lineae)'], [2, 'Bright grooved lanes'], [3, 'Canyons'], [4, 'Groove fields']], 0),
        rng('size', 'Size (km)', 5, 3000, 1, 200), rng('width', 'Width', 0.005, 0.4, 0.005, 0.05), rng('depth', 'Depth (m)', -5000, 5000, 10, 400),
        rng('cover', 'Coverage', 0, 1, 0.01, 0.6), rng('seed', 'Seed', 0, 100, 1, 1)],
      lib: 'fractures',
      glsl: (n) => `{ vec2 fr2 = nodeFractures(p, ${n.sel.style}, ${n.P.size}, ${n.P.width}, ${n.P.cover}, ${n.P.seed} + ${n.id}.0);
    float w = ${n.I.where};
    ${n.O.height} = ${n.I.height} + w * ${n.P.depth} * fr2.x; ${n.O.lines} = w * fr2.y; }`,
    },
    plateaus: {
      title: 'Plateaus', hue: 45, desc: 'Stepped mesas with ragged cliffs.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: '0.0' }, { id: 'where', label: 'Where', kind: V, def: '1.0' }],
      outputs: [{ id: 'height', label: 'Height', kind: V }, { id: 'cliffs', label: 'Cliffs', kind: V }],
      params: [rng('size', 'Size (km)', 5, 3000, 1, 300), rng('amount', 'Step height (m)', -4000, 4000, 10, 600), rng('levels', 'Levels', 1, 6, 1, 3),
        rng('lip', 'Raised lips', 0, 1.5, 0.01, 0.3), rng('seed', 'Seed', 0, 100, 1, 1)],
      lib: 'plateaus',
      glsl: (n) => `{ vec2 pl = nodePlateaus(p, ${n.P.size}, ${n.P.levels}, ${n.P.lip}, ${n.P.seed} + ${n.id}.0);
    ${n.O.height} = ${n.I.height} + ${n.I.where} * ${n.P.amount} * pl.x; ${n.O.cliffs} = ${n.I.where} * pl.y; }`,
    },
    volcanoes: {
      title: 'Volcanoes', hue: 5, desc: 'Shield volcanoes with calderas and lava flows.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: '0.0' }, { id: 'where', label: 'Where', kind: V, def: '1.0' }],
      outputs: [{ id: 'height', label: 'Height', kind: V }, { id: 'flows', label: 'Lava flows', kind: V }, { id: 'calderas', label: 'Calderas', kind: V }],
      params: [rng('density', 'Density', 0, 1, 0.01, 0.15), rng('size', 'Size (km)', 5, 1500, 1, 150), rng('amount', 'Height (m)', 0, 25000, 50, 3000),
        rng('caldera', 'Caldera size', 0, 0.5, 0.01, 0.12), rng('flows', 'Flow reach', 0, 3, 0.01, 1), rng('seed', 'Seed', 0, 100, 1, 1)],
      lib: 'volcanoes',
      glsl: (n) => `{ vec3 vo = nodeVolcanoes(p, ${n.P.density}, ${n.P.size}, ${n.P.caldera}, ${n.P.flows}, ${n.P.seed} + ${n.id}.0);
    float w = ${n.I.where};
    ${n.O.height} = ${n.I.height} + w * ${n.P.amount} * vo.x; ${n.O.flows} = w * vo.y; ${n.O.calderas} = w * vo.z; }`,
    },
    mask: {
      title: 'Mask', hue: 0, sat: 0, desc: 'Picks out where something applies.',
      inputs: [{ id: 'value', label: 'Value', kind: V, def: '0.0' }],
      outputs: [{ id: 'mask', label: 'Mask', kind: V }],
      params: [sel('source', 'From', [[0, 'Input value'], [1, 'Latitude (°)'], [2, 'Random patches'], [3, 'Hemisphere']], 0),
        rng('from', 'From', -10000, 10000, 0.01, 0.4), rng('to', 'To', -10000, 10000, 0.01, 0.6), rng('size', 'Patch / edge size (km)', 5, 5000, 1, 400),
        rng('jag', 'Ragged edge', 0, 2, 0.01, 0.6), chk('invert', 'Invert', false)],
      glsl: (n) => `{ float v;
    ${['v = ' + n.I.value + ';', 'v = degrees(asin(abs(p.y)));', 'v = 0.5 + 0.6 * warped(p * fr(' + n.P.size + ') + seedOff(uSeed + ' + n.id + '.0), 5, 0.9);', 'v = dot(p, normalize(vec3(0.3, 0.2, 1.0))) * 0.5 + 0.5;'][n.sel.source]}
    float a = ${n.P.from}, b = ${n.P.to};
    v += ${n.P.jag} * (abs(b - a) + 0.02 * (abs(a) + abs(b)) + 1e-3) * 0.6 * jag(p, fr(${n.P.size}) * 3.0, uTex);
    float t = sstep(min(a, b), max(a, b) + 1e-4, v); if (a > b) t = 1.0 - t;
    ${n.O.mask} = ${n.sel.invert ? '1.0 - t' : 't'}; }`,
    },
    math: {
      title: 'Math', hue: 190, sat: 20, desc: 'Combine two values.',
      inputs: [{ id: 'a', label: 'A', kind: V, def: '0.0' }, { id: 'b', label: 'B', kind: V, def: 'B' }, { id: 'factor', label: 'Factor', kind: V, def: 'F' }],
      outputs: [{ id: 'result', label: 'Result', kind: V }],
      params: [sel('op', 'Operation', [[0, 'Add'], [1, 'Subtract'], [2, 'Multiply'], [3, 'Maximum'], [4, 'Minimum'], [5, 'Mix A→B by factor'], [6, 'A × factor']], 0),
        rng('b', 'B (if not connected)', -10000, 10000, 0.01, 0), rng('factor', 'Factor (if not connected)', -10, 10, 0.01, 0.5)],
      glsl: (n) => {
        const a = n.I.a, b = n.I.b === 'B' ? n.P.b : n.I.b, f = n.I.factor === 'F' ? n.P.factor : n.I.factor;
        return `${n.O.result} = ${[`${a} + ${b}`, `${a} - ${b}`, `${a} * ${b}`, `max(${a}, ${b})`, `min(${a}, ${b})`, `mix(${a}, ${b}, ${f})`, `${a} * ${f}`][n.sel.op]};`;
      },
    },
    paint: {
      title: 'Paint', hue: 330, desc: 'Paints a colour where the mask is.',
      inputs: [{ id: 'colour', label: 'Colour', kind: C, def: 'vec3(0.5)' }, { id: 'mask', label: 'Mask', kind: V, def: '1.0' }],
      outputs: [{ id: 'colour', label: 'Colour', kind: C }],
      params: [col('color', 'Paint', '#8a5a3c'), rng('strength', 'Strength', 0, 1, 0.01, 0.8), sel('blend', 'Blend', [[0, 'Mix'], [1, 'Multiply'], [2, 'Lighten'], [3, 'Darken'], [4, 'Tint (keep brightness)']], 0),
        rng('variation', 'Variation', 0, 1, 0.01, 0.3), rng('fray', 'Ragged edges', 0, 2, 0.01, 0.8)],
      glsl: (n) => `{ vec3 c0 = ${n.I.colour};
    float jn = jag(p, fr(60.0), uTex);
    float m = frayed(${n.I.mask}, jn, ${n.P.fray}) * ${n.P.strength};
    vec3 pc = ${n.P.color} * (1.0 + ${n.P.variation} * (0.35 * jag(p + 2.3, fr(25.0), uTex) + 0.25 * fbm(p * fr(400.0) + 5.0, 4)));
    vec3 r;
    ${['r = pc;', 'r = c0 * pc * 2.0;', 'r = max(c0, pc);', 'r = min(c0, pc);', 'r = pc * (luma(c0) / max(luma(pc), 1e-3));'][n.sel.blend]}
    ${n.O.colour} = mix(c0, max(r, 0.0), m); }`,
    },
    output: {
      title: 'Output', hue: 0, sat: 0, desc: 'What gets previewed and exported.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: 'baseH' }, { id: 'colour', label: 'Colour', kind: C, def: 'baseC' }],
      outputs: [],
      params: [],
      glsl: (n) => `outH = ${n.I.height}; outC = ${n.I.colour};`,
    },
  };
  const ADDABLE = ['terrain', 'craters', 'fractures', 'plateaus', 'volcanoes', 'mask', 'math', 'paint', 'world', 'output'];

  // ---------------------------------------------------------------- GLSL library for the heavier nodes
  const LIB = {
    common: String.raw`
uniform sampler2DArray uBaseH, uBaseC, uBaseM;
uniform float uR, uTex, uHmin, uHmax, uSeed;
layout(location = 0) out vec4 oH;
layout(location = 1) out vec4 oC;
float fr(float km) { return uR / (max(km, 0.001) * 1000.0); }
float azimuth(vec3 p, vec3 c) { vec3 e = eastOf(c), n = cross(c, e); vec3 v = p - c; return atan(dot(v, n), dot(v, e)); }
`,
    craters: String.raw`
// x height (m, before depth ×), y bright ejecta/rays, z crater floors
vec4 nodeCraters(vec3 p, float dens, float largestKm, float age, float rays, float seed) {
  float h = 0.0, ej = 0.0, fl = 0.0;
  float maxRad = largestKm * 500.0 / uR;
  float f = 0.34 / maxRad;
  int oc = clamp(int(log2(maxRad / (uTex * 1.1))) + 1, 0, 14);
  uint sd = uint(seed * 977.0) + 5003u;
  for (int o = 0; o < oc; o++) {
    vec3 q = p * f;
    ivec3 c0 = ivec3(floor(q));
    uint so = sd + uint(o) * 7919u;
    for (int n = 0; n < uL27; n++) {
      ivec3 cc = c0 + ivec3(n % 3, (n / 3) % 3, n / 9) - 1;
      vec3 hh = hash33(cc, so);
      if (hh.x > dens) continue;
      vec3 ctr = vec3(cc) + hash33(cc, so + 1u);
      float cl = length(ctr);
      if (abs(cl - f) > 0.5) continue;
      vec3 cd = ctr / cl;
      float rr = mix(0.1, 0.34, pow(hh.y, 2.2)) / f;
      vec3 dv = p - cd;
      if (dot(dv, dv) > sq(rr * 3.2)) continue;
      float Dkm = 2.0 * rr * uR * 0.001;
      float fresh = pow(hh.z, mix(0.3, 4.0, age));
      float ang = azimuth(p, cd);
      float az = snoise(vec3(cos(ang) * 1.3, sin(ang) * 1.3, hh.x * 40.0 + float(o)));
      float d = gcDist(p, cd) / rr * (1.0 + 0.07 * az);
      h += craterProfile(d, Dkm, 15.0, fresh, az, hh.y);
      ej = max(ej, ejectaBright(d, ang, sstep(1.0 - rays, 1.0 - rays * 0.3, hash13(cc, so + 5u)), hh.x * 97.0) * sstep(2.9, 1.8, d));
      fl = max(fl, sstep(0.85, 0.45, d) * sstep(2.0, 8.0, Dkm));
    }
    f *= 2.0;
  }
  return vec4(h, ej, fl, 0.0);
}
`,
    fractures: String.raw`
// x relief (-1..1, scaled by depth), y line mask
vec2 nodeFractures(vec3 p, int style, float sizeKm, float width, float cover, float seed) {
  vec3 so = seedOff(uSeed + seed * 13.0);
  float f = fr(sizeKm), tq = uTex * f;
  float covm = sstep(1.0 - cover, 1.0 - cover + 0.15, 0.5 + 0.6 * fbm(p * 3.0 + so, 3));
  float jn = 0.04 * jag(p, f * 6.0, uTex);
  float h = 0.0, m = 0.0;
  if (style == 0) {                       // polygonal troughs with raised lips
    vec3 q = p * f + 0.35 * warpVec(p * f * 0.25 + so, 2);
    Cell c = cellular(q, uint(seed) + 400u);
    float ed = cellEdge(c, q) + jn;
    float w = width * (0.5 + fract(c.id * 11.0 + c.id2 * 7.0));
    float tr = sstep(w + tq, max(w - tq, 0.0), ed);
    h = -tr + 0.35 * sstep(w * 2.5, w * 1.2, ed) * (1.0 - tr);
    m = tr;
  } else if (style == 1) {                // families of long, gently curving double ridges
    for (int k = 0; k < L(3); k++) {
      float fk = f * pow(1.5, float(k));
      vec3 dirK = normalize(hash33(ivec3(k, 3, int(seed)), 11u) - 0.5);
      vec3 q = p * fk + so * (1.3 * float(k + 1));
      q -= dirK * dot(q, dirK) * 0.96;
      vec3 g; float nv = snoiseGrad(q, g);
      vec3 gt = g - p * dot(g, p);
      float dist = abs(nv) / max(length(gt), 0.05) / fk;          // radians
      float x = dist / (width * 0.25 / f + uTex * 0.7);
      float seg = sstep(-0.15, 0.35, snoise(q * 0.3 + 7.0));
      h += seg * (exp(-sq((x - 0.9) / 0.5)) - 0.6 * exp(-sq(x / 0.35))) / (1.0 + 0.4 * float(k));
      m = max(m, seg * exp(-sq(x / 1.2)) * (1.0 - 0.15 * float(k)));
    }
  } else if (style == 2) {                // bright grooved lanes along cell boundaries
    vec3 q = p * f + 0.25 * warpVec(p * 2.0 + so, 3);
    Cell c = cellular(q, uint(seed) + 555u);
    float ed = cellEdge(c, q) + jn;
    float wL = width * (0.4 + 1.1 * fract(c.id * 13.0 + c.id2 * 7.0)) * (0.6 + 0.8 * (0.5 + 0.5 * fbm(q * 1.7, 3)));
    float lane = sstep(wL + tq, max(wL - tq, 0.0), ed) * step(0.3, fract(c.id * 5.3 + c.id2 * 5.3));
    float gro = pow(abs(sin((ed * 35.0 + 0.5 * snoise(q * 6.0)) * PI)), 0.8);
    h = lane * (0.6 * gro - 0.5);
    m = lane;
  } else if (style == 3) {                // canyon networks with terraced walls
    vec3 q = p * f + 0.5 * warpVec(p * 2.0 + so, 3);
    Cell c = cellular(q, uint(seed) + 2024u);
    float ed = cellEdge(c, q) + jn;
    float w = width * (0.6 + 0.8 * (0.5 + 0.5 * fbm(q * 0.7, 3)));
    float wall = sstep(w * 0.4, w, ed);
    float steps = floor(wall * 4.0) / 4.0 + sstep(0.6, 1.0, fract(wall * 4.0)) / 4.0;
    h = -(1.0 - mix(wall, steps, 0.5));
    m = sstep(w, w * 0.3, ed);
  } else {                                // polygons filled with parallel grooves
    vec3 q = p * f + 0.3 * warpVec(p * 3.0 + so, 3);
    Cell c = cellular(q, uint(seed) + 777u);
    vec3 dir = normalize(hash33(ivec3(floor(c.c1 * 3.0)), 9u) - 0.5);
    float ph = dot(p, dir) * f / max(width, 0.005) * 0.2 + 3.0 * fbm(p * f * 2.0 + so, 3);
    float gr = pow(abs(sin(ph)), 0.6) * (0.7 + 0.3 * sin(ph * 2.7 + 1.0));
    float edge = sstep(0.0, 0.08, cellEdge(c, q));
    h = edge * (gr - 0.5) * (0.6 + 0.4 * fract(c.id * 17.0));
    m = edge * gr * step(0.5, fract(c.id * 3.7));
  }
  return vec2(h, m) * covm;
}
`,
    plateaus: String.raw`
// x stacked step height (0..~levels), y cliff mask
vec2 nodePlateaus(vec3 p, float sizeKm, float levels, float lip, float seed) {
  vec3 so = seedOff(uSeed + seed * 7.0);
  float h = 0.0, cl = 0.0;
  for (int k = 0; k < L(6); k++) {
    if (float(k) >= levels) break;
    float fS = fr(sizeKm / (1.0 + 0.7 * float(k)));
    vec3 q = p * fS + so * float(k + 2);
    q += 0.45 * warpVec(q * 0.35, 3);
    float nS = fbm(q, min(5, octaves(fS, uTex)), 2.0, 0.5) + 0.04 * jag(p, fS * 8.0, uTex);
    float edge = 0.12 * float(k) - 0.08;
    float w = max(0.006 + 0.003 * float(k), uTex * fS * 0.8);
    float cliff = sstep(edge - w, edge + w, nS);
    float lp = exp(-sq((nS - edge - 1.6 * w) / (1.2 * w)));
    h += (cliff + lip * lp) / (1.0 + 0.35 * float(k));
    cl = max(cl, exp(-sq((nS - edge) / (1.5 * w))));
  }
  return vec2(h, cl);
}
`,
    volcanoes: String.raw`
// x relief (0..1), y lava flows, z calderas
vec3 nodeVolcanoes(vec3 p, float dens, float sizeKm, float caldera, float reach, float seed) {
  float f = fr(sizeKm * 2.5);
  vec3 q = p * f + seedOff(uSeed + seed * 5.0);
  Cell c = cellular(q, uint(seed) + 311u);
  if (c.id >= dens) return vec3(0.0);
  float r = 0.16 + 0.16 * fract(c.id * 13.7);
  vec3 u = normalize(q - c.c1);
  float ang = atan(u.y, u.x) + u.z;
  float d = c.f1 / r;
  float h = 0.0, fl = 0.0, cal = 0.0;
  vec2 cs = vec2(cos(ang), sin(ang));
  float lobe = snoise(vec3(cs * 2.6, d * 0.4 + c.id * 20.0)) + 0.3 * jag(p, f * 6.0, uTex);
  float rch = 1.0 + reach * (0.8 + 0.8 * (0.5 + 0.5 * snoise(vec3(cs * 1.4, c.id * 9.0))));
  fl = sstep(-0.05, 0.1, lobe) * sstep(rch, rch * 0.9, d) * sstep(0.5, 0.9, d);
  if (d < 1.0) {
    float flows = ridged(vec3(ang * 14.0, d * 5.0, c.id * 30.0), 3);
    h = pow(1.0 - d, 1.3) * (1.0 + 0.05 * flows);
    cal = sstep(caldera * 1.1, caldera * 0.9, d + 0.03 * jag(p, f * 20.0, uTex));
    h -= 0.15 * cal;
  }
  h += 0.02 * fl;
  return vec3(h, fl * (1.0 - cal), cal);
}
`,
  };

  // ---------------------------------------------------------------- compile
  const hexLin = (hex) => {
    const v = parseInt(String(hex).replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  };
  const glslNum = (x) => { const s = String(+x); return /[.e]/.test(s) ? s : s + '.0'; };

  function compile(graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const src = new Map();
    for (const l of graph.links) if (byId.has(l.from[0]) && byId.has(l.to[0])) src.set(l.to[0] + ':' + l.to[1], l.from);
    const out = graph.nodes.find((n) => n.type === 'output');
    if (!out) return { identity: true };
    const order = [], state = new Map();
    const visit = (id) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) throw new Error('Node graph has a loop.');
      state.set(id, 1);
      const n = byId.get(id);
      for (const i of DEFS[n.type].inputs) { const s = src.get(id + ':' + i.id); if (s) visit(s[0]); }
      state.set(id, 2); order.push(n);
    };
    visit(out.id);
    // identity: only World -> Output with height→height, colour→colour (or nothing connected)
    const hs = src.get(out.id + ':height'), cs = src.get(out.id + ':colour');
    const isWorld = (s, o) => !s || (byId.get(s[0]).type === 'world' && s[1] === o);
    if (isWorld(hs, 'height') && isWorld(cs, 'colour')) return { identity: true };

    const libs = new Set(), uniforms = {};
    let decl = '', body = '', key = '';
    const kindOf = (s) => DEFS[byId.get(s[0]).type].outputs.find((o) => o.id === s[1]).kind;
    for (const n of order) {
      const def = DEFS[n.type];
      if (def.lib) libs.add(def.lib);
      const I = {}, P = {}, O = {}, selv = {};
      for (const i of def.inputs) {
        const s = src.get(n.id + ':' + i.id);
        if (!s) { I[i.id] = i.def; continue; }
        const v = `n${s[0]}_${s[1]}`, k = kindOf(s);
        I[i.id] = k === i.kind ? v : i.kind === C ? `vec3(${v})` : `luma(${v})`;
      }
      for (const p of def.params) {
        const val = n.params[p.id] ?? p.value;
        if (p.type === 'select') { selv[p.id] = +val; continue; }
        if (p.type === 'check') { selv[p.id] = !!val; continue; }
        const u = `u${n.id}_${p.id}`;
        P[p.id] = u;
        if (p.type === 'color') { decl += `uniform vec3 ${u};\n`; uniforms[u] = hexLin(val); }
        else { decl += `uniform float ${u};\n`; uniforms[u] = +val; }
      }
      for (const o of def.outputs) { O[o.id] = `n${n.id}_${o.id}`; body += `  ${o.kind === C ? 'vec3' : 'float'} ${O[o.id]};\n`; }
      body += '  ' + def.glsl({ id: n.id, I, P, O, sel: selv }) + '\n';
      key += `${n.type}${n.id}:${JSON.stringify(selv)}|`;
    }
    for (const l of graph.links) key += `${l.from}>${l.to};`;
    const needSlope = order.some((n) => n.type === 'world');
    const fs = `//#include planet\n${LIB.common}\n${[...libs].map((l) => LIB[l]).join('\n')}\n${decl}
void main() {
  vec3 p = cellDir();
  float baseH = at(uBaseH).r;
  vec4 bc = at(uBaseC);
  vec3 baseC = srgbToLinear(bc.rgb);
  vec4 baseM = at(uBaseM);
  float baseSlope = 0.0;
  ${needSlope ? `{ float d = texelAngle(uN) * uR;
    float gx = nb(uBaseH, ivec2(1, 0)).r - nb(uBaseH, ivec2(-1, 0)).r, gy = nb(uBaseH, ivec2(0, 1)).r - nb(uBaseH, ivec2(0, -1)).r;
    baseSlope = length(vec2(gx, gy)) / (2.0 * d) * pow(max(d, 50.0) / 5000.0, 0.3); }` : ''}
  float outH = baseH; vec3 outC = baseC;
${body}
  oH = vec4(outH);
  oC = vec4(linearToSrgb(sat3(outC)), bc.a);
}
`;
    let hash = 0; for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
    return { identity: false, fs, uniforms, key: 'nodes.' + (hash >>> 0).toString(36) + '.' + key.length };
  }

  // ---------------------------------------------------------------- run on a world
  let running = null, pending = null;
  async function apply(world, graph) {
    if (running) { pending = [world, graph]; return running; }
    running = (async () => {
      try { await applyNow(world, graph); }
      finally {
        running = null;
        if (pending) { const [w, g] = pending; pending = null; await apply(w, g); }
      }
    })();
    return running;
  }
  async function applyNow(world, graph) {
    const gpu = world.ctx.gpu;
    const c = compile(graph || { nodes: [], links: [] });
    if (c.identity) { world.useBase(); return; }
    const prog = await gpu.programAsync(c.key, c.fs);
    if (world.disposed) return;
    if (!world.nodeH) { world.nodeH = gpu.field(world.N, 'r32f', 'nodeH'); world.nodeC = gpu.field(world.N, 'rgba8', 'nodeC'); }
    await gpu.runTiled(prog, [world.nodeH, world.nodeC], {
      ...c.uniforms, uBaseH: world.baseH, uBaseC: world.baseAlbedo, uBaseM: world.M || world.baseH,
      uR: world.R, uTex: Math.PI / 2 / world.N, uHmin: world.baseHmin, uHmax: world.baseHmax, uSeed: (world.ctx.seed % 997) + 0.5,
    });
    if (world.disposed) return;
    world.H = world.nodeH; world.albedo = world.nodeC;
    const st = world.ctx.ops.fieldStats(world.H, 0, 128);
    world.ctx.hmin = st.min; world.ctx.hmax = st.max;
  }

  // ---------------------------------------------------------------- graphs
  function node(id, type, x, y, params = {}) { return { id, type, x, y, params }; }
  function defaultGraph() {
    return { nodes: [node(1, 'world', 40, 60), node(2, 'output', 560, 80)], links: [{ from: [1, 'height'], to: [2, 'height'] }, { from: [1, 'colour'], to: [2, 'colour'] }], nextId: 3 };
  }
  const EXAMPLES = {
    'World only (no changes)': defaultGraph,
    'Extra craters with bright rays': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'craters', 260, 20, { density: 0.35, largest: 80, rays: 0.12 }),
      node(4, 'paint', 520, 200, { color: '#e6ddd0', strength: 0.9, fray: 0.6 }), node(2, 'output', 780, 60)],
      links: [{ from: [1, 'height'], to: [3, 'height'] }, { from: [3, 'height'], to: [2, 'height'] }, { from: [1, 'colour'], to: [4, 'colour'] }, { from: [3, 'ejecta'], to: [4, 'mask'] }, { from: [4, 'colour'], to: [2, 'colour'] }], nextId: 5 }),
    'Recolour the lowlands': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'mask', 260, 220, { from: 0.15, to: 0.35, invert: true, jag: 0.8 }),
      node(4, 'paint', 520, 160, { color: '#4a3a33', strength: 0.85, variation: 0.4 }), node(2, 'output', 780, 60)],
      links: [{ from: [1, 'height'], to: [2, 'height'] }, { from: [1, 'h01'], to: [3, 'value'] }, { from: [1, 'colour'], to: [4, 'colour'] }, { from: [3, 'mask'], to: [4, 'mask'] }, { from: [4, 'colour'], to: [2, 'colour'] }], nextId: 5 }),
    'Cracked plates (Europa on anything)': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'fractures', 260, 20, { style: 1, size: 600, width: 0.06, depth: 400 }),
      node(4, 'fractures', 260, 330, { style: 0, size: 300, width: 0.05, depth: -500, cover: 0.55 }), node(5, 'paint', 540, 200, { color: '#7a4a30', strength: 0.8 }),
      node(6, 'paint', 780, 260, { color: '#5b3a2a', strength: 0.7 }), node(2, 'output', 1020, 60)],
      links: [{ from: [1, 'height'], to: [3, 'height'] }, { from: [3, 'height'], to: [4, 'height'] }, { from: [4, 'height'], to: [2, 'height'] },
        { from: [1, 'colour'], to: [5, 'colour'] }, { from: [3, 'lines'], to: [5, 'mask'] }, { from: [5, 'colour'], to: [6, 'colour'] }, { from: [4, 'lines'], to: [6, 'mask'] }, { from: [6, 'colour'], to: [2, 'colour'] }], nextId: 7 }),
    'Volcanic field with dark flows': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'mask', 20, 330, { source: 2, from: 0.45, to: 0.6, size: 900 }),
      node(4, 'volcanoes', 280, 60, { density: 0.4, size: 260, amount: 4000, flows: 1.4 }), node(5, 'paint', 540, 240, { color: '#2b2622', strength: 0.85 }), node(2, 'output', 800, 60)],
      links: [{ from: [1, 'height'], to: [4, 'height'] }, { from: [3, 'mask'], to: [4, 'where'] }, { from: [4, 'height'], to: [2, 'height'] },
        { from: [1, 'colour'], to: [5, 'colour'] }, { from: [4, 'flows'], to: [5, 'mask'] }, { from: [5, 'colour'], to: [2, 'colour'] }], nextId: 6 }),
    'Mesas and cliffs': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'plateaus', 260, 20, { size: 250, amount: 500, levels: 3, lip: 0.4 }),
      node(4, 'terrain', 500, 20, { style: 3, size: 15, amount: 60 }), node(5, 'paint', 520, 300, { color: '#c9b49a', strength: 0.6, blend: 2 }), node(2, 'output', 780, 60)],
      links: [{ from: [1, 'height'], to: [3, 'height'] }, { from: [3, 'height'], to: [4, 'height'] }, { from: [4, 'height'], to: [2, 'height'] },
        { from: [1, 'colour'], to: [5, 'colour'] }, { from: [3, 'cliffs'], to: [5, 'mask'] }, { from: [5, 'colour'], to: [2, 'colour'] }], nextId: 6 }),
  };

  S.Nodes = { DEFS, ADDABLE, EXAMPLES, compile, apply, defaultGraph };
})();
