"""The Lexington's structure as a 3D finite-element model (OpenSeesPy).

Where everything comes from:
  model/asbuilt.json  the as-built record, exported with the as-built app's own geometry code
                      (tools/export-asbuilt.ts): grid lines, columns, walls, lift cores, slab
                      outlines and openings, taped figures wherever the site has taped them.
  model/slabs.json    each floor's slab thickness and beam schedule, as the concrete estimator
                      reads the engineer's drawings (tools/export-slabs.ts).
  model/loads.json    materials, stiffness modifiers, loads, wind and seismic parameters.

What the model is:
  - Slabs: 4-node shells (ShellMITC4) on a mesh laid out along the grid lines, beam lines, slab
    edges, opening edges and lift-core walls (merged where they're within MERGE_TOL, then split so
    no cell is longer than MAX_CELL). A cell is slab when its middle is inside the floor's outline
    and outside every opening (voids, stairs, the pool, lift shafts).
  - Beams: elastic frame elements along their grid lines, sharing the slab's nodes.
  - Columns and short shear walls (SW4..SW7): elastic frame elements on their own centre line,
    tied to the slab by rigid links (so a column taped off its line carries its eccentricity), and
    walls also by stiff arms to the slab at their two ends.
  - Lift cores: shell walls, three elements per storey, with the lift door left out of the lower two.
  - Base: columns and cores fixed at the ground floor (+0.300), where the tie beams and ground slab
    hold them; foundation pressures are worked out from the reactions there.

Positions: x to the right from grid B, y down the page from grid 2, in mm, as the as-built record
keeps them. In the model (m): X = x/1000, Y = -y/1000 (so the plan reads like the drawing), Z up.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "model"

MERGE_TOL = 150.0  # mm: mesh lines closer than this are one line
MAX_CELL = 900.0  # mm: longest side of a slab cell
LINK_MAX = 1500.0  # mm: a column further than this from any slab node at a level is left free there
CORE_SUBDIV = 3  # shell elements per storey up a core wall
G_ACC = 9.81


def read(name: str):
    return json.loads((MODEL / name).read_text())


def torsion_J(a: float, b: float) -> float:
    """St Venant torsion constant of an a x b rectangle (m4)."""
    a, b = max(a, b), min(a, b)
    return a * b**3 * (1 / 3 - 0.21 * (b / a) * (1 - b**4 / (12 * a**4)))


def merge_lines(cands: list[tuple[float, int]], tol=MERGE_TOL, max_gap=MAX_CELL) -> list[float]:
    """Candidates (position mm, priority) -> sorted mesh line positions.

    Candidates within `tol` of a cluster's first member join it; the cluster sits on its
    highest-priority members (averaged). Gaps longer than `max_gap` are split evenly."""
    cands = sorted(cands)
    clusters: list[list[tuple[float, int]]] = []
    for p, pr in cands:
        if clusters and p - clusters[-1][0][0] <= tol:
            clusters[-1].append((p, pr))
        else:
            clusters.append([(p, pr)])
    reps = []
    for c in clusters:
        top = max(pr for _, pr in c)
        vals = [p for p, pr in c if pr == top]
        reps.append(sum(vals) / len(vals))
    out = [reps[0]]
    for a, b in zip(reps, reps[1:]):
        n = max(1, math.ceil((b - a) / max_gap - 1e-9))
        out.extend(a + (b - a) * k / n for k in range(1, n + 1))
    return out


def nearest_index(lines: list[float], v: float) -> int:
    return int(np.argmin(np.abs(np.asarray(lines) - v)))


@dataclass
class Level:
    idx: int
    key: str
    name: str
    short: str
    z: float  # mm
    floor: dict
    spec: dict | None
    outline: Polygon | None
    holes: list  # dicts: name, kind, box [x0,y0,x1,y1]
    gx: dict
    gy: dict
    cells: dict = field(default_factory=dict)  # (i,j) -> thickness mm
    nodes: dict = field(default_factory=dict)  # (i,j) -> node tag at this level (slab and core)


class Building:
    def __init__(self, asbuilt="asbuilt.json", slabs="slabs.json", loads="loads.json"):
        self.asbuilt = read(asbuilt)
        self.slabspec = read(slabs)
        self.cfg = read(loads)
        self.warnings: list[str] = []
        self.levels: list[Level] = []
        for i, f in enumerate(sorted(self.asbuilt["floors"], key=lambda f: f["order"])):
            outline = None
            if f.get("outline"):
                outline = Polygon(f["outline"])
                if not outline.is_valid:
                    outline = outline.buffer(0)
            holes = [dict(name=o["name"], kind=o["kind"], box=o["box"]) for o in f["openings"] if o.get("box")]
            for c in f["cores"]:
                x0, y0, x1, y1 = c["box"]
                t = c["wall"]
                holes.append(dict(name=f"{c['name']} shaft", kind="lift", box=[x0 + t, y0 + t, x1 - t, y1 - t]))
            self.levels.append(
                Level(
                    idx=i, key=f["key"], name=f["name"], short=f["short"], z=float(f["level"]), floor=f,
                    spec=self.slabspec.get(f["key"]), outline=outline, holes=holes,
                    gx={g["id"]: g["pos"] for g in f["grid"]["x"]}, gy={g["id"]: g["pos"] for g in f["grid"]["y"]},
                )
            )
        self.base = self.levels[0]
        c = self.cfg["materials"]["concrete"]
        self.E = c["Ecm_GPa"] * 1e6  # kPa
        self.nu = c["nu"]
        self.G = self.E / (2 * (1 + self.nu))
        self.gamma = c["gamma"]
        self._mesh_lines()

    # ------------------------------------------------------------------ mesh lines
    def _beam_runs(self, lv: Level):
        """The floor's beams as (axis, at_mm, lo_mm, hi_mm, depth, width, edge, label)."""
        if not lv.spec or lv.outline is None:
            return []
        minx, miny, maxx, maxy = lv.outline.bounds
        runs = []
        for b in lv.spec["beams"]:
            row = b["along"] == "row"
            across = self.grid_lookup(lv, "y" if row else "x")
            along = self.grid_lookup(lv, "x" if row else "y")
            at = b["at"] if isinstance(b["at"], (int, float)) else across.get(b["at"])
            lo = (minx if row else miny) - 50 if b["from"] == "edge" else along.get(b["from"])
            hi = (maxx if row else maxy) + 50 if b["to"] == "edge" else along.get(b["to"])
            if at is None or lo is None or hi is None:
                self.warnings.append(f"{lv.name}: beam {b} names a grid line this floor doesn't have; left out")
                continue
            lo, hi = min(lo, hi), max(lo, hi)
            label = f"{'row' if row else 'line'} {b['at']} {b['from']}-{b['to']} {b['depth']}x{b['width']}"
            runs.append(("row" if row else "line", float(at), lo, hi, b["depth"], b["width"], bool(b.get("edge")), label))
        return runs

    def grid_lookup(self, lv: Level, axis: str) -> dict:
        """This level's grid lines, with any it doesn't record taken from the nearest level below that does."""
        out = {}
        for other in sorted(self.levels[: lv.idx], key=lambda o: o.idx):
            out.update(other.gx if axis == "x" else other.gy)
        out.update(lv.gx if axis == "x" else lv.gy)
        return out

    def _pool_walls(self, lv: Level):
        """The pool's walls: deep beams (R10 sheet 56: 1800x300 'BM WALL') round the water, on their centre lines."""
        p = self.cfg["pool"]
        out = []
        if lv.key != p["floor"]:
            return out
        for h in lv.holes:
            if h["kind"] != "pool":
                continue
            x0, y0, x1, y1 = h["box"]
            t = p["wall_t_m"] * 1000
            x0, y0, x1, y1 = x0 - t / 2, y0 - t / 2, x1 + t / 2, y1 + t / 2
            D = (p["wall_depth_m"] + 0.0) * 1000
            label = f"pool wall {round(D)}x{round(t)}"
            out += [("row", y0, x0, x1, D, t, False, label + " (north)"), ("row", y1, x0, x1, D, t, False, label + " (south)"),
                    ("line", x0, y0, y1, D, t, False, label + " (west)"), ("line", x1, y0, y1, D, t, False, label + " (east)")]
        return out

    def _core_lines(self, core: dict):
        x0, y0, x1, y1 = core["box"]
        t = core["wall"]
        xl, xr, yt, yb = x0 + t / 2, x1 - t / 2, y0 + t / 2, y1 - t / 2
        door = core.get("door")
        dxs, dys = [], []
        if door:
            a = door["from"]
            w = door["width"]
            if door["side"] in ("t", "b"):
                dxs = [x0 + a, x0 + a + w]
            else:
                dys = [y0 + a, y0 + a + w]
        return xl, xr, yt, yb, dxs, dys

    def _mesh_lines(self):
        cx: list[tuple[float, int]] = []
        cy: list[tuple[float, int]] = []
        for lv in self.levels:
            cx += [(p, 2) for p in lv.gx.values()]
            cy += [(p, 2) for p in lv.gy.values()]
            if lv.outline is not None:
                for x, y in lv.outline.exterior.coords:
                    cx.append((x, 1))
                    cy.append((y, 1))
            for h in lv.holes:
                x0, y0, x1, y1 = h["box"]
                cx += [(x0, 1), (x1, 1)]
                cy += [(y0, 1), (y1, 1)]
            for c in lv.floor["cores"]:
                xl, xr, yt, yb, dxs, dys = self._core_lines(c)
                cx += [(xl, 3), (xr, 3)] + [(v, 3) for v in dxs]
                cy += [(yt, 3), (yb, 3)] + [(v, 3) for v in dys]
            for axis, at, *_ in self._beam_runs(lv):
                (cy if axis == "row" else cx).append((at, 2))
            for axis, at, *_ in self._pool_walls(lv):
                (cy if axis == "row" else cx).append((at, 1))
        self.xs = merge_lines(cx)
        self.ys = merge_lines(cy)

    # ------------------------------------------------------------------ helpers
    def thickness_at(self, lv: Level, x: float) -> float:
        zones = lv.spec["zones"] if lv.spec else [{"t": 200}]
        for zn in zones:
            lo = lv.gx.get(zn["from"], -1e9) if zn.get("from") else -1e9
            hi = lv.gx.get(zn["to"], 1e9) if zn.get("to") else 1e9
            if lo <= x < hi:
                return float(zn["t"])
        return float(zones[-1]["t"])

    def in_hole(self, lv: Level, x: float, y: float, pad=0.0):
        for h in lv.holes:
            x0, y0, x1, y1 = h["box"]
            if x0 + pad < x < x1 - pad and y0 + pad < y < y1 - pad:
                return h
        return None

    def is_balcony(self, lv: Level, y: float) -> bool:
        y7 = lv.gy.get("7")
        y2 = lv.gy.get("2", 0.0)
        return (y7 is not None and y > y7 + 150) or y < y2 - 300

    # ------------------------------------------------------------------ build
    def build(self, ops):
        """Create the OpenSees model. Keeps maps of every node and element for the results."""
        self.ops = ops
        ops.wipe()
        ops.model("basic", "-ndm", 3, "-ndf", 6)
        self.ntag = 0
        self.etag = 0
        self.xyz: dict[int, tuple[float, float, float]] = {}  # tag -> (x mm, y mm, z mm)
        self.node_level: dict[int, int] = {}
        self.fixed: dict[int, str] = {}  # base node -> group (column key / core name)
        self.slaves: dict[int, int] = {}  # constrained node -> retained node
        self.frames: list[dict] = []
        self.shells: list[dict] = []
        self.loads: dict[str, dict[int, np.ndarray]] = {"G_self": {}, "G_super": {}, "Q": {}}
        self.base_direct: dict[str, dict[str, float]] = {}  # loads applied straight onto base nodes, per group
        self.pool_info = None
        ops.geomTransf("Linear", 1, 0.0, 0.0, 1.0)  # horizontal members: local z = global Z
        ops.geomTransf("Linear", 2, 1.0, 0.0, 0.0)  # vertical members: local z = global X, local y = -Y
        self._sections = {}
        self._core_nodes = {}
        self._mesh_slabs()
        self._cores()
        self._beams()
        self._columns()
        self._area_loads()
        self.summary = dict(
            nodes=self.ntag, frames=len(self.frames), shells=len(self.shells),
            links=len(self.slaves), mesh=f"{len(self.xs)} x {len(self.ys)} lines",
        )
        return self

    def node(self, lvl: int, x: float, y: float, z: float) -> int:
        self.ntag += 1
        t = self.ntag
        self.ops.node(t, x / 1000, -y / 1000, z / 1000)
        self.xyz[t] = (x, y, z)
        self.node_level[t] = lvl
        return t

    def level_node(self, lv: Level, i: int, j: int) -> int:
        key = (i, j)
        if key not in lv.nodes:
            lv.nodes[key] = self.node(lv.idx, self.xs[i], self.ys[j], lv.z)
            if lv.idx == self.base.idx:
                self.ops.fix(lv.nodes[key], 1, 1, 1, 1, 1, 1)
        return lv.nodes[key]

    def shell_section(self, t_mm: float, kind: str) -> int:
        key = (round(t_mm), kind)
        if key not in self._sections:
            tag = len(self._sections) + 1
            st = self.cfg["stiffness"]
            if kind == "slab":
                self.ops.section("ElasticMembranePlateSection", tag, self.E, self.nu, t_mm / 1000, 0.0, st["slab_bending"])
            else:
                self.ops.section("ElasticMembranePlateSection", tag, self.E * st["core_E"], self.nu, t_mm / 1000, 0.0, 1.0)
            self._sections[key] = tag
        return self._sections[key]

    def add_load(self, case: str, node: int, f) -> None:
        node = self.slaves.get(node, node) if case != "_keep" else node
        arr = self.loads[case].setdefault(node, np.zeros(6))
        arr[: len(f)] += f

    def _mesh_slabs(self):
        for lv in self.levels:
            if lv.outline is None:
                continue
            poly = prep(lv.outline)
            for i in range(len(self.xs) - 1):
                xm = (self.xs[i] + self.xs[i + 1]) / 2
                for j in range(len(self.ys) - 1):
                    ym = (self.ys[j] + self.ys[j + 1]) / 2
                    if not poly.contains(Point(xm, ym)) or self.in_hole(lv, xm, ym):
                        continue
                    lv.cells[(i, j)] = self.thickness_at(lv, xm)
            for (i, j), t in lv.cells.items():
                n = [self.level_node(lv, i, j), self.level_node(lv, i + 1, j), self.level_node(lv, i + 1, j + 1), self.level_node(lv, i, j + 1)]
                # counter-clockwise seen from above: Y = -y flips the page, so go (i,j)->(i,j+1)->(i+1,j+1)->(i+1,j)
                n = [n[0], n[3], n[2], n[1]]
                self.etag += 1
                self.ops.element("ShellMITC4", self.etag, *n, self.shell_section(t, "slab"))
                area = (self.xs[i + 1] - self.xs[i]) * (self.ys[j + 1] - self.ys[j]) / 1e6
                self.shells.append(dict(tag=self.etag, kind="slab", level=lv.idx, ij=(i, j), nodes=n, t=t, area=area))

    def _cores(self):
        """Lift cores: shell walls on their centre lines, from the base to the last level they're recorded on."""
        self.cores: dict[str, dict] = {}
        for a, lv in enumerate(self.levels[:-1]):
            top = self.levels[a + 1]
            for c in lv.floor["cores"]:
                if not any(cc["name"] == c["name"] for cc in top.floor["cores"]):
                    continue
                xl, xr, yt, yb, dxs, dys = self._core_lines(c)
                il, ir = nearest_index(self.xs, xl), nearest_index(self.xs, xr)
                jt, jb = nearest_index(self.ys, yt), nearest_index(self.ys, yb)
                info = self.cores.setdefault(c["name"], dict(name=c["name"], ref=c["ref"], box=c["box"], wall=c["wall"], door=c.get("door"), segs=[], levels=[]))
                info["levels"].append(a)
                door = c.get("door")
                walls = [  # (side, fixed index, axis, from, to)
                    ("t", jt, "x", il, ir), ("b", jb, "x", il, ir), ("l", il, "y", jt, jb), ("r", ir, "y", jt, jb),
                ]
                for side, fix_i, axis, p, q in walls:
                    for k in range(p, q):
                        if axis == "x":
                            ij0, ij1 = (k, fix_i), (k + 1, fix_i)
                            mid = (self.xs[k] + self.xs[k + 1]) / 2
                            length = self.xs[k + 1] - self.xs[k]
                        else:
                            ij0, ij1 = (fix_i, k), (fix_i, k + 1)
                            mid = (self.ys[k] + self.ys[k + 1]) / 2
                            length = self.ys[k + 1] - self.ys[k]
                        in_door = False
                        if door and door["side"] == side:
                            lo = (c["box"][0] if axis == "x" else c["box"][1]) + door["from"]
                            in_door = lo < mid < lo + door["width"]
                        self._core_column(lv, top, ij0, ij1, c["wall"], in_door, c["name"], side, length)
                        if a == 0:
                            info["segs"].append(dict(side=side, ij0=ij0, ij1=ij1, door=in_door))

    def _core_column(self, lv, top, ij0, ij1, t, in_door, core, side, length):
        h = top.z - lv.z
        zs = [lv.z + h * k / CORE_SUBDIV for k in range(CORE_SUBDIV + 1)]

        def nd(ij, k):
            if k == 0:
                return self.level_node(lv, *ij)
            if k == CORE_SUBDIV:
                return self.level_node(top, *ij)
            key = ("core", ij, lv.idx, k)
            if key not in self._core_nodes:
                self._core_nodes[key] = self.node(lv.idx, self.xs[ij[0]], self.ys[ij[1]], zs[k])
            return self._core_nodes[key]

        sec = self.shell_section(t, "core")
        for k in range(CORE_SUBDIV):
            if in_door and k < CORE_SUBDIV - 1:
                continue
            n = [nd(ij0, k), nd(ij1, k), nd(ij1, k + 1), nd(ij0, k + 1)]
            self.etag += 1
            self.ops.element("ShellMITC4", self.etag, *n, sec)
            area = length * h / CORE_SUBDIV / 1e6
            self.shells.append(dict(tag=self.etag, kind="core", level=lv.idx, core=core, side=side, sub=k, nodes=n, t=t, area=area))
            w = area * t / 1000 * self.gamma
            for nn in n:
                self._apply_or_base("G_self", nn, w / 4, core)
        if lv.idx == self.base.idx:
            for ij in (ij0, ij1):
                self.fixed[self.level_node(lv, *ij)] = core

    def _apply_or_base(self, case, node, fz_down, group):
        """A vertical load (kN, downward) at a node; on a base node it's kept aside for the foundation sums."""
        if self.node_level.get(node) == self.base.idx and self.xyz[node][2] == self.base.z:
            d = self.base_direct.setdefault(group, {})
            d[case] = d.get(case, 0.0) + fz_down
            return
        self.add_load(case, node, [0, 0, -fz_down])

    def _beams(self):
        st = self.cfg["stiffness"]
        self.beam_runs = []
        for lv in self.levels:
            if lv.outline is None:
                continue
            near_slab = prep(lv.outline.buffer(120))
            seen: dict[tuple, dict] = {}
            for axis, at, lo, hi, depth, width, edge, label in self._beam_runs(lv) + self._pool_walls(lv):
                lines = self.ys if axis == "row" else self.xs
                k = nearest_index(lines, at)
                if abs(lines[k] - at) > MERGE_TOL:
                    self.warnings.append(f"{lv.name}: beam {label} is {abs(lines[k]-at):.0f} mm off the nearest mesh line")
                run = []
                along = self.xs if axis == "row" else self.ys
                for s in range(len(along) - 1):
                    a, b = along[s], along[s + 1]
                    if a < lo - MERGE_TOL / 2 or b > hi + MERGE_TOL / 2:
                        continue
                    ij0, ij1 = ((s, k), (s + 1, k)) if axis == "row" else ((k, s), (k, s + 1))
                    if ij0 not in lv.nodes or ij1 not in lv.nodes:
                        continue
                    mx, my = ((a + b) / 2, lines[k]) if axis == "row" else (lines[k], (a + b) / 2)
                    if not near_slab.contains(Point(mx, my)) or (self.in_hole(lv, mx, my, pad=60) and not label.startswith("pool")):
                        continue
                    key = (lv.idx, ij0, ij1)
                    if key in seen and seen[key]["depth"] * seen[key]["width"] >= depth * width:
                        continue
                    seen[key] = dict(depth=depth, width=width, label=label, axis=axis, edge=edge)
                    run.append(key)
                self.beam_runs.append(dict(level=lv.idx, label=label, segs=len(run)))
            for (li, ij0, ij1), b in seen.items():
                n0, n1 = lv.nodes[ij0], lv.nodes[ij1]
                d, w = b["depth"] / 1000, b["width"] / 1000
                A = d * w
                Iy = w * d**3 / 12 * st["beam_I"]
                Iz = d * w**3 / 12 * st["beam_I"]
                J = torsion_J(d, w) * st["beam_torsion"]
                self.etag += 1
                self.ops.element("elasticBeamColumn", self.etag, n0, n1, A, self.E, self.G, J, Iy, Iz, 1)
                L = math.dist(self.xyz[n0][:2], self.xyz[n1][:2]) / 1000
                tslab = self.thickness_at(lv, (self.xyz[n0][0] + self.xyz[n1][0]) / 2) / 1000
                down = max(0.0, d - tslab)
                wself = 0.0 if b["label"].startswith("pool") else down * w * self.gamma * L  # pool walls: weight is in the pool load
                self.add_load("G_self", n0, [0, 0, -wself / 2])
                self.add_load("G_self", n1, [0, 0, -wself / 2])
                self.frames.append(dict(tag=self.etag, kind="beam", level=lv.idx, nodes=(n0, n1), b=b["width"], h=b["depth"], L=L, label=b["label"], axis=b["axis"], edge=b["edge"]))

    def nearest_level_node(self, lv: Level, x: float, y: float):
        best, bd = None, 1e18
        for (i, j), tag in lv.nodes.items():
            d = (self.xs[i] - x) ** 2 + (self.ys[j] - y) ** 2
            if d < bd:
                best, bd = tag, d
        return best, math.sqrt(bd)

    def _columns(self):
        st = self.cfg["stiffness"]
        for a, lv in enumerate(self.levels[:-1]):
            top = self.levels[a + 1]
            for c in lv.floor["columns"]:
                if not c.get("box"):
                    continue
                x0, y0, x1, y1 = c["box"]
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                wx, hy = (x1 - x0) / 1000, (y1 - y0) / 1000
                is_wall = c["kind"] == "wall"
                group = f"{lv.key}:{c['key']}"
                ends = []
                for L in (lv, top):
                    if L.idx == self.base.idx:
                        n = self.node(L.idx, cx, cy, L.z)
                        self.ops.fix(n, 1, 1, 1, 1, 1, 1)
                        self.fixed[n] = group
                        ends.append((n, None, 0.0))
                        continue
                    m, d = self.nearest_level_node(L, cx, cy)
                    n = self.node(L.idx, cx, cy, L.z)
                    if m is None or d > LINK_MAX:
                        self.warnings.append(f"{c['name']} at {c['ref']} ({lv.name}): no slab within {LINK_MAX/1000:.1f} m at {L.name}; its end is left free")
                        ends.append((n, None, d))
                        continue
                    self.ops.rigidLink("beam", m, n)
                    self.slaves[n] = m
                    ends.append((n, m, d))
                    if is_wall:
                        self._wall_arms(L, c, m)
                A = wx * hy
                mod = st["wall_I"] if is_wall else st["column_I"]
                Iz = wx * hy**3 / 12 * mod  # bending about X (uses the depth along Y)
                Iy = hy * wx**3 / 12 * mod  # bending about Y
                J = torsion_J(wx, hy)
                self.etag += 1
                self.ops.element("elasticBeamColumn", self.etag, ends[0][0], ends[1][0], A, self.E, self.G, J, Iy, Iz, 2)
                h = (top.z - lv.z) / 1000
                w = A * h * self.gamma
                self._apply_or_base("G_self", ends[0][0], w / 2, group)
                self.add_load("G_self", ends[1][0], [0, 0, -w / 2])
                self.frames.append(dict(
                    tag=self.etag, kind="wall" if is_wall else "column", level=lv.idx, nodes=(ends[0][0], ends[1][0]),
                    name=c["name"], ref=c["ref"], key=c["key"], group=group, bx=x1 - x0, by=y1 - y0, cx=cx, cy=cy, L=h,
                    measured=c.get("measured", False), offsets=[round(e[2]) for e in ends],
                ))

    def _wall_arms(self, L: Level, c, master):
        """Stiff arms in the slab from a wall's middle to the slab nodes at its two ends."""
        x0, y0, x1, y1 = c["box"]
        along_x = (x1 - x0) >= (y1 - y0)
        ends = [((x0, (y0 + y1) / 2)), ((x1, (y0 + y1) / 2))] if along_x else [((x0 + x1) / 2, y0), ((x0 + x1) / 2, y1)]
        for ex, ey in ends:
            n, d = self.nearest_level_node(L, ex, ey)
            if n is None or n == master or d > 600:
                continue
            self.etag += 1
            self.ops.element("elasticBeamColumn", self.etag, master, n, 1.0, self.E, self.G, 0.1, 0.1, 0.1, 1)
            self.frames.append(dict(tag=self.etag, kind="arm", level=L.idx, nodes=(master, n)))

    # ------------------------------------------------------------------ gravity loads
    def _area_loads(self):
        cfg = self.cfg
        dead, walls, imp, stairs = cfg["dead"], cfg["walls"], cfg["imposed"], cfg["stairs"]
        top_idx = self.levels[-1].idx
        for lv in self.levels:
            if lv.outline is None:
                continue
            roof = lv.idx == top_idx
            for (i, j), t in lv.cells.items():
                xm = (self.xs[i] + self.xs[i + 1]) / 2
                ym = (self.ys[j] + self.ys[j + 1]) / 2
                area = (self.xs[i + 1] - self.xs[i]) * (self.ys[j + 1] - self.ys[j]) / 1e6
                corners = [lv.nodes[(i, j)], lv.nodes[(i + 1, j)], lv.nodes[(i + 1, j + 1)], lv.nodes[(i, j + 1)]]
                balc = self.is_balcony(lv, ym)
                g_self = t / 1000 * self.gamma
                if roof:
                    g_sup = dead["roof_finishes_kPa"] + dead["ceiling_services_kPa"]
                    q = imp["roof_kPa"]
                else:
                    g_sup = dead["finishes_kPa"] + dead["ceiling_services_kPa"] + (0 if balc else walls["internal_kPa"])
                    q = imp["balcony_kPa"] if balc else imp["floor_kPa"]
                for n in corners:
                    self.add_load("G_self", n, [0, 0, -g_self * area / 4])
                    self.add_load("G_super", n, [0, 0, -g_sup * area / 4])
                    self.add_load("Q", n, [0, 0, -q * area / 4])
            # Walls and balustrades round the slab's outside edge.
            for (i, j) in lv.cells:
                for (di, dj), (na, nb) in {
                    (0, -1): ((i, j), (i + 1, j)), (0, 1): ((i, j + 1), (i + 1, j + 1)),
                    (-1, 0): ((i, j), (i, j + 1)), (1, 0): ((i + 1, j), (i + 1, j + 1)),
                }.items():
                    nbr = (i + di, j + dj)
                    if nbr in lv.cells:
                        continue
                    xm = (self.xs[i] + self.xs[i + 1]) / 2
                    ym = (self.ys[j] + self.ys[j + 1]) / 2
                    # the far side: outside the outline (an edge) or a hole (not loaded here)
                    if 0 <= nbr[0] < len(self.xs) - 1 and 0 <= nbr[1] < len(self.ys) - 1:
                        fx = (self.xs[nbr[0]] + self.xs[nbr[0] + 1]) / 2
                        fy = (self.ys[nbr[1]] + self.ys[nbr[1] + 1]) / 2
                        if lv.outline.contains(Point(fx, fy)):
                            continue
                    length = math.dist((self.xs[na[0]], self.ys[na[1]]), (self.xs[nb[0]], self.ys[nb[1]])) / 1000
                    if lv.idx == top_idx:
                        w = walls["balustrade_kN_m"]  # parapet round the roof
                    else:
                        w = walls["balustrade_kN_m"] if self.is_balcony(lv, ym) else walls["external_kN_m"]
                    for n in (lv.nodes[na], lv.nodes[nb]):
                        self.add_load("G_super", n, [0, 0, -w * length / 2])
            # Stairs and the pool: carried round the edge of their opening.
            for h in lv.holes:
                if h["kind"] not in ("stair", "pool"):
                    continue
                x0, y0, x1, y1 = h["box"]
                area = (x1 - x0) * (y1 - y0) / 1e6
                if h["kind"] == "stair":
                    G = area * (stairs["self_kPa"] + stairs["finishes_kPa"])
                    Q = area * imp["stairs_kPa"]
                else:
                    p = cfg["pool"]
                    per = 2 * ((x1 - x0) + (y1 - y0)) / 1000
                    G = area * (p["water_depth_m"] * 10 + p["base_slab_m"] * self.gamma + p["finishes_kPa"]) + per * p["wall_depth_m"] * p["wall_t_m"] * self.gamma
                    Q = 0.0
                    self.pool_info = dict(level=lv.name, area_m2=round(area, 1), G_kN=round(G))
                ring = self.ring_nodes(lv, h["box"])
                if not ring:
                    self.warnings.append(f"{lv.name}: no slab round {h['name']}; its load is left out")
                    continue
                for n in ring:
                    self.add_load("G_self", n, [0, 0, -G / len(ring)])
                    if Q:
                        self.add_load("Q", n, [0, 0, -Q / len(ring)])
        # Lifts: at the top of each shaft.
        for name, info in self.cores.items():
            topl = self.levels[max(info["levels"]) + 1]
            ring = [topl.nodes[s] for s in {seg[k] for seg in info["segs"] for k in ("ij0", "ij1")} if s in topl.nodes]
            for n in ring:
                self.add_load("G_super", n, [0, 0, -cfg["lifts"]["G_kN"] / len(ring)])
                self.add_load("Q", n, [0, 0, -cfg["lifts"]["Q_kN"] / len(ring)])
        for tank in cfg["roof_tanks"]["items"]:
            lv = self.levels[-1]
            n, _ = self.nearest_level_node(lv, tank["x_mm"], tank["y_mm"])
            self.add_load("G_super", n, [0, 0, -tank["kN"]])

    def ring_nodes(self, lv: Level, box):
        x0, y0, x1, y1 = box
        out = []
        for (i, j), tag in lv.nodes.items():
            x, y = self.xs[i], self.ys[j]
            if x0 - MERGE_TOL <= x <= x1 + MERGE_TOL and y0 - MERGE_TOL <= y <= y1 + MERGE_TOL:
                on_edge = min(abs(x - x0), abs(x - x1)) <= MERGE_TOL or min(abs(y - y0), abs(y - y1)) <= MERGE_TOL
                if on_edge:
                    out.append(tag)
        return out
