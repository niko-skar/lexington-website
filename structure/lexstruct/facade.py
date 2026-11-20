"""The building's skin for the 3D viewer: external walls on the as-built slab edges with the architect's windows in
them, balconies where the plans set the wall back, glass balustrades, slab-edge bands, soffit downlights, and the site
round it (cars in the car park, palms on the terraces).

Rules, in order:
1. A floor's enclosure is its as-built slab outline (the 7th floor: the part the roof covers), less any open areas set
   in model/architecture.json (the pool deck on the 1st floor).
2. Each window read off the architect's floor plans (model/arch_windows.json, from tools/read_arch_windows.py) is put
   on the as-built grid: its wall line by its offset from the nearest grid line, its middle by its place in the bay.
   It then goes onto the nearest enclosure edge facing the same way:
   - less than SNAP inside that edge, or outside it: on the edge (the as-built slab edge wins);
   - SNAP to SETBACK_MAX inside it: the wall is set back to the window's line between the grid lines either side of
     the window, and the slab in front is a balcony with a glass balustrade.
3. Where the plans editor has a layout with external walls (the 1st floor), its walls and openings are used, and the
   architect's windows and the slab-edge walls are left out within COVER of them.
Positions in mm here; the output is in metres in the viewer's frame (x, y as the as-built record, up = z).
"""
from __future__ import annotations

import math

from shapely.geometry import LineString, Point
from shapely.geometry import box as sbox
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

SNAP = 750.0  # mm: a window this close inside the slab edge is on the edge
SETBACK_MAX = 3000.0  # mm: deeper than this, the window is not on this edge
WALL_T = 225.0  # mm: 225 sandcrete block, outer face on the slab edge
JAMB = 100.0  # mm of wall kept at the end of an edge beside a window
GAP = 200.0  # mm of wall kept between two windows
COVER = 700.0  # mm: the plans editor's external walls replace the shell this close to them
BAL_H = 1100.0  # mm: balustrade height
LIGHT_STEP = 1500.0  # mm between soffit downlights


def r(v, n=3):
    return round(float(v), n)


def _polys(geom):
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    return [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon" and g.area > 1e4]


def edges(geom):
    """Every edge of a (multi)polygon with its outward normal. dir 'h': along x at y = c; 'v': along y at x = c;
    'd': any other direction. f: +1 when the outside is towards +y ('h') or +x ('v')."""
    out = []
    for p in _polys(geom):
        p = orient(p, 1.0)
        for ring in [p.exterior, *p.interiors]:
            cs = list(ring.coords)
            for (x0, y0), (x1, y1) in zip(cs[:-1], cs[1:]):
                dx, dy = x1 - x0, y1 - y0
                L = math.hypot(dx, dy)
                if L < 1:
                    continue
                nx, ny = dy / L, -dx / L
                e = dict(p=(x0, y0), q=(x1, y1), n=(nx, ny), len=L)
                if abs(dy) < 1:
                    e.update(dir="h", c=(y0 + y1) / 2, s0=min(x0, x1), s1=max(x0, x1), f=1 if ny > 0 else -1)
                elif abs(dx) < 1:
                    e.update(dir="v", c=(x0 + x1) / 2, s0=min(y0, y1), s1=max(y0, y1), f=1 if nx > 0 else -1)
                else:
                    e.update(dir="d")
                out.append(e)
    return out


def grid_ref(gx, gy):
    """The as-built grid, with the architect's outer lines it doesn't have (A, row 1) at their drawn spacing."""
    gx, gy = dict(gx), dict(gy)
    if "A" not in gx and "B" in gx:
        gx["A"] = gx["B"] - 3750
    if "1" not in gy and "2" in gy:
        gy["1"] = gy["2"] - 3750
    return gx, gy


def place(w, gx, gy):
    """An architect's window on the as-built grid: (wall line, middle along the wall) in mm, or None."""
    try:
        if w["dir"] == "h":
            line = gy[w["line"][0]] + w["line"][1]
            a0, a1, fr = w["along"]
            mid = gx[a0] + fr * (gx[a1] - gx[a0])
        else:
            line = gx[w["line"][0]] + w["line"][1]
            a0, a1, fr = w["along"]
            mid = gy[a0] + fr * (gy[a1] - gy[a0])
    except KeyError:
        return None
    return line, mid


def _seg(e, a, b, off):
    """The stretch a..b (along) of an axis edge, as plan points, moved off the edge by `off` mm along its normal."""
    if e["dir"] == "h":
        y = e["c"] + off * e["f"]
        return (a, y), (b, y)
    x = e["c"] + off * e["f"]
    return (x, a), (x, b)


def _free(e, cover):
    """The parts of an axis edge (along-intervals) not covered by the plans editor's walls."""
    if cover is None:
        return [(e["s0"], e["s1"])]
    (x0, y0), (x1, y1) = _seg(e, e["s0"], e["s1"], 0)
    rest = LineString([(x0, y0), (x1, y1)]).difference(cover)
    out = []
    for g in getattr(rest, "geoms", [rest]):
        if g.is_empty or g.length < 150:
            continue
        cs = list(g.coords)
        k = 0 if e["dir"] == "h" else 1
        out.append((min(cs[0][k], cs[-1][k]), max(cs[0][k], cs[-1][k])))
    return sorted(out)


def _fit(ws, lo, hi):
    """Windows on one stretch of wall [lo, hi]: kept inside it with a jamb at each end, and apart from each other.
    Each w: dict with 'mid', 'w'. Too-wide ones are narrowed; ones that don't fit at all are dropped."""
    ws = sorted(ws, key=lambda w: w["mid"])
    for w in ws:
        w["a"], w["b"] = w["mid"] - w["w"] / 2, w["mid"] + w["w"] / 2
        if w["a"] < lo + JAMB:
            w["b"] += lo + JAMB - w["a"]
            w["a"] = lo + JAMB
        if w["b"] > hi - JAMB:
            w["a"] -= w["b"] - (hi - JAMB)
            w["b"] = hi - JAMB
        w["a"] = max(w["a"], lo + JAMB)
    for u, v in zip(ws[:-1], ws[1:]):
        if u["b"] + GAP > v["a"]:
            m = (u["b"] + v["a"]) / 2
            u["b"], v["a"] = m - GAP / 2, m + GAP / 2
    return [w for w in ws if w["b"] - w["a"] >= 400]


def floor_skin(b, lv, nxt, roof, windows_arch, layout, cfg):
    """One floor's walls (pieces), windows, balustrades and balconies. Returns a dict of lists, mm."""
    S = lv.outline
    E = S
    if roof is not None and nxt is roof and roof.outline is not None:
        E = S.intersection(roof.outline)
    gx, gy = grid_ref(b.grid_lookup(lv, "x"), b.grid_lookup(lv, "y"))
    opens = []
    for oa in cfg.get("open_areas", []):
        if oa.get("floor") != lv.key:
            continue
        def at(ids, g, i, inf):
            v = ids[i]
            return inf if v is None else g.get(v, inf)
        x0, x1 = at(oa["x"], gx, 0, -1e7), at(oa["x"], gx, 1, 1e7)
        y0, y1 = at(oa["y"], gy, 0, -1e7), at(oa["y"], gy, 1, 1e7)
        opens.append(sbox(x0, y0, x1, y1))
    if opens:
        E = E.difference(unary_union(opens))
    cover = layout.get("cover") if layout else None

    # 1. the architect's windows onto this floor's edges, deciding where the wall steps back
    E_edges = [e for e in edges(E) if e["dir"] != "d"]
    gal = sorted(gx.values())
    gal_y = sorted(gy.values())
    placed, zones, dropped = [], [], 0
    for w in windows_arch:
        pos = place(w, gx, gy)
        if pos is None:
            dropped += 1
            continue
        line, mid = pos
        if cover is not None and cover.contains(Point((mid, line) if w["dir"] == "h" else (line, mid))):
            continue  # the plans editor's layout has this wall
        best = None
        # the side the tag is on gives the way the window faces; where the architect put the tag inside the room,
        # the other way is tried
        for facing in (w["facing"], -w["facing"]):
            for e in E_edges:
                if e["dir"] != w["dir"] or e["f"] != facing or not (e["s0"] - 300 <= mid <= e["s1"] + 300):
                    continue
                d = (e["c"] - line) * e["f"]  # > 0: the window is inside the slab edge
                if d < -1500 or d > SETBACK_MAX:
                    continue
                if best is None or abs(d) < abs(best[1]):
                    best = (e, d)
            if best is not None:
                break
        if best is None:
            dropped += 1
            continue
        e, d = best
        item = dict(src=w, mid=mid, w=float(w["w"]), dir=w["dir"], f=e["f"])
        if d < SNAP:
            item["line"] = e["c"]
        else:
            item["line"] = line
            grid = gal if w["dir"] == "h" else gal_y
            a = max([g for g in grid if g <= mid - w["w"] / 2 + 400], default=e["s0"])
            bb = min([g for g in grid if g >= mid + w["w"] / 2 - 400], default=e["s1"])
            a, bb = max(a, e["s0"]), min(bb, e["s1"])
            lo_, hi_ = sorted((line, e["c"] + 50 * e["f"]))
            zone = (sbox(a, lo_, bb, hi_) if w["dir"] == "h" else sbox(lo_, a, hi_, bb)) if bb - a > 800 else None
            indoor = layout.get("indoor") if layout else None
            if zone is not None and indoor is not None and zone.intersection(indoor).area > 0.3 * zone.area:
                zone = None  # the plans editor has a room there, not a balcony: the wall stays on the slab edge
            if zone is None:
                item["line"] = e["c"]
            else:
                zones.append(zone)
        placed.append(item)
    E2 = E.difference(unary_union(zones)) if zones else E
    E2 = unary_union([p.buffer(0) for p in _polys(E2)]) if not E2.is_empty else E2

    # 2. walls along the enclosure's edges, cut round the windows on them
    z0 = lv.z
    t_next = (max(z["t"] for z in (nxt.spec or {}).get("zones", [{"t": 200}])) if nxt is not None and nxt.outline is not None else 200)
    z1 = (nxt.z - t_next) if nxt is not None else z0 + 3000
    walls, wins = [], []
    used = set()
    for e in edges(E2):
        if e["dir"] == "d":
            (xa, ya), (xb, yb) = e["p"], e["q"]
            nx, ny = e["n"]
            o = WALL_T / 2
            walls.append(dict(kind="facade", a=(xa - nx * o, ya - ny * o), b=(xb - nx * o, yb - ny * o), z0=z0, z1=z1, t=WALL_T))
            continue
        for lo, hi in _free(e, cover):
            mine = [p for p in placed if id(p) not in used and p["dir"] == e["dir"] and p["f"] == e["f"]
                    and abs(p["line"] - e["c"]) < 120 and lo - 200 <= p["mid"] <= hi + 200]
            for p in mine:
                used.add(id(p))
            fitted = _fit([dict(p) for p in mine], lo, hi)
            ext0 = WALL_T / 2 if abs(lo - e["s0"]) < 1 else 0
            ext1 = WALL_T / 2 if abs(hi - e["s1"]) < 1 else 0
            pos = lo - ext0
            pieces = []
            for wdw in fitted:
                if wdw["a"] > pos:
                    pieces.append((pos, wdw["a"], z0, z1))
                sill, h = wdw["src"]["sill"], wdw["src"]["h"]
                top = min(z0 + sill + h, z1 - 50)
                if sill > 0:
                    pieces.append((wdw["a"], wdw["b"], z0, z0 + sill))
                pieces.append((wdw["a"], wdw["b"], top, z1))
                pos = wdw["b"]
                p0, p1 = _seg(e, wdw["a"], wdw["b"], 0)
                s = wdw["src"]
                wins.append(dict(a=p0, b=p1, n=(0, e["f"]) if e["dir"] == "h" else (e["f"], 0), z0=z0 + sill, z1=top, t=WALL_T,
                                 kind=s["kind"], panes=s["panes"], tag=s["tag"], sheet=s["sheet"],
                                 width_drawn=s["w"], narrowed=wdw["b"] - wdw["a"] < s["w"] - 50))
            if hi + ext1 > pos:
                pieces.append((pos, hi + ext1, z0, z1))
            for a, bb, za, zb in pieces:
                if bb - a < 20 or zb - za < 20:
                    continue
                p0, p1 = _seg(e, a, bb, -WALL_T / 2)
                walls.append(dict(kind="facade", a=p0, b=p1, z0=za, z1=zb, t=WALL_T))
    # placed windows that found no wall (an edge narrower than the window): count them
    dropped += sum(1 for p in placed if id(p) not in used)

    # 3. glass balustrades on the slab edge wherever the floor is open: balconies, terraces, the pool deck
    bal = []
    S_line = S.exterior
    keep = S_line.difference(E2.boundary.buffer(60)) if not E2.is_empty else S_line
    if cover is not None:
        keep = keep.difference(cover)
    for g in getattr(keep, "geoms", [keep]):
        if g.is_empty or g.geom_type != "LineString":
            continue
        cs = list(g.coords)
        for (xa, ya), (xb, yb) in zip(cs[:-1], cs[1:]):
            L = math.hypot(xb - xa, yb - ya)
            if L < 250:
                continue
            # inset 60 mm onto the slab
            mx, my = (xa + xb) / 2, (ya + yb) / 2
            nx, ny = (yb - ya) / L, -(xb - xa) / L
            if S.contains(Point(mx + nx * 100, my + ny * 100)):
                nx, ny = -nx, -ny
            bal.append(dict(kind="balustrade", a=(xa - nx * 60, ya - ny * 60), b=(xb - nx * 60, yb - ny * 60), z0=z0, z1=z0 + BAL_H, t=30))
    return dict(walls=walls, windows=wins, balustrades=bal, enclosure=E2, zones=zones, dropped=dropped, placed=len(placed))


def downlights(S_above, E_this, z_soffit, inset=350.0):
    """Downlights under the slab above wherever it is outside this floor's enclosure: along its edges."""
    if S_above is None:
        return []
    R = S_above.difference(E_this) if E_this is not None and not E_this.is_empty else S_above
    inner = R.buffer(-250)
    if inner.is_empty:
        return []
    pts = []
    for e in edges(S_above):
        if e["dir"] == "d":
            continue
        n = int(e["len"] // LIGHT_STEP)
        if n < 1:
            continue
        step = e["len"] / n
        for k in range(n):
            s = e["s0"] + step * (k + 0.5)
            (x, y), _ = _seg(e, s, s, -inset)
            if inner.contains(Point(x, y)):
                pts.append((x, y, z_soffit))
    return pts


def fascia(lv, t_slab):
    """A white band round the slab edge, 0.45 m deep, standing 40 mm proud (the renders' floor lines)."""
    out = []
    if lv.outline is None:
        return out
    for e in edges(lv.outline):
        (xa, ya), (xb, yb) = e["p"], e["q"]
        nx, ny = e["n"]
        out.append(dict(kind="fascia", a=(xa + nx * 40, ya + ny * 40), b=(xb + nx * 40, yb + ny * 40), z0=lv.z - t_slab - 270, z1=lv.z + 30, t=80))
    return out


def ground_lobbies(b):
    """The two lift lobbies on the ground floor (the car park): a white front wall between the row-7 columns in front
    of each lift, with the entrance door (yellow, as in the renders), and side walls back to the lift core."""
    g = b.levels[0]
    one = b.levels[1]
    t1 = max(z["t"] for z in (one.spec or {}).get("zones", [{"t": 200}]))
    z0, z1 = g.z, one.z - t1
    cols = [c for c in g.floor["columns"] if c.get("box")]
    walls, doors = [], []
    for core in g.floor["cores"]:
        x0, y0, x1, y1 = core["box"]
        cx = (x0 + x1) / 2
        # the row-7 columns either side, in front of the lift
        front = [c for c in cols if c["box"][1] > y1 + 500]
        if not front:
            continue
        yf = min(c["box"][1] for c in front)
        left = max([c["box"][2] for c in front if c["box"][2] <= cx], default=x0 - 1500)
        right = min([c["box"][0] for c in front if c["box"][0] >= cx], default=x1 + 1500)
        t = WALL_T
        yw = yf - t / 2
        door_w = 1200
        dx0, dx1 = cx - door_w / 2, cx + door_w / 2
        for a, bb, za, zb in [(left, dx0, z0, z1), (dx1, right, z0, z1), (dx0, dx1, z0 + 2200, z1)]:
            walls.append(dict(kind="facade", a=(a, yw), b=(bb, yw), z0=za, z1=zb, t=t, note="ground-floor lift lobby (assumed)"))
        for xs in (left + t / 2, right - t / 2):
            walls.append(dict(kind="facade", a=(xs, y1), b=(xs, yf), z0=z0, z1=z1, t=t, note="ground-floor lift lobby (assumed)"))
        doors.append(dict(a=(dx0, yf), b=(dx1, yf), n=(0, 1), z0=z0, z1=z0 + 2200, t=t, kind="entrance", panes=1, tag="Entrance",
                          sheet="lobby door as in the renders", width_drawn=door_w, narrowed=False))
    return walls, doors


def car_park(b, lobbies):
    """Cars parked nose-out under the building, two to a bay as in the renders, clear of the columns, lift cores and
    lobbies: along the west front (rows 6-7) and the east front (rows 3-4), from grid D to N."""
    g = b.levels[0]
    gx = b.grid_lookup(g, "x")
    obst = [sbox(*c["box"]).buffer(350) for c in g.floor["columns"] if c.get("box")]
    obst += [sbox(*c["box"]).buffer(600) for c in g.floor["cores"]]
    for w in lobbies:
        (xa, ya), (xb, yb) = w["a"], w["b"]
        obst.append(LineString([(xa, ya), (xb, yb)]).buffer(700))
    for h in b.levels[1].holes:
        if h["kind"] == "stair":
            obst.append(sbox(*h["box"]).buffer(500))
    blocked = unary_union(obst)
    S1 = b.levels[1].outline
    xs = sorted(v for k, v in gx.items() if k in ("D", "F", "G", "H", "K", "L", "M", "N"))
    cars = []
    palette = ["#f1f0ec", "#c8ccd1", "#25282d", "#5a6069", "#e8e5de", "#1b1d21", "#9aa1a9"]
    k = 0
    for side, yc, dirn in (("west", 15150, 1), ("east", 8300, -1)):
        for xa, xb in zip(xs[:-1], xs[1:]):
            n = int((xb - xa - 600) // 2700)
            if n < 1:
                continue
            step = (xb - xa) / n
            for i in range(n):
                x = xa + step * (i + 0.5)
                foot = sbox(x - 950, yc - 2300, x + 950, yc + 2300)
                if foot.intersects(blocked) or (S1 is not None and not S1.contains(foot.centroid)):
                    continue
                cars.append(dict(x=x, y=yc, dir=dirn, colour=palette[k % len(palette)]))
                k += 1
    return cars


def palms(b, terrace, z):
    """Palms in planters on the top floor's roof terraces, as on the renders' roof line: one or two per terrace,
    1.1 m in from its edges."""
    out = []
    inner = terrace.buffer(-1100)
    for p in sorted(_polys(inner), key=lambda q: -q.area):
        if p.area < 4e6:
            continue
        x0, y0, x1, y1 = p.bounds
        picks = [(x0, y0), (x1, y1)] if p.area > 20e6 else [((x0 + x1) / 2, (y0 + y1) / 2)]
        for px, py in picks:
            q = p.exterior.interpolate(p.exterior.project(Point(px, py)))
            out.append(dict(x=q.x, y=q.y, z=z, h=4200 + 600 * (len(out) % 2)))
        if len(out) >= 6:
            break
    return out


def umbrellas(deck, z, n=3):
    """Parasols spaced along an open deck (the pool deck), clear of its edges, as the renders show on the left end."""
    inner = deck.buffer(-700) if deck is not None else None
    out = []
    for p in sorted(_polys(inner), key=lambda q: -q.area)[:1]:
        x0, y0, x1, y1 = p.bounds
        for k in range(n):
            f = (k + 0.5) / n
            pt = Point((x0 + x1) / 2, y0 + f * (y1 - y0)) if y1 - y0 >= x1 - x0 else Point(x0 + f * (x1 - x0), (y0 + y1) / 2)
            if not p.contains(pt):
                pt = p.exterior.interpolate(p.exterior.project(pt))
            out.append(dict(x=pt.x, y=pt.y, z=z))
    return out
