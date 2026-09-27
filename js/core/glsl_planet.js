// Selene — planetary landform primitives (SpaceEngine-style procedural toolbox, reworked):
// derivative-damped "eroded" fBm, cellular noise with cell centres, physically shaped impact
// craters (simple bowls -> complex craters with terraces and central peaks -> peak rings),
// crack networks, grooved terrain, volcano and caldera profiles.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  S.GLSL.planet = String.raw`
// ---------------------------------------------------------------- simplex noise with analytic gradient
float snoiseGrad(vec3 v, out vec3 grad) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = _perm(_perm(_perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = inversesqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m, m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 t = m2 * m * pdotx;
  grad = -8.0 * (t.x * x0 + t.y * x1 + t.z * x2 + t.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  grad *= 42.0;
  return 42.0 * dot(m4, pdotx);
}

// "Eroded" fBm (after Inigo Quilez): each octave is damped where the accumulated slope is steep,
// so detail collects in valleys and on flats while ridgelines stay clean — reads like erosion.
float erodedFbm(vec3 p, int oct, float lac, float gain, float k) {
  float a = 0.0, b = 1.0, norm = 0.0; vec3 d = vec3(0.0);
  for (int i = 0; i < oct; i++) {
    vec3 g; float n = snoiseGrad(p, g);
    d += g * b;
    a += b * n / (1.0 + k * dot(d, d));
    norm += b; b *= gain;
    p = p * lac + vec3(3.1, -1.7, 5.3);
  }
  return a / norm;
}
// Ridged multifractal whose finer octaves are eroded away on steep ground (sharp crests, gullied flanks)
float ridgedEroded(vec3 p, int oct, float lac, float gain, float k) {
  float sum = 0.0, amp = 1.0, w = 1.0, norm = 0.0; vec3 d = vec3(0.0);
  for (int i = 0; i < oct; i++) {
    vec3 g; float n = snoiseGrad(p, g);
    d += g * amp * (n < 0.0 ? 1.0 : -1.0);
    float r = 1.0 - abs(n); r *= r; r *= w;
    w = sat(r * 2.0);
    sum += amp * r / (1.0 + k * dot(d, d)); norm += amp; amp *= gain;
    p = p * lac + vec3(-4.1, 2.3, 7.7);
  }
  return sum / norm;
}
// band-limited octave count: finest wavelength about two texels
int octaves(float f0, float texAng) { return clamp(int(log2((0.33 / texAng) / f0)) + 1, 1, 14); }

// ---------------------------------------------------------------- cellular noise with centres
struct Cell { float f1; float f2; vec3 c1; vec3 c2; float id; float id2; };
Cell cellular(vec3 p, uint seed) {
  ivec3 c = ivec3(floor(p));
  Cell r; r.f1 = 9.0; r.f2 = 9.0; r.c1 = vec3(0.0); r.c2 = vec3(0.0); r.id = 0.0; r.id2 = 0.0;
  for (int n = 0; n < uL27; n++) {
    ivec3 q = c + ivec3(n % 3, (n / 3) % 3, n / 9) - 1;
    vec3 pt = vec3(q) + hash33(q, seed);
    float d = length(pt - p);
    if (d < r.f1) { r.f2 = r.f1; r.c2 = r.c1; r.id2 = r.id; r.f1 = d; r.c1 = pt; r.id = hash13(q, seed + 77u); }
    else if (d < r.f2) { r.f2 = d; r.c2 = pt; r.id2 = hash13(q, seed + 77u); }
  }
  return r;
}
// approximate distance to the nearest Voronoi edge (exact for the two nearest sites)
float cellEdge(Cell c, vec3 p) {
  vec3 m = 0.5 * (c.c1 + c.c2), n = normalize(c.c2 - c.c1);
  return abs(dot(p - m, n));
}

// ---------------------------------------------------------------- impact crater morphology
// d: distance from centre in crater radii; Dkm: diameter; Dt: simple->complex transition diameter;
// fresh: 1 = pristine, 0 = heavily degraded; az: azimuth noise [-1,1]; returns metres.
float craterProfile(float d, float Dkm, float Dt, float fresh, float az, float rnd) {
  float s = Dkm / Dt;
  float depth, rim, floorR, peak = 0.0, ring = 0.0;
  if (s < 1.0) { depth = 0.2 * Dkm; rim = 0.04 * Dkm; floorR = 0.0; }
  else {
    depth = 0.2 * Dt * pow(s, 0.3);
    rim = 0.04 * Dt * pow(s, 0.42);
    floorR = clamp(0.22 + 0.16 * log2(s), 0.2, 0.62);
    if (s < 7.0) peak = depth * (0.35 + 0.25 * rnd) * sstep(1.0, 1.8, s);
    else ring = depth * 0.3;
  }
  depth *= 1000.0; rim *= 1000.0; peak *= 1000.0; ring *= 1000.0;
  depth *= mix(0.28, 1.0, fresh); rim *= mix(0.2, 1.0, fresh) * (1.0 + 0.25 * az); peak *= mix(0.3, 1.0, fresh);
  float v;
  if (d < 1.0) {
    if (s < 1.0) v = -depth + (depth + rim) * pow(d, mix(2.0, 2.4, fresh));
    else {
      float t = sat((d - floorR) / (1.0 - floorR));
      float wall = pow(t, 1.6);
      // slumped terraces on complex crater walls
      float nT = 3.0 + floor(rnd * 3.0);
      float tq = floor(wall * nT) / nT, tf = fract(wall * nT);
      float terr = tq + sstep(0.55, 1.0, tf) / nT;
      wall = mix(wall, terr, 0.6 * fresh * sstep(1.3, 2.5, s));
      v = -depth + (depth + rim) * wall;
      v += peak * exp(-sq(d / (0.1 + 0.05 * rnd)));
      v += ring * exp(-sq((d - floorR * 0.55) / 0.05));
    }
    // degraded craters are infilled: smooth, shallow dish
    float dish = -depth * 0.8 * (1.0 - d * d) * (1.0 - d * d) + rim * d * d;
    v = mix(dish, v, sstep(0.0, 0.7, fresh));
  } else {
    // rim flank and continuous ejecta blanket (thickness ~ r^-3)
    float ej = rim * pow(d, -3.0) * sstep(3.2, 1.6, d);
    v = mix(rim * exp(-sq((d - 1.0) / 0.35)) * 0.8, ej, sstep(0.0, 0.6, fresh));
  }
  return v;
}
// Fresh-ejecta brightness around a crater (0..1): a soft bright halo plus thin ray streaks of
// random length with clumps along them (secondary craters). Angle noise uses (cos, sin) so rays
// are continuous all the way round.
float ejectaBright(float d, float ang, float fresh, float seedf) {
  if (d > 14.0 || fresh <= 0.0) return 0.0;
  vec2 cs = vec2(cos(ang), sin(ang));
  float halo = exp(-sq(max(d - 0.95, 0.0) / 0.45)) * (0.75 + 0.25 * sstep(1.0, 0.3, d));
  float r1 = pow(sat(snoise(vec3(cs * 7.0, seedf))), 2.5);
  float r2 = pow(sat(snoise(vec3(cs * 19.0, seedf + 3.7))), 3.0);
  float r3 = pow(sat(snoise(vec3(cs * 41.0, seedf + 8.1))), 3.0);
  float len = 5.0 + 8.0 * (0.5 + 0.5 * snoise(vec3(cs * 2.5, seedf + 1.3)));
  float rays = (r1 + 0.8 * r2 + 0.6 * r3) * sstep(len, 1.3, d) * sstep(0.9, 1.6, d);
  rays *= 0.55 + 0.45 * snoise(vec3(d * 1.3, cs * 9.0 + seedf));
  return fresh * max(halo * 0.85, rays * 1.1);
}
`;
})();
