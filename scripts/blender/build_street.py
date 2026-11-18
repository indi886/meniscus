# Meniscus: the city around the corner building, for the process take.
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/blender/build_street.py -- <repo root>
# Writes public/media/model/street.glb (Draco, WebP textures).
#
# Written in three.js space (x east, y up, z south), like build_building.py. The block is laid out
# around the take's camera paths so that no framing ever lands inside a building:
#  - the site (x −7..7, z −5..5) with its paved forecourt to the east (three.js builds that one)
#  - EAST: footpath, kerb, a two-lane street with parking lanes (x 19.6..29.4), the far footpath,
#    then a row of Victorian terrace shops and a glass office tower (x ≥ 33, z ≤ 19)
#  - SOUTH: footpath, a cross street (z 9.6..19.4), then a park with lawns and paths (z ≥ 21)
#  - NORTH: a service lane, then a 1960s concrete office block (z ≤ −9)
#  - WEST: a service lane, then a red-brick warehouse (x ≤ −11)
#  - a ring of towers 140–320 m out for a skyline, which the take's aerial haze softens
#  - kerbs with gutters, lane and edge lines, a zebra crossing, lamps, traffic lights, bollards
# Façades are generated straight-on photographs (assets-src/street/facade-*.jpg) mapped at their
# real-world scale with world-space UVs, so windows read at the right size on every block.
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Vector

ROOT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.getcwd()
SRC = os.path.join(ROOT, 'assets-src', 'street', 'tex')
OUT = os.path.join(ROOT, 'public', 'media', 'model', 'street.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
random.seed(7)

def to_b(p):
    return Vector((p[0], -p[2], p[1]))

MATS = {}
def mat(name, rgb=(0.5, 0.5, 0.5), rough=0.8, metal=0.0, image=None, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(os.path.join(SRC, image))
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 4.0
    MATS[name] = m
    return m

# façade texture sizes in metres (what each photograph spans)
FACADES = {
    'facade-glass': (23.0, 28.8),
    'facade-concrete': (17.0, 21.3),
    'facade-brick': (16.0, 20.0),
    'facade-terrace': (16.0, 9.0),
}
for f in FACADES:
    mat(f, rough=0.55 if f == 'facade-glass' else 0.85, metal=0.25 if f == 'facade-glass' else 0.0, image=f + '.jpg')
mat('asphalt', rough=0.92, image='asphalt.jpg')
mat('footpath', (0.62, 0.61, 0.58), 0.88)
mat('kerb', (0.7, 0.69, 0.66), 0.8)
mat('paint', (0.92, 0.92, 0.88), 0.6)
mat('roofing', (0.2, 0.205, 0.21), 0.92)
mat('lawn', (0.16, 0.3, 0.1), 0.95)
mat('gravel', (0.62, 0.57, 0.48), 0.95)
mat('poleblack', (0.06, 0.07, 0.07), 0.5, 0.6)
mat('lampglass', (1.0, 0.95, 0.85), 0.2, emit=(1.0, 0.86, 0.62))
mat('signal_red', (0.9, 0.08, 0.05), 0.3, emit=(1.0, 0.1, 0.05))
mat('signal_green', (0.1, 0.9, 0.4), 0.3, emit=(0.1, 1.0, 0.45))
mat('plant', (0.72, 0.73, 0.72), 0.6, 0.2)
mat('bench', (0.35, 0.24, 0.15), 0.7)

BM = {}
def bm_for(m):
    if m not in BM:
        bm = bmesh.new()
        bm.loops.layers.uv.new('UVMap')
        BM[m] = bm
    return BM[m]

def quad(m, pts, uvs):
    bm = bm_for(m)
    uvl = bm.loops.layers.uv['UVMap']
    vs = [bm.verts.new(to_b(p)) for p in pts]
    f = bm.faces.new(vs)
    for loop, uv in zip(f.loops, uvs):
        loop[uvl].uv = uv
    return f

def box(m, x0, x1, y0, y1, z0, z1, uv_scale=None, facade=None, roof='roofing', voff=0.0):
    """Box in three space. Side faces carry world-space UVs at the façade's real size."""
    P = lambda x, y, z: (x, y, z)
    tw, th = FACADES[facade] if facade else (uv_scale or (4.0, 4.0))
    side_m = facade or m
    # four sides (outward normals: +x, -x, +z, -z); u runs along the face, v up
    faces = [
        ([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], 'z', -1),
        ([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], 'z', 1),
        ([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], 'x', 1),
        ([P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], 'x', -1),
    ]
    for pts, axis, sgn in faces:
        uvs = []
        for (x, y, z) in pts:
            h = (z if axis == 'z' else x) * sgn
            uvs.append((h / tw, y / th + voff))
        quad(side_m, pts, uvs)
    # top and bottom
    rm = roof if facade else m
    top = [P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)]
    quad(rm, top, [(p[0] / tw, p[2] / tw) for p in top])
    bot = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)]
    quad(rm, bot, [(p[0] / tw, p[2] / tw) for p in bot])

def ground(m, x0, x1, z0, z1, y=0.0, tile=4.0):
    pts = [(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)]
    quad(m, pts, [(p[0] / tile, p[2] / tile) for p in pts])

def cyl(m, cx, cz, y0, y1, r, seg=12):
    bm = bm_for(m)
    from mathutils import Matrix
    mtx = Matrix.Translation(to_b((cx, (y0 + y1) / 2, cz)))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=y1 - y0, matrix=mtx, calc_uvs=False)

# --------------------------------------------------------------------------------------------
# ground plane layers (y = 0 is the footpath/forecourt level; roads sit 150 mm lower)
ROAD_Y = -0.15
# east street, its parking lanes and the far footpath
ground('asphalt', 19.6, 29.4, -140, 140, ROAD_Y, tile=7.0)
# south cross street
ground('asphalt', -140, 19.6, 9.6, 19.4, ROAD_Y, tile=7.0)
ground('asphalt', 29.4, 140, 9.6, 19.4, ROAD_Y, tile=7.0)
# footpaths: around the site (west lane and north lane are footpath-paved too), the far sides
ground('footpath', 17.2, 19.4, -140, 9.4, 0.0, tile=3.0)
ground('footpath', -11.0, 19.4, 5.0, 9.4, 0.0, tile=3.0)
ground('footpath', -11.0, 7.2, -9.0, -5.0, 0.0, tile=3.0)
ground('footpath', -11.0, -7.0, -9.0, 5.0, 0.0, tile=3.0)
ground('footpath', 7.2, 17.2, -9.0, -7.0, 0.0, tile=3.0)
ground('footpath', 7.2, 17.2, 7.0, 9.4, 0.0, tile=3.0)
ground('footpath', 29.6, 33.0, -140, 9.4, 0.0, tile=3.0)
ground('footpath', 29.6, 140, 19.6, 21.0, 0.0, tile=3.0)
ground('footpath', -140, 19.4, 19.6, 21.0, 0.0, tile=3.0)
ground('footpath', 17.2, 19.4, 19.6, 140, 0.0, tile=3.0)
ground('footpath', 29.6, 33.0, 19.6, 140, 0.0, tile=3.0)
# kerbs (with a little gutter face) along every road edge
def kerb_x(x, z0, z1):
    box('kerb', x - 0.15, x + 0.15, ROAD_Y, 0.0, z0, z1, uv_scale=(1, 1))
def kerb_z(z, x0, x1):
    box('kerb', x0, x1, ROAD_Y, 0.0, z - 0.15, z + 0.15, uv_scale=(1, 1))
kerb_x(19.45, -140, 9.45)
kerb_x(19.45, 19.55, 140)
kerb_x(29.55, -140, 9.45)
kerb_x(29.55, 19.55, 140)
kerb_z(9.45, -140, 19.45)
kerb_z(9.45, 29.55, 140)
kerb_z(19.55, -140, 19.45)
kerb_z(19.55, 29.55, 140)
# everything outside the modelled streets reads as more city street, under the haze
ground('asphalt', -420, 420, -420, 420, ROAD_Y - 0.02, tile=7.0)
# park beyond the cross street: lawns cut by gravel paths, benches (stops at the east street's
# footpath, x 17.2); a second, smaller park across the east street
ground('lawn', -60, 17.2, 21.0, 120, 0.02, tile=6.0)
ground('gravel', -60, 17.2, 38.0, 41.0, 0.03, tile=3.0)
ground('gravel', 4.0, 7.0, 21.0, 120, 0.03, tile=3.0)
ground('lawn', 33.0, 120, 21.0, 120, 0.02, tile=6.0)
ground('gravel', 33.0, 120, 52.0, 55.0, 0.03, tile=3.0)
for x in (-14.0, 0.0, 11.0):
    box('bench', x - 0.9, x + 0.9, 0.42, 0.48, 36.8, 37.3, uv_scale=(1, 1))
    box('poleblack', x - 0.85, x - 0.75, 0.0, 0.42, 36.85, 37.25, uv_scale=(1, 1))
    box('poleblack', x + 0.75, x + 0.85, 0.0, 0.42, 36.85, 37.25, uv_scale=(1, 1))

# road paint: centre dashes, parking-lane lines, edge lines, stop lines, a zebra crossing
def paint(x0, x1, z0, z1):
    ground('paint', x0, x1, z0, z1, ROAD_Y + 0.005, tile=1.0)
for z in range(-138, 138, 6):
    if 7.5 < z < 21.5:
        continue
    paint(24.43, 24.57, z, z + 3.0)
for x in (21.3, 27.7):
    paint(x - 0.05, x + 0.05, -138, 7.0)
    paint(x - 0.05, x + 0.05, 22.0, 138)
for x in range(-138, 138, 6):
    if 17.5 < x < 31.5:
        continue
    paint(x, x + 3.0, 14.43, 14.57)
# zebra crossing across the east street, just north of the intersection
for i in range(8):
    x = 20.0 + i * 1.2
    paint(x, x + 0.6, 3.2, 7.2)
paint(19.7, 24.4, 2.6, 2.9)  # stop line, northbound side

# street lamps along both footpaths of the east street and the south side
def lamp(x, z, arm_dir):
    cyl('poleblack', x, z, 0.0, 7.2, 0.08)
    ax, az = arm_dir
    ex, ez = x + ax * 1.6, z + az * 1.6
    if ax:
        box('poleblack', min(x, ex), max(x, ex), 7.1, 7.2, z - 0.035, z + 0.035, uv_scale=(1, 1))
    else:
        box('poleblack', x - 0.035, x + 0.035, 7.1, 7.2, min(z, ez), max(z, ez), uv_scale=(1, 1))
    hx, hz = x + ax * 1.6, z + az * 1.6
    box('poleblack', hx - 0.3, hx + 0.3, 6.95, 7.12, hz - 0.18, hz + 0.18, uv_scale=(1, 1))
    box('lampglass', hx - 0.24, hx + 0.24, 6.92, 6.96, hz - 0.13, hz + 0.13, uv_scale=(1, 1))
for z in (-34, -18, -2, 26, 42):
    lamp(18.9, z, (1, 0))
    lamp(30.1, z + 8, (-1, 0))
for x in (-24, -8, 10):
    lamp(x, 9.0, (0, 1))

# traffic lights on the intersection corners
def signal(x, z):
    cyl('poleblack', x, z, 0.0, 3.4, 0.07)
    box('poleblack', x - 0.18, x + 0.18, 3.0, 3.95, z - 0.14, z + 0.14, uv_scale=(1, 1))
    box('signal_red', x - 0.08, x + 0.08, 3.68, 3.82, z + 0.14, z + 0.17, uv_scale=(1, 1))
    box('signal_green', x - 0.08, x + 0.08, 3.12, 3.26, z - 0.17, z - 0.14, uv_scale=(1, 1))
for (x, z) in ((19.0, 9.0), (30.0, 9.0), (19.0, 20.0), (30.0, 20.0)):
    signal(x, z)
# bollards at the forecourt edge and bins
for z in range(-6, 7, 2):
    cyl('poleblack', 17.0, z + 0.5, 0.0, 0.95, 0.09, 10)
for (x, z) in ((18.6, -12.0), (18.6, 12.5), (30.4, -20.0)):
    cyl('plant', x, z, 0.0, 1.0, 0.3, 14)

# --------------------------------------------------------------------------------------------
# neighbours
def building(x0, x1, z0, z1, h, facade, voff=0.0, plant=True):
    box(None, x0, x1, 0.0, h, z0, z1, facade=facade, voff=voff)
    # parapet coping: a rim, so the membrane roof inside it shows
    c = 0.32
    for (a0, a1, b0, b1) in ((x0 - 0.05, x1 + 0.05, z0 - 0.05, z0 + c), (x0 - 0.05, x1 + 0.05, z1 - c, z1 + 0.05),
                             (x0 - 0.05, x0 + c, z0 + c, z1 - c), (x1 - c, x1 + 0.05, z0 + c, z1 - c)):
        box('plant', a0, a1, h, h + 0.55, b0, b1, uv_scale=(1, 1))
    if plant:
        for _ in range(3):
            w, d = random.uniform(1.5, 4.0), random.uniform(1.5, 3.0)
            cx, cz = random.uniform(x0 + w, x1 - w), random.uniform(z0 + d, z1 - d)
            box('plant', cx - w / 2, cx + w / 2, h, h + random.uniform(1.0, 2.6), cz - d / 2, cz + d / 2, uv_scale=(1, 1))

# north: a 1960s concrete office across the service lane (four floors, so the site still reads)
building(-11.0, 17.0, -34.0, -14.0, 14.2, 'facade-concrete')
# west: a three-storey red-brick warehouse across the service lane
building(-36.0, -15.0, -30.0, 9.0, 12.0, 'facade-brick')
# east: terrace shops opposite the forecourt, a glass tower to the north-east
building(33.0, 49.0, -3.0, 19.0, 9.0, 'facade-terrace', voff=-0.04, plant=False)
building(33.0, 54.0, -34.0, -5.0, 30.0, 'facade-glass')
# further along the east street and the cross street
building(33.0, 50.0, -70.0, -38.0, 26.0, 'facade-concrete')
building(-11.0, 17.0, -70.0, -34.0, 36.0, 'facade-glass')
building(-64.0, -40.0, -30.0, 9.0, 30.0, 'facade-concrete')
building(-60.0, -34.0, -70.0, -34.0, 24.0, 'facade-brick')
# a middle ring of blocks, so the haze has a city to swallow between the street and the skyline
for (x0, x1, z0, z1, h, f) in (
    (-60.0, -34.0, -112.0, -76.0, 28.0, 'facade-concrete'),
    (-11.0, 17.0, -112.0, -76.0, 28.0, 'facade-brick'),
    (33.0, 54.0, -112.0, -76.0, 32.0, 'facade-glass'),
    (60.0, 92.0, -112.0, -76.0, 34.0, 'facade-glass'),
    (60.0, 92.0, -70.0, -38.0, 33.0, 'facade-brick'),
    (60.0, 92.0, -34.0, -5.0, 24.0, 'facade-concrete'),
    (53.0, 76.0, -3.0, 19.0, 18.0, 'facade-brick'),
    (-104.0, -66.0, -30.0, 9.0, 26.0, 'facade-brick'),
    (-104.0, -66.0, -70.0, -34.0, 30.0, 'facade-glass'),
    (-104.0, -66.0, 21.0, 58.0, 22.0, 'facade-concrete'),
    (-104.0, -66.0, 64.0, 100.0, 30.0, 'facade-glass'),
    (-60.0, -20.0, 128.0, 152.0, 30.0, 'facade-glass'),
    (0.0, 40.0, 128.0, 152.0, 24.0, 'facade-concrete'),
    (60.0, 100.0, 128.0, 152.0, 36.0, 'facade-brick'),
    (126.0, 150.0, 21.0, 60.0, 44.0, 'facade-glass'),
    (126.0, 150.0, -40.0, 15.0, 30.0, 'facade-concrete'),
):
    building(x0, x1, z0, z1, h, f)
# a distant skyline ring (hazed in the take)
for i in range(30):
    a = i / 30 * math.tau + random.uniform(-0.05, 0.05)
    r = random.uniform(190, 360)
    if math.sin(a) > 0.55 and math.cos(a) > -0.5:
        r += 60  # keep the park side lower
    cx, cz = math.cos(a) * r, math.sin(a) * r
    w, d = random.uniform(18, 34), random.uniform(18, 34)
    h = random.uniform(22, 70)
    f = random.choice(['facade-glass', 'facade-glass', 'facade-concrete'])
    building(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, h, f, plant=False)

# --------------------------------------------------------------------------------------------
objs = []
for name, bm in BM.items():
    if name is None:
        continue
    # quads are wound outward by construction (open shells, so recalc_face_normals can't be trusted)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    me.materials.append(MATS[name])
    scene.collection.objects.link(ob)
    objs.append(ob)
bpy.ops.object.select_all(action='DESELECT')
for ob in objs:
    ob.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
print('triangles', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_image_format='WEBP', export_image_quality=80,
    export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
)
print('glb saved', OUT, os.path.getsize(OUT))
