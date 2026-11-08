#!/usr/bin/env python3
"""Build the Glowforge cut files for the physical Parking Pulse map.

Run the layout generator first, then this:

    node physical-pulse/generate-tampa-style.cjs      # writes physical-pulse/data/layout.json
    python3 physical-pulse/build_cut_files.py         # writes physical-pulse/cut/*.svg

Two layers, stacked:
  face-layer.svg  — the land piece. Cut to the coastline + frame edge, with the 45
                    11.75mm pixel holes; streets/terrain scored, labels engraved.
  ocean-layer.svg — the full-size base board. Outer edge + 45 clearance holes cut,
                    bathymetry and a coastline alignment guide scored, compass and
                    cartouche engraved.

Every operation gets its own color, so each shows up as a separate step in the
Glowforge app (and can be set to Ignore — e.g. skip minor streets on a first pass).
Labels are converted to glyph outlines because Glowforge doesn't import live SVG text.

Needs: fontTools (pip install fonttools); cairosvg is optional, for PNG previews.
"""
import json, math, os, sys

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cut")
FONT_PATH = os.environ.get("PULSE_FONT", "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf")
OCEAN_HOLE_MM = 16.0   # clearance in the base board so the pixel's snap barbs can open behind the face
SLIVER_MIN_IN = 0.08   # warn if a hole leaves less than ~2mm of wood to the coastline

L = json.load(open(os.path.join(HERE, "data", "layout.json")))
W, H = L["W"], L["H"]

# Glowforge operation colors (one step per color)
OPS = {
    "cut":     ("#0000FF", "Cut"),
    "engrave": ("#000000", "Engrave"),
    "free":    ("#FF0000", "Score — freeways (darkest)"),
    "major":   ("#FF8C00", "Score — major streets"),
    "minor":   ("#00A000", "Score — minor streets (optional)"),
    "terrain": ("#9900CC", "Score — terrain contours"),
    "neat":    ("#00AAAA", "Score — frame neatline + compass ring"),
    "bathy":   ("#FF0000", "Score — bathymetry"),
    "guide":   ("#FF8C00", "Score — coastline alignment guide"),
}
# Wood-tone palette for the realistic stacked preview
WOOD = {"cut": "#3a2a18", "engrave": "#3b2b1a", "free": "#6b5232", "major": "#9c8560", "minor": "#b9a47f",
        "terrain": "#c5b08a", "neat": "#3b2b1a", "bathy": "#7d8f8a", "guide": "#45544f"}

f2 = lambda v: f"{v:.4f}".rstrip("0").rstrip(".")

# ── text → outlines ───────────────────────────────────────────────────────────
font = TTFont(FONT_PATH)
GS, CMAP, UPM = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
HMTX = font["hmtx"]
CAP = getattr(font["OS/2"], "sCapHeight", 0) or 0.7 * UPM

def text_path(text, cx, y, size, ls, central=True):
    """Outline `text` centered on cx. y is the visual center (central) or the baseline."""
    sc = size / UPM
    names = [CMAP.get(ord(ch), ".notdef") for ch in text]
    adv = [HMTX[n][0] * sc for n in names]
    width = sum(adv) + ls * (len(text) - 1)
    x = cx - width / 2
    base = y + CAP * sc / 2 if central else y
    pen = SVGPathPen(GS, ntos=f2)
    for n, a in zip(names, adv):
        GS[n].draw(TransformPen(pen, (sc, 0, 0, -sc, x, base)))
        x += a + ls
    return pen.getCommands(), width, CAP * sc

# ── geometry helpers ──────────────────────────────────────────────────────────
def poly_d(pls):
    return " ".join("M" + "L".join(f"{f2(x)},{f2(y)}" for x, y in pl) for pl in pls if len(pl) > 1)

def plen(pls):
    return sum(math.dist(a, b) for pl in pls for a, b in zip(pl, pl[1:]))

def clip_to_rect(poly, x0, y0, x1, y1):
    """Sutherland–Hodgman against the frame rectangle."""
    def stage(pts, inside, cross):
        out, prev = [], pts[-1] if pts else None
        for cur in pts:
            if inside(cur):
                if not inside(prev): out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
            prev = cur
        return out
    atx = lambda X: (lambda a, b: (X, a[1] + (b[1] - a[1]) * (X - a[0]) / (b[0] - a[0])))
    aty = lambda Y: (lambda a, b: (a[0] + (b[0] - a[0]) * (Y - a[1]) / (b[1] - a[1]), Y))
    p = [tuple(q) for q in poly]
    for inside, cross in ((lambda q: q[0] >= x0, atx(x0)), (lambda q: q[0] <= x1, atx(x1)),
                          (lambda q: q[1] >= y0, aty(y0)), (lambda q: q[1] <= y1, aty(y1))):
        p = stage(p, inside, cross)
        if not p: break
    return p

def area(p):
    return 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1]))

def circle_union(centers, r, step_deg=2.0):
    """Outline of the union of equal circles: each circle is split at its exact
    intersection points with its neighbours and only the outer arcs are kept, so
    overlapping clearance holes become one clean cut with no slivers or crossings."""
    arcs, merged = [], 0
    for i, (cx, cy) in enumerate(centers):
        nbrs = [c for j, c in enumerate(centers) if j != i and math.dist(c, (cx, cy)) < 2 * r]
        if not nbrs:
            arcs.append([(cx + r * math.cos(t), cy + r * math.sin(t)) for t in
                         [k * 2 * math.pi / 180 for k in range(181)]]); continue
        merged += 1
        cuts = []
        for ox, oy in nbrs:
            d, th = math.dist((ox, oy), (cx, cy)), math.atan2(oy - cy, ox - cx)
            al = math.acos(min(1, d / (2 * r)))
            cuts += [(th - al) % (2 * math.pi), (th + al) % (2 * math.pi)]
        cuts.sort()
        for a, b in zip(cuts, cuts[1:] + [cuts[0] + 2 * math.pi]):
            mid = (a + b) / 2
            mp = (cx + r * math.cos(mid), cy + r * math.sin(mid))
            if any(math.dist(mp, o) < r - 1e-9 for o in nbrs): continue
            n = max(2, int(math.degrees(b - a) / step_deg) + 1)
            arcs.append([(cx + r * math.cos(a + (b - a) * k / n), cy + r * math.sin(a + (b - a) * k / n)) for k in range(n + 1)])
    return arcs, merged

def seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

# ── land piece outline (face cut) ─────────────────────────────────────────────
land = []
for ring in L["landRings"]:
    c = clip_to_rect(ring, 0, 0, W, H)
    if len(c) >= 3 and abs(area(c)) > 0.01:
        land.append(c)
land_d = " ".join("M" + "L".join(f"{f2(x)},{f2(y)}" for x, y in r) + "Z" for r in land)
coast_edges = []  # outline segments that are coastline, not the frame edge
for r in land:
    for a, b in zip(r, r[1:] + r[:1]):
        on_frame = (abs(a[0] - b[0]) < 1e-6 and min(abs(a[0]), abs(a[0] - W)) < 1e-6) or \
                   (abs(a[1] - b[1]) < 1e-6 and min(abs(a[1]), abs(a[1] - H)) < 1e-6)
        if not on_frame: coast_edges.append((a, b))

# ── labels → outlines, plus real-width bookkeeping for the overlap check ──────
label_d, boxes, worst_ratio = [], [], 0
for lab in L["labels"]:
    n = len(lab["lines"])
    widest = 0
    for i, line in enumerate(lab["lines"]):
        ly = lab["y"] + (-(n - 1) / 2 + i) * lab["lh"]
        d, w, cap = text_path(line, lab["x"], ly, lab["size"], lab["ls"])
        label_d.append(d)
        widest = max(widest, w)
        worst_ratio = max(worst_ratio, w / (len(line) * lab["size"] * 0.85))
    hh = n * lab["lh"]
    boxes.append((lab["x"] - widest / 2, lab["y"] - hh / 2, lab["x"] + widest / 2, lab["y"] + hh / 2))

R = L["holeR"]
holes = L["holes"]
overlaps = sum(1 for i in range(len(boxes)) for j in range(i + 1, len(boxes))
               if not (boxes[i][2] < boxes[j][0] or boxes[j][2] < boxes[i][0] or boxes[i][3] < boxes[j][1] or boxes[j][3] < boxes[i][1]))
hole_hits = sum(1 for b in boxes for h in holes
                if math.hypot(max(b[0] - h["x"], 0, h["x"] - b[2]), max(b[1] - h["y"], 0, h["y"] - b[3])) < R)
hole_pairs = sum(1 for i in range(len(holes)) for j in range(i + 1, len(holes))
                 if math.dist((holes[i]["x"], holes[i]["y"]), (holes[j]["x"], holes[j]["y"])) < 2 * R + 0.04)
slivers = []
for h in holes:
    dc = min((seg_dist((h["x"], h["y"]), a, b) for a, b in coast_edges), default=9) - R
    de = min(h["x"], W - h["x"], h["y"], H - h["y"]) - R
    if min(dc, de) < SLIVER_MIN_IN: slivers.append((h["name"], round(min(dc, de) * 25.4, 1)))

# ── compass + cartouche (ocean layer) ─────────────────────────────────────────
def compass_d(x, y, r):
    polys = []
    for i in range(8):
        a, lr, w = i * math.pi / 4, (r * 0.4 if i % 2 else r), (0.03 if i % 2 else 0.05)
        pts = [(x, y), (x + math.sin(a - 0.13) * w, y - math.cos(a - 0.13) * w),
               (x + math.sin(a) * lr, y - math.cos(a) * lr), (x + math.sin(a + 0.13) * w, y - math.cos(a + 0.13) * w)]
        polys.append("M" + "L".join(f"{f2(px)},{f2(py)}" for px, py in pts) + "Z")
    return " ".join(polys)

cp = L["compass"]
ocean_engrave = [compass_d(cp["x"], cp["y"], cp["r"]), text_path("N", cp["x"], cp["y"] - cp["r"] - 0.06, 0.12, 0, central=False)[0]]
for c in L["cartouche"]:
    ocean_engrave.append(text_path(c["text"], c["x"], c["y"], c["size"], c["ls"], central=False)[0])

# ── SVG writers ───────────────────────────────────────────────────────────────
SW = 0.01  # hairline-ish stroke; Glowforge only reads the path, not the width

def stroke(color, d, sw=SW):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>\n' if d else ""

def circles(color, pts, r, sw=SW):
    return "".join(f'<circle cx="{f2(p["x"])}" cy="{f2(p["y"])}" r="{f2(r)}" fill="none" stroke="{color}" stroke-width="{sw}"/>\n' for p in pts)

def neat_d():
    return " ".join(f"M{f2(x)},{f2(y)}h{f2(w)}v{f2(h)}h{f2(-w)}Z" for x, y, w, h in L["neat"])

def svg(body, bg=None):
    head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}in" height="{H}in" viewBox="0 0 {W} {H}">\n'
    return head + (f'<rect width="{W}" height="{H}" fill="{bg}"/>\n' if bg else "") + body + "</svg>\n"

lay = L["layers"]

def face_body(c, preview=False):
    b = ""
    if preview: b += f'<path d="{land_d}" fill="#e6d4b0" fill-rule="evenodd"/>\n'
    b += stroke(c["terrain"], poly_d(lay["terrain"]), 0.004 if preview else SW)
    b += stroke(c["minor"], poly_d(lay["minor"]), 0.0035 if preview else SW)
    b += stroke(c["major"], poly_d(lay["major"]), 0.006 if preview else SW)
    b += stroke(c["free"], poly_d(lay["free"]), 0.013 if preview else SW)
    b += stroke(c["neat"], neat_d(), 0.012 if preview else SW)
    b += f'<path d="{" ".join(label_d)}" fill="{c["engrave"]}"/>\n'
    if preview:
        b += "".join(f'<circle cx="{f2(h["x"])}" cy="{f2(h["y"])}" r="{f2(R)}" fill="#1b1410"/>\n' for h in holes)
        b += stroke(c["cut"], land_d, 0.012)
    else:
        b += stroke(c["cut"], land_d) + circles(c["cut"], holes, R)
    return b

def ocean_body(c, preview=False):
    b = ""
    if preview: b += f'<rect width="{W}" height="{H}" fill="#4a5753"/>\n'
    b += stroke(c["bathy"], poly_d(lay["bathy"]), 0.006 if preview else SW)
    b += stroke(c["guide"], poly_d([list(e) for e in coast_edges]), 0.012 if preview else SW)  # = face cut edge
    b += stroke(c["neat"], neat_d(), 0.012 if preview else SW)
    b += f'<circle cx="{f2(cp["x"])}" cy="{f2(cp["y"])}" r="{f2(cp["r"] * 0.18)}" fill="none" stroke="{c["neat"]}" stroke-width="{0.018 if preview else SW}"/>\n'
    b += f'<path d="{" ".join(ocean_engrave)}" fill="{"#d3dbd6" if preview else c["engrave"]}"/>\n'
    if not preview:
        b += stroke(c["cut"], f"M0,0H{f2(W)}V{f2(H)}H0Z")
        b += stroke(c["cut"], poly_d(clear_arcs))
    return b

clear_arcs, merged_holes = circle_union([(h["x"], h["y"]) for h in holes], OCEAN_HOLE_MM / 25.4 / 2)

os.makedirs(OUT, exist_ok=True)
ops = {k: v[0] for k, v in OPS.items()}
open(os.path.join(OUT, "face-layer.svg"), "w").write(svg(face_body(ops)))
open(os.path.join(OUT, "ocean-layer.svg"), "w").write(svg(ocean_body(ops)))
stack = svg(ocean_body(WOOD, True) + face_body(WOOD, True))

# ── report ────────────────────────────────────────────────────────────────────
print(f"frame {W} x {H} in  |  font {os.path.basename(FONT_PATH)}")
print(f"face:  {len(land)} land piece(s), cut {plen([r + r[:1] for r in land]) + len(holes) * 2 * math.pi * R:.0f} in "
      f"| {len(holes)} holes @ {R * 2 * 25.4:.2f}mm | {len(L['labels'])} labels engraved")
for k in ("free", "major", "minor", "terrain"):
    print(f"   score {k:8s} {len(lay[k]):6d} paths  {plen(lay[k]):8.0f} in")
print(f"ocean: cut {2 * (W + H) + plen(clear_arcs):.0f} in | {len(holes)} clearance holes @ {OCEAN_HOLE_MM}mm "
      f"({merged_holes} merged with a neighbour) | bathy {plen(lay['bathy']):.0f} in, coast guide {plen([list(e) for e in coast_edges]):.0f} in")
print(f"checks: label/label overlaps {overlaps} | label-over-hole {hole_hits} | holes too close {hole_pairs} "
      f"| real/estimated label width {worst_ratio:.2f}x")
print("thin wood near holes (<2mm): " + (", ".join(f"{n} {d}mm" for n, d in slivers) or "none"))

if "--preview" in sys.argv:
    import cairosvg
    pdir = sys.argv[sys.argv.index("--preview") + 1] if len(sys.argv) > sys.argv.index("--preview") + 1 else OUT
    os.makedirs(pdir, exist_ok=True)
    for name, data in (("face-layer", svg(face_body(ops), "#ffffff")), ("ocean-layer", svg(ocean_body(ops), "#ffffff")), ("stacked", stack)):
        cairosvg.svg2png(bytestring=data.encode(), write_to=os.path.join(pdir, f"preview-{name}.png"), output_width=1400)
    print("previews ->", pdir)
