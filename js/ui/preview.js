// Selene — live preview. Globe: ray-traced sphere shaded straight from the cube-sphere fields
// (no mesh, exact at any zoom). Map: the equirectangular layout you will export, per layer.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const FS = String.raw`
uniform sampler2DArray uAlb, uH, uEm, uPaintL;
uniform float uShowPaint, uCurR; uniform vec3 uCurD;
uniform sampler2D uRef; uniform float uRefOn, uSplit;
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

vec3 refAt(vec3 d) {             // reference image is an equirectangular map (column 0 = 180°W, top = north)
  vec2 ll = dirLatLon(d);
  return srgbToLinear(texture(uRef, vec2(fract((ll.y + PI) / TAU), 0.5 - ll.x / PI)).rgb);
}
// paint-mode overlay: masks tinted red/green/blue, brush outline
vec3 overlay(vec3 c, vec3 d) {
  if (uShowPaint < 0.5) return c;
  vec4 pm = clamp(sampleDir(uPaintL, d), 0.0, 1.0);
  c = mix(c, vec3(1.0, 0.25, 0.2), pm.r * 0.45);
  c = mix(c, vec3(0.3, 1.0, 0.35), pm.g * 0.45);
  c = mix(c, vec3(0.3, 0.5, 1.0), pm.b * 0.45);
  if (uCurR > 0.0) { float a = gcDist(d, uCurD) / uCurR; c = mix(c, vec3(1.0, 0.85, 0.5), 0.9 * exp(-sq((a - 1.0) * 30.0))); }
  return c;
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
    if (uRefOn > 0.5 && fc.x > uSplit * uRes.x) {
      vec3 rc = refAt(d);
      if (uLayer == 1) { float mu = max(dot(d, uSun), 0.0); col = rc * (mu * 1.25 + uAmbient); } else col = rc;
    }
    if (uRefOn > 0.5 && abs(fc.x - uSplit * uRes.x) < 1.5) { o = vec4(1.0, 0.8, 0.45, 1.0); return; }
    o = vec4(overlay(uLayer == 1 ? tonemap(col) : linearToSrgb(col), d), 1.0);
  } else {
    float sc = min(uRes.x * 0.5, uRes.y);              // keep the map 2:1 whatever the panel shape
    vec2 uv = vec2((fc.x - 0.5 * uRes.x) / (2.0 * sc), (fc.y - 0.5 * uRes.y) / sc) / uZoom + uPan + 0.5;
    if (uv.y < 0.0 || uv.y > 1.0) { o = vec4(vec3(0.012, 0.014, 0.02), 1.0); return; }
    float lon = fract(uv.x) * TAU - PI, lat = (uv.y - 0.5) * PI;
    vec3 d = latLonDir(lat, lon);
    vec3 col = layerColor(d, 1.0);
    if (uRefOn > 0.5 && fc.x > uSplit * uRes.x) col = refAt(d);
    if (uRefOn > 0.5 && abs(fc.x - uSplit * uRes.x) < 1.5) { o = vec4(1.0, 0.8, 0.45, 1.0); return; }
    o = vec4(overlay(uLayer == 1 ? tonemap(col) : linearToSrgb(col), d), 1.0);
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
    setReference(img) {
      const gl = this.gpu.gl;
      if (this.refTex) { gl.deleteTexture(this.refTex); this.refTex = null; }
      if (img) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.refTex = t;
      }
      this.dirty = true;
    }
    _bindInput(cv) {
      let drag = null;
      let tooling = false;
      cv.addEventListener('contextmenu', (e) => { if (this.tool) e.preventDefault(); });
      cv.addEventListener('pointerdown', (e) => {
        this.spin = false;
        cv.setPointerCapture(e.pointerId);
        if (this.tool && e.button === 0 && !e.shiftKey) { tooling = true; this.tool.down(this.pick(e.clientX, e.clientY), e); return; }
        if (this.refTex) {                      // grabbing the split line moves it
          const r = cv.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width;
          if (Math.abs(sx - (this.split ?? 0.5)) < 0.015) { this.splitDrag = true; return; }
        }
        drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, pan: [...this.pan] };
      });
      cv.addEventListener('pointermove', (e) => {
        if (this.tool) { const d = this.pick(e.clientX, e.clientY); this.cursor = d; this.dirty = true; if (tooling) this.tool.move(d, e); }
        if (this.splitDrag) { const r = cv.getBoundingClientRect(); this.split = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)); this.dirty = true; return; }
        if (!drag) return;
        const dx = (e.clientX - drag.x) / cv.clientHeight, dy = (e.clientY - drag.y) / cv.clientHeight;
        if (this.view === 0) { const k = (this.dist - 1) * 0.9; this.yaw = drag.yaw - dx * k * 2; this.pitch = Math.max(-1.5, Math.min(1.5, drag.pitch + dy * k * 2)); }
        else { this.pan = [drag.pan[0] - dx / this.zoom * cv.clientHeight / cv.clientWidth, Math.max(-0.5, Math.min(0.5, drag.pan[1] + dy / this.zoom))]; }
        this.dirty = true;
      });
      cv.addEventListener('pointerup', (e) => { if (tooling) { tooling = false; this.tool.up(this.pick(e.clientX, e.clientY), e); } drag = null; this.splitDrag = false; });
      cv.addEventListener('pointerleave', () => { if (this.tool) { this.cursor = null; this.dirty = true; } });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const k = Math.exp(e.deltaY * 0.0012);
        if (this.view === 0) this.dist = 1 + Math.max(0.004, Math.min(8, (this.dist - 1) * k));
        else this.zoom = Math.max(1, Math.min(64, this.zoom / k));
        this.dirty = true;
      }, { passive: false });
    }
    // screen point -> unit direction on the planet (or null)
    pick(cx, cy) {
      const cv = this.gpu.canvas, r = cv.getBoundingClientRect();
      if (!this.res || !this.R3) return null;
      const [w, h] = this.res;
      const fx = (cx - r.left) / r.width * w, fy = (1 - (cy - r.top) / r.height) * h;
      let d;
      if (this.view === 0) {
        const nx = (fx / w * 2 - 1) * (w / h), ny = fy / h * 2 - 1;
        let rd = [nx * 0.5, ny * 0.5, -1]; const l = Math.hypot(...rd); rd = rd.map((x) => x / l);
        const ro = [0, 0, this.dist];
        const b = ro[2] * rd[2], c = ro[2] * ro[2] - 1, disc = b * b - c;
        if (disc < 0) return null;
        const t = -b - Math.sqrt(disc), hit = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
        const R = this.R3;
        d = [0, 1, 2].map((i) => R[i][0] * hit[0] + R[i][1] * hit[1] + R[i][2] * hit[2]);
      } else {
        const sc = Math.min(w * 0.5, h);
        const u = (fx - 0.5 * w) / (2 * sc) / this.zoom + this.pan[0] + 0.5, v = (fy - 0.5 * h) / sc / this.zoom + this.pan[1] + 0.5;
        if (v < 0 || v > 1) return null;
        const lon = (u - Math.floor(u)) * 2 * Math.PI - Math.PI, lat = (v - 0.5) * Math.PI;
        d = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
      }
      const l = Math.hypot(...d); return d.map((x) => x / l);
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
      this.R3 = R; this.res = [w, h];
      const sun = [Math.cos(this.sunEl) * Math.sin(this.sunAz), Math.sin(this.sunEl), Math.cos(this.sunEl) * Math.cos(this.sunAz)];
      // the sun is fixed relative to the camera so the terminator stays in view while you orbit
      const sw = [0, 1, 2].map((k) => R[k][0] * sun[0] + R[k][1] * sun[1] + R[k][2] * sun[2]);
      gpu.draw2D(this.prog, null, {
        uAlb: W.albedo, uH: W.H, uEm: W.emission || W.albedo, uHasEm: W.P.emissive ? 1 : 0,
        uRot: rot, uRes: [w, h], uDist: this.dist, uExag: this.exag, uR: W.R, uHmin: W.ctx.hmin, uHmax: W.ctx.hmax,
        uPaintL: W.paint || W.albedo, uShowPaint: this.tool && W.paint ? 1 : 0, uCurD: this.cursor || [0, 1, 0], uCurR: this.tool && this.cursor ? this.tool.radius() : 0,
        uRef: this.refTex || undefined, uRefOn: this.refTex ? 1 : 0, uSplit: this.split ?? 0.5,
        uLit: 1, uZoom: this.zoom, uPan: this.pan, uSun: sw, uView: this.view, uLayer: this.layer, uSea: 0, uAmbient: 0.015,
      });
    }
  }
  S.Preview = Preview;
})();
