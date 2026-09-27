// Selene — text files that ship with an export: a Blender importer script and a Kopernicus
// config template for KSP.
(function () {
  'use strict';
  const S = (window.Selene = window.Selene || {});

  // info: { name, files: {color, height16, heightSurface16, normal, emission, spec}, hmin, hmax (exported metres),
  //         radiusKm (in-game), ocean, emissive }
  function blenderScript(info) {
    const f = info.files;
    return `# Selene planet importer for Blender 3.x / 4.x
# 1. Put this script in the same folder as the exported maps.
# 2. In Blender: Scripting workspace -> Open this file -> Run Script (Alt+P).
# It builds "${info.name}" as a displaced, UV-mapped sphere with a full material.
import bpy, bmesh, math, os

NAME = ${JSON.stringify(info.name)}
try:
    MAP_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    MAP_DIR = ""
if not os.path.exists(os.path.join(MAP_DIR, ${JSON.stringify(f.color)})):
    MAP_DIR = bpy.path.abspath("//")          # fall back to the .blend file's folder

RADIUS = 1.0                                   # Blender units
H_MIN, H_MAX = ${info.hmin.toFixed(2)}, ${info.hmax.toFixed(2)}   # metres, as stored in the 16-bit height map
PLANET_RADIUS_M = ${(info.radiusKm * 1000).toFixed(1)}
EXAGGERATION = 1.0                             # raise to make relief visible from orbit (e.g. 5-20)
SEGMENTS, RINGS = 1024, 512                    # mesh density for displacement (lower on slow machines)

def img(name, color=True):
    path = os.path.join(MAP_DIR, name)
    if not name or not os.path.exists(path):
        return None
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return im

# ---- sphere with explicit equirectangular UVs (u = longitude eastward from -180, v = latitude)
me = bpy.data.meshes.new(NAME + "Mesh")
bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")
verts = []
for j in range(RINGS + 1):
    lat = -math.pi / 2 + math.pi * j / RINGS
    row = []
    for i in range(SEGMENTS + 1):
        lon = -math.pi + 2 * math.pi * i / SEGMENTS
        row.append(bm.verts.new((RADIUS * math.cos(lat) * math.cos(lon), RADIUS * math.cos(lat) * math.sin(lon), RADIUS * math.sin(lat))))
    verts.append(row)
for j in range(RINGS):
    for i in range(SEGMENTS):
        face = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
        for loop, (a, b) in zip(face.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
            loop[uv].uv = (a / SEGMENTS, b / RINGS)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
obj = bpy.data.objects.new(NAME, me)
bpy.context.collection.objects.link(obj)

# ---- true displacement from the 16-bit height map
height = img(${JSON.stringify(f.heightSurface16 || f.height16)}, False)
if height:
    tex = bpy.data.textures.new(NAME + "Height", 'IMAGE')
    tex.image = height
    tex.extension = 'EXTEND'
    mod = obj.modifiers.new("SeleneDisplace", 'DISPLACE')
    mod.texture = tex
    mod.texture_coords = 'UV'
    mod.uv_layer = "UVMap"
    mod.direction = 'NORMAL'
    span = (H_MAX - H_MIN) / PLANET_RADIUS_M * RADIUS
    mod.strength = span * EXAGGERATION
    mod.mid_level = (0.0 - H_MIN) / max(1e-6, H_MAX - H_MIN)   # sea level / datum stays at RADIUS

# ---- material
mat = bpy.data.materials.new(NAME + "Surface")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes.get("Principled BSDF")
def image_node(im, x, y):
    n = nt.nodes.new("ShaderNodeTexImage"); n.image = im; n.location = (x, y); n.extension = 'EXTEND'; n.interpolation = 'Cubic'
    return n
col = img(${JSON.stringify(f.color)})
if col:
    nt.links.new(image_node(col, -600, 300).outputs["Color"], bsdf.inputs["Base Color"])
nrm = img(${JSON.stringify(f.normal || '')}, False)
if nrm:
    tn = image_node(nrm, -600, -100)
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-300, -100); nm.uv_map = "UVMap"; nm.inputs["Strength"].default_value = 1.0
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
bsdf.inputs["Roughness"].default_value = 0.92
spec = img(${JSON.stringify(f.spec || '')}, False)
if spec:
    sn = image_node(spec, -900, 0)
    mr = nt.nodes.new("ShaderNodeMapRange"); mr.location = (-300, 100)
    mr.inputs["To Min"].default_value = 0.92; mr.inputs["To Max"].default_value = 0.08
    nt.links.new(sn.outputs["Color"], mr.inputs["Value"]); nt.links.new(mr.outputs["Result"], bsdf.inputs["Roughness"])
emi = img(${JSON.stringify(f.emission || '')})
if emi:
    en = image_node(emi, -600, -450)
    key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
    nt.links.new(en.outputs["Color"], bsdf.inputs[key])
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 4.0
obj.data.materials.append(mat)
print("Selene: built", NAME)
`;
  }

  function kopernicusCfg(info) {
    const f = info.files;
    const dir = `Selene/${info.name}`;
    return `// Kopernicus body generated by Selene — a starting point, check values against the Kopernicus wiki.
// Copy the PNGs to GameData/${dir}/ (convert them to DDS with your own tool if you like;
// KSP expects DDS textures flipped vertically — most converters have an option for it).
//
// Height map: 16-bit is smoothest if your Kopernicus version reads 16-bit PNG heightmaps;
// otherwise use the dithered 8-bit map. deformity = full height range, offset = lowest point.
@Kopernicus:AFTER[Kopernicus]
{
    Body
    {
        name = ${info.name}
        Template
        {
            name = ${info.ocean ? 'Kerbin' : 'Moho'}
            removeAllPQSMods = true
            removeAtmosphere = ${info.ocean ? 'false' : 'true'}
            removeOcean = ${info.ocean ? 'false' : 'true'}
        }
        Properties
        {
            description = Generated with Selene.
            radius = ${Math.round(info.radiusKm * 1000)}
            // geeASL = 0.3
            // rotationPeriod = 21600
        }
        Orbit
        {
            referenceBody = Sun
            semiMajorAxis = 20000000000
            // eccentricity, inclination, color ...
        }
        ScaledVersion
        {
            type = ${info.ocean ? 'Atmospheric' : 'Vacuum'}
            Material
            {
                texture = ${dir}/${f.kspColor || f.color}
                normals = ${dir}/${f.normal || ''}
            }
        }
        PQS
        {
            Mods
            {
                VertexHeightMap
                {
                    map = ${dir}/${f.height8 || f.height16}
                    offset = ${info.hmin.toFixed(1)}
                    deformity = ${(info.hmax - info.hmin).toFixed(1)}
                    scaleDeformityByRadius = false
                    order = 20
                    enabled = true
                }
                VertexColorMap
                {
                    map = ${dir}/${f.color}
                    order = 9999993
                    enabled = true
                }
                VertexSimplexNoiseColor   // subtle close-up colour breakup
                {
                    blend = 0.08
                    colorStart = 1,1,1,1
                    colorEnd = 0.8,0.8,0.8,1
                    frequency = 60
                    octaves = 6
                    persistence = 0.5
                    seed = 4242
                    order = 9999994
                    enabled = true
                }
            }
        }
    }
}
`;
  }

  S.Integrations = { blenderScript, kopernicusCfg };
})();
