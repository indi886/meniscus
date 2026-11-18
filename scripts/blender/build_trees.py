"""Procedural London-plane street trees for the process take.

blender -b -P scripts/blender/build_trees.py -- <repo-root>

Wood: parallel-transport tube meshes (trunk + leader, limbs, sub-branches) with a
root flare and the seamless camo bark from scripts/bark-tex.mjs.
Foliage: cards cut from a real plane-tree photo (scripts/tree-tex.mjs). Each card is
written twice with opposite winding so both faces keep the same outward normal
(three.js DoubleSide would flip it); normals are bent toward the crown's sphere so the
canopy shades as a volume, and a per-card vertex colour darkens the inner and lower
crown -- cheap self-shadowing.

Exports public/media/model/trees.glb with tree_a_wood / tree_a_leaf / tree_b_wood /
tree_b_leaf at the origin (Y up after export).
"""
import sys, os, math, random, bpy, bmesh
from mathutils import Vector, Matrix, Quaternion

ROOT = sys.argv[sys.argv.index('--') + 1]
TEX = os.path.join(ROOT, 'assets-src', 'street', 'tree')
OUT = os.path.join(ROOT, 'public', 'media', 'model', 'trees.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat_bark():
    m = bpy.data.materials.new('bark')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(os.path.join(TEX, 'bark.png'))
    nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.92
    return m


def mat_leaf():
    m = bpy.data.materials.new('leaf')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(os.path.join(TEX, 'leaves.png'))
    nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(img.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.78
    try:
        m.blend_method = 'CLIP'
        m.alpha_threshold = 0.5
    except Exception:
        pass
    m.surface_render_method = 'DITHERED'
    return m


BARK, LEAF = mat_bark(), mat_leaf()


def frames(pts):
    """parallel-transport frames along a polyline"""
    T = [(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(len(pts))]
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = [T[0].cross(up).normalized()]
    for i in range(1, len(pts)):
        n = N[-1] - T[i] * N[-1].dot(T[i])
        N.append(n.normalized() if n.length > 1e-6 else N[-1])
    return T, N


def tube(bm, uv, pts, radii, segs):
    T, N = frames(pts)
    circ = 2 * math.pi * max(radii[0], 0.02)
    urep = max(1, round(circ / 1.3))
    rings, vacc = [], 0.0
    for i, p in enumerate(pts):
        if i:
            vacc += (pts[i] - pts[i - 1]).length
        B = T[i].cross(N[i])
        ring = []
        for j in range(segs + 1):
            a = 2 * math.pi * j / segs
            d = N[i] * math.cos(a) + B * math.sin(a)
            ring.append((bm.verts.new(p + d * radii[i]), (j / segs * urep, vacc / (2 * circ))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(segs):
            a, b = rings[i][j], rings[i][j + 1]
            c, d = rings[i + 1][j + 1], rings[i + 1][j]
            f = bm.faces.new((a[0], b[0], c[0], d[0]))
            f.smooth = True
            for loop, (_, t) in zip(f.loops, (a, b, c, d)):
                loop[uv].uv = t
    # cap the tip so thin twigs do not show a hole
    tip = bm.verts.new(pts[-1] + T[-1] * radii[-1])
    for j in range(segs):
        a, b = rings[-1][j], rings[-1][j + 1]
        f = bm.faces.new((a[0], b[0], tip))
        f.smooth = True
        for loop, t in zip(f.loops, (a[1], b[1], (a[1][0], a[1][1] + 0.02))):
            loop[uv].uv = t


def curve(start, direction, length, bend_to, bend, n, wobble, rng):
    """polyline that bends its heading toward `bend_to` by `bend` radians"""
    pts, d, p = [start.copy()], direction.normalized(), start.copy()
    axis = d.cross(bend_to)
    step = length / n
    for i in range(n):
        if axis.length > 1e-6:
            d = (Quaternion(axis.normalized(), bend / n) @ d).normalized()
        d = (d + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * wobble).normalized()
        p = p + d * step
        pts.append(p.copy())
    return pts


def build(name, seed, trunk_h, height, spread, limbs, cards):
    rng = random.Random(seed)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    anchors = []
    UP = Vector((0, 0, 1))

    # trunk + central leader
    lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.05
    tpts, trad = [], []
    r0 = 0.17 + spread * 0.006
    nT = 12
    for i in range(nT + 1):
        t = i / nT
        z = t * (height * 0.68)
        p = Vector((lean.x * z + math.sin(t * 5 + seed) * 0.05, lean.y * z + math.cos(t * 4 + seed) * 0.05, z))
        tpts.append(p)
        flare = 1 + 0.55 * math.exp(-z / 0.28)
        trad.append(max(0.04, r0 * flare * (1 - 0.72 * t)))
    tube(bm, uv, tpts, trad, 10)
    anchors.append((tpts[-1], 1.0))

    # limbs
    for k in range(limbs):
        az = (k / limbs) * 2 * math.pi + rng.uniform(-0.35, 0.35)
        el = math.radians(rng.uniform(32, 55))
        z0 = trunk_h + rng.uniform(-0.4, 0.9)
        i0 = min(nT, int(z0 / (height * 0.68) * nT))
        base = tpts[i0]
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        L = spread * 0.5 * rng.uniform(0.85, 1.08) / max(0.55, math.cos(el) + 0.25)
        pts = curve(base, d, L, UP, math.radians(rng.uniform(10, 24)), 9, 0.06, rng)
        rs = trad[i0] * rng.uniform(0.58, 0.72)
        rad = [max(0.018, rs * (1 - 0.82 * (i / 9)) ) for i in range(10)]
        tube(bm, uv, pts, rad, 7)
        anchors.append((pts[-1], 1.0))
        anchors.append((pts[6], 0.8))
        for s in range(rng.randint(2, 3)):
            ti = rng.randint(4, 7)
            sd = (pts[ti + 1] - pts[ti]).normalized()
            side = sd.cross(UP)
            if side.length < 1e-3:
                side = Vector((1, 0, 0))
            q = Quaternion(sd, rng.uniform(0, 2 * math.pi))
            bd = (sd + (q @ side.normalized()) * rng.uniform(0.6, 1.1)).normalized()
            sl = spread * rng.uniform(0.16, 0.27)
            sp = curve(pts[ti], bd, sl, UP, math.radians(rng.uniform(8, 20)), 6, 0.08, rng)
            sr = [max(0.012, rad[ti] * 0.62 * (1 - 0.8 * (i / 6))) for i in range(7)]
            tube(bm, uv, sp, sr, 5)
            anchors.append((sp[-1], 1.0))

    wood = bpy.data.meshes.new(f'{name}_wood')
    bm.to_mesh(wood); bm.free()
    wood.materials.append(BARK)
    ow = bpy.data.objects.new(f'{name}_wood', wood)
    bpy.context.scene.collection.objects.link(ow)

    # ---- foliage cards ------------------------------------------------------
    cen = sum((a for a, _ in anchors), Vector()) / len(anchors)
    cen.z += 0.4
    rx = max(abs(a.x - cen.x) for a, _ in anchors) + 1.0
    ry = max(abs(a.y - cen.y) for a, _ in anchors) + 1.0
    rz = max(abs(a.z - cen.z) for a, _ in anchors) + 1.1
    pos = []
    for a, w in anchors:
        for _ in range(int(3 + 3 * w)):
            off = Vector((rng.gauss(0, 0.65), rng.gauss(0, 0.65), rng.gauss(0.25, 0.5)))
            pos.append(a + off)
    while len(pos) < cards:
        p = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if 0.45 < p.length < 1.0:
            pos.append(cen + Vector((p.x * rx, p.y * ry, p.z * rz)))
    me = bpy.data.meshes.new(f'{name}_leaf')
    verts, faces, uvs, cols, nors = [], [], [], [], []
    for p in pos:
        rel = p - cen
        en = Vector((rel.x / rx, rel.y / ry, rel.z / rz))
        rn = min(1.0, en.length)
        out = (Vector((rel.x / rx ** 2, rel.y / ry ** 2, rel.z / rz ** 2))).normalized() if rel.length > 1e-3 else UP
        rv = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
        n = (out * 0.55 + rv * 0.45).normalized()
        t = n.cross(UP if abs(n.z) < 0.95 else Vector((1, 0, 0))).normalized()
        t = Quaternion(n, rng.uniform(-0.6, 0.6)) @ t
        b = n.cross(t).normalized()
        s = rng.uniform(1.5, 2.4) * (0.75 + 0.35 * rn)
        cell = rng.randrange(4)
        u0, v0 = (cell % 2) * 0.5, 0.5 - (cell // 2) * 0.5
        flip = rng.random() < 0.5
        corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        # inner + lower crown sits in its own shade; sun-side outer cards stay bright
        shade = (0.5 + 0.5 * rn) * (0.82 + 0.18 * max(-1.0, min(1.0, en.z)))
        tint = rng.uniform(0.9, 1.08)
        col = (shade * tint, shade * rng.uniform(0.96, 1.05), shade * rng.uniform(0.86, 1.0), 1.0)
        bentn = (out * 0.75 + n * 0.25).normalized()
        base = len(verts)
        for cx, cy in corners:
            verts.append(p + t * (cx * s / 2) + b * (cy * s / 2))
            cu = (cx + 1) / 2
            uvs.append((u0 + (1 - cu if flip else cu) * 0.5, v0 + (cy + 1) / 4))
        faces.append((base, base + 1, base + 2, base + 3))
        faces.append((base + 3, base + 2, base + 1, base))
        for _ in range(2):
            cols.append(col)
            nors.append(bentn)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    cattr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    loop_normals = []
    for fi, poly in enumerate(me.polygons):
        poly.use_smooth = True
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = uvs[vi]
            cattr.data[li].color = cols[fi]
            loop_normals.append(nors[fi])
    me.normals_split_custom_set(loop_normals)
    me.materials.append(LEAF)
    ol = bpy.data.objects.new(f'{name}_leaf', me)
    bpy.context.scene.collection.objects.link(ol)
    print(name, 'wood tris', sum(len(p.vertices) - 2 for p in wood.polygons), 'cards', len(pos),
          'crown', tuple(round(v, 2) for v in cen), 'radii', round(rx, 2), round(ry, 2), round(rz, 2))


build('tree_a', 11, trunk_h=3.2, height=11.0, spread=9.0, limbs=5, cards=150)
build('tree_b', 23, trunk_h=2.7, height=8.2, spread=6.4, limbs=4, cards=110)

for o in bpy.context.scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_normal_quantization=12, export_draco_color_quantization=10,
    export_image_format='WEBP', export_image_quality=86,
    export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
    export_vertex_color='ACTIVE', export_all_vertex_colors=False,
)
print('glb saved', OUT, os.path.getsize(OUT))
