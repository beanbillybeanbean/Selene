// Selene — live preview. Globe: ray-traced sphere shaded straight from the cube-sphere fields
// (no mesh, exact at any zoom). Map: the equirectangular layout you will export, per layer.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const FS = String.raw`
uniform sampler2DArray uAlb, uH, uEm;
uniform mat3 uRot;
uniform vec2 uRes;
uniform float uDist, uExag, uR, uHmin, uHmax, uHasEm, uLit, uZoom, uSea, uAmbient;
uniform vec2 uPan;
uniform vec3 uSun;
uniform int uView, uLayer;
out vec4 o;

vec3 camPos() { return vec3(0.0, 0.0, uDist); }
vec3 cameraDir() { return uRot * camPos(); }
float hAt(vec3 d) { return sampleDir(uH, d).r; }
vec3 albAt(vec3 d) { return srgbToLinear(sampleDir(uAlb, d).rgb); }
vec3 normalAt(vec3 d, float scale) {
  int N = textureSize(uH, 0).x;
  float da = texelAngle(N) * scale;
  vec3 e = eastOf(d), n = northOf(d);
  float gE = (hAt(normalize(d + e * da)) - hAt(normalize(d - e * da))) / (2.0 * da * uR);
  float gN = (hAt(normalize(d + n * da)) - hAt(normalize(d - n * da))) / (2.0 * da * uR);
  return normalize(d - (gE * e + gN * n) * uExag);
}
vec3 shade(vec3 d, float scale) {
  vec3 a = albAt(d);
  if (uLit < 0.5) return a;
  vec3 nn = normalAt(d, scale);
  float mu0 = max(dot(nn, uSun), 0.0);
  // Lambert blended with Lommel-Seeliger (regolith-like, flatter limb)
  float ls = mu0 / (mu0 + max(dot(nn, normalize(cameraDir())), 0.05));
  float l = mix(mu0, 2.0 * ls * max(dot(d, uSun) + 0.2, 0.0), 0.35);
  vec3 c = a * (l * 1.25 + uAmbient);
  if (uHasEm > 0.5) c += srgbToLinear(sampleDir(uEm, d).rgb) * 1.5;
  return c;
}
vec3 tonemap(vec3 c) { return linearToSrgb(c / (1.0 + 0.15 * c)); }

vec3 layerColor(vec3 d, float scale) {
  if (uLayer == 0) return albAt(d);
  if (uLayer == 1) return shade(d, scale);
  float h = hAt(d);
  if (uLayer == 2) { float t = (h - uHmin) / max(1.0, uHmax - uHmin); return vec3(t * t); }
  if (uLayer == 3) {
    float t = sat((h - uHmin) / max(1.0, uHmax - uHmin));
    vec3 c = mix(vec3(0.05, 0.1, 0.35), vec3(0.1, 0.45, 0.4), sstep(0.0, 0.3, t));
    c = mix(c, vec3(0.55, 0.5, 0.2), sstep(0.3, 0.6, t)); c = mix(c, vec3(0.55, 0.3, 0.15), sstep(0.6, 0.85, t)); c = mix(c, vec3(0.95), sstep(0.85, 1.0, t));
    vec3 nn = normalAt(d, scale);
    return c * (0.35 + 0.8 * max(dot(nn, normalize(vec3(-0.6, 0.6, 0.5))), 0.0));
  }
  if (uLayer == 4) { vec3 nn = normalAt(d, scale); vec3 e = eastOf(d), n = northOf(d); return srgbToLinear(vec3(dot(nn, e), dot(nn, n), dot(nn, d)) * 0.5 + 0.5); }
  return srgbToLinear(sampleDir(uEm, d).rgb);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  if (uView == 0) {
    vec2 ndc = (fc / uRes * 2.0 - 1.0) * vec2(uRes.x / uRes.y, 1.0);
    vec3 ro = camPos(), rd = normalize(vec3(ndc * 0.5, -1.0));
    float b = dot(ro, rd), c = dot(ro, ro) - 1.0, disc = b * b - c;
    if (disc < 0.0) { o = vec4(vec3(0.012, 0.014, 0.02), 1.0); return; }
    vec3 hit = ro + rd * (-b - sqrt(disc));
    vec3 d = normalize(uRot * hit);
    // pixel footprint in texels for the normal estimate (sharp when zoomed, smooth when far)
    int N = textureSize(uH, 0).x;
    float pixAng = (uDist - 1.0) / uRes.y / max(0.2, -dot(normalize(hit), rd));
    float scale = clamp(pixAng / texelAngle(N), 1.0, 8.0);
    vec3 col = uLayer == 1 ? shade(d, scale) : layerColor(d, scale);
    o = vec4(uLayer == 1 ? tonemap(col) : linearToSrgb(col), 1.0);
  } else {
    vec2 uv = (fc / uRes - 0.5) / uZoom + uPan + 0.5;
    if (uv.y < 0.0 || uv.y > 1.0) { o = vec4(vec3(0.012, 0.014, 0.02), 1.0); return; }
    float lon = fract(uv.x) * TAU - PI, lat = (uv.y - 0.5) * PI;
    vec3 d = latLonDir(lat, lon);
    vec3 col = layerColor(d, 1.0);
    o = vec4(uLayer == 1 ? tonemap(col) : linearToSrgb(col), 1.0);
  }
}`;

  class Preview {
    constructor(gpu) {
      this.gpu = gpu;
      this.view = 0; this.layer = 1;
      this.yaw = 0.6; this.pitch = 0.25; this.dist = 3.2; this.exag = 6; this.sunAz = -1.75; this.sunEl = 0.3;
      this.zoom = 1; this.pan = [0, 0]; this.spin = true; this.world = null;
      this.prog = gpu.program('preview', FS);
      this._bindInput(gpu.canvas);
      const loop = () => { this.frame(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      this.dirty = true;
    }
    setWorld(w) { this.world = w; this.dirty = true; }
    _bindInput(cv) {
      let drag = null;
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, pan: [...this.pan] }; cv.setPointerCapture(e.pointerId); this.spin = false; });
      cv.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = (e.clientX - drag.x) / cv.clientHeight, dy = (e.clientY - drag.y) / cv.clientHeight;
        if (this.view === 0) { const k = (this.dist - 1) * 0.9; this.yaw = drag.yaw - dx * k * 2; this.pitch = Math.max(-1.5, Math.min(1.5, drag.pitch + dy * k * 2)); }
        else { this.pan = [drag.pan[0] - dx / this.zoom * cv.clientHeight / cv.clientWidth, Math.max(-0.5, Math.min(0.5, drag.pan[1] + dy / this.zoom))]; }
        this.dirty = true;
      });
      cv.addEventListener('pointerup', () => { drag = null; });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const k = Math.exp(e.deltaY * 0.0012);
        if (this.view === 0) this.dist = 1 + Math.max(0.004, Math.min(8, (this.dist - 1) * k));
        else this.zoom = Math.max(1, Math.min(64, this.zoom / k));
        this.dirty = true;
      }, { passive: false });
    }
    frame() {
      const gpu = this.gpu, cv = gpu.canvas, gl = gpu.gl;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.dirty = true; }
      if (this.spin && this.view === 0 && this.world) { this.yaw += 0.0015; this.dirty = true; }
      if (!this.dirty || this.busy || gpu.lost) return;
      this.dirty = false;
      if (!this.world) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.clearColor(0.012, 0.014, 0.02, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
      const W = this.world;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(-this.pitch), sp = Math.sin(-this.pitch);
      // world = Ry(yaw) · Rx(-pitch) · camera   (row-major here, uploaded column-major)
      const R = [[cy, sy * sp, sy * cp], [0, cp, -sp], [-sy, cy * sp, cy * cp]];
      const rot = [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]];
      const sun = [Math.cos(this.sunEl) * Math.sin(this.sunAz), Math.sin(this.sunEl), Math.cos(this.sunEl) * Math.cos(this.sunAz)];
      // the sun is fixed relative to the camera so the terminator stays in view while you orbit
      const sw = [0, 1, 2].map((k) => R[k][0] * sun[0] + R[k][1] * sun[1] + R[k][2] * sun[2]);
      gpu.draw2D(this.prog, null, {
        uAlb: W.albedo, uH: W.H, uEm: W.emission || W.albedo, uHasEm: W.P.emissive ? 1 : 0,
        uRot: rot, uRes: [w, h], uDist: this.dist, uExag: this.exag, uR: W.R, uHmin: W.ctx.hmin, uHmax: W.ctx.hmax,
        uLit: 1, uZoom: this.zoom, uPan: this.pan, uSun: sw, uView: this.view, uLayer: this.layer, uSea: 0, uAmbient: 0.015,
      });
    }
  }
  S.Preview = Preview;
})();
