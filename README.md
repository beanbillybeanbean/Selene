# Selene — planet height & colour map generator

Selene generates realistic, seamless planet maps for **KSP (Kopernicus)** and **Blender**:
16-bit height maps, colour (albedo) maps, normal maps and emission maps. It is built for rocky,
icy and volcanic worlds. Every parameter is editable. There are 52 presets, grouped in the World type menu:
- **Planets:** Mars (real layout: Tharsis, Olympus Mons, Valles Marineris, Hellas, Argyre), Venus, Mercury, Earth.
- **Moons:** the Moon, Io, Europa, Ganymede, Callisto, Titan, Enceladus, Mimas, Tethys, Dione, Iapetus, Miranda,
  Ariel, Umbriel, Triton, Charon.
- **Dwarf planets and small worlds:** Pluto (with its heart-shaped ice plain), Ceres, Vesta, Eris, Makemake, and an
  ultra-red Kuiper-belt world.
- **Rocky and volcanic worlds:** a Super-Earth, a mottled desert world, an opaline (vivid blue mineral) world, the Cracked world, a lava world, a fractured exotic world, a scorched world,
  an obsidian world, a carbon world, a sulfur world, a salt-flat world, a dune world, an ancient wet world, and an
  ice-age red world.
- **Icy worlds:** the Banded moon (dark crust, bright patches, a painted equatorial canyon and an equatorial ridge),
  the Rift moon (a giant Valles Marineris system), a chaos moon, a grooved ice world and a cryovolcanic world.
- **Earth-like worlds:** an arid habitable world, an Eyeball world (tidally locked), a Desert world (no oceans), a Snowball world, an Ocean world, a Jungle world and a Tundra world.

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

Exports can go up to **16384 × 8192** from any resolution. They are rendered in tiles and streamed into the PNG encoder, so they don't need the whole map in memory.

\*On a mid-range desktop GPU. Worlds with erosion (Mars, Earth) take longer.

### Live preview
With **Live** ticked (top bar), changing any setting rebuilds a quick low-resolution preview about half a
second after you stop. Press **Generate** for full quality. **Export** always builds at full quality first.

### Great provinces
The **Great provinces** section adds up to three planet-scale layers to any world:
- **Filament belts:** Venus-style broad bright zones laced with bright ridge filaments.
- **Streaky provinces:** Mars-style dark regions, wind-stretched, with dense detail inside and along their ragged edges.
- **Regions:** plain soft-edged provinces.
- **Scattered patches:** many separate blotches of varying strength, like frost or dark deposits on an icy moon.

Each layer has its own colour (the Province 1–3 palette entries), coverage, size, interior and edge detail,
edge brightness and wind stretch. **Latitude bias** pulls a layer towards a band of latitude (the centre and width
are set separately), e.g. Mars's dark southern belt or Venus's bright equatorial belt. Negative bias keeps it away from that band.
**Variety** varies how strong each patch is.

Provinces are more than paint:
- **Relief** raises the province into a plateau or sinks it into a basin, so its colour boundary is also a real slope.
- **Dune seas** fill it with wind-aligned dunes.
- **Follow terrain** lets its material collect in hollows and basins and pull back from crests and cliffs.
  Its boundary then snakes along the relief instead of cutting across it like a stencil.
- Every province edge varies along its length: a crisp contact in some places, a gradual fade in others.
  There are detached fragments and holes, and the density varies inside. **Edge softness** sets how wide the fading
  stretches are (Mars's albedo regions use a lot of it).
- **Longitude bias** works like latitude bias. Use the two together to place a province, for example Pluto's dark
  Cthulhu region beside its ice plain.

### Real Mars layout
**Real Mars layout** (Volcanism) places the big features where they are on Mars, scaled to your planet:
- the Tharsis rise, dusted bright (**Dust on volcanic rises**);
- Olympus Mons, the three Tharsis Montes and the low, vast Alba Mons;
- the Valles Marineris system running east from Noctis Labyrinthus;
- the Hellas and Argyre basins, with bright dust-filled floors (**Dust-filled basin floors**).

### Ice-sheet basins
**Ice-sheet basin** (Fractures & ice) is modelled on Pluto's Sputnik Planitia: a huge plain of soft, bright ice.
- It has a ragged shoreline and broad swells.
- The ice is split into convection cells whose troughs collect dark debris.
- Its pitted margin fades into the surrounding uplands, which slope down into it.
- It is younger than everything around it, so it has no craters.

### Equatorial ridges, painted canyons and pits
These are in the **Fractures & ice** section.
- **Equatorial ridge** (like Iapetus): a segmented mountain ridge around a great circle.
  Set its height, width, tilt and how continuous it is. It can carry a streaky colour band.
- **Canyon on the equator:** the first canyon follows the equator. Separate controls set its depth and width.
- **Canyon band:** streaks the canyon floor and walls with a bright, dark or secondary deposit. The band reaches
  beyond the rims, so it looks painted on while still following the real relief.
- **Dimples:** fields of rimmed pits (Callisto and Triton style knobby, pitted ground).

### Chasmata: Valles Marineris at any size
**Chasmata** (Fractures & ice) adds wide canyon systems. Two layouts are available:
- **Valles Marineris system:** the full Martian layout, scaled by the length and trough width you set. From west to east:
  - the Noctis Labyrinthus maze of grabens and pits;
  - the parallel Ius and Tithonium troughs;
  - the wide, merged Melas, Candor and Ophir troughs, with bright layered mesas;
  - the closed Hebes and Juventae troughs to the north;
  - the long Coprates trough;
  - Eos, Capri and Ganges, breaking up into chaotic terrain.

  All troughs share the same wall and floor style:
  - Walls have a sharp rim, steep cliffs, benches, spur-and-gully ribs, scalloped alcoves at every scale, and layered colour bands.
  - Floors are hummocky, with landslide lobes grooved across their length, and have their own colour.
  - Fossae and pit-crater chains run parallel on the plateau either side.

  **Side canyons** adds short tributary canyons with rounded heads, cutting back into the plateau from the walls.

  **Run west to east** and **Latitude** place it. Mars uses it at real scale; the Rift moon uses it at giant scale.
- **Simple trough + parallels:** a single scalloped trough with plateau islands, en-echelon parallel troughs and grabens.

Craters also vary in shape: polygonal craters with straight wall segments, elongated oblique impacts, and central-pit craters.

### Fine relief
**Fine relief everywhere** (Detail section) adds rough small-scale relief to every surface, from about a third of the
hill size down to a single texel. Plateaus and plains are then never smooth up close, in the height map or in KSP.
Old, degraded craters keep a flat floor, a defined wall and a low, broken rim instead of fading into soft dishes.

### Flooded plains
Maria, lava plains and ice basins are never perfectly flat. **Relief kept on flooded plains** (in the Craters section)
lets buried craters show through as ghost rings, and adds low swells and a fine flow texture.

### Node editor (remix and recolour)
Press **◈ Nodes** in the bar under the globe. A Blender-style panel opens under the preview.
Changes re-apply in about a second, without regenerating the planet.

- **World** is the planet you generated, and **Output** is what gets previewed and exported.
  At first, World is wired straight into Output.
- Add nodes with the buttons along the top of the panel:

  | Node | What it does |
  |---|---|
  | Terrain | Adds hills, mountains, rubble, mesas or dunes |
  | Craters | Adds a crater population with real crater shapes and bright rays |
  | Fractures | Adds polygon cracks, long ridges, bright grooved lanes, canyons or groove fields |
  | Plateaus | Adds stepped mesas with ragged cliffs |
  | Volcanoes | Adds shield volcanoes with calderas and lava flows |
  | Mask | Picks out a height band, latitude, random patches or a hemisphere |
  | Math | Adds, multiplies, mixes or combines two values |
  | Paint | Paints a colour where its mask is |
  | Province | Planet-scale shapes: Venus-style bright filament belts, Mars-style dark streaky provinces, regions, scattered patches; optional latitude band |
  | Erosion | Runs real river erosion on its input; outputs eroded height, a river mask and how much was eroded |
  | Terrace | Cuts terrain into steps and ledges |
  | Curve | Remaps a value through a curve you drag (contrast, invert, levels) |
  | Smooth / Sharpen | Blurs, sharpens or keeps only detail, at a radius in km |
  | Image | Uses your own 2:1 image as a mask, heightmap or colour source |

- **Chaining height:** each feature node takes a Height and gives back Height + its feature.
  Chain them like World → Craters → Fractures → Output.
- **Using masks:** feature nodes also output masks, such as Bright ejecta, Lines, Cliffs or Lava flows.
  Wire a mask into a **Paint** node to colour exactly those places.
  Wire it into another node's **Where** input to limit that node to those places.
- **Connecting:** drag from an output ● to an input ●. Drag a plugged-in input ● away to unplug it.
- **Moving around:** drag empty space to pan, and use the mouse wheel to zoom.
- **Removing:** × (or Delete) removes the selected node.
- **Examples** loads ready-made graphs, and **Tidy** re-arranges the boxes.
- The graph is kept when you switch world type, saved with **Save settings**, and
  applied to exports.

### Comparing with a real planet
Press **◧ Reference** and load a real 2:1 map (e.g. a NASA Mars mosaic). The view splits in two: your planet on the
left and the reference on the right, on the globe or the flat map. Drag the gold line to move the split, and press ✕ to close it.

### Your own presets
Press **★ Save preset** next to the World type menu and give it a name. It stores everything:
- all settings and colours;
- the seed;
- the node graph and your painting.

Your presets appear under **My presets** in the World type menu. **🗑** deletes the selected one.
They live in your browser's storage. To move them to another computer, use **Save settings… / Load settings…**.

### Painting on the globe
Press **✎ Paint** (after generating). Pick a tool in the panel that appears, then drag on the globe or the map.
- **Mask 1/2/3:** paint masks, shown tinted red, green and blue. Use them in the node editor with the **Painted** node:
  connect a mask to a **Paint** node to colour it, or to any node's **Where** input to confine that feature.
- **Raise / Lower:** sculpt the height. Alt or Ctrl while raising lowers instead.
- **Crater / Volcano:** click to place one. The size and depth sliders apply; depth 2000 gives a crater its natural depth.
- **Canyon:** drag from one end of the canyon to the other.
- **Undo stroke** and **Clear all paint** do what they say.
- **Rotating:** Shift+drag or right-drag rotates the view while painting.

Everything you paint is saved with your settings and replayed when you regenerate, even at a different
resolution. It is also included in exports.

### If something goes wrong
- **The first generation of each world type is slower.** Its shaders are compiled then, and on
  Windows that can take a little while. The progress bar shows *compiling shaders* during this step.
- **"GPU driver reset / context lost".** Windows restarts the graphics driver if one GPU job runs
  too long. Selene splits all work into small chunks to avoid this. If it still happens, reload
  the page (F5) and use a lower resolution.
- **Laptops with two GPUs.** In Windows *Settings → System → Display → Graphics*, set your browser to
  *High performance* so it uses the dedicated GPU.

## What gets exported

| File | Use |
|---|---|
| `*_color.png` | Albedo / colour map (sRGB, no baked lighting) |
| `*_height16.png` | 16-bit greyscale height. The metre range is in `*_info.txt`. |
| `*_height8.png` | 8-bit height with dithering, which breaks up terracing when interpolated |
| `*_surface16.png` | Ocean worlds with "Paint oceans" ticked: height with the sea surface flattened, for rendering |
| `*_normal.png` | Tangent-space normal map (OpenGL / +Y north) |
| `*_emission.png` | Glowing lava, for lava worlds and Io |
| `*_specular.png` | Ocean mask (Earth-like worlds) |
| `*_roughness.png` | Roughness for PBR shading (rock rough, ice smoother, water/lava glossy) |
| `*_ao.png` | Ambient occlusion from the terrain |
| `*_clouds.png` | Cloud layer (grey + alpha), coverage set next to the checkbox |
| `*_night_lights.png` | City lights on habitable lowlands and coasts, density set next to the checkbox |
| `*_Kopernicus.cfg` | Starting-point Kopernicus body config (VertexHeightMap `offset`/`deformity` filled in) |
| `*_blender_import.py` | Blender script that builds a displaced, fully textured planet |
| `*_info.txt`, `*_settings.json` | Height range, and the exact settings to regenerate the same planet |

All maps are **equirectangular (2:1)**. Column 0 is 180° W and the top row is the north pole.
The seam and the poles are artefact-free because everything is simulated on a cube-sphere.

### Tidally locked worlds and ice cracks
On Earth-like worlds, **Tidally locked** (Climate) makes one side always face the star. The climate is then warmest
under the star (the **substellar point**, which you can place). That gives a warm "eye" of open ocean and coasts,
with everything else frozen. Winds blow in toward the eye, where the rain falls.

**Cracks in the ice** draws dark crack networks (open water, meltwater channels) across sea ice and ice sheets. On a
locked world they run outward from the eye and are densest near it.

**Rivers** are drawn as water. Each one's width grows with the area that drains into it, so big rivers show and
small ones fade out at low resolution.

### KSP / Kopernicus
In KSP a planet looks different from Selene's preview. From far away KSP draws a textured sphere (colour + normal map);
closer in it builds real terrain from the **height map** and paints it with the colour map **per vertex**. That terrain is
much coarser than the maps, so fine detail blurs, and any noise in the height map shows up as bumps everywhere.

For the best result:
- Use the **16-bit** height map if your Kopernicus reads it. The 8-bit map is error-diffused, so it has no terraces and
  much less noise than before, but it is still only 256 levels.
- **Never block-compress the height map** (DXT1/DXT5/BC). Keep it PNG, or an uncompressed / L8 DDS.
  Compression artefacts turn into bumps all over the terrain.
- **Oceans are not painted into the maps by default.** For ocean worlds:
  - the colour map shows the sea floor (sand on the shelves, darker sediment in the deeps);
  - the normal map keeps the sea-floor relief;
  - the height map always holds the real sea floor, with sea level at 0 m.

  KSP's (Kopernicus) ocean then draws the water. Tick **Paint oceans into colour & normal maps** if you want the
  old look, for example for a scaled-space texture or a render without a water layer.
- Normal maps: tick **Normal map, KSP layout (DXT5nm)** and convert that file as plain DXT5. Alternatively, convert the
  normal `*_normal.png` with your tool's *normal map / DXT5nm* mode. Converting the plain normal map as ordinary
  DXT1/DXT5 makes KSP read the wrong channels, and ridges turn into dark grooves.
- Tick **KSP colour (baked relief)**. It bakes soft, non-directional shading (dark hollows, lit crests) into the colour
  map, so craters and ridges stay readable under KSP's flat lighting. The cfg uses it automatically.

- Set **In-game radius** and press **auto** next to *Height scale*. Relief then scales with the planet, e.g. Mars-sized relief on a 600 km body.
  Or pick your own height scale.
- `offset` and `deformity` in the generated cfg already match the exported height map.
- Selene exports PNG only. Convert to DDS with your own tool if you want. KSP expects DDS textures flipped vertically.
- *Longitude offset* rolls the maps if you need a feature at a particular longitude.

| KSP file | Use |
|---|---|
| `*_color_ksp.png` | Colour with baked relief shading (ScaledVersion texture and VertexColorMap) |
| `*_normal_ksp_dxt5nm.png` | Normal map in Unity's DXT5nm layout (x in alpha, y in green) |

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
    polar layered deposits, Iapetus-style equatorial ridges and pitted "dimple" terrain.
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
