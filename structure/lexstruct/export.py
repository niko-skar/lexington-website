"""The data the 3D viewer draws: the building in layers, with the analysis results on each element.

Layers: 'structure' now (slabs, columns, walls, lift cores, beams, foundations); 'architecture',
'mep' and 'other' are there, empty, for the plan walls, services and the rest to go in later. All
positions in metres in the viewer's frame: X = x/1000 (right from grid B), Y = up, Z = y/1000 (down
the page), so the plan reads like the drawings when seen from above.
"""
from __future__ import annotations

import json
import math
import re

import numpy as np


def r(v, n=3):
    return round(float(v), n)


def export_viewer(b, a, d, results, path):
    G, Q = a.cases["G"], a.cases["Q"]
    col_rows = {c["tag"]: c for c in d.columns}
    sens = {c["tag"]: c for c in (results.get("seismic_sensitivity") or {}).get("columns", [])}
    levels = [dict(key=lv.key, name=lv.name, short=lv.short, z=r(lv.z / 1000)) for lv in b.levels]

    slabs = []
    for lv in b.levels:
        if lv.outline is None:
            continue
        holes = [dict(name=h["name"], kind=h["kind"], box=[r(v / 1000) for v in h["box"]]) for h in lv.holes]
        zones = (lv.spec or {}).get("zones", [{"t": 200}])
        t = max(z["t"] for z in zones)
        slabs.append(dict(level=lv.key, z=r(lv.z / 1000), t=t / 1000, outline=[[r(x / 1000), r(y / 1000)] for x, y in lv.outline.exterior.coords[:-1]],
                          holes=holes, source=(lv.spec or {}).get("source"), borrowed=(lv.spec or {}).get("borrowed")))

    columns = []
    for idx, fr in enumerate(a.frame_list):
        if fr["kind"] not in ("column", "wall"):
            continue
        lv = b.levels[fr["level"]]
        top = b.levels[fr["level"] + 1]
        c = col_rows.get(fr["tag"], {})
        x0, y0 = fr["cx"] - fr["bx"] / 2, fr["cy"] - fr["by"] / 2
        columns.append(dict(
            id=fr["tag"], kind=fr["kind"], name=fr["name"], ref=fr["ref"], level=lv.key,
            box=[r(x0 / 1000), r(y0 / 1000), r((x0 + fr["bx"]) / 1000), r((y0 + fr["by"]) / 1000)], z0=r(lv.z / 1000), z1=r(top.z / 1000),
            NG=round(float(G.frames[idx][0])), NQ=round(float(Q.frames[idx][0])), Nuls=c.get("N_uls"), axial=c.get("axial_ratio"),
            rho_g=c.get("rho_needed_gravity"), rho_s=c.get("rho_needed_seismic"), prov=c.get("provided"), rho_prov=c.get("rho_provided"),
            ug=c.get("util_gravity"), us=c.get("util_seismic"), measured=fr.get("measured", False),
            rho_s2=sens.get(fr["tag"], {}).get("rho_needed_seismic"), us2=sens.get(fr["tag"], {}).get("util_seismic"),
            ug35=(results.get("concrete_c28") or {}).get(fr["tag"]),
        ))

    cores = []
    core_rows = {(c["core"], c["level"]): c for c in d.cores}
    for name, info in b.cores.items():
        for li in info["levels"]:
            lv, top = b.levels[li], b.levels[li + 1]
            c = core_rows.get((name, lv.key), {})
            cores.append(dict(name=name, level=lv.key, box=[r(v / 1000) for v in info["box"]], wall=info["wall"] / 1000, door=info.get("door"),
                              z0=r(lv.z / 1000), z1=r(top.z / 1000), NG=c.get("N_G"), NQ=c.get("N_Q"), rho_g=c.get("rho_needed_gravity"), rho_s=c.get("rho_needed_seismic"),
                              ug=c.get("util_gravity_at_0_5pct"), us=c.get("util_seismic_at_0_5pct"),
                              V=c.get("V_seis"), M=c.get("M_seis")))

    beams = []
    beam_rows = {(r_["level"], r_["label"]): r_ for r_ in d.beams}
    tag_to_frame = {f["tag"]: f for f in a.frame_list}
    for (lvl, label), row in beam_rows.items():
        segs = [tag_to_frame[t] for t in row["tags"]]
        lv = next(l for l in b.levels if l.key == lvl)
        # merge touching segments into runs
        pts = []
        for f in segs:
            n0, n1 = f["nodes"]
            pts.append((b.xyz[n0][:2], b.xyz[n1][:2]))
        pts.sort()
        runs = []
        for p, q in pts:
            p, q = (p, q) if p <= q else (q, p)
            if runs and math.dist(runs[-1][1], p) < 1:
                runs[-1][1] = q
            else:
                runs.append([p, q])
        for p, q in runs:
            beams.append(dict(level=lvl, label=label, a=[r(p[0] / 1000), r(p[1] / 1000)], b_=[r(q[0] / 1000), r(q[1] / 1000)], z=r(lv.z / 1000),
                              w=row["b"] / 1000, h=row["h"] / 1000, Mhog=row["M_hog"], Msag=row["M_sag"], V=row["V"], As_top=row["As_top"],
                              As_bot=row["As_bottom"], As_comp=row["As_comp"], links=row["links_mm2_per_m"], ok=row["ok"], seis=row["seis"]))

    foundations = []
    raft = None
    if b.raft is not None:
        rn = d.raft_nodes_out
        at = {r_["ij"]: k for k, r_ in enumerate(b.raft_nodes)}
        tiles = []
        for ci, (i, j) in enumerate(d.raft_cells["ij"]):
            ks = [at[(i, j)], at[(i + 1, j)], at[(i, j + 1)], at[(i + 1, j + 1)]]
            tiles.append([r(b.xs[i] / 1000), r(b.ys[j] / 1000), r(b.xs[i + 1] / 1000), r(b.ys[j + 1] / 1000),
                          round(float(np.mean(rn["p_sls"][ks]))), round(float(np.min(rn["p_min"][ks]))), round(float(np.max(rn["p_max"][ks]))),
                          r(float(np.mean(rn["settle"][ks])), 1), round(float(d.raft_cells["As"][ci].max())), b.base.cells[(i, j)] / 1000,
                          r(float(d.raft_cells["use"][ci]), 2) if np.isfinite(d.raft_cells["use"][ci]) else None,
                          r(float(d.raft_cells["use_p"][ci]), 2) if np.isfinite(d.raft_cells["use_p"][ci]) else None])
        raft = dict(summary=d.raft, z=r(b.base.z / 1000), t=b.raft_cfg["t_mm"] / 1000, qa=b.cfg["soil"]["bearing_kPa"],
                    tiles=tiles, keys=["x0", "y0", "x1", "y1", "p_sls", "p_min_seis", "p_max_seis", "settle_mm", "As_max", "t", "steel_use", "steel_use_gravity"],
                    punching=d.found, src=b.raft_cfg.get("src"))
    for f in ([] if b.raft is not None else d.found):
        side = max(f["base_side_m"], f.get("base_side_seis_m") or 0)
        foundations.append(dict(group=f["group"], name=f["name"], ref=f["ref"], x=r(f["x"] / 1000), y=r(f["y"] / 1000), z=r(b.base.z / 1000),
                                side=side, side_sls=f["base_side_m"], Nsls=f["N_sls"], Nuls=f["N_uls"], NG=f["N_G"], NQ=f["N_Q"],
                                Nmax=f.get("N_seis_max"), Nmin=f.get("N_seis_min"), M=f.get("M_seis"), uplift=f.get("uplift"),
                                r10_base=f.get("r10_base"), r10_sls_kPa=f.get("r10_sls_kPa")))

    architecture = architecture_layer(b)

    modes = []
    for k in range(min(9, len(a.T))):
        ph = a.phi[:, k]
        scale = 1.0 / max(1e-9, np.abs(np.concatenate([ph[0::3], ph[1::3]])).max())
        modes.append(dict(T=r(a.T[k]), mx=r(a.meff["x"][k] * 100, 1), my=r(a.meff["y"][k] * 100, 1), twist=r(a.twist_share[k] * 100, 0),
                          floors=[dict(level=b.levels[fl["level"]].key, cx=r(fl["xc"]), cz=r(-fl["yc"]), ux=r(ph[3 * i] * scale), uz=r(-ph[3 * i + 1] * scale), th=r(ph[3 * i + 2] * scale, 5))
                                  for i, fl in enumerate(a.floors)]))

    data = dict(
        name="The Lexington", generated=results["generated"], levels=levels,
        grid=dict(x=[dict(id=g["id"], p=r(g["pos"] / 1000)) for g in b.asbuilt["floors"][1]["grid"]["x"]],
                  y=[dict(id=g["id"], p=r(g["pos"] / 1000)) for g in b.asbuilt["floors"][1]["grid"]["y"]]),
        layers=dict(
            structure=dict(slabs=slabs, columns=columns, cores=cores, beams=beams, foundations=foundations, raft=raft),
            architecture=architecture,
            mep=dict(items=[], note="Services (water, drainage, electrical, lifts) go here."),
            other=dict(items=[], site=architecture.pop("site", None), note="Site, landscaping and anything else."),
        ),
        modes=modes,
        summary=dict(totals=results["totals"], seismic=results["seismic"], wind=results["wind"], model=results["model"], pool=results["pool"]),
        report=dict(
            asbuilt=results["inputs"]["asbuilt"], floors=results["floors"], drift=results["drift"],
            drift_sens=(results.get("seismic_sensitivity") or {}).get("drift"), sens_ag=(results.get("seismic_sensitivity") or {}).get("agR_g"),
            torsion=results["torsion"], modes=results["modes"], deflection=results["deflection"], warnings=results["warnings"],
            foundations=d.found, cores=d.cores, flat_slab_punching=getattr(d, "punch2", None),
            concrete_c28=results.get("concrete_c28"),
            cores_sens=(results.get("seismic_sensitivity") or {}).get("cores"),
            basis={k: v for k, v in b.cfg.items() if k != "_about"},
        ),
    )
    path.write_text(json.dumps(data, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else str(o)))


def architecture_layer(b):
    """The building's skin and layouts, and the homes as the live website lists them (see facade.py for the rules).

    - Every floor: 225 mm block walls on the as-built slab edges (the 7th floor: under the roof), with the architect's
      windows in them (model/arch_windows.json, read off the floor plans); walls set back where the plans put a window
      behind a balcony; glass balustrades round balconies and terraces; a white band on every slab edge; downlights in
      the soffits over balconies and the car park; the roof parapet.
    - Where the plans editor has a layout with external walls (the 1st floor) its walls, windows and doors are used.
    - The ground floor: the lift lobbies' fronts with their entrance doors.
    - Stair shafts from the as-built openings; rooms and homes from the layouts."""
    import json as _json
    from pathlib import Path as _Path

    from shapely.geometry import LineString, Point, Polygon
    from shapely.geometry import box as sbox
    from shapely.ops import unary_union

    from . import facade as F
    from .building import model_file

    lv_by_key = {lv.key: lv for lv in b.levels}
    roof = b.levels[-1]
    ac = _json.loads(model_file("architecture.json").read_text()) if model_file("architecture.json").exists() else {}
    awp = _Path(__file__).resolve().parents[1] / "model" / "arch_windows.json"
    aw = _json.loads(awp.read_text())["windows"] if awp.exists() else []
    pick = ac.get("layout_pick", {})
    words = {w.lower() for w in ac.get("room_words", [])}

    def clean(name, typ):
        # only everyday room words get through; anything else (a person's name) becomes the room type
        if not name:
            return None
        toks = re.findall(r"[\w&'-]+", name.lower())
        return name if toks and all(t in words for t in toks) else (typ or "room").capitalize()

    def tslab(lv):
        return max(z["t"] for z in (lv.spec or {}).get("zones", [{"t": 200}])) if lv is not None and lv.outline is not None else 200

    def m(p):
        return [r(p[0] / 1000), r(p[1] / 1000)]

    def out_wall(level, w, **extra):
        d = dict(level=level, kind=w["kind"], a=m(w["a"]), b=m(w["b"]), z0=r(w["z0"] / 1000), z1=r(w["z1"] / 1000), t=r(w["t"] / 1000))
        if w.get("note"):
            d["note"] = w["note"]
        d.update(extra)
        return d

    def out_window(level, w, src):
        return dict(level=level, a=m(w["a"]), b=m(w["b"]), n=list(w["n"]), z0=r(w["z0"] / 1000), z1=r(w["z1"] / 1000), t=r(w["t"] / 1000),
                    kind=w["kind"], panes=w["panes"], tag=w.get("tag"), sheet=w.get("sheet"), w_drawn=w.get("width_drawn"),
                    narrowed=bool(w.get("narrowed")), src=src, inner=bool(w.get("inner")))

    # the plans editor's layouts (model/plans.json from tools/export-plans.ts); a floor's first layout unless picked
    plan_floors = {}
    pp = model_file("plans.json")
    if pp.exists():
        for opt in _json.loads(pp.read_text()).get("options", []):
            fk = opt["floorKey"]
            want = pick.get(fk)
            if (want is not None and opt["option"] != want) or fk in plan_floors:
                continue
            plan_floors[fk] = opt

    walls, windows, lights, stairs, rooms, homes_geo = [], [], [], [], [], []
    report = {}
    enclosures = {}
    for i, lv in enumerate(b.levels[:-1]):
        nxt = b.levels[i + 1]
        if lv.outline is not None:
            opt = plan_floors.get(lv.key)
            lay = None
            ext = [w for w in (opt or {}).get("walls", []) if w["kind"] in ("external", "glazing", "balustrade")]
            if ext:
                segs = [LineString([(w["s0"], w["c"]), (w["s1"], w["c"])] if w["dir"] == "h" else [(w["c"], w["s0"]), (w["c"], w["s1"])]) for w in ext]
                indoor = [Polygon(rm["loops"][0]) for rm in opt.get("rooms", []) if rm.get("loops") and rm.get("type") not in ("balcony", "terrace", None)]
                lay = dict(cover=unary_union([s.buffer(F.COVER, cap_style=2) for s in segs]),
                           indoor=unary_union([p.buffer(0) for p in indoor]) if indoor else None)
            mine = [w for w in aw if lv.key in w["floors"]]
            sk = F.floor_skin(b, lv, nxt, roof, mine, lay, ac)
            enclosures[lv.key] = sk["enclosure"]
            walls += [out_wall(lv.key, w) for w in sk["walls"]]
            walls += [out_wall(lv.key, w) for w in sk["balustrades"]]
            windows += [out_window(lv.key, w, "architect") for w in sk["windows"]]
            report[lv.key] = dict(architect_windows=len(mine), placed=len(sk["windows"]), balconies=len(sk["zones"]), left_out=sk["dropped"],
                                  narrowed=sum(1 for w in sk["windows"] if w["narrowed"]), layout=bool(lay))
            for h in lv.holes:
                if h["kind"] == "stair":
                    x0, y0, x1, y1 = h["box"]
                    stairs.append(dict(level=lv.key, name=h["name"], box=[r(x0 / 1000), r(y0 / 1000), r(x1 / 1000), r(y1 / 1000)], z0=r(lv.z / 1000), z1=r(nxt.z / 1000)))
        # downlights under the slab above, wherever it is outside this floor's enclosure
        if nxt.outline is not None:
            zs = (nxt.z - tslab(nxt)) / 1000 - 0.01
            # the car park's soffit lights sit further in, where they show from the street past the slab-edge band
            for x, y, _ in F.downlights(nxt.outline, enclosures.get(lv.key), zs, inset=1200 if lv.idx == 0 else 350):
                lights.append([r(x / 1000, 2), r(y / 1000, 2), r(zs, 2), lv.key])
    for lv in b.levels:
        if lv.outline is not None and lv.idx > 0:
            walls += [out_wall(lv.key, w) for w in F.fascia(lv, tslab(lv))]
    if roof.outline is not None:
        cs = list(roof.outline.exterior.coords)
        for (xa, ya), (xb, yb) in zip(cs[:-1], cs[1:]):
            walls.append(dict(level=roof.key, kind="parapet", a=[r(xa / 1000), r(ya / 1000)], b=[r(xb / 1000), r(yb / 1000)], z0=r(roof.z / 1000), z1=r(roof.z / 1000 + 0.6), t=0.15))
    # the ground floor's lift lobbies
    lob_walls, lob_doors = F.ground_lobbies(b)
    g = b.levels[0]
    walls += [out_wall(g.key, w) for w in lob_walls]
    windows += [out_window(g.key, w, "renders") for w in lob_doors]

    # the layouts: walls cut round their openings; windows and doors in external walls drawn as windows
    for key, opt in plan_floors.items():
        lv = lv_by_key.get(key)
        if lv is None:
            continue
        nxt = b.levels[lv.idx + 1] if lv.idx + 1 < len(b.levels) else None
        z0 = lv.z
        z1 = (nxt.z - tslab(nxt)) if nxt is not None else z0 + 2900
        S = lv.outline
        ops_by_wall = {}
        for o in opt.get("openings", []):
            ops_by_wall.setdefault(o["wall"], []).append(o)
        # a layout's inside walls traced along the facade or a slab edge (the rough layouts trace the outside walls as
        # partitions) give way to the facade there: only walls running the same way within 0.65 m of it are cut back
        along = {"h": [], "v": []}
        for e in F.edges(S) + F.edges(enclosures.get(key)):
            if e["dir"] == "h":
                along["h"].append(LineString([(e["s0"], e["c"]), (e["s1"], e["c"])]).buffer(650, cap_style=2))
            elif e["dir"] == "v":
                along["v"].append(LineString([(e["c"], e["s0"]), (e["c"], e["s1"])]).buffer(650, cap_style=2))
        along = {k: unary_union(v) if v else None for k, v in along.items()}

        def spans(w):
            if w["kind"] in ("external", "glazing", "balustrade") or along.get(w["dir"]) is None:
                return [(w["s0"], w["s1"])]
            seg = LineString([(w["s0"], w["c"]), (w["s1"], w["c"])] if w["dir"] == "h" else [(w["c"], w["s0"]), (w["c"], w["s1"])])
            rest = seg.difference(along[w["dir"]])
            k = 0 if w["dir"] == "h" else 1
            out = []
            for g_ in getattr(rest, "geoms", [rest]):
                if not g_.is_empty and g_.length > 300:
                    cs = list(g_.coords)
                    out.append((min(cs[0][k], cs[-1][k]), max(cs[0][k], cs[-1][k])))
            return out

        def layout_wall(w, s0_, s1_):
            w = dict(w, s0=s0_, s1=s1_)
            glass_wall = w["kind"] in ("glazing", "balustrade")
            outer = w["kind"] in ("external", "glazing")
            top = z0 + 1100 if w["kind"] == "balustrade" else z1
            P = (lambda s, w=w: (s, w["c"])) if w["dir"] == "h" else (lambda s, w=w: (w["c"], s))
            cuts = sorted([o for o in ops_by_wall.get(w["key"], []) if s0_ <= o["at"] <= s1_], key=lambda o: o["at"])
            pos = w["s0"]
            pieces = []
            for o in cuts:
                a, bb = max(w["s0"], o["at"] - o["w"] / 2), min(w["s1"], o["at"] + o["w"] / 2)
                if a > pos:
                    pieces.append((pos, a, z0, top, glass_wall))
                kind = {"window": "sliding", "slider": "slider", "door": "door"}.get(o["kind"], "door")
                sill, head = (900, 2100) if kind == "sliding" else (0, 2100)
                if kind == "door" and not outer:
                    head = 2100  # an inside door: just the opening
                else:
                    # which side is outside: the side away from the floor's slab, or away from its middle
                    mx, my = P((a + bb) / 2)
                    n = (0, 1) if w["dir"] == "h" else (1, 0)
                    if S is not None:
                        pa = Point(mx + n[0] * 1500, my + n[1] * 1500)
                        pb = Point(mx - n[0] * 1500, my - n[1] * 1500)
                        if S.contains(pa) and not S.contains(pb):
                            n = (-n[0], -n[1])
                        elif S.contains(pa) == S.contains(pb):
                            cx, cy = S.centroid.x, S.centroid.y
                            if (mx - cx) * n[0] + (my - cy) * n[1] < 0:
                                n = (-n[0], -n[1])
                    windows.append(out_window(key, dict(a=P(a), b=P(bb), n=n, z0=z0 + sill, z1=z0 + head, t=w["t"], kind=kind,
                                                        panes=max(1, round((bb - a) / 1300)), tag="plans editor", width_drawn=o["w"],
                                                        inner=not outer), "layout"))
                if sill > 0:
                    pieces.append((a, bb, z0, z0 + sill, False))
                pieces.append((a, bb, z0 + head, top, glass_wall))
                pos = max(pos, bb)
            if pos < w["s1"]:
                pieces.append((pos, w["s1"], z0, top, glass_wall))
            for sa, sb, za, zb, glass in pieces:
                if sb - sa < 20 or zb - za < 20:
                    continue
                walls.append(dict(level=key, kind="plan-" + w["kind"], glass=glass, a=m(P(sa)), b=m(P(sb)), z0=r(za / 1000), z1=r(zb / 1000), t=w["t"] / 1000))

        for w0 in opt["walls"]:
            for s0_, s1_ in spans(w0):
                layout_wall(w0, s0_, s1_)
        for rm in opt.get("rooms", []):
            if rm.get("name") is None and rm.get("type") is None:
                continue
            rooms.append(dict(level=key, name=clean(rm["name"], rm["type"]), type=rm["type"], unit=rm["unit"], area=rm["area"], z=r(z0 / 1000),
                              loops=[[[r(x / 1000), r(y / 1000)] for x, y in l] for l in rm["loops"]]))
        for h in opt.get("homes", []):
            homes_geo.append(dict(level=key, unit=h["unit"], nia=h["nia"], outdoor=h["outdoor"], z=r(z0 / 1000),
                                  loops=[[[r(x / 1000), r(y / 1000)] for x, y in l] for l in h["loops"]]))

    # the site: cars in the car park, palms on the top floor's terraces
    top = b.levels[-2]
    terrace = top.outline.difference(enclosures[top.key]) if top.outline is not None and top.key in enclosures else None
    if terrace is not None and roof.outline is not None:
        terrace = terrace.difference(roof.outline)  # palms only where open to the sky
    # parasols on the open decks (the pool deck)
    paras = []
    for oa in ac.get("open_areas", []):
        lv = lv_by_key.get(oa.get("floor"))
        if lv is None or lv.outline is None or lv.key not in enclosures:
            continue
        deck = lv.outline.difference(enclosures[lv.key])
        for h in lv.holes:
            deck = deck.difference(sbox(*h["box"]).buffer(300))
        if roof.outline is not None and lv.idx + 1 == roof.idx:
            continue  # the roof terrace gets palms instead
        paras += F.umbrellas(deck, lv.z)
    site = dict(
        umbrellas=[[r(p["x"] / 1000, 2), r(p["y"] / 1000, 2), r(p["z"] / 1000, 2)] for p in paras],
        cars=[[r(c["x"] / 1000, 2), r(c["y"] / 1000, 2), c["dir"], c["colour"]] for c in F.car_park(b, lob_walls)],
        palms=[[r(p["x"] / 1000, 2), r(p["y"] / 1000, 2), r(p["z"] / 1000, 2), r(p["h"] / 1000, 2)] for p in (F.palms(b, terrace, top.z) if terrace is not None else [])],
        ground=r(b.levels[0].z / 1000 - 0.02),
        note="Cars and palms are set dressing, placed like the renders; the ground is the car park level.")

    homes, fetched = [], None
    wp = _Path(__file__).resolve().parents[1] / "model" / "website.json"
    if wp.exists():
        w = _json.loads(wp.read_text())
        fetched = w.get("fetched")
        keys = [lv.key for lv in b.levels]
        for u in w.get("units", []):
            f = u.get("floor")
            homes.append(dict(unit=u.get("unitNumber"), floor=f, level=keys[f] if isinstance(f, int) and 0 <= f < len(keys) else None,
                              type=u.get("bedroomType"), area=u.get("areaSqm"), balcony=u.get("balconySqm"), terrace=u.get("terraceSqm"),
                              price=u.get("priceUSD"), status=u.get("status")))
    return dict(walls=walls, windows=windows, lights=lights, stairs=stairs, homes=homes, homes_fetched=fetched, rooms=rooms, home_outlines=homes_geo,
                layouts={k: dict(option=v["option"], updatedAt=v.get("updatedAt"), walls=len(v["walls"]), problems=v.get("problems", [])) for k, v in plan_floors.items()},
                facade=report, site=site,
                open_areas=[dict(floor=o["floor"], name=o["name"]) for o in ac.get("open_areas", [])],
                note="Walls on the as-built slab edges with the architect's windows (floor plans A105-A110, schedule A119) placed on the "
                     "as-built grid; balconies where the plans set the wall back; the plans editor's layout where it has external walls.")
