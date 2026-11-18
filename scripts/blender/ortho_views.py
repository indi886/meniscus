"""Orthographic measuring renders (source units, rotation baked, Z up).

blender -b -P scripts/blender/ortho_views.py -- <glb> <out_prefix> <scale> <cy> <cz> [<cx>]
Each image is 800 px square covering `scale` units, centred on (cy, cz) for the
+X / -X views and on (cx, cz) for the -Y view, so pixel -> units is exact:
  +X view (looking -X): u = cy + (px/800 - .5) * scale      (camera right = +Y)
  -X view (looking +X): u = cy - (px/800 - .5) * scale      (camera right = -Y)
  -Y view (looking +Y): u = cx + (px/800 - .5) * scale      (camera right = +X)
  z = cz + (.5 - py/800) * scale
"""
import sys, math, bpy
from mathutils import Vector

a = sys.argv[sys.argv.index('--') + 1:]
src, out, scale, cy, cz = a[0], a[1], float(a[2]), float(a[3]), float(a[4])
cx = float(a[5]) if len(a) > 5 else 0.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 800
sc.world = bpy.data.worlds.new('w')
cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = scale
cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
for name, loc, rot in [
    ('px', (5, cy, cz), (math.pi / 2, 0, math.pi / 2)),
    ('nx', (-5, cy, cz), (math.pi / 2, 0, -math.pi / 2)),
    ('ny', (cx, -5, cz), (math.pi / 2, 0, 0)),
]:
    cam.location = loc; cam.rotation_euler = rot
    sc.render.filepath = f'{out}-{name}.png'
    bpy.ops.render.render(write_still=True)
