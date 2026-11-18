"""Clean a fal image-to-3D GLB for the web: bake the importer's rotation, scale to
real-world size, retouch badges out of the texture by re-pointing UVs, decimate,
shrink textures, export Draco + WebP.

blender -b -P scripts/blender/clean_gen.py -- <src.glb> <out.glb> <json-config>

config keys:
  length / height   target size in metres along X (length) or Z (height)
  center            true -> centre X/Y on the origin, otherwise keep the source origin
  ratio             decimate ratio
  tex               base colour size (px); normal/MR get tex too, capped by "tex_aux"
  badges            [[cx, cy, cz, hx, hy, hz, donor_dx, donor_dy, donor_dz], ...] in SOURCE
                    units, after the rotation bake (Z up) -- faces inside the box get the
                    UV of the face nearest the donor point, so the badge prints as paint.
  shots             optional prefix for check renders (absolute path)
"""
import sys, json, math, os, bpy, bmesh
from mathutils import Vector
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
src, out, cfg = argv[0], argv[1], json.loads(argv[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
if len(objs) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data

# ---- badge retouch (source units) ---------------------------------------------
badges = cfg.get('badges', [])
if badges:
    bm = bmesh.new(); bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    kd = KDTree(len(bm.faces))
    for f in bm.faces:
        kd.insert(f.calc_center_median(), f.index)
    kd.balance()
    for b in badges:
        c = Vector(b[0:3]); h = Vector(b[3:6]); donor = c + Vector(b[6:9])
        _, di, _ = kd.find(donor)
        df = bm.faces[di]
        duv = sum((l[uv].uv for l in df.loops), Vector((0, 0))) / len(df.loops)
        n = 0
        for f in bm.faces:
            p = f.calc_center_median()
            if all(abs(p[i] - c[i]) <= h[i] for i in range(3)):
                for l in f.loops:
                    l[uv].uv = duv
                n += 1
        print('badge', [round(v, 3) for v in c], 'faces', n, 'donor uv', tuple(round(v, 3) for v in duv))
    bm.to_mesh(me); bm.free()

# ---- scale + placement ------------------------------------------------------
xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
lo = Vector((min(xs), min(ys), min(zs))); hi = Vector((max(xs), max(ys), max(zs)))
size = hi - lo
k = cfg['length'] / size.x if 'length' in cfg else cfg['height'] / size.z
shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)) if cfg.get('center') else Vector((0, 0, lo.z))
for v in me.vertices:
    v.co = (v.co - shift) * k
print('scale', round(k, 4), 'shift', tuple(round(v, 4) for v in shift), 'size m', tuple(round(v * k, 3) for v in size))

# ---- decimate ---------------------------------------------------------------
mod = ob.modifiers.new('dec', 'DECIMATE')
mod.ratio = cfg.get('ratio', 0.4)
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=mod.name)
me.calc_loop_triangles()
print('tris after', len(me.loop_triangles))
for p in me.polygons:
    p.use_smooth = True

# ---- textures ---------------------------------------------------------------
tex = cfg.get('tex', 1024); aux = cfg.get('tex_aux', tex)
for img in bpy.data.images:
    if img.size[0] == 0:
        continue
    t = tex if img.name.endswith('20250901') else aux
    if img.size[0] > t:
        img.scale(t, t)
    print('img', img.name, img.size[:])

for m in me.materials:
    m.name = cfg.get('material', m.name)

if cfg.get('shots'):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = 640; scene.render.resolution_y = 480
    scene.world = bpy.data.worlds.new('w')
    cd = bpy.data.cameras.new('cam'); cd.lens = 50
    cam = bpy.data.objects.new('cam', cd); scene.collection.objects.link(cam); scene.camera = cam
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    ctr = sum(bb, Vector()) / 8
    rad = max((p - ctr).length for p in bb)
    for name, az, el in cfg.get('views', [['a', 30, 15], ['b', 210, 15]]):
        a, e = math.radians(az), math.radians(el)
        d = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
        cam.location = ctr + d * rad * 2.6
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f"{cfg['shots']}-{name}.png"
        bpy.ops.render.render(write_still=True)

bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
    export_image_format='WEBP', export_image_quality=cfg.get('quality', 82),
    export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
    export_materials='EXPORT',
)
print('glb saved', out, os.path.getsize(out))
