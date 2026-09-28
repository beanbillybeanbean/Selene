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
  const crv = (id, label, value) => ({ id, label, type: 'curve', value });
  const img = (id, label) => ({ id, label, type: 'image', value: '' });

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
    terrace: {
      title: 'Terrace', hue: 60, desc: 'Cuts terrain into steps and ledges.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: '0.0' }, { id: 'where', label: 'Where', kind: V, def: '1.0' }],
      outputs: [{ id: 'height', label: 'Height', kind: V }, { id: 'ledges', label: 'Ledge edges', kind: V }],
      params: [rng('step', 'Step height (m)', 5, 4000, 5, 300), rng('sharp', 'Sharpness', 0, 1, 0.01, 0.75), rng('jitter', 'Irregularity', 0, 1, 0.01, 0.35), rng('size', 'Irregularity size (km)', 5, 2000, 1, 150)],
      glsl: (n) => `{ float hh = ${n.I.height};
    float st = ${n.P.step} * (1.0 + ${n.P.jitter} * 0.6 * fbm(p * fr(${n.P.size}) + seedOff(uSeed + ${n.id}.0), 4));
    float v = hh / st, fl = floor(v), f = fract(v), s = 0.5 * (1.0 - ${n.P.sharp});
    float t = (fl + sstep(0.5 - s - 0.001, 0.5 + s + 0.001, f)) * st;
    ${n.O.height} = mix(hh, t, ${n.I.where}); ${n.O.ledges} = ${n.I.where} * exp(-sq((f - 0.5) / max(0.02, s + 0.04))); }`,
    },
    curve: {
      title: 'Curve', hue: 170, sat: 30, desc: 'Remaps a value through a curve (contrast, levels, invert…).',
      inputs: [{ id: 'value', label: 'Value', kind: V, def: '0.0' }],
      outputs: [{ id: 'value', label: 'Value', kind: V }],
      params: [rng('from', 'Input from', -20000, 20000, 0.01, 0), rng('to', 'Input to', -20000, 20000, 0.01, 1), crv('curve', 'Curve', [0, 0.25, 0.5, 0.75, 1]),
        rng('outFrom', 'Output from', -20000, 20000, 0.01, 0), rng('outTo', 'Output to', -20000, 20000, 0.01, 1)],
      lib: 'curve',
      glsl: (n) => `${n.O.value} = mix(${n.P.outFrom}, ${n.P.outTo}, curve5(sat((${n.I.value} - ${n.P.from}) / max(1e-6, ${n.P.to} - ${n.P.from})), ${n.P.curve}));`,
    },
    smooth: {
      title: 'Smooth / Sharpen', hue: 200, sat: 30, desc: 'Blurs, sharpens or extracts detail at a chosen scale.',
      inputs: [{ id: 'value', label: 'Value', kind: V, def: 'baseH' }],
      outputs: [{ id: 'value', label: 'Value', kind: V }],
      params: [sel('mode', 'Mode', [[0, 'Blur'], [1, 'Sharpen'], [2, 'Detail only (high-pass)']], 0), rng('radius', 'Radius (km)', 1, 3000, 1, 80), rng('amount', 'Amount', 0, 4, 0.01, 1)],
      barrier: 'value',
      glslBarrier: (n) => { const o = `at(uBar${n.id}).r`, b = `at(uBarB${n.id}).r`;
        return `${n.O.value} = ${[`mix(${o}, ${b}, sat(${n.P.amount}))`, `${o} + ${n.P.amount} * (${o} - ${b})`, `${n.P.amount} * (${o} - ${b})`][n.sel.mode]};`; },
    },
    erosion: {
      title: 'Erosion', hue: 150, desc: 'Real river erosion: valleys, drainage networks and river mask.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: 'baseH' }],
      outputs: [{ id: 'height', label: 'Height', kind: V }, { id: 'rivers', label: 'Rivers', kind: V }, { id: 'eroded', label: 'Eroded (m)', kind: V }],
      params: [rng('steps', 'Erosion time (steps)', 20, 800, 10, 150), rng('strength', 'River incision', 0.1, 6, 0.05, 1.2), rng('concentrate', 'Flow concentration', 1, 8, 0.1, 2.5),
        rng('creep', 'Hillslope creep', 0, 0.2, 0.005, 0.02), rng('talus', 'Max stable slope', 0.1, 2, 0.01, 0.8), rng('rivers', 'River threshold (log km²)', 1, 6, 0.05, 3.4)],
      barrier: 'height',
      glslBarrier: (n) => `${n.O.height} = at(uBar${n.id}).r;
  ${n.O.rivers} = sat((log(max(at(uBarB${n.id}).r, 1e-3)) / 2.302585 - ${n.P.rivers}) / 1.2);
  ${n.O.eroded} = at(uBarC${n.id}).r - at(uBar${n.id}).r;`,
    },
    image: {
      title: 'Image', hue: 250, desc: 'Uses your own equirectangular image (mask, heightmap or colours).',
      inputs: [],
      outputs: [{ id: 'value', label: 'Brightness', kind: V }, { id: 'colour', label: 'Colour', kind: C }, { id: 'alpha', label: 'Alpha', kind: V }],
      params: [img('image', 'Image (2:1 map)'), rng('lon', 'Rotate (°)', -180, 180, 1, 0), chk('flip', 'Flip vertically', false)],
      glsl: (n) => `{ vec2 ll = dirLatLon(p);
    vec2 uv = vec2(fract((ll.y + PI) / TAU + ${n.P.lon} / 360.0), 0.5 - ll.x / PI);
    ${n.sel.flip ? 'uv.y = 1.0 - uv.y;' : ''}
    vec4 t = texture(${n.P.image}, uv);
    ${n.O.value} = luma(t.rgb); ${n.O.colour} = srgbToLinear(t.rgb); ${n.O.alpha} = t.a; }`,
    },
    province: {
      title: 'Province', hue: 20, desc: 'Planet-scale shapes: Venus bright belts, Mars dark provinces, regions.',
      inputs: [],
      outputs: [{ id: 'mask', label: 'Mask', kind: V }, { id: 'filaments', label: 'Filaments / streaks', kind: V }, { id: 'edge', label: 'Edge band', kind: V }],
      params: [sel('style', 'Shape', [[1, 'Regions'], [2, 'Filament belts (Venus)'], [3, 'Streaky provinces (Mars)']], 2), rng('cover', 'Coverage', 0, 1, 0.01, 0.3),
        rng('size', 'Size (km)', 100, 8000, 10, 2500), rng('stretch', 'Wind stretch', 0, 1, 0.01, 0), rng('jag', 'Ragged edges', 0, 3, 0.01, 1), rng('seed', 'Seed', 0, 100, 1, 1)],
      glsl: (n) => `{ vec3 pv = provinceShape(vec4(${n.sel.style}.0, ${n.P.cover}, ${n.P.size}, ${n.P.jag}), vec4(0.0, 0.0, ${n.P.stretch}, ${n.P.seed}), ${n.id}.0, p, uR, uTex, seedOff(uSeed + 91.0));
    ${n.O.mask} = pv.x; ${n.O.filaments} = pv.y; ${n.O.edge} = pv.z; }`,
    },
    output: {
      title: 'Output', hue: 0, sat: 0, desc: 'What gets previewed and exported.',
      inputs: [{ id: 'height', label: 'Height', kind: V, def: 'baseH' }, { id: 'colour', label: 'Colour', kind: C, def: 'baseC' }],
      outputs: [],
      params: [],
      glsl: (n) => `outH = ${n.I.height}; outC = ${n.I.colour};`,
    },
  };
  const ADDABLE = ['terrain', 'craters', 'fractures', 'plateaus', 'volcanoes', 'province', 'erosion', 'terrace', 'mask', 'math', 'curve', 'smooth', 'image', 'paint', 'world', 'output'];

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
    curve: String.raw`
float curve5(float t, float k[5]) {             // Catmull-Rom through 5 evenly spaced points
  float x = t * 4.0; int i = int(min(floor(x), 3.0)); float f = x - float(i);
  float p0 = k[max(i - 1, 0)], p1 = k[i], p2 = k[i + 1], p3 = k[min(i + 2, 4)];
  vec4 w = crW(f);
  return w.x * p0 + w.y * p1 + w.z * p2 + w.w * p3;
}
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

  function strHash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + '.' + str.length; }

  // Compiles the graph into stages. Nodes that need their input as a texture (blur, erosion) are
  // "barriers": their input is rendered first, processed on the GPU, and read back by later stages.
  function compile(graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const src = new Map();
    for (const l of graph.links) if (byId.has(l.from[0]) && byId.has(l.to[0])) src.set(l.to[0] + ':' + l.to[1], l.from);
    const out = graph.nodes.find((n) => n.type === 'output');
    if (!out) return { identity: true };
    const hs = src.get(out.id + ':height'), cs = src.get(out.id + ':colour');
    const isWorld = (s0, o) => !s0 || (byId.get(s0[0]).type === 'world' && s0[1] === o);
    if (isWorld(hs, 'height') && isWorld(cs, 'colour')) return { identity: true };
    const kindOf = (s0) => DEFS[byId.get(s0[0]).type].outputs.find((o) => o.id === s0[1]).kind;

    // Emit one shader computing `roots` (array of [socket or null, default expr, kind]).
    function emit(roots) {
      const order = [], state = new Map(), barriers = new Set();
      const visit = (id) => {
        if (state.get(id) === 2) return;
        if (state.get(id) === 1) throw new Error('Node graph has a loop.');
        state.set(id, 1);
        const n = byId.get(id), def = DEFS[n.type];
        if (def.barrier) barriers.add(id);
        else for (const i of def.inputs) { const s0 = src.get(id + ':' + i.id); if (s0) visit(s0[0]); }
        state.set(id, 2); order.push(n);
      };
      for (const r of roots) if (r[0]) visit(r[0][0]);
      const libs = new Set(), uniforms = {};
      let decl = '', body = '';
      for (const n of order) {
        const def = DEFS[n.type];
        if (def.lib) libs.add(def.lib);
        const I = {}, P = {}, O = {}, selv = {};
        for (const i of def.inputs) {
          const s0 = src.get(n.id + ':' + i.id);
          if (!s0) { I[i.id] = i.def; continue; }
          const v = `n${s0[0]}_${s0[1]}`, k = kindOf(s0);
          I[i.id] = k === i.kind ? v : i.kind === C ? `vec3(${v})` : `luma(${v})`;
        }
        for (const p of def.params) {
          const val = n.params[p.id] ?? p.value;
          if (p.type === 'select') { selv[p.id] = +val; continue; }
          if (p.type === 'check') { selv[p.id] = !!val; continue; }
          const u = `u${n.id}_${p.id}`;
          P[p.id] = u;
          if (p.type === 'color') { decl += `uniform vec3 ${u};\n`; uniforms[u] = hexLin(val); }
          else if (p.type === 'curve') { decl += `uniform float ${u}[5];\n`; uniforms[u] = Float32Array.from(val); }
          else if (p.type === 'image') { decl += `uniform sampler2D ${u};\n`; uniforms[u] = { nodeImage: val }; }
          else { decl += `uniform float ${u};\n`; uniforms[u] = +val; }
        }
        for (const o of def.outputs) { O[o.id] = `n${n.id}_${o.id}`; body += `  ${o.kind === C ? 'vec3' : 'float'} ${O[o.id]};\n`; }
        if (def.barrier) {
          decl += `uniform sampler2DArray uBar${n.id}, uBarB${n.id}, uBarC${n.id};\n`;
          body += '  ' + def.glslBarrier({ id: n.id, I, P, O, sel: selv }) + '\n';
        } else body += '  ' + def.glsl({ id: n.id, I, P, O, sel: selv }) + '\n';
      }
      const expr = (r) => { if (!r[0]) return r[1]; const v = `n${r[0][0]}_${r[0][1]}`, k = kindOf(r[0]); return k === r[2] ? v : r[2] === C ? `vec3(${v})` : `luma(${v})`; };
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
${body}
  oH = vec4(${expr(roots[0])});
  oC = vec4(linearToSrgb(sat3(${roots[1] ? expr(roots[1]) : 'baseC'})), bc.a);
}
`;
      return { fs, uniforms, key: 'nodes.' + strHash(fs), barriers: [...barriers] };
    }

    // barrier stages in dependency order
    const stages = [], done = new Set();
    const stageFor = (id) => {
      if (done.has(id)) return; done.add(id);
      const n = byId.get(id), def = DEFS[n.type];
      const e = emit([[src.get(id + ':' + def.barrier) || null, def.inputs.find((i) => i.id === def.barrier).def, V]]);
      e.barriers.forEach(stageFor);
      const params = {}; for (const p of def.params) params[p.id] = n.params[p.id] ?? p.value;
      stages.push({ id, type: n.type, params, ...e, cacheKey: e.key + JSON.stringify(e.uniforms, (k, v) => (v instanceof Float32Array ? [...v] : v)).length + JSON.stringify(params) + strHash(JSON.stringify(e.uniforms, (k, v) => (v instanceof Float32Array ? [...v] : v))) });
    };
    const final = emit([[hs || null, 'baseH', V], [cs || null, 'baseC', C]]);
    final.barriers.forEach(stageFor);
    return { identity: false, stages, final };
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

  const imageCache = new Map();   // dataURL -> texture
  async function imageTexture(gpu, url) {
    if (!url) return gpu._dummy2D();
    if (imageCache.has(url)) return imageCache.get(url);
    const im = new Image(); im.src = url;
    await im.decode();
    const gl = gpu.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    imageCache.set(url, t);
    return t;
  }

  async function applyNow(world, graph) {
    const gpu = world.ctx.gpu, ops = world.ctx.ops, N = world.N;
    const c = compile(graph || { nodes: [], links: [] });
    if (c.identity) { world.useBase(); return; }
    const base = {
      uBaseH: world.baseH, uBaseC: world.baseAlbedo, uBaseM: world.M || world.baseH,
      uR: world.R, uTex: Math.PI / 2 / N, uHmin: world.baseHmin, uHmax: world.baseHmax, uSeed: (world.ctx.seed % 997) + 0.5,
    };
    const resolve = async (u) => { const r = {}; for (const k in u) r[k] = u[k] && u[k].nodeImage !== undefined ? await imageTexture(gpu, u[k].nodeImage) : u[k]; return r; };
    world.nodeCache = world.nodeCache || new Map();
    const used = new Set(), bar = {};
    const barUniforms = (ids) => { const r = {}; for (const id of ids) { const t = bar[id]; r['uBar' + id] = t.a; r['uBarB' + id] = t.b || t.a; r['uBarC' + id] = t.c || t.a; } return r; };
    for (const st of c.stages) {
      let entry = world.nodeCache.get(st.cacheKey);
      if (!entry) {
        const prog = await gpu.programAsync(st.key, st.fs);
        const inp = gpu.field(N, 'r32f'), dummyC = gpu.field(N, 'rgba8');
        await gpu.runTiled(prog, [inp, dummyC], { ...base, ...(await resolve(st.uniforms)), ...barUniforms(st.barriers) });
        gpu.free(dummyC);
        entry = await processBarrier(world, st, inp);
        world.nodeCache.set(st.cacheKey, entry);
      }
      used.add(st.cacheKey);
      bar[st.id] = entry;
      if (world.disposed) return;
    }
    // free cached stage results no longer in the graph
    for (const [k, e] of world.nodeCache) if (!used.has(k)) { for (const t of [e.a, e.b, e.c]) if (t) gpu.free(t); world.nodeCache.delete(k); }
    const prog = await gpu.programAsync(c.final.key, c.final.fs);
    if (world.disposed) return;
    if (!world.nodeH) { world.nodeH = gpu.field(N, 'r32f', 'nodeH'); world.nodeC = gpu.field(N, 'rgba8', 'nodeC'); }
    await gpu.runTiled(prog, [world.nodeH, world.nodeC], { ...base, ...(await resolve(c.final.uniforms)), ...barUniforms(c.final.barriers) });
    if (world.disposed) return;
    world.H = world.nodeH; world.albedo = world.nodeC;
    const stt = ops.fieldStats(world.H, 0, 128);
    world.ctx.hmin = stt.min; world.ctx.hmax = stt.max;
  }

  // blur via a coarse copy (texel ≈ radius) upsampled bicubically; erosion via the real simulation
  async function processBarrier(world, st, inp) {
    const gpu = world.ctx.gpu, ops = world.ctx.ops, N = world.N, R = world.R;
    if (st.type === 'smooth') {
      const want = Math.PI / 2 * R / (Math.max(1, st.params.radius) * 1000);
      let n = N; while (n > 8 && n / 2 >= want) n /= 2;
      let cur = inp;
      const chain = [];
      while (cur.N > n) { const nx = Math.max(n, cur.N / 8); const f = gpu.field(nx, 'r32f'); ops.resample(cur, f); chain.push(f); cur = f; }
      const blurred = gpu.field(N, 'r32f');
      if (cur === inp) ops.copy(inp, blurred); else ops.resample(cur, blurred, true);
      chain.forEach((f) => gpu.free(f));
      return { a: inp, b: blurred };
    }
    if (st.type === 'erosion') {
      const orig = gpu.field(N, 'r32f'); ops.copy(inp, orig);
      const T = gpu.field(16, 'rgba16f'); ops.scaleOffset(inp, T, [0, 0, 0, 0], [0, 0, 0, 0]);
      const q = st.params;
      const ctx = { ...world.ctx, P: { ...world.P, erosion: true, erosionIterations: q.steps, erosionStrength: q.strength, flowExponent: q.concentrate, hillslope: q.creep, talus: q.talus, uplift: 0, fillRate: world.P.fillRate ?? 1.5, erosionBaseRes: 128 } };
      const A = await S.Erosion.run(ctx, inp, T, () => {}, 0, 1);
      gpu.free(T);
      return { a: inp, b: A || orig, c: orig };
    }
    return { a: inp };
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

  Object.assign(EXAMPLES, {
    'Eroded valleys with river colour': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'erosion', 270, 20, { steps: 180, strength: 1.5 }),
      node(4, 'paint', 530, 200, { color: '#3d2a22', strength: 0.55, fray: 0.3 }), node(2, 'output', 790, 60)],
      links: [{ from: [1, 'height'], to: [3, 'height'] }, { from: [3, 'height'], to: [2, 'height'] }, { from: [1, 'colour'], to: [4, 'colour'] }, { from: [3, 'rivers'], to: [4, 'mask'] }, { from: [4, 'colour'], to: [2, 'colour'] }], nextId: 5 }),
    'Venus bright belts on any world': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'province', 20, 330, { style: 2, cover: 0.3, size: 3000 }),
      node(4, 'paint', 280, 160, { color: '#f2c060', strength: 0.5, blend: 2 }), node(5, 'paint', 530, 200, { color: '#fff0b0', strength: 0.7, blend: 2, fray: 0.4 }), node(2, 'output', 790, 60)],
      links: [{ from: [1, 'height'], to: [2, 'height'] }, { from: [1, 'colour'], to: [4, 'colour'] }, { from: [3, 'mask'], to: [4, 'mask'] }, { from: [4, 'colour'], to: [5, 'colour'] }, { from: [3, 'filaments'], to: [5, 'mask'] }, { from: [5, 'colour'], to: [2, 'colour'] }], nextId: 6 }),
    'Mars dark provinces on any world': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'province', 20, 330, { style: 3, cover: 0.3, size: 2500, stretch: 0.6, jag: 1.5 }),
      node(4, 'terrain', 280, 20, { style: 3, size: 20, amount: 250 }), node(5, 'paint', 530, 220, { color: '#4a2e22', strength: 0.75, fray: 0.8 }), node(2, 'output', 790, 60)],
      links: [{ from: [1, 'height'], to: [4, 'height'] }, { from: [3, 'mask'], to: [4, 'where'] }, { from: [4, 'height'], to: [2, 'height'] }, { from: [1, 'colour'], to: [5, 'colour'] }, { from: [3, 'mask'], to: [5, 'mask'] }, { from: [5, 'colour'], to: [2, 'colour'] }], nextId: 6 }),
    'Terraced canyons (terrace + sharpen)': () => ({ nodes: [node(1, 'world', 20, 40), node(3, 'terrace', 270, 20, { step: 400, sharp: 0.8 }), node(4, 'smooth', 520, 20, { mode: 1, radius: 30, amount: 1.2 }),
      node(5, 'paint', 520, 300, { color: '#d8b48c', strength: 0.45, blend: 2 }), node(2, 'output', 780, 60)],
      links: [{ from: [1, 'height'], to: [3, 'height'] }, { from: [3, 'height'], to: [4, 'value'] }, { from: [4, 'value'], to: [2, 'height'] }, { from: [1, 'colour'], to: [5, 'colour'] }, { from: [3, 'ledges'], to: [5, 'mask'] }, { from: [5, 'colour'], to: [2, 'colour'] }], nextId: 6 }),
  });

  S.Nodes = { DEFS, ADDABLE, EXAMPLES, compile, apply, defaultGraph };
})();
