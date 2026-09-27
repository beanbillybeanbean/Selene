// Selene — export: cube-sphere -> equirectangular maps (rendered in strips so 8K maps fit in GPU
// memory), PNG (8/16-bit) encoding and ZIP bundling.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const EQ = String.raw`
uniform sampler2DArray uSrc, uHt;
uniform int uW, uHH, uY0, uMode;
uniform float uLon0, uR, uNormalK, uSea, uFlatSea;
out vec4 o;
float hAt(vec3 d) { float h = sampleDirCubic(uHt, d); return uFlatSea > 0.5 ? max(h, uSea) : h; }
void main() {
  float lon = gl_FragCoord.x / float(uW) * TAU - PI + uLon0;
  float row = float(uY0) + gl_FragCoord.y;
  float lat = PI * 0.5 - row / float(uHH) * PI;
  vec3 d = latLonDir(lat, lon);
  if (uMode == 0) { o = vec4(sampleDirCubic(uHt, d)); return; }
  if (uMode == 1) { o = sampleDir(uSrc, d); return; }
  // tangent-space normal (x = east, y = north, OpenGL convention)
  float dlat = PI / float(uHH), dlon = TAU / float(uW);
  float de = max(dlon * cos(lat), dlat * 0.5);
  vec3 e = eastOf(d), n = northOf(d);
  float hE = hAt(normalize(d + e * de)), hW = hAt(normalize(d - e * de));
  float hN = hAt(normalize(d + n * dlat)), hS = hAt(normalize(d - n * dlat));
  vec2 g = vec2((hE - hW) / (2.0 * de * uR), (hN - hS) / (2.0 * dlat * uR));
  vec3 nn = normalize(vec3(-g * uNormalK, 1.0));
  o = vec4(nn * 0.5 + 0.5, 1.0);
}`;

  // Render a layer of `world` to an equirectangular W×H array.
  // layer: 'height' -> Float32Array(W*H) metres; 'albedo' -> Uint8Array RGBA; 'normal' -> Uint8Array RGBA
  async function equirect(world, layer, W, Hh, opts = {}, progress = () => {}) {
    const gpu = world.ctx.gpu;
    const prog = gpu.program('export.eq', EQ);
    const mode = layer === 'height' ? 0 : layer === 'albedo' || layer === 'emission' ? 1 : 2;
    const fmt = mode === 1 || mode === 2 ? 'rgba8' : 'rgba32f';
    const stripH = Math.max(1, Math.min(Hh, Math.floor(2e6 / W)));
    const strip = gpu.tex2D(W, stripH, fmt);
    const out = mode === 0 ? new Float32Array(W * Hh) : new Uint8Array(W * Hh * 4);
    const U = {
      uSrc: layer === 'emission' ? world.emission : world.albedo, uHt: world.H, uW: W, uHH: Hh, uMode: mode, uLon0: (opts.lonShift || 0) * Math.PI / 180, uR: world.R,
      uNormalK: opts.normalStrength ?? 1, uSea: world.P.ocean ? 0 : -1e9, uFlatSea: opts.flatSea ? 1 : 0,
    };
    for (let y0 = 0; y0 < Hh; y0 += stripH) {
      const h = Math.min(stripH, Hh - y0);
      gpu.draw2D(prog, strip, { ...U, uY0: y0 });
      const px = gpu.read2D(strip, 0, 0, W, h);
      if (mode === 0) for (let i = 0, n = W * h; i < n; i++) out[y0 * W + i] = px[i * 4];
      else out.set(px.subarray(0, W * h * 4), y0 * W * 4);
      progress(Math.min(1, (y0 + h) / Hh));
      await new Promise((r) => setTimeout(r, 0));
    }
    gpu.free2D(strip);
    return out;
  }

  // ------------------------------------------------------------------ PNG
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(buf, crc = 0xffffffff) { for (let i = 0; i < buf.length; i++) crc = CRC[(crc ^ buf[i]) & 255] ^ (crc >>> 8); return crc; }
  async function deflate(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  function chunk(type, data) {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    dv.setUint32(8 + data.length, (crc32(b.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
    return b;
  }
  // pixels: Uint8Array (8-bit) or Uint16Array (16-bit), `channels` interleaved, rows top-down
  async function encodePNG(pixels, w, h, channels, bits = 8) {
    const colorType = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
    const bpp = channels * (bits / 8), stride = w * bpp;
    const raw = new Uint8Array((stride + 1) * h);
    const src = bits === 16 ? new Uint8Array(pixels.length * 2) : pixels;
    if (bits === 16) for (let i = 0; i < pixels.length; i++) { src[i * 2] = pixels[i] >> 8; src[i * 2 + 1] = pixels[i] & 255; }
    for (let y = 0; y < h; y++) {
      const o = y * (stride + 1), r = y * stride, pr = r - stride;
      raw[o] = 4; // Paeth
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? src[r + x - bpp] : 0, b = y > 0 ? src[pr + x] : 0, c = x >= bpp && y > 0 ? src[pr + x - bpp] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        raw[o + 1 + x] = (src[r + x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = bits; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const idat = await deflate(raw);
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    return new Blob([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
  }

  // ------------------------------------------------------------------ ZIP (stored; the images are already compressed)
  async function makeZip(files) { // files: [{name, blob}]
    const parts = [], central = []; let offset = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const name = enc.encode(f.name), crc = (crc32(data) ^ 0xffffffff) >>> 0;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
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
  function heightTo8(hf, mn, mx, dither = true) {
    const out = new Uint8Array(hf.length), s = 255 / Math.max(1e-6, mx - mn);
    let seed = 12345;
    const r = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < hf.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((hf[i] - mn) * s + (dither ? r() - r() : 0))));
    return out;
  }
  function rgbaToRGB(rgba) { const n = rgba.length / 4, o = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { o[i * 3] = rgba[i * 4]; o[i * 3 + 1] = rgba[i * 4 + 1]; o[i * 3 + 2] = rgba[i * 4 + 2]; } return o; }
  function channel(rgba, c) { const n = rgba.length / 4, o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = rgba[i * 4 + c]; return o; }
  function minMax(a) { let mn = Infinity, mx = -Infinity; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; } return { min: mn, max: mx }; }

  S.Export = { equirect, encodePNG, makeZip, heightTo16, heightTo8, rgbaToRGB, channel, minMax };
})();
