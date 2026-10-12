"""Build scraper/data/india_states_map.json (state outlines for the site map).

Source: india.topo.json from https://github.com/varunon9/india-choropleth-javascript
(MIT License, Copyright (c) 2020 Varun kumar). Run:
    python3 tools/build_map.py path/to/india.topo.json

Output: {"credit": ..., "states": {state name as in scraper/geo.py: [ring, ...]}}
where each ring is a flat list [lon, lat, lon, lat, ...] rounded to 0.01 degree,
simplified so the file stays small.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "scraper", "data", "india_states_map.json")
CREDIT = "State outlines: india-choropleth-javascript by Varun kumar (MIT License)"
NAMES = {
    "Andaman & Nicobar Island": "Andaman and Nicobar Islands",
    "Arunanchal Pradesh": "Arunachal Pradesh",
    "Dadara & Nagar Havelli": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "Jammu & Kashmir": "Jammu and Kashmir",
    "NCT of Delhi": "Delhi",
}
TOLERANCE = 0.025  # degrees, Douglas-Peucker
# The source file's latitudes are compressed (Delhi comes out at 27.3 to 27.7
# instead of 28.4 to 28.9). Fitted against the known extents of ten states:
# true latitude = LAT_SCALE * file latitude + LAT_SHIFT (worst error 0.09 degree).
LAT_SCALE, LAT_SHIFT = 1.0555, -0.3834


def decode_arcs(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, LAT_SCALE * (y * sy + ty) + LAT_SHIFT))
        arcs.append(pts)
    return arcs


def ring(arcs, idx):
    pts = []
    for i in idx:
        a = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        pts.extend(a if not pts else a[1:])
    return pts


def simplify(pts, tol):
    """Douglas-Peucker. A closed ring is split at its farthest point first."""
    if len(pts) < 4:
        return pts
    if pts[0] == pts[-1]:
        far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
        return _dp(pts[:far + 1], tol)[:-1] + _dp(pts[far:], tol)
    return _dp(pts, tol)


def _dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
        best, bi = 0, -1
        for i in range(a + 1, b):
            x0, y0 = pts[i]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, bi = d, i
        if best > tol and bi > 0:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def main(path):
    with open(path, encoding="utf-8") as fh:
        topo = json.load(fh)
    arcs = decode_arcs(topo)
    states = {}
    for g in topo["objects"]["india"]["geometries"]:
        name = (g.get("properties") or {}).get("name")
        if not name:
            continue
        name = NAMES.get(name, name)
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        for poly in polys:
            for r in poly:
                pts = simplify(ring(arcs, r), TOLERANCE)
                if len(pts) < 4:
                    continue
                flat = []
                for x, y in pts:
                    flat += [round(x, 2), round(y, 2)]
                states.setdefault(name, []).append(flat)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"credit": CREDIT, "states": states}, fh, separators=(",", ":"))
    print("{} states, {} rings, {} bytes -> {}".format(
        len(states), sum(len(v) for v in states.values()), os.path.getsize(OUT), OUT))


if __name__ == "__main__":
    main(sys.argv[1])
