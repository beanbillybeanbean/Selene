// Selene — export: cube-sphere -> equirectangular maps, rendered in tiles (any width up to 16K,
// independent of the GPU's texture size limit) and streamed straight into PNG encoders, so even
// 16384×8192 maps never need the whole image in memory. Also: ZIP bundling.
// Map modes: 0 height, 1 colour/emission, 2 normal, 3 roughness, 4 ambient occlusion, 5 clouds,
//            6 night lights.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const EQ = String.raw`//#include planet
uniform sampler2DArray uSrc, uHt, uMat;
uniform int uW, uHH, uX0, uY0, uMode;
uniform float uLon0, uR, uNormalK, uSea, uFlatSea, uEmissive, uAoK, uCloudCover, uCloudScale, uLights, uSeed, uHmin, uHmax;
out vec4 o;
float hAt(vec3 d) { float h = sampleDirCubic(uHt, d); return uFlatSea > 0.5 ? max(h, uSea) : h; }
void main() {
  float lon = (float(uX0) + gl_FragCoord.x) / float(uW) * TAU - PI + uLon0;
  float row = float(uY0) + gl_FragCoord.y;
  float lat = PI * 0.5 - row / float(uHH) * PI;
  vec3 d = latLonDir(lat, lon);
  if (uMode == 0) { o = vec4(sampleDirCubic(uHt, d)); return; }
  if (uMode == 1) { o = sampleDir(uSrc, d); return; }
  float dlat = PI / float(uHH), dlon = TAU / float(uW);
  float de = max(dlon * cos(lat), dlat * 0.5);
  vec3 e = eastOf(d), n = northOf(d);
  if (uMode == 2) {        // tangent-space normal (x = east, y = north, OpenGL convention)
    float hE = hAt(normalize(d + e * de)), hW = hAt(normalize(d - e * de));
    float hN = hAt(normalize(d + n * dlat)), hS = hAt(normalize(d - n * dlat));
    vec2 g = vec2((hE - hW) / (2.0 * de * uR), (hN - hS) / (2.0 * dlat * uR));
    o = vec4(normalize(vec3(-g * uNormalK, 1.0)) * 0.5 + 0.5, 1.0); return;
  }
  if (uMode == 3) {        // roughness: rock rough, ice/frost smoother, liquid water and molten lava glossy
    vec4 alb = sampleDir(uSrc, d);
    vec4 m = sampleDir(uMat, d);
    float r = 0.9 - 0.08 * luma(alb.rgb);
    if (uEmissive > 0.5) r = mix(r, 0.35, sat(m.a)); else r = mix(r, 0.55, sat(m.a));
    r = mix(r, 0.07, alb.a);                          // oceans (terran water mask)
    o = vec4(r); return;
  }
  if (uMode == 4) {        // ambient occlusion: how much the surrounding terrain rises above this point
    float h = hAt(d), occ = 0.0, wsum = 0.0;
    float r0 = max(dlat, texelAngle(textureSize(uHt, 0).x));
    for (int k = 0; k < L(6); k++) {
      float r = r0 * pow(2.0, float(k));
      float ring = 0.0;
      for (int j = 0; j < L(8); j++) {
        float a = float(j) * 0.785398 + float(k) * 0.4;
        vec3 q = normalize(d + (e * cos(a) + n * sin(a)) * r);
        ring += atan(max(0.0, hAt(q) - h) * uAoK * 12.0 / (r * uR));
      }
      float w = 1.0 / (1.0 + float(k));
      occ += ring / 8.0 * w; wsum += w;
    }
    o = vec4(1.0 - sat(occ / wsum * 1.6)); return;
  }
  if (uMode == 5) {        // cloud layer: large swirls stretched into zonal bands, cellular fine texture
    vec3 so = seedOff(uSeed + 61.0);
    vec3 zq = d - e * dot(d, e) * 0.55;                 // east-west stretch (winds are zonal)
    vec3 q = zq * uCloudScale + so;
    q += 0.9 * warpVec(q * 0.45, 3);                                        // large swirls
    float c = fbm(q, 6, 2.0, 0.5);
    float band = cos(lat * 6.0) * 0.12 + cos(lat * 2.0) * 0.05;          // ITCZ / subtropical / storm belts
    c += band;
    float t = 0.28 - uCloudCover * 0.56;
    float cov = sstep(t - 0.12, t + 0.2, c + 0.08 * fbm(q * 5.0, 4));
    Cell cc = cellular(q * 6.0, 23u);                                     // cumulus / cell texture
    cov *= 0.8 + 0.2 * sstep(0.1, 0.55, cc.f2 - cc.f1);
    cov = sat(cov * (0.85 + 0.3 * fbm(q * 3.0 + 7.0, 3)));
    o = vec4(vec3(cov), cov); return;
  }
  // mode 6: night lights — clustered settlements on habitable lowland, densest along coasts
  vec4 alb = sampleDir(uSrc, d);
  float h = hAt(d);
  float land = uSea > -1e8 ? step(uSea, h) * (1.0 - alb.a) : 1.0;
  float lowland = sstep(3000.0, 200.0, h - max(uSea, uHmin));
  float coast = uSea > -1e8 ? sstep(1500.0, 20.0, h - uSea) : 0.5;
  float temperate = sstep(75.0, 55.0, abs(degrees(lat)));
  float suit = land * lowland * temperate * (0.35 + 0.65 * coast) * (1.0 - sstep(0.75, 0.95, luma(alb.rgb)));
  vec3 so = seedOff(uSeed + 77.0);
  Cell cc = cellular(d * (uR / 150000.0) + so, 88u);
  float city = exp(-sq(cc.f1 / (0.08 + 0.18 * pow(cc.id, 3.0)))) * step(1.0 - uLights, cc.id * 0.7 + 0.3 * fbm(d * 4.0 + so, 3) + 0.2);
  Cell tc = cellular(d * (uR / 30000.0) - so, 89u);
  float town = exp(-sq(tc.f1 / 0.12)) * step(0.55, tc.id + 0.35 * uLights);
  float spark = sstep(0.55, 0.9, snoise(d * (uR / 6000.0) + so));
  float lum = suit * (1.4 * city + 0.6 * town + 0.12 * spark * uLights);
  vec3 col = mix(vec3(1.0, 0.62, 0.25), vec3(1.0, 0.86, 0.6), sat(lum - 0.6));
  o = vec4(linearToSrgb(col * sat(lum)), 1.0);
}`;

  const MODES = { height: 0, albedo: 1, emission: 1, normal: 2, roughness: 3, ao: 4, clouds: 5, lights: 6 };

  // Render rows [y0, y0+h) of a map, tiling horizontally. Returns Float32Array (height) or Uint8Array RGBA.
  function renderRows(world, layer, W, Hh, y0, h, opts, cache) {
    const gpu = world.ctx.gpu, mode = MODES[layer];
    const prog = gpu.program('export.eq', EQ);
    const float = mode === 0;
    const TW = Math.min(W, 4096, gpu.maxTex);
    if (!cache.tex || cache.tex.w !== TW || cache.tex.h < h || cache.float !== float) {
      if (cache.tex) gpu.free2D(cache.tex);
      cache.tex = gpu.tex2D(TW, h, float ? 'rgba32f' : 'rgba8'); cache.float = float;
    }
    const out = float ? new Float32Array(W * h) : new Uint8Array(W * h * 4);
    const U = {
      uSrc: layer === 'emission' ? world.emission : world.albedo, uHt: world.H, uMat: world.M || world.H, uW: W, uHH: Hh, uMode: mode,
      uLon0: (opts.lonShift || 0) * Math.PI / 180, uR: world.R, uNormalK: opts.normalStrength ?? 1, uSea: world.P.ocean ? 0 : -1e9,
      uFlatSea: opts.flatSea ? 1 : 0, uEmissive: world.P.emissive ? 1 : 0, uAoK: opts.aoStrength ?? 1, uCloudCover: opts.cloudCover ?? 0.5,
      uCloudScale: opts.cloudScale ?? 4, uLights: opts.lights ?? 0.5, uSeed: (world.ctx.seed % 997) + 0.5, uHmin: world.ctx.hmin, uHmax: world.ctx.hmax, uY0: y0,
    };
    for (let x0 = 0; x0 < W; x0 += TW) {
      const tw = Math.min(TW, W - x0);
      gpu.draw2D(prog, cache.tex, { ...U, uX0: x0 });
      const px = gpu.read2D(cache.tex, 0, 0, tw, h);
      for (let y = 0; y < h; y++) {
        if (float) for (let x = 0; x < tw; x++) out[y * W + x0 + x] = px[(y * tw + x) * 4];
        else out.set(px.subarray(y * tw * 4, (y + 1) * tw * 4), (y * W + x0) * 4);
      }
    }
    return out;
  }
  function stripRows(W) { return Math.max(1, Math.min(512, Math.floor(4e6 / W))); }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // Whole map in memory (fine up to ~8K; used by tests and small exports)
  async function equirect(world, layer, W, Hh, opts = {}, progress = () => {}) {
    const cache = {}, sh = stripRows(W), float = layer === 'height';
    const out = float ? new Float32Array(W * Hh) : new Uint8Array(W * Hh * 4);
    for (let y0 = 0; y0 < Hh; y0 += sh) {
      const h = Math.min(sh, Hh - y0);
      out.set(renderRows(world, layer, W, Hh, y0, h, opts, cache), y0 * W * (float ? 1 : 4));
      progress((y0 + h) / Hh); await tick();
    }
    if (cache.tex) world.ctx.gpu.free2D(cache.tex);
    return out;
  }
  // Stream a map strip by strip into consumers: each consumer gets (rows, y0, h)
  async function streamMap(world, layer, W, Hh, opts, consumers, progress = () => {}) {
    const cache = {}, sh = stripRows(W);
    for (let y0 = 0; y0 < Hh; y0 += sh) {
      const h = Math.min(sh, Hh - y0);
      const rows = renderRows(world, layer, W, Hh, y0, h, opts, cache);
      for (const c of consumers) await c(rows, y0, h);
      progress((y0 + h) / Hh); await tick();
    }
    if (cache.tex) world.ctx.gpu.free2D(cache.tex);
  }

  // ------------------------------------------------------------------ PNG (streaming)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(buf, crc = 0xffffffff) { for (let i = 0; i < buf.length; i++) crc = CRC[(crc ^ buf[i]) & 255] ^ (crc >>> 8); return crc; }
  function chunkHead(type, len) { const b = new Uint8Array(8), dv = new DataView(b.buffer); dv.setUint32(0, len); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i); return b; }
  function chunk(type, data) {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    dv.setUint32(8 + data.length, (crc32(b.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
    return b;
  }
  // Rows go in top-down as Uint8Array (8-bit) or Uint16Array (16-bit) with `channels` interleaved.
  class PNGStream {
    constructor(w, h, channels, bits = 8) {
      this.w = w; this.h = h; this.ch = channels; this.bits = bits;
      this.bpp = channels * (bits / 8); this.stride = w * this.bpp;
      this.prev = new Uint8Array(this.stride); this.first = true;
      this.cs = new CompressionStream('deflate');
      this.writer = this.cs.writable.getWriter();
      this.parts = [];
      const rd = this.cs.readable.getReader();
      this.done = (async () => { for (;;) { const { value, done } = await rd.read(); if (done) break; this.parts.push(value); } })();
    }
    async addRows(pixels, nrows) {
      const { stride, bpp } = this;
      const src = this.bits === 16 ? new Uint8Array(pixels.length * 2) : pixels;
      if (this.bits === 16) for (let i = 0; i < pixels.length; i++) { src[i * 2] = pixels[i] >> 8; src[i * 2 + 1] = pixels[i] & 255; }
      const raw = new Uint8Array((stride + 1) * nrows);
      for (let y = 0; y < nrows; y++) {
        const o = y * (stride + 1), r = y * stride;
        const prev = y === 0 ? this.prev : src.subarray(r - stride, r);
        const up = !(this.first && y === 0);
        raw[o] = 4; // Paeth
        for (let x = 0; x < stride; x++) {
          const a = x >= bpp ? src[r + x - bpp] : 0, b = up ? prev[x] : 0, c = x >= bpp && up ? prev[x - bpp] : 0;
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          raw[o + 1 + x] = (src[r + x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
      }
      this.prev = src.slice((nrows - 1) * stride, nrows * stride);
      this.first = false;
      await this.writer.write(raw);
    }
    async finish() {
      await this.writer.close();
      await this.done;
      const len = this.parts.reduce((s, p) => s + p.length, 0);
      const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
      dv.setUint32(0, this.w); dv.setUint32(4, this.h); ihdr[8] = this.bits; ihdr[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[this.ch];
      // IDAT CRC over the streamed parts
      let crc = crc32(new TextEncoder().encode('IDAT'));
      for (const p of this.parts) crc = crc32(p, crc);
      const tail = new Uint8Array(4); new DataView(tail.buffer).setUint32(0, (crc ^ 0xffffffff) >>> 0);
      const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      return new Blob([sig, chunk('IHDR', ihdr), chunkHead('IDAT', len), ...this.parts, tail, chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
    }
  }
  async function encodePNG(pixels, w, h, channels, bits = 8) {
    const s = new PNGStream(w, h, channels, bits);
    await s.addRows(pixels, h);
    return s.finish();
  }

  // ------------------------------------------------------------------ ZIP (stored; CRC computed in slices)
  async function blobCRC(blob) {
    let crc = 0xffffffff;
    for (let o = 0; o < blob.size; o += 16 << 20) crc = crc32(new Uint8Array(await blob.slice(o, o + (16 << 20)).arrayBuffer()), crc);
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function makeZip(files) { // files: [{name, blob}]
    const parts = [], central = []; let offset = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      const size = f.blob.size, name = enc.encode(f.name), crc = await blobCRC(f.blob);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.blob);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ------------------------------------------------------------------ conversions
  function heightTo16(hf, mn, mx) {
    const out = new Uint16Array(hf.length), s = 65535 / Math.max(1e-6, mx - mn);
    for (let i = 0; i < hf.length; i++) out[i] = Math.max(0, Math.min(65535, Math.round((hf[i] - mn) * s)));
    return out;
  }
  // 8-bit with triangular dither: breaks up terracing when Kopernicus interpolates the map
  let dseed = 12345;
  function heightTo8(hf, mn, mx, dither = true) {
    const out = new Uint8Array(hf.length), s = 255 / Math.max(1e-6, mx - mn);
    const r = () => { dseed = (Math.imul(dseed, 1664525) + 1013904223) >>> 0; return dseed / 4294967296; };
    for (let i = 0; i < hf.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((hf[i] - mn) * s + (dither ? r() - r() : 0))));
    return out;
  }
  function rgbaToRGB(rgba) { const n = rgba.length / 4, o = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { o[i * 3] = rgba[i * 4]; o[i * 3 + 1] = rgba[i * 4 + 1]; o[i * 3 + 2] = rgba[i * 4 + 2]; } return o; }
  function channel(rgba, c) { const n = rgba.length / 4, o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = rgba[i * 4 + c]; return o; }
  function minMax(a) { let mn = Infinity, mx = -Infinity; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; } return { min: mn, max: mx }; }

  S.Export = { equirect, streamMap, PNGStream, encodePNG, makeZip, heightTo16, heightTo8, rgbaToRGB, channel, minMax };
})();
