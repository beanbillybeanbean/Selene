// Selene — WebGL2 compute helpers.
// Every planet field lives on a cube-sphere: a 6-layer 2D texture array, one layer per cube face,
// using an equi-angular mapping so texels are close to equal-area. A "pass" runs a fragment shader
// over every texel of every face of a target field.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  const FORMATS = {
    r32f: { internal: 'R32F', format: 'RED', type: 'FLOAT', bytes: 4 },
    rg32f: { internal: 'RG32F', format: 'RG', type: 'FLOAT', bytes: 8 },
    rgba32f: { internal: 'RGBA32F', format: 'RGBA', type: 'FLOAT', bytes: 16 },
    rgba16f: { internal: 'RGBA16F', format: 'RGBA', type: 'HALF_FLOAT', bytes: 8 },
    rgba8: { internal: 'RGBA8', format: 'RGBA', type: 'UNSIGNED_BYTE', bytes: 4 },
  };

  const VERT_FULLSCREEN = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  class GPU {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is not available in this browser. Use a recent Chrome, Edge or Firefox.');
      const need = ['EXT_color_buffer_float', 'EXT_float_blend'];
      for (const e of need) if (!gl.getExtension(e)) throw new Error(`Your GPU/browser lacks ${e}, which Selene needs for 32-bit float simulation.`);
      gl.getExtension('OES_texture_float_linear');
      this.parallel = gl.getExtension('KHR_parallel_shader_compile');
      this.lost = false;
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; if (this.onLost) this.onLost(); });
      this.gl = gl;
      this.canvas = canvas;
      this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this.programs = new Map();
      this.fbo = gl.createFramebuffer();
      this.vao = gl.createVertexArray();
      this.fields = new Set();
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    }

    // ------------------------------------------------------------------ programs
    // frag: fragment source WITHOUT the #version line; the common GLSL library is prepended.
    _start(key, frag, vert) {
      const gl = this.gl;
      if (this.lost || gl.isContextLost()) throw lostError();
      const fsrc = '#version 300 es\n#define FRAG 1\n' + S.GLSL.header + S.GLSL.lib + '\n' + frag.replace('//#include planet', S.GLSL.planet || '');
      const vsrc = vert ? '#version 300 es\n' + S.GLSL.header + S.GLSL.lib + '\n' + vert : VERT_FULLSCREEN;
      const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
      const vs = mk(gl.VERTEX_SHADER, vsrc), fs = mk(gl.FRAGMENT_SHADER, fsrc);
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs);
      gl.linkProgram(p);
      return { key, p, vs, fs, vsrc, fsrc };
    }
    _finish(st) {
      const gl = this.gl;
      if (this.lost || gl.isContextLost()) throw lostError();
      if (!gl.getProgramParameter(st.p, gl.LINK_STATUS)) {
        for (const [sh, src] of [[st.vs, st.vsrc], [st.fs, st.fsrc]]) {
          if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) continue;
          const log = gl.getShaderInfoLog(sh) || '';
          const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`);
          const m = /ERROR: \d+:(\d+)/.exec(log);
          const ctx = m ? lines.slice(Math.max(0, +m[1] - 4), +m[1] + 2).join('\n') : '';
          throw new Error(`Shader "${st.key}" failed to compile:\n${log}\n${ctx}`);
        }
        const log = gl.getProgramInfoLog(st.p);
        if (gl.isContextLost()) throw lostError();
        throw new Error(`Program "${st.key}" failed to link: ${log || '(the driver gave no reason — usually the GPU driver gave up on a very large shader)'}`);
      }
      gl.deleteShader(st.vs); gl.deleteShader(st.fs);
      const uniforms = new Map();
      const n = gl.getProgramParameter(st.p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(st.p, i);
        const name = info.name.replace(/\[0\]$/, '');
        uniforms.set(name, { loc: gl.getUniformLocation(st.p, info.name), type: info.type, size: info.size });
      }
      const prog = { key: st.key, p: st.p, uniforms };
      this.programs.set(st.key, prog);
      return prog;
    }
    // blocking compile (fine for small shaders)
    program(key, frag, vert) {
      if (this.programs.has(key)) return this.programs.get(key);
      return this._finish(this._start(key, frag, vert));
    }
    // non-blocking compile: lets the browser compile on a background thread while the page stays alive
    async programAsync(key, frag, vert) {
      if (this.programs.has(key)) return this.programs.get(key);
      const st = this._start(key, frag, vert);
      if (this.parallel) {
        const DONE = this.parallel.COMPLETION_STATUS_KHR;
        while (!this.gl.getProgramParameter(st.p, DONE)) {
          if (this.lost || this.gl.isContextLost()) throw lostError();
          await new Promise((r) => setTimeout(r, 15));
        }
      }
      return this._finish(st);
    }

    _bind(prog, uniforms) {
      const gl = this.gl;
      gl.useProgram(prog.p);
      let unit = 0;
      for (const [name, u] of prog.uniforms) {
        let v = uniforms[name];
        if (v === undefined && name === 'uL27') v = 27;
        if (v === undefined) {
          if (u.type !== gl.SAMPLER_2D_ARRAY && u.type !== gl.SAMPLER_2D) continue;
          v = u.type === gl.SAMPLER_2D ? this._dummy2D() : this._dummyArr(); // never leave a sampler on a render target
        }
        switch (u.type) {
          case gl.SAMPLER_2D_ARRAY:
          case gl.SAMPLER_2D:
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(u.type === gl.SAMPLER_2D ? gl.TEXTURE_2D : gl.TEXTURE_2D_ARRAY, v.tex || v);
            gl.uniform1i(u.loc, unit++);
            break;
          case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
          case gl.INT: case gl.BOOL: u.size > 1 ? gl.uniform1iv(u.loc, v) : gl.uniform1i(u.loc, v | 0); break;
          case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
          case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
          case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
          case gl.INT_VEC2: gl.uniform2iv(u.loc, v); break;
          case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
          case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
          default: throw new Error(`Unhandled uniform type for ${name}`);
        }
      }
    }

    _dummyArr() {
      if (!this._dA) { const gl = this.gl; this._dA = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._dA); gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 6); }
      return this._dA;
    }
    _dummy2D() {
      if (!this._d2) { const gl = this.gl; this._d2 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this._d2); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1); }
      return this._d2;
    }

    // ------------------------------------------------------------------ fields
    field(N, fmt = 'r32f', label = '') {
      const gl = this.gl, F = FORMATS[fmt];
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl[F.internal], N, N, 6);
      for (const k of ['TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER']) gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl[k], gl.NEAREST);
      for (const k of ['TEXTURE_WRAP_S', 'TEXTURE_WRAP_T']) gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl[k], gl.CLAMP_TO_EDGE);
      const f = { tex, N, fmt, label, bytes: N * N * 6 * F.bytes };
      this.fields.add(f);
      return f;
    }
    free(f) {
      if (!f || !f.tex) return;
      this.gl.deleteTexture(f.tex);
      this.fields.delete(f);
      f.tex = null;
    }
    memoryMB() { let b = 0; for (const f of this.fields) b += f.bytes; return b / 1048576; }

    // Run `prog` over every face of `targets` (one field or an array for MRT).
    // opts.blend: 'premul' for crater stamping, opts.instances + opts.count for instanced draws.
    run(prog, targets, uniforms = {}, opts = {}) {
      const gl = this.gl;
      targets = Array.isArray(targets) ? targets : [targets];
      const N = targets[0].N;
      this._bind(prog, { ...uniforms, uN: N });
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.bindVertexArray(this.vao);
      gl.viewport(0, 0, N, N);
      const bufs = targets.map((_, i) => gl.COLOR_ATTACHMENT0 + i);
      gl.drawBuffers(bufs);
      if (opts.rect) { gl.enable(gl.SCISSOR_TEST); gl.scissor(opts.rect[0], opts.rect[1], opts.rect[2], opts.rect[3]); }
      if (opts.blend === 'premul') { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
      else if (opts.blend === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
      const faceLoc = prog.uniforms.get('uFace');
      const faces = opts.faces || [0, 1, 2, 3, 4, 5];
      for (const face of faces) {
        targets.forEach((t, i) => gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, t.tex, 0, face));
        if (faceLoc) gl.uniform1i(faceLoc.loc, face);
        if (opts.count) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, opts.count);
        else gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      for (let i = 0; i < targets.length; i++) gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, null, 0, 0);
      if (opts.blend) gl.disable(gl.BLEND);
      if (opts.rect) gl.disable(gl.SCISSOR_TEST);
    }

    // Run a heavy pass in small tiles, waiting for the GPU between batches so no single submission
    // runs long enough to trip the OS GPU watchdog (Windows resets the driver after ~2 s).
    async runTiled(prog, targets, uniforms = {}, opts = {}) {
      const N = (Array.isArray(targets) ? targets[0] : targets).N;
      const T = Math.min(N, opts.tile || 128);
      const tiles = [];
      for (let f = 0; f < 6; f++) for (let y = 0; y < N; y += T) for (let x = 0; x < N; x += T) tiles.push([f, x, y]);
      let batch = 1, i = 0;
      while (i < tiles.length) {
        const t0 = performance.now();
        const end = Math.min(tiles.length, i + batch);
        for (; i < end; i++) { const [f, x, y] = tiles[i]; this.run(prog, targets, uniforms, { ...opts, faces: [f], rect: [x, y, T, T] }); }
        await this.sync();
        if (this.lost || this.gl.isContextLost()) throw lostError();
        const per = (performance.now() - t0) / batch;
        batch = Math.max(1, Math.min(96, Math.floor(120 / Math.max(per, 0.05))));
        if (opts.progress) opts.progress(i / tiles.length);
      }
    }

    // ------------------------------------------------------------------ plain 2D targets
    tex2D(w, h, fmt = 'rgba32f', filter = 'NEAREST') {
      const gl = this.gl, F = FORMATS[fmt];
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl[F.internal], w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl[filter]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl[filter]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { tex, w, h, fmt };
    }
    free2D(t) { if (t && t.tex) { this.gl.deleteTexture(t.tex); t.tex = null; } }

    // Render prog into a 2D texture (or the canvas when target is null) at viewport x,y,w,h.
    draw2D(prog, target, uniforms = {}, vp) {
      const gl = this.gl;
      this._bind(prog, uniforms);
      gl.bindVertexArray(this.vao);
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.viewport(0, 0, target.w, target.h);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const v = vp || [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight];
        gl.viewport(v[0], v[1], v[2], v[3]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (target) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    }

    // Read back a 2D float/byte texture.
    read2D(t, x = 0, y = 0, w = t.w, h = t.h) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      let out;
      if (t.fmt === 'rgba8') { out = new Uint8Array(w * h * 4); gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out); }
      else { out = new Float32Array(w * h * 4); gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out); }
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      return out;
    }

    // Read one face (or all six) of a float field as RGBA float32.
    readField(f, face = -1) {
      const gl = this.gl, N = f.N;
      const faces = face < 0 ? [0, 1, 2, 3, 4, 5] : [face];
      const byte = f.fmt === 'rgba8';
      const out = byte ? new Uint8Array(N * N * 4 * faces.length) : new Float32Array(N * N * 4 * faces.length);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      faces.forEach((fc, k) => {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, f.tex, 0, fc);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        const view = byte ? new Uint8Array(out.buffer, k * N * N * 4, N * N * 4) : new Float32Array(out.buffer, k * N * N * 16, N * N * 4);
        gl.readPixels(0, 0, N, N, gl.RGBA, byte ? gl.UNSIGNED_BYTE : gl.FLOAT, view);
      });
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
      return out;
    }

    // Wait for queued GPU work without blocking the page (keeps the UI alive and avoids driver
    // watchdog resets on long simulations).
    async sync() {
      const gl = this.gl;
      const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      while (true) {
        const r = gl.clientWaitSync(s, 0, 0);
        if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED) break;
        if (r === gl.WAIT_FAILED) break;
        await new Promise((res) => setTimeout(res, 4));
      }
      gl.deleteSync(s);
    }
  }

  function lostError() {
    return new Error('The GPU driver reset (WebGL context lost). This happens when the graphics driver decides a job is taking too long.\n\nReload the page (F5) and try again — a lower resolution, or closing other GPU-heavy programs, helps. If it keeps happening, tell me your GPU model.');
  }

  S.GPU = GPU;
  S.FORMATS = FORMATS;
})();
