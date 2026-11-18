"""Inspect fal image-to-3D GLBs: tri counts, bounds, textures, and quick workbench renders.

blender -b -P scripts/blender/inspect_gen.py -- <glb> <out_prefix>
"""
import sys, math, bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in bpy.context.scene.objects:
    print('OBJ', o.name, o.type, tuple(round(v, 3) for v in o.location), o.rotation_mode,
          tuple(round(v, 3) for v in (o.rotation_quaternion if o.rotation_mode == 'QUATERNION' else o.rotation_euler)),
          tuple(round(v, 3) for v in o.scale), 'parent', o.parent.name if o.parent else None)
tris = 0
lo = Vector((1e9, 1e9, 1e9)); hi = -lo
for o in meshes:
    me = o.data
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)
    for v in me.vertices:
        w = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    for m in me.materials:
        print('MAT', m.name)
        if m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image:
                    print('  IMG', n.image.name, n.image.size[:], [l.to_socket.name for l in n.outputs[0].links])
print('TRIS', tris, 'VERTS', sum(len(o.data.vertices) for o in meshes))
print('BBOX lo', tuple(round(v, 3) for v in lo), 'hi', tuple(round(v, 3) for v in hi), 'size', tuple(round(v, 3) for v in hi - lo))

# quick renders: front (-Y), side (+X), top
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 512; scene.render.resolution_y = 512
scene.render.film_transparent = False
world = bpy.data.worlds.new('w'); scene.world = world
c = (lo + hi) / 2; size = max(hi - lo)
cam_data = bpy.data.cameras.new('cam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = size * 1.15
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
views = {
    'front': (Vector((0, -1, 0)), (math.radians(90), 0, 0)),
    'side': (Vector((1, 0, 0)), (math.radians(90), 0, math.radians(90))),
    'top': (Vector((0, 0, 1)), (0, 0, 0)),
}
for name, (d, rot) in views.items():
    cam.location = c + d * size * 3
    cam.rotation_euler = rot
    scene.render.filepath = f'{out}-{name}.png'
    bpy.ops.render.render(write_still=True)
