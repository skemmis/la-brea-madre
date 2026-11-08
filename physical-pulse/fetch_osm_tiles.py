#!/usr/bin/env python3
"""Fetch the map frame's road network from OpenFreeMap vector tiles (OpenStreetMap data).

    python3 physical-pulse/fetch_osm_tiles.py

Writes physical-pulse/data/osm-roads-box.json ({h: highway class, c: [[lng, lat], ...]}),
the file generate-tampa-style.cjs reads. This is the default road source because the
Overpass API and Geofabrik refuse connections from some networks (cloud hosts included),
while OpenFreeMap's tile CDN is reachable everywhere. Lines are clipped to each tile's
own edge so streets aren't doubled where tiles meet.
Needs: pip install mapbox-vector-tile
"""
import gzip, json, math, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
import mapbox_vector_tile

S, W, N, E = 33.93, -118.60, 34.27, -118.12
PAD = 0.01
Z = 14
TILEJSON = "https://tiles.openfreemap.org/planet"
CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary"}
UA = {"User-Agent": "la-brea-madre-pulse-map/1.0"}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        data = r.read()
    return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data

def tile_x(lon): return int((lon + 180) / 360 * 2 ** Z)
def tile_y(lat):
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** Z)

def clip(a, b, ext):
    """Liang–Barsky clip of segment a-b to the tile square [0, ext]."""
    t0, t1 = 0.0, 1.0
    dx, dy = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0]), (dx, ext - a[0]), (-dy, a[1]), (dy, ext - a[1])):
        if p == 0:
            if q < 0: return None
        else:
            r = q / p
            if p < 0:
                if r > t1: return None
                t0 = max(t0, r)
            else:
                if r < t0: return None
                t1 = min(t1, r)
    return (a[0] + t0 * dx, a[1] + t0 * dy), (a[0] + t1 * dx, a[1] + t1 * dy)

def clip_line(pts, ext):
    out, cur = [], None
    for a, b in zip(pts, pts[1:]):
        c = clip(a, b, ext)
        if not c:
            if cur and len(cur) > 1: out.append(cur)
            cur = None; continue
        if cur is None or cur[-1] != c[0]:
            if cur and len(cur) > 1: out.append(cur)
            cur = [c[0]]
        cur.append(c[1])
        if c[1] != b:
            out.append(cur); cur = None
    if cur and len(cur) > 1: out.append(cur)
    return out

def to_lnglat(tx, ty, ext, p):
    n = 2 ** Z
    lon = (tx + p[0] / ext) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + p[1] / ext) / n))))
    return [round(lon, 6), round(lat, 6)]

def fetch(args):
    tx, ty, tmpl = args
    raw = get(tmpl.format(z=Z, x=tx, y=ty))
    layers = mapbox_vector_tile.decode(raw, default_options={"y_coord_down": True})
    lay = layers.get("transportation")
    if not lay: return []
    ext = lay.get("extent", 4096)
    ways = []
    for f in lay["features"]:
        cls = f["properties"].get("class")
        if cls not in CLASSES: continue
        h = cls + "_link" if f["properties"].get("ramp") == 1 and cls in ("motorway", "trunk") else cls
        g = f["geometry"]
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"] if g["type"] == "MultiLineString" else []
        for ln in lines:
            for part in clip_line([tuple(p) for p in ln], ext):
                ways.append({"h": h, "c": [to_lnglat(tx, ty, ext, p) for p in part]})
    return ways

tmpl = json.loads(get(TILEJSON))["tiles"][0]
xs = range(tile_x(W - PAD), tile_x(E + PAD) + 1)
ys = range(tile_y(N + PAD), tile_y(S - PAD) + 1)
jobs = [(x, y, tmpl) for x in xs for y in ys]
print(f"fetching {len(jobs)} z{Z} tiles from {tmpl.split('/{z}')[0]} ...", flush=True)
with ThreadPoolExecutor(8) as ex:
    ways = [w for chunk in ex.map(fetch, jobs) for w in chunk]
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "osm-roads-box.json")
os.makedirs(os.path.dirname(dst), exist_ok=True)
json.dump(ways, open(dst, "w"))
counts = {}
for w in ways: counts[w["h"]] = counts.get(w["h"], 0) + 1
print(f"{len(ways)} road pieces -> {dst}  {counts}")
