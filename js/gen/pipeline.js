// Selene — generation pipeline. Runs every stage in geological order on the GPU and returns the
// finished world: height (m), albedo, emission, drainage, material and climate fields on the
// cube-sphere.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  class World {
    constructor(ctx, f) { Object.assign(this, f); this.ctx = ctx; this.P = ctx.P; this.N = ctx.N; this.R = ctx.R; }
    // back to the generated fields (node graph disabled / identity)
    useBase() { this.H = this.baseH; this.albedo = this.baseAlbedo; this.ctx.hmin = this.baseHmin; this.ctx.hmax = this.baseHmax; }
    dispose() {
      this.disposed = true;
      for (const k of ['H', 'T', 'A', 'M', 'clim', 'albedo', 'emission', 'baseH', 'baseAlbedo', 'nodeH', 'nodeC']) if (this[k]) this.ctx.gpu.free(this[k]);
    }
  }

  async function generate(gpu, P, report = () => {}) {
    const t0 = performance.now();
    const ctx = { gpu, ops: new S.Ops(gpu), N: +P.resolution, R: P.geoRadius * 1000, P, seed: S.hashSeed(P.seed) };
    let H, T = null, M = null, A = null, clim = null;
    if (P.model === 'terran') {
      ({ H, T } = await S.Terrain.build(ctx, report));
      if (P.ocean) { // put sea level exactly where the requested share of the surface stays dry
        const st = ctx.ops.fieldStats(H, 0, 128);
        const q = S.quantile(st.data, 1 - P.landFraction);
        const tmp = gpu.field(ctx.N, 'r32f'); ctx.ops.scaleOffset(H, tmp, [1, 1, 1, 1], [-q, 0, 0, 0]); ctx.ops.copy(tmp, H); gpu.free(tmp);
      }
      if (P.erosion) A = await S.Erosion.run(ctx, H, T, report, 0.1, 0.6);
    } else {
      ({ H, M } = await S.Landforms.build(ctx, report));
      if (P.erosion) {
        T = gpu.field(ctx.N, 'rgba16f');
        ctx.ops.scaleOffset(H, T, [0, 0, 0, 0], [0, 0, 0, 0]);
        A = await S.Erosion.run(ctx, H, T, report, 0.1, 0.6);
      }
      await S.Landforms.overlay(ctx, H, M, report);
    }
    report('Measuring the relief', 0.72);
    const st = ctx.ops.fieldStats(H, 0, 128);
    ctx.hmin = st.min; ctx.hmax = st.max;
    if (P.model === 'terran') { report('Computing climate', 0.74); clim = await S.Climate.run(ctx, H, report); }
    report('Painting the surface', 0.95);
    const { albedo, emission } = await S.Surface.run(ctx, { H, clim, A, M }, report);
    await gpu.sync();
    report('Done', 1);
    const w = new World(ctx, { H, T, A, M, clim, albedo, emission, baseH: H, baseAlbedo: albedo, baseHmin: ctx.hmin, baseHmax: ctx.hmax });
    if (P.nodes && S.Nodes) { report('Applying node graph', 0.99); await S.Nodes.apply(w, P.nodes); }
    w.seconds = (performance.now() - t0) / 1000;
    return w;
  }

  S.generate = generate;
})();
