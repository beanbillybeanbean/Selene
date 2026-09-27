# Selene — planet height & colour map generator

Selene generates realistic, seamless planet maps for **KSP (Kopernicus)** and **Blender**:
16-bit height maps, colour (albedo) maps, normal maps and emission maps. It is built for rocky,
icy and volcanic worlds. The presets are Mars, Venus, the Moon, Mercury, Europa, Enceladus, Ganymede, Charon, Io, a lava world, and a fractured exotic world. Every parameter is editable.
An Earth-like generator is included too.

Everything runs on your GPU in the browser. There is nothing to install.

## Running it

1. Download or clone this folder.
2. Double-click **`index.html`**. It opens in your browser and works straight from disk.
   - Use a recent **Chrome, Edge or Firefox** on a machine with a real GPU.
   - The only requirement is WebGL2 with 32-bit float render targets, which every desktop GPU from the last ten years has.
3. Pick a **World type**, type a **Seed**, choose a **Resolution**, then press **Generate** (or Ctrl+Enter).
4. Look around the globe:
   - Drag to rotate and scroll to zoom.
   - **Map** view shows the exact equirectangular layout that gets exported.
   - The layer menu shows the colour, height, shaded-relief, normal and emission maps.
5. Tweak the parameters on the left, generate again, then press **Export ZIP** on the right.

| Resolution | Cube faces | Natural export size | Typical time* |
|---|---|---|---|
| Draft | 256² | 1024 × 512 | ~1 s |
| Standard | 512² | 2048 × 1024 | a few s |
| High | 1024² | 4096 × 2048 | ~10 s |
| Ultra | 2048² | 8192 × 4096 | ~30–60 s |

\*On a mid-range desktop GPU. Worlds with erosion (Mars, Earth) take longer.

## What gets exported

| File | Use |
|---|---|
| `*_color.png` | Albedo / colour map (sRGB, no baked lighting) |
| `*_height16.png` | 16-bit greyscale height. The metre range is in `*_info.txt`. |
| `*_height8.png` | 8-bit height with dithering, which breaks up terracing when interpolated |
| `*_surface16.png` | Ocean worlds only: height with the sea surface flattened, for rendering |
| `*_normal.png` | Tangent-space normal map (OpenGL / +Y north) |
| `*_emission.png` | Glowing lava, for lava worlds and Io |
| `*_specular.png` | Ocean mask (Earth-like worlds) |
| `*_Kopernicus.cfg` | Starting-point Kopernicus body config (VertexHeightMap `offset`/`deformity` filled in) |
| `*_blender_import.py` | Blender script that builds a displaced, fully textured planet |
| `*_info.txt`, `*_settings.json` | Height range, and the exact settings to regenerate the same planet |

All maps are **equirectangular (2:1)**. Column 0 is 180° W and the top row is the north pole.
The seam and the poles are artefact-free because everything is simulated on a cube-sphere.

### KSP / Kopernicus
- Set **In-game radius** and press **auto** next to *Height scale*. Relief then scales with the planet, e.g. Mars-sized relief on a 600 km body.
  Or pick your own height scale.
- `offset` and `deformity` in the generated cfg already match the exported height map.
- Selene exports PNG only. Convert to DDS with your own tool if you want. KSP expects DDS textures flipped vertically.
- *Longitude offset* rolls the maps if you need a feature at a particular longitude.

### Blender
Put `*_blender_import.py` next to the maps, open it in the Scripting workspace and run it.
It creates a UV sphere with explicit equirectangular UVs, a Displace modifier driven by the 16-bit
height map (radius 1 = sea level/datum; raise `EXAGGERATION` to see relief from orbit), and a
material with colour, normal, roughness and emission.

## How it works

- **Cube-sphere GPU simulation.** Every field (height, materials, drainage, climate) lives on
  six equi-angular cube faces. Neighbour lookups cross face edges seamlessly, so there are
  no seams and no polar pinching.
- **Landforms modelled on real ones** (in the spirit of SpaceEngine's procedural toolbox):
  - **Terrain:** highland/lowland provinces with an optional hemispheric dichotomy, "eroded" fBm
    (derivative-damped, so ridges stay crisp and valleys fill with texture), ridged mountains, and
    stepped plateaus with lobate fractal escarpments.
  - **Craters:** a crater population following the observed size–frequency distribution, with real
    morphometry: simple bowls → complex craters with flat floors, slumped terraces and central
    peaks → peak rings. Ages range from pristine to infilled. There are also multi-ring basins,
    lava-flooded maria and young rayed craters.
  - **Volcanism:** shield volcanoes with calderas and Olympus-style basal scarps, volcanic rises,
    Venusian coronae, tesserae, shield fields and wrinkle ridges.
  - **Ice and fractures:** Io paterae and block mountains, fracture networks, grooved terrain,
    Europan double-ridge lineae and chaos, Enceladus tiger stripes, Valles-style canyons, dunes,
    and polar layered deposits.
- **Erosion** (Mars, Earth): stream-power fluvial incision with iterative multiple-flow drainage
  accumulation on the GPU, hillslope creep, talus collapse and depression filling. It runs
  coarse-to-fine, re-injecting detail at each level.
- **Colour follows the terrain.** The colour model combines:
  - a height ramp with colour distortion, and soft regional albedo provinces (optionally tied to elevation);
  - polar and hemispheric tints, and cliff colour;
  - curvature (ridges vs hollows);
  - material layers (dark lava/maria/lineae, sand, plume deposits, fresh ejecta and rays, ice),
    and blackbody-coloured emission for molten lava.
- **Earth-like worlds:** plate tectonics (orogens, trenches, rifts, mid-ocean ridges, hotspot
  chains), erosion, a moisture-transport climate model (trade winds, westerlies, rain shadows),
  and biome colouring.

## Files
```
index.html            the app
css/selene.css
js/core/              WebGL2 compute helpers, GLSL library (cube-sphere, noise, landform primitives)
js/gen/               generation stages (landforms, terrain, erosion, climate, surface colour)
js/export/            equirectangular resampling, PNG/ZIP writers, Blender & Kopernicus files
js/ui/                preview renderer and interface
js/presets.js         world presets and the parameter schema
```
