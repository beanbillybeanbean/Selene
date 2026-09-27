// Selene — GLSL library shared by every shader: cube-sphere addressing, cross-face neighbour
// fetches, bilinear/bicubic sampling by direction, seeded noise (simplex, fBm, ridged, cellular).
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const header = `
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2D;
uniform int uFace;
uniform int uN;
`;

  const lib = String.raw`
const float PI = 3.14159265358979;
const float TAU = 6.28318530717959;
const float QPI = 0.785398163397448;

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 sat3(vec3 x) { return clamp(x, 0.0, 1.0); }
float sstep(float a, float b, float x) { return smoothstep(a, b, x); }
float lin(float a, float b, float x) { return sat((x - a) / (b - a)); }

// ---------------------------------------------------------------- cube-sphere addressing
// Face order: +X, -X, +Y, -Y, +Z, -Z. Equi-angular (EAC) mapping inside each face.
void faceBasis(int f, out vec3 n, out vec3 u, out vec3 v) {
  if (f == 0)      { n = vec3( 1, 0, 0); u = vec3(0, 0,-1); v = vec3(0, 1, 0); }
  else if (f == 1) { n = vec3(-1, 0, 0); u = vec3(0, 0, 1); v = vec3(0, 1, 0); }
  else if (f == 2) { n = vec3( 0, 1, 0); u = vec3(1, 0, 0); v = vec3(0, 0,-1); }
  else if (f == 3) { n = vec3( 0,-1, 0); u = vec3(1, 0, 0); v = vec3(0, 0, 1); }
  else if (f == 4) { n = vec3( 0, 0, 1); u = vec3(1, 0, 0); v = vec3(0, 1, 0); }
  else             { n = vec3( 0, 0,-1); u = vec3(-1,0, 0); v = vec3(0, 1, 0); }
}
// xy: continuous texel coordinate on face f of an N-texel face (texel centre = i + 0.5)
vec3 texelDir(int f, vec2 xy, int N) {
  vec3 n, u, v; faceBasis(f, n, u, v);
  vec2 s = xy / float(N) * 2.0 - 1.0;
  vec2 a = tan(QPI * s);
  return normalize(n + a.x * u + a.y * v);
}
int dirFace(vec3 d) {
  vec3 a = abs(d);
  if (a.x >= a.y && a.x >= a.z) return d.x > 0.0 ? 0 : 1;
  if (a.y >= a.z) return d.y > 0.0 ? 2 : 3;
  return d.z > 0.0 ? 4 : 5;
}
vec2 dirToXY(vec3 d, int f, int N) {
  vec3 n, u, v; faceBasis(f, n, u, v);
  float dn = dot(d, n);
  vec2 a = vec2(dot(d, u), dot(d, v)) / dn;
  vec2 s = atan(a) / QPI;
  return (s * 0.5 + 0.5) * float(N);
}
// integer texel (possibly off the face) -> real texel on the correct face
ivec3 wrapTexel(int f, ivec2 p, int N) {
  if (p.x >= 0 && p.y >= 0 && p.x < N && p.y < N) return ivec3(p, f);
  vec3 d = texelDir(f, vec2(p) + 0.5, N);
  int g = dirFace(d);
  ivec2 q = clamp(ivec2(floor(dirToXY(d, g, N))), ivec2(0), ivec2(N - 1));
  return ivec3(q, g);
}
// solid-angle-ish size of a texel edge (radians) near direction d for an N face (EAC is close to uniform)
float texelAngle(int N) { return (PI * 0.5) / float(N); }

const ivec2 N8[8] = ivec2[8](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1), ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1));
float sq(float x) { return x * x; }

#ifdef FRAG
ivec2 cellXY() { return ivec2(gl_FragCoord.xy); }
vec3 cellDir() { return texelDir(uFace, gl_FragCoord.xy, uN); }
vec4 at(sampler2DArray t) { return texelFetch(t, ivec3(ivec2(gl_FragCoord.xy), uFace), 0); }
vec4 nb(sampler2DArray t, ivec2 o) { return texelFetch(t, wrapTexel(uFace, ivec2(gl_FragCoord.xy) + o, uN), 0); }
#endif

vec4 sampleDir(sampler2DArray t, vec3 d) {
  int N = textureSize(t, 0).x;
  int f = dirFace(d);
  vec2 xy = dirToXY(d, f, N) - 0.5;
  vec2 fl = floor(xy), fr = xy - fl;
  ivec2 p = ivec2(fl);
  vec4 a = texelFetch(t, wrapTexel(f, p, N), 0);
  vec4 b = texelFetch(t, wrapTexel(f, p + ivec2(1, 0), N), 0);
  vec4 c = texelFetch(t, wrapTexel(f, p + ivec2(0, 1), N), 0);
  vec4 e = texelFetch(t, wrapTexel(f, p + ivec2(1, 1), N), 0);
  return mix(mix(a, b, fr.x), mix(c, e, fr.x), fr.y);
}
vec4 crW(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
// Catmull-Rom bicubic sample of the red channel (keeps upsampled terrain crisp without creases)
float sampleDirCubic(sampler2DArray t, vec3 d) {
  int N = textureSize(t, 0).x;
  int f = dirFace(d);
  vec2 xy = dirToXY(d, f, N) - 0.5;
  vec2 fl = floor(xy), fr = xy - fl;
  ivec2 p = ivec2(fl);
  vec4 wx = crW(fr.x), wy = crW(fr.y);
  float s = 0.0;
  for (int j = 0; j < 4; j++) {
    float row = 0.0;
    for (int i = 0; i < 4; i++) row += wx[i] * texelFetch(t, wrapTexel(f, p + ivec2(i - 1, j - 1), N), 0).r;
    s += wy[j] * row;
  }
  return s;
}

// ---------------------------------------------------------------- tangent frame / lat-lon
vec3 eastOf(vec3 p) { vec3 e = vec3(p.z, 0.0, -p.x); float l = length(e); return l < 1e-6 ? vec3(0, 0, -1) : e / l; }
vec3 northOf(vec3 p) { return normalize(cross(p, eastOf(p))); }
vec2 dirLatLon(vec3 d) { return vec2(asin(clamp(d.y, -1.0, 1.0)), atan(-d.z, d.x)); }
vec3 latLonDir(float lat, float lon) { return vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon)); }
// rotate p about unit axis k by angle a
vec3 rotAxis(vec3 p, vec3 k, float a) { float c = cos(a), s = sin(a); return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c); }
float gcDist(vec3 a, vec3 b) { return acos(clamp(dot(a, b), -1.0, 1.0)); }

// ---------------------------------------------------------------- hashing
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash33(ivec3 c, uint seed) { return vec3(pcg3d(uvec3(c) ^ uvec3(seed, seed * 7919u, seed * 104729u))) * (1.0 / 4294967295.0); }
float hash13(ivec3 c, uint seed) { return hash33(c, seed).x; }
float hash11(uint x) { return float(pcg3d(uvec3(x, x * 3u + 1u, 17u)).x) * (1.0 / 4294967295.0); }

// ---------------------------------------------------------------- simplex noise (Ashima / McEwan)
vec4 _perm(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec3 v) {
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
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

// seeded offset so different seeds give unrelated noise (kept small for float precision)
vec3 seedOff(float s) { return vec3(fract(sin(s * 12.9898) * 43758.5453), fract(sin(s * 78.233) * 43758.5453), fract(sin(s * 37.719) * 43758.5453)) * 200.0 - 100.0; }

float fbm(vec3 p, int oct, float lac, float gain) {
  float a = 1.0, s = 0.0, n = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= oct) break;
    s += a * snoise(p); n += a; a *= gain;
    p = ROT * p * lac + vec3(1.7, 9.2, -3.1);
  }
  return s / n;
}
float fbm(vec3 p, int oct) { return fbm(p, oct, 2.0, 0.5); }
// Musgrave ridged multifractal: sharp crests, smooth valleys; heterogeneity via weight feedback
float ridged(vec3 p, int oct, float lac, float gain) {
  float sum = 0.0, amp = 1.0, w = 1.0, norm = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(snoise(p));
    n *= n; n *= w;
    w = sat(n * 2.0);
    sum += n * amp; norm += amp; amp *= gain;
    p = ROT * p * lac + vec3(-4.1, 2.3, 7.7);
  }
  return sum / norm;
}
float ridged(vec3 p, int oct) { return ridged(p, oct, 2.0, 0.5); }
// domain-warped fBm (organic, elongated shapes)
float warped(vec3 p, int oct, float w) {
  vec3 q = vec3(fbm(p + vec3(1.7, 9.2, 5.1), 4), fbm(p + vec3(8.3, 2.8, -3.3), 4), fbm(p + vec3(-4.4, 6.6, 1.1), 4));
  return fbm(p + w * q, oct);
}
vec3 warpVec(vec3 p, int oct) {
  return vec3(fbm(p + vec3(1.7, 9.2, 5.1), oct), fbm(p + vec3(8.3, 2.8, -3.3), oct), fbm(p + vec3(-4.4, 6.6, 1.1), oct));
}
// cellular noise: x = F1, y = F2 distance, z = hash of nearest cell
vec3 worley(vec3 p, uint seed) {
  ivec3 c = ivec3(floor(p));
  float f1 = 9.0, f2 = 9.0, id = 0.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec3 q = c + ivec3(i, j, k);
    vec3 h = hash33(q, seed);
    float d = length(vec3(q) + h - p);
    if (d < f1) { f2 = f1; f1 = d; id = hash13(q, seed + 77u); } else if (d < f2) f2 = d;
  }
  return vec3(f1, f2, id);
}

// ---------------------------------------------------------------- colour
vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

  S.GLSL = { header, lib };
})();
