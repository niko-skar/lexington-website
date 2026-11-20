"""The data the 3D viewer draws: the building in layers, with the analysis results on each element.

Layers: 'structure' now (slabs, columns, walls, lift cores, beams, foundations); 'architecture',
'mep' and 'other' are there, empty, for the plan walls, services and the rest to go in later. All
positions in metres in the viewer's frame: X = x/1000 (right from grid B), Y = up, Z = y/1000 (down
the page), so the plan reads like the drawings when seen from above.
"""
from __future__ import annotations

import json
import math

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
            other=dict(items=[], note="Site, landscaping and anything else."),
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
    """The building's shell from the as-built record, and the homes as the live website lists them.

    - Facade walls on every slab edge that is not a balcony (225 mm block, slab to the slab above), and on grid 7
      behind the balconies; glass-like balustrades on balcony edges; a parapet round the roof.
    - On the 7th floor (penthouses and roof terraces) the walls follow the roof's outline (what the roof covers is
      indoors); the rest of its slab edge gets a terrace balustrade.
    - Stair shafts from the as-built openings.
    The walls inside each home come in from the plans editor's layouts when they can be read."""
    import json as _json
    from pathlib import Path as _Path
    from shapely.geometry import LineString

    walls, stairs = [], []
    lv_by_key = {lv.key: lv for lv in b.levels}
    roof = b.levels[-1]
    for i, lv in enumerate(b.levels[:-1]):
        if lv.outline is None:
            continue
        nxt = b.levels[i + 1]
        t_next = (max(z["t"] for z in (nxt.spec or {}).get("zones", [{"t": 200}])) if nxt.outline is not None else 0) / 1000
        z0, z1 = lv.z / 1000, nxt.z / 1000 - t_next
        y7 = b.grid_lookup(lv, "y").get("7")
        enclosed = lv.outline
        if nxt.key == roof.key and roof.outline is not None:
            enclosed = roof.outline.intersection(lv.outline)
        def edges(poly):
            cs = list(poly.exterior.coords)
            return list(zip(cs[:-1], cs[1:]))
        balc = lambda y: y7 is not None and y > y7 + 150
        if enclosed.geom_type == "Polygon" and not enclosed.is_empty:
            for (xa, ya), (xb, yb) in edges(enclosed):
                if math.dist((xa, ya), (xb, yb)) < 50:
                    continue
                if balc((ya + yb) / 2) and enclosed is lv.outline:
                    walls.append(dict(level=lv.key, kind="balustrade", a=[r(xa / 1000), r(ya / 1000)], b=[r(xb / 1000), r(yb / 1000)], z0=r(z0), z1=r(z0 + 1.1), t=0.06))
                else:
                    walls.append(dict(level=lv.key, kind="facade", a=[r(xa / 1000), r(ya / 1000)], b=[r(xb / 1000), r(yb / 1000)], z0=r(z0), z1=r(z1), t=0.225))
            if y7 is not None and enclosed is lv.outline:
                # the facade behind the balconies: on grid 7 wherever the slab runs past it
                minx, _, maxx, _ = lv.outline.bounds
                line = LineString([(minx, y7), (maxx, y7)])
                beyond = lv.outline.intersection(line)
                for seg in getattr(beyond, "geoms", [beyond]):
                    if seg.is_empty or seg.length < 300:
                        continue
                    (xa, ya), (xb, yb) = list(seg.coords)[0], list(seg.coords)[-1]
                    mid = ((xa + xb) / 2, y7 + 400)
                    from shapely.geometry import Point as _P
                    if lv.outline.contains(_P(*mid)):
                        walls.append(dict(level=lv.key, kind="facade", a=[r(xa / 1000), r(y7 / 1000)], b=[r(xb / 1000), r(y7 / 1000)], z0=r(z0), z1=r(z1), t=0.225, note="behind the balconies, on grid 7 (assumed)"))
        if enclosed is not lv.outline:
            # roof terraces round the penthouses: a balustrade on the slab edge outside the roof
            for (xa, ya), (xb, yb) in edges(lv.outline):
                seg = LineString([(xa, ya), (xb, yb)])
                if seg.length < 50:
                    continue
                if roof.outline is not None and roof.outline.buffer(10).contains(seg):
                    continue
                walls.append(dict(level=lv.key, kind="balustrade", a=[r(xa / 1000), r(ya / 1000)], b=[r(xb / 1000), r(yb / 1000)], z0=r(z0), z1=r(z0 + 1.1), t=0.06))
        for h in lv.holes:
            if h["kind"] == "stair":
                x0, y0, x1, y1 = h["box"]
                stairs.append(dict(level=lv.key, name=h["name"], box=[r(x0 / 1000), r(y0 / 1000), r(x1 / 1000), r(y1 / 1000)], z0=r(z0), z1=r(nxt.z / 1000)))
    if roof.outline is not None:
        cs = list(roof.outline.exterior.coords)
        for (xa, ya), (xb, yb) in zip(cs[:-1], cs[1:]):
            walls.append(dict(level=roof.key, kind="parapet", a=[r(xa / 1000), r(ya / 1000)], b=[r(xb / 1000), r(yb / 1000)], z0=r(roof.z / 1000), z1=r(roof.z / 1000 + 0.6), t=0.15))

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
    return dict(walls=walls, stairs=stairs, homes=homes, homes_fetched=fetched,
                note="Shell from the as-built slab edges; homes from the live website. Walls inside the homes come from the plans editor's layouts once they can be read.")
