# Meniscus: the corner building for the process take, modelled procedurally in headless Blender.
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/blender/build_building.py -- <repo root>
# Writes public/media/model/building.glb (Draco) and assets-src/model/building-ao.png (baked AO,
# converted to WebP by scripts/stills.mjs-style step in scripts/model.mjs).
#
# Everything is written in three.js space (x east, y up, z south) and converted to Blender's Z-up
# at the last moment, so the numbers match src/scenes/process.ts exactly: the dirt shader cleans
# by world position (drops on the east face, wash fronts, solar rows), and those must line up.
#
# The building: a 1920s Hawkesbury-sandstone corner block with a 2000s glass refit on its east face.
#  - ground floor: rusticated base (coursed blocks with recessed joints), a plinth course, a recessed
#    bronze shopfront on the east with a fascia, a blank bronze sign band and a steel blade canopy
#  - upper floors: ashlar with punched windows in real reveals (0.35 m walls): stone architraves,
#    projecting sills, keystones, bronze frames with a mullion and transom, inset glass
#  - quoins on every stone corner, a string course at the first floor, a three-step cornice, a
#    parapet with aluminium coping
#  - east face: unitised curtain wall, 1.257 m modules, fritted spandrels at every slab, pressure-
#    capped mullions and transoms, between full-height stone piers
#  - roof: membrane deck, galvanised box gutters along the east and south parapets with outlets, a
#    solar array of three rows on aluminium racking, two condensers with fan grilles, a lift
#    overrun, a hatch; a downpipe with rainhead and brackets on the south face
# Material names are the contract with process.ts (stone, trim, base, glass_cw, glass_win,
# glass_shop, spandrel, alu, bronze, steel, roof, plant, fan, solar, galv, interior).
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix

ROOT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.getcwd()
OUT_GLB = os.path.join(ROOT, 'public', 'media', 'model', 'building.glb')
OUT_AO = os.path.join(ROOT, 'assets-src', 'model', 'building-ao.png')
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
os.makedirs(os.path.dirname(OUT_AO), exist_ok=True)
AO_SIZE = 2048

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --------------------------------------------------------------------------------------------
# dimensions (must match process.ts)
W, D, FLOOR, FLOORS = 14.0, 10.0, 3.2, 4
H = FLOOR * FLOORS            # 12.8
X0, X1, Z0, Z1 = -W / 2, W / 2, -D / 2, D / 2
WALL = 0.35                   # wall thickness: the depth of every reveal
PIER = 0.6                    # stone piers either side of the curtain wall
CW_Z0, CW_Z1 = Z0 + PIER, Z1 - PIER
DECK = H + 0.15               # roof deck top
PARAPET_TOP = H + 0.95

# --------------------------------------------------------------------------------------------
MATS = {}
def mat(name, rgb, metal=0.0, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1.0)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    MATS[name] = m
    return m

mat('stone', (0.80, 0.68, 0.50), 0.0, 0.85)
mat('trim', (0.88, 0.79, 0.64), 0.0, 0.75)
mat('base', (0.62, 0.53, 0.41), 0.0, 0.9)
mat('glass_cw', (0.56, 0.66, 0.72), 0.9, 0.04)
mat('glass_win', (0.45, 0.55, 0.6), 0.85, 0.05)
mat('glass_shop', (0.24, 0.29, 0.32), 0.7, 0.04)
mat('spandrel', (0.16, 0.19, 0.21), 0.6, 0.22)
mat('alu', (0.62, 0.64, 0.66), 1.0, 0.33)
mat('bronze', (0.24, 0.17, 0.11), 1.0, 0.38)
mat('steel', (0.10, 0.11, 0.12), 0.7, 0.45)
mat('roof', (0.16, 0.16, 0.17), 0.0, 0.92)
mat('plant', (0.80, 0.81, 0.80), 0.2, 0.45)
mat('fan', (0.05, 0.05, 0.05), 0.5, 0.6)
mat('solar', (0.04, 0.08, 0.17), 0.55, 0.12)
mat('galv', (0.58, 0.60, 0.61), 1.0, 0.48)
mat('interior', (0.015, 0.015, 0.016), 0.0, 1.0)

BEVEL = {'stone': 0.012, 'trim': 0.012, 'base': 0.016, 'alu': 0.006, 'bronze': 0.005, 'plant': 0.02, 'steel': 0.004}

BM = {}
def bm_for(name):
    if name not in BM:
        BM[name] = bmesh.new()
    return BM[name]

def to_b(p):
    # three (x, y up, z south) → Blender (x, y north, z up)
    return Vector((p[0], -p[2], p[1]))

FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]

def box(m, cx, cy, cz, sx, sy, sz, rot=None):
    """Axis-aligned box in three space (centre, size); optional 3x3 rotation about its centre."""
    if sx <= 1e-4 or sy <= 1e-4 or sz <= 1e-4:
        return
    bm = bm_for(m)
    vs = []
    for dx in (-0.5, 0.5):
        for dy in (-0.5, 0.5):
            for dz in (-0.5, 0.5):
                p = Vector((dx * sx, dy * sy, dz * sz))
                if rot is not None:
                    p = rot @ p
                vs.append(bm.verts.new(to_b((cx + p.x, cy + p.y, cz + p.z))))
    for f in FACES:
        bm.faces.new([vs[i] for i in f])

def box_span(m, x0, x1, y0, y1, z0, z1):
    box(m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))

def cyl(m, cx, cy, cz, r, h, axis='y', seg=16):
    bm = bm_for(m)
    rot = Matrix.Identity(4)
    # bmesh cones are built along Blender Z (= three y)
    if axis == 'x':
        rot = Matrix.Rotation(math.pi / 2, 4, 'Y')
    elif axis == 'z':
        rot = Matrix.Rotation(math.pi / 2, 4, 'X')
    mtx = Matrix.Translation(to_b((cx, cy, cz))) @ rot
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h, matrix=mtx)

# --------------------------------------------------------------------------------------------
# a face of the building, described in its own 2D frame: u along the face, v up, and an outward
# normal. Everything on a face is placed with face_box(u0, u1, v0, v1, out0, out1): out is metres
# in front of the face plane (negative = into the wall).
class Face:
    def __init__(self, name, origin_u, plane, axis):
        self.name = name
        self.axis = axis      # 'x' face (normal along ±x) or 'z' face (normal along ±z)
        self.plane = plane    # coordinate of the face plane
        self.sign = 1 if plane > 0 else -1

    def box(self, m, u0, u1, v0, v1, o0, o1):
        if self.axis == 'z':  # south (+z) / north (−z): u is x
            z0, z1 = self.plane + self.sign * o0, self.plane + self.sign * o1
            box_span(m, u0, u1, v0, v1, min(z0, z1), max(z0, z1))
        else:                 # east (+x) / west (−x): u is z
            x0, x1 = self.plane + self.sign * o0, self.plane + self.sign * o1
            box_span(m, min(x0, x1), max(x0, x1), v0, v1, u0, u1)

SOUTH = Face('south', 0, Z1, 'z')
NORTH = Face('north', 0, Z0, 'z')
WEST = Face('west', 0, X0, 'x')
EAST = Face('east', 0, X1, 'x')

def wall_with_openings(face, u0, u1, v0, v1, openings, m='stone', rusticate=False):
    """Solid wall between u0..u1, v0..v1, WALL thick, with rectangular openings (u0, u1, v0, v1)."""
    ops = sorted(openings)
    def piece(a0, a1, b0, b1):
        if a1 - a0 < 1e-3 or b1 - b0 < 1e-3:
            return
        if rusticate:
            # coursed blocks 0.4 m high with 20 mm recessed joints: a backing slab and proud courses
            face.box(m, a0, a1, b0, b1, -WALL, -0.03)
            y = b0
            while y < b1 - 1e-3:
                top = min(b1, y + 0.4)
                face.box(m, a0, a1, y + (0.012 if y > b0 else 0.0), top - 0.012, -0.03, 0.0)
                y = top
        else:
            face.box(m, a0, a1, b0, b1, -WALL, 0.0)
    # bands below and above each opening, piers between them
    cur = u0
    for (a0, a1, b0, b1) in ops:
        piece(cur, a0, v0, v1)
        piece(a0, a1, v0, b0)
        piece(a0, a1, b1, v1)
        cur = a1
    piece(cur, u1, v0, v1)

def punched_window(face, uc, sill, w, h, ground=False, door=False):
    a0, a1 = uc - w / 2, uc + w / 2
    b0, b1 = sill, sill + h
    t = 0.14
    if not ground:
        # architrave, sill and keystone
        face.box('trim', a0 - t, a0, b0, b1 + t, 0.0, 0.05)
        face.box('trim', a1, a1 + t, b0, b1 + t, 0.0, 0.05)
        face.box('trim', a0 - t, a1 + t, b1, b1 + t, 0.0, 0.05)
        face.box('trim', uc - 0.15, uc + 0.15, b1 - 0.06, b1 + t + 0.14, 0.0, 0.09)
    if not door:
        face.box('trim', a0 - 0.2, a1 + 0.2, b0 - 0.1, b0, -0.05, 0.14)
    else:
        face.box('base', a0 - 0.1, a1 + 0.1, 0.0, 0.06, -0.2, 0.18)
    # reveal soffit and jambs are the wall pieces; the frame sits 0.2 m back
    fd0, fd1 = -0.27, -0.2
    f = 0.065
    face.box('bronze', a0, a0 + f, b0, b1, fd0, fd1)
    face.box('bronze', a1 - f, a1, b0, b1, fd0, fd1)
    face.box('bronze', a0, a1, b0, b0 + f, fd0, fd1)
    face.box('bronze', a0, a1, b1 - f, b1, fd0, fd1)
    tr = b0 + h * (0.78 if door else 0.7)
    face.box('bronze', a0, a1, tr - f / 2, tr + f / 2, fd0, fd1)
    face.box('bronze', uc - f / 2, uc + f / 2, b0, tr if door else b1, fd0, fd1)
    face.box('glass_win' if not door else 'glass_shop', a0 + f, a1 - f, b0 + f, b1 - f, -0.25, -0.235)

def quoins(face, u_edge, inward, v0, v1):
    """Alternating long and short quoin stones up a corner, proud of the face by 30 mm."""
    v = v0
    i = 0
    while v < v1 - 1e-3:
        top = min(v1, v + 0.4)
        L = 0.72 if i % 2 == 0 else 0.46
        a, b = (u_edge, u_edge + inward * L)
        face.box('stone', min(a, b), max(a, b), v + 0.012, top - 0.012, 0.0, 0.03)
        v = top
        i += 1

def band(face, u0, u1, v0, v1, proud, m='trim'):
    face.box(m, u0, u1, v0, v1, -0.02, proud)

# --------------------------------------------------------------------------------------------
# stone faces: south and north (u = x, 14 m), west (u = z, 10 m)
LONG = [-5.4, -2.7, 0.0, 2.7, 5.4]
SHORT = [-3.0, 0.0, 3.0]
UP_W, UP_H, UP_SILL = 1.5, 2.0, 0.85
GR_W, GR_H, GR_SILL = 1.5, 2.25, 0.55

for face, us, (u0, u1) in ((SOUTH, LONG, (X0, X1)), (NORTH, LONG, (X0, X1)), (WEST, SHORT, (Z0, Z1))):
    # ground floor: rusticated, with a door in the middle bay of the south face
    ops = []
    for i, uc in enumerate(us):
        door = face is SOUTH and i == 2
        s, h = (0.06, 2.62) if door else (GR_SILL, GR_H)
        ops.append((uc - GR_W / 2, uc + GR_W / 2, s, s + h))
        punched_window(face, uc, s, GR_W, h, ground=True, door=door)
    wall_with_openings(face, u0, u1, 0.0, FLOOR, ops, m='base', rusticate=True)
    band(face, u0 - 0.04, u1 + 0.04, 0.0, 0.32, 0.05, m='base')  # plinth course
    # upper floors: ashlar with punched windows
    for f in range(1, FLOORS):
        v0 = f * FLOOR
        ops = [(uc - UP_W / 2, uc + UP_W / 2, v0 + UP_SILL, v0 + UP_SILL + UP_H) for uc in us]
        wall_with_openings(face, u0, u1, v0, v0 + FLOOR, ops)
        for uc in us:
            punched_window(face, uc, v0 + UP_SILL, UP_W, UP_H)
    # string course at the first floor and the cornice at the top
    band(face, u0 - 0.12, u1 + 0.12, FLOOR - 0.08, FLOOR + 0.16, 0.12)
    band(face, u0 - 0.1, u1 + 0.1, H - 0.02, H + 0.14, 0.08)
    band(face, u0 - 0.2, u1 + 0.2, H + 0.14, H + 0.28, 0.18)
    band(face, u0 - 0.3, u1 + 0.3, H + 0.28, H + 0.38, 0.27)

# quoins on the stone corners (above the string course; the rustication carries the ground floor)
for face, u_edge, inward in ((SOUTH, X0, 1), (WEST, Z1, -1), (NORTH, X0, 1), (WEST, Z0, 1),
                             (SOUTH, X1, -1), (NORTH, X1, -1)):
    quoins(face, u_edge, inward, FLOOR + 0.16, H - 0.02)

# east face: stone piers either end, full height; the curtain wall between; shopfront below
for (a, b) in ((Z0, CW_Z0), (CW_Z1, Z1)):
    EAST.box('stone', a, b, FLOOR, H, -WALL, 0.0)
    EAST.box('base', a, b, 0.0, FLOOR, -WALL, 0.0)
    y = 0.0
    while y < FLOOR - 1e-3:
        EAST.box('base', a, b, y + (0.012 if y > 0 else 0.0), min(FLOOR, y + 0.4) - 0.012, -0.03, 0.0)
        y += 0.4
quoins(EAST, Z1, -1, FLOOR + 0.16, H - 0.02)
quoins(EAST, Z0, 1, FLOOR + 0.16, H - 0.02)
band(EAST, Z0 - 0.12, Z1 + 0.12, FLOOR - 0.08, FLOOR + 0.16, 0.12)
# the cornice runs across the top of the glass as a stone head
EAST.box('stone', CW_Z0, CW_Z1, H - 0.02, H + 0.14, -WALL, 0.0)
band(EAST, Z0 - 0.1, Z1 + 0.1, H - 0.02, H + 0.14, 0.08)
band(EAST, Z0 - 0.2, Z1 + 0.2, H + 0.14, H + 0.28, 0.18)
band(EAST, Z0 - 0.3, Z1 + 0.3, H + 0.28, H + 0.38, 0.27)

# curtain wall: 7 modules, vision glass and fritted spandrels, pressure-capped mullions
MOD = (CW_Z1 - CW_Z0) / 7
GX0, GX1 = -0.12, -0.1        # glass plane just behind the stone face
for f in range(1, FLOORS):
    v0 = f * FLOOR
    sp0, sp1 = v0 - 0.32, v0 + 0.46
    EAST.box('spandrel', CW_Z0, CW_Z1, max(FLOOR + 0.16, sp0), sp1, GX0, GX1)
    top = (f + 1) * FLOOR - 0.32 if f < FLOORS - 1 else H - 0.02
    EAST.box('glass_cw', CW_Z0, CW_Z1, sp1, top, GX0 - 0.005, GX1 - 0.005)
    for v in (sp1, top):
        EAST.box('alu', CW_Z0, CW_Z1, v - 0.035, v + 0.035, GX1 - 0.02, 0.05)
for i in range(8):
    zc = CW_Z0 + i * MOD
    EAST.box('alu', zc - 0.035, zc + 0.035, FLOOR + 0.16, H - 0.02, GX0 - 0.04, 0.06)
EAST.box('spandrel', CW_Z0, CW_Z1, H - 0.34, H - 0.02, GX0, GX1)

# shopfront: recessed 0.4 m, bronze frames, clerestory, a door pair in the middle module
SX = -0.4
EAST.box('base', CW_Z0, CW_Z1, 0.0, 0.05, SX - 0.05, 0.05)          # threshold
EAST.box('stone', CW_Z0, CW_Z1, 2.78, 2.92, SX, 0.0)                  # soffit
EAST.box('stone', CW_Z0, CW_Z1, 2.92, FLOOR - 0.08, -0.05, 0.0)      # fascia
EAST.box('bronze', CW_Z0 + 0.3, CW_Z1 - 0.3, 2.96, 3.06, 0.0, 0.03)  # sign band, left blank
EAST.box('glass_shop', CW_Z0, CW_Z1, 0.05, 2.78, SX - 0.02, SX)
for i in range(8):
    zc = CW_Z0 + i * MOD
    EAST.box('bronze', zc - 0.035, zc + 0.035, 0.05, 2.78, SX - 0.03, SX + 0.07)
for v in (0.05, 2.25, 2.78):
    EAST.box('bronze', CW_Z0, CW_Z1, v - 0.035, v + 0.035, SX - 0.03, SX + 0.07)
mid = CW_Z0 + 3.5 * MOD
for dz in (-0.42, 0.42):
    EAST.box('bronze', mid + dz - 0.02, mid + dz + 0.02, 0.9, 1.3, SX + 0.07, SX + 0.12)  # door pulls
# steel blade canopy with three tie rods
CAN_Y = FLOOR + 0.18
box_span('steel', X1, X1 + 1.35, CAN_Y, CAN_Y + 0.09, CW_Z0 + 0.4, CW_Z1 - 0.4)
for zc in (CW_Z0 + 0.8, 0.0, CW_Z1 - 0.8):
    a = Vector((X1 + 1.28, CAN_Y + 0.09, zc))
    b = Vector((X1 + 0.02, CAN_Y + 1.25, zc))
    d = b - a
    rot = Matrix.Rotation(math.atan2(d.y, d.x), 3, 'Z')  # three space: rotate the rod's x into a→b
    box('steel', (a.x + b.x) / 2, (a.y + b.y) / 2, zc, d.length, 0.025, 0.025, rot=rot)

# --------------------------------------------------------------------------------------------
# dark interior behind every opening
box_span('interior', X0 + WALL, X1 - WALL - 0.12, 0.02, H - 0.05, Z0 + WALL, Z1 - WALL)

# roof: deck, parapet with coping, gutters with outlets
box_span('roof', X0 + 0.05, X1 - 0.05, H - 0.05, DECK, Z0 + 0.05, Z1 - 0.05)
for (x0, x1, z0, z1) in ((X0, X1, Z1 - 0.3, Z1), (X0, X1, Z0, Z0 + 0.3), (X0, X0 + 0.3, Z0, Z1), (X1 - 0.3, X1, Z0, Z1)):
    box_span('stone', x0, x1, H + 0.38, PARAPET_TOP - 0.06, z0, z1)
for (x0, x1, z0, z1) in ((X0 - 0.04, X1 + 0.04, Z1 - 0.34, Z1 + 0.04), (X0 - 0.04, X1 + 0.04, Z0 - 0.04, Z0 + 0.34),
                         (X0 - 0.04, X0 + 0.34, Z0, Z1), (X1 - 0.34, X1 + 0.04, Z0, Z1)):
    box_span('alu', x0, x1, PARAPET_TOP - 0.06, PARAPET_TOP, z0, z1)
G_IN = 0.3
def gutter_x(x0, x1, zc):  # runs along x
    box_span('galv', x0, x1, DECK, DECK + 0.03, zc - 0.3, zc + 0.3)
    box_span('galv', x0, x1, DECK, DECK + 0.16, zc - 0.32, zc - 0.29)
    box_span('galv', x0, x1, DECK, DECK + 0.16, zc + 0.29, zc + 0.32)
def gutter_z(z0, z1, xc):  # runs along z
    box_span('galv', xc - 0.3, xc + 0.3, DECK, DECK + 0.03, z0, z1)
    box_span('galv', xc - 0.32, xc - 0.29, DECK, DECK + 0.16, z0, z1)
    box_span('galv', xc + 0.29, xc + 0.32, DECK, DECK + 0.16, z0, z1)
gutter_z(Z0 + G_IN, Z1 - G_IN - 0.62, X1 - 0.5)
gutter_x(X0 + G_IN, X1 - G_IN, Z1 - 0.5)
for (x, z) in ((X1 - 0.5, Z0 + 0.8), (X1 - 0.6, Z1 - 0.5), (X0 + 0.9, Z1 - 0.5)):
    box_span('fan', x - 0.12, x + 0.12, DECK + 0.031, DECK + 0.036, z - 0.12, z + 0.12)  # outlets

# solar array: three rows on racking, tilted 15° to the north (must match the solar dirt rows)
TILT = -0.26
rot = Matrix.Rotation(TILT, 3, 'X')
for r in range(3):
    zc = -3.6 + r * 2.2 + 1.1
    yc = H + 0.55 + 0.15
    box('solar', -0.4, yc, zc, 9.2, 0.045, 1.7, rot=rot)
    # frame rails along the long edges and the ends
    for dz in (-0.86, 0.86):
        p = rot @ Vector((0, -0.01, dz))
        box('alu', -0.4, yc + p.y, zc + p.z, 9.26, 0.06, 0.05, rot=rot)
    for dx in (-4.62, 4.62):
        box('alu', -0.4 + dx, yc - 0.01, zc, 0.05, 0.06, 1.76, rot=rot)
    # legs: short at the north (front) edge, tall at the south
    for x in (-4.4, -2.2, 0.0, 2.2, 4.0):
        for dz, sign in ((-0.7, -1), (0.7, 1)):
            p = rot @ Vector((0, 0, dz))
            top = yc + p.y - 0.03
            box_span('alu', x - 0.025, x + 0.025, DECK, top, zc + p.z - 0.025, zc + p.z + 0.025)
        box_span('alu', x - 0.02, x + 0.02, DECK, DECK + 0.04, zc - 0.8, zc + 0.8)  # base rail

# plant: two condensers with fan grilles, a lift overrun, a hatch
for zc in (-2.1, -0.5):
    box_span('plant', X0 + 0.55, X0 + 1.55, DECK, DECK + 1.05, zc - 0.55, zc + 0.55)
    cyl('fan', X0 + 1.05, DECK + 1.07, zc, 0.36, 0.04, 'y', 24)
    for k in range(5):
        box_span('steel', X0 + 0.72 + k * 0.17, X0 + 0.74 + k * 0.17, DECK + 1.08, DECK + 1.1, zc - 0.36, zc + 0.36)
    for k in range(6):  # louvres on the side
        box_span('steel', X0 + 1.55, X0 + 1.57, DECK + 0.2 + k * 0.13, DECK + 0.25 + k * 0.13, zc - 0.45, zc + 0.45)
box_span('stone', X0 + 0.45, X0 + 1.85, DECK, DECK + 1.9, 1.5, 3.4)
box_span('alu', X0 + 0.41, X0 + 1.89, DECK + 1.9, DECK + 1.95, 1.46, 3.44)
box_span('plant', 5.0, 5.9, DECK, DECK + 0.18, -4.3, -3.6)

# downpipe on the south face near the east pier: rainhead, pipe, brackets
DPX, DPZ = X1 - 0.45, Z1 + 0.12
box_span('galv', DPX - 0.17, DPX + 0.17, H - 0.45, H - 0.08, Z1 + 0.01, Z1 + 0.3)
cyl('galv', DPX, (H - 0.45 + 0.15) / 2, DPZ, 0.075, H - 0.45 - 0.15, 'y', 16)
cyl('galv', DPX, 0.08, DPZ + 0.08, 0.075, 0.25, 'z', 16)
for y in (2.2, 4.6, 7.0, 9.4, 11.6):
    box_span('galv', DPX - 0.1, DPX + 0.1, y, y + 0.05, Z1, DPZ + 0.09)

# --------------------------------------------------------------------------------------------
# objects: one per material, bevelled where it catches light, then joined into one mesh
objs = []
for name, bm in BM.items():
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if name in BEVEL:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=BEVEL[name], segments=1, affect='EDGES', clamp_overlap=True, profile=0.5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    me.materials.append(MATS[name])
    scene.collection.objects.link(ob)
    objs.append(ob)

bpy.ops.object.select_all(action='DESELECT')
for ob in objs:
    ob.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
building = bpy.context.view_layer.objects.active
building.name = 'Building'
me = building.data
print('triangles', sum(len(p.vertices) - 2 for p in me.polygons))

# UVs for the AO atlas
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0025, area_weight=0.0, scale_to_bounds=True)
bpy.ops.object.mode_set(mode='OBJECT')

# --------------------------------------------------------------------------------------------
# bake ambient occlusion (Cycles, CPU): the reveals, cornice undersides and gutters carry it
world = bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
world.light_settings.distance = 1.6
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
scene.render.bake.margin = 6
img = bpy.data.images.new('building_ao', AO_SIZE, AO_SIZE, alpha=False)
for m in MATS.values():
    nt = m.node_tree
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = img
    nt.nodes.active = n
bpy.ops.object.select_all(action='DESELECT')
building.select_set(True)
bpy.context.view_layer.objects.active = building
bpy.ops.object.bake(type='AO')
img.filepath_raw = OUT_AO
img.file_format = 'PNG'
img.save()
print('ao saved', OUT_AO)
# the AO image is applied in three.js (aoMap), so the image nodes are removed before export
for m in MATS.values():
    for n in [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']:
        m.node_tree.nodes.remove(n)

bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', use_selection=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=16, export_draco_texcoord_quantization=14,
    export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
)
print('glb saved', OUT_GLB, os.path.getsize(OUT_GLB))
