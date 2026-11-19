"""Builds the structural model of The Lexington, runs every analysis and check, and writes the results.

    python3 structure/run.py            # everything -> structure/out/results.json (+ viewer data)

Inputs are in structure/model/ (see lexstruct/building.py). Re-export the as-built record first when
the site has taped new figures:

    node structure/tools/export-asbuilt.ts [backup.json] > structure/model/asbuilt.json
    node --import ./structure/tools/alias.mjs structure/tools/export-slabs.ts > structure/model/slabs.json
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import openseespy.opensees as ops

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lexstruct.analysis import Analysis  # noqa: E402
from lexstruct.building import ROOT, Building  # noqa: E402
from lexstruct.design import Design  # noqa: E402
from lexstruct.export import export_viewer  # noqa: E402

OUT = ROOT / "out"


def log(msg, t0=[time.time()]):
    print(f"[{time.time() - t0[0]:6.1f}s] {msg}", flush=True)


def main():
    OUT.mkdir(exist_ok=True)
    b = Building()
    b.build(ops)
    log(f"model: {b.summary}")
    a = Analysis(b)
    a.run_gravity()
    log("gravity cases solved")
    a.floor_masses()
    a.condense()
    log(f"modes: T = {', '.join(f'{t:.2f}' for t in a.T[:6])} s")
    a.run_seismic()
    log("response spectrum done")
    sens = b.cfg["seismic"].get("agR_sensitivity_g")
    if sens:
        a.run_seismic(agR_g=sens, label="E_sens")
    a.run_wind()
    log("wind done")

    d = Design(a)
    cols = d.check_columns()
    log(f"columns checked: {len(cols)}")
    cores = d.check_cores()
    beams = d.check_beams()
    found = d.foundations()
    drift = d.drift()
    tors = d.torsional_radius()
    log("checks done")

    s = b.cfg["seismic"]
    modes = [dict(mode=k + 1, T=round(float(a.T[k]), 3), mx=round(float(a.meff["x"][k]) * 100, 1), my=round(float(a.meff["y"][k]) * 100, 1),
                  twist=round(float(a.twist_share[k]) * 100), Sd_g=round(a.Sd(float(a.T[k])) / 9.81, 3)) for k in range(len(a.T))]
    E = a.cases["E"]
    G, Q = a.cases["G"], a.cases["Q"]
    totals = dict(
        G_self=round(sum(-v[2] for v in b.loads["G_self"].values()) + sum(v.get("G_self", 0) for v in b.base_direct.values())),
        G_super=round(sum(-v[2] for v in b.loads["G_super"].values()) + sum(v.get("G_super", 0) for v in b.base_direct.values())),
        Q=round(sum(-v[2] for v in b.loads["Q"].values()) + sum(v.get("Q", 0) for v in b.base_direct.values())),
        seismic_weight=round(sum(f["W"] for f in a.floors)),
        slab_area_m2=round(sum((b.xs[i + 1] - b.xs[i]) * (b.ys[j + 1] - b.ys[j]) for lv in b.levels for (i, j) in lv.cells) / 1e6),
    )
    floors = []
    for fl in a.floors:
        lv = b.levels[fl["level"]]
        area = sum((b.xs[i + 1] - b.xs[i]) * (b.ys[j + 1] - b.ys[j]) for (i, j) in lv.cells) / 1e6
        floors.append(dict(level=lv.key, name=lv.name, z=lv.z, area_m2=round(area, 1), W_seis=round(fl["W"]), cm=[round(fl["xc"], 2), round(-fl["yc"], 2)],
                           spec=(lv.spec or {}).get("source"), borrowed=(lv.spec or {}).get("borrowed"), source=lv.floor.get("source")))
    sag = (G + Q).disp[:, 2]
    worst_sag = int(np.argmin(sag))
    results = dict(
        generated=time.strftime("%Y-%m-%d %H:%M"),
        inputs=dict(asbuilt=b.asbuilt.get("source"), loads=b.cfg),
        model=b.summary, warnings=b.warnings, totals=totals, floors=floors, pool=b.pool_info,
        modes=modes, torsion=tors,
        seismic=dict(agR_g=s["agR_g"], q=s["q"], ground=s["ground_types"],
                     base_shear_x=round(float(np.sum(E["x"]["Fi"]))), base_shear_y=round(float(np.sum(E["y"]["Fi"]))),
                     T1x=round(E["x"]["T1"], 3), T1y=round(E["y"]["T1"], 3),
                     rsa_base_shear_x=round(float(drift["x"][0]["V_storey_kN"])), rsa_base_shear_y=round(float(drift["y"][0]["V_storey_kN"]))),
        seismic_sensitivity=dict(agR_g=sens) if sens else None,
        wind={d_: dict(F=[round(float(f), 1) for f in a.cases["W"][d_]["F"]], base_shear=round(float(a.cases["W"][d_]["base_shear"]))) for d_ in ("x", "y")},
        drift=drift, columns=cols, cores=cores, beams=[{k: v for k, v in r.items() if k != "tags"} for r in beams], foundations=found,
        deflection=dict(max_mm=round(float(sag[worst_sag]) * 1000, 1), at=[round(c) for c in b.xyz[worst_sag]]),
    )
    if sens:
        # columns again at the lower hazard, for the comparison table
        d2 = Design(a)
        a.cases["E_main"] = a.cases["E"]
        a.cases["E"] = a.cases["E_sens"]
        d2.combos = d2._combos()
        cols2 = d2.check_columns()
        cores2 = d2.check_cores()
        drift2 = d2.drift()
        a.cases["E"] = a.cases["E_main"]
        results["seismic_sensitivity"]["columns"] = [dict(tag=c["tag"], rho_needed_seismic=c["rho_needed_seismic"], util_seismic=c["util_seismic"]) for c in cols2]
        results["seismic_sensitivity"]["cores"] = [dict(core=c["core"], level=c["level"], rho_needed_seismic=c["rho_needed_seismic"],
                                                        util_seismic_at_0_5pct=c["util_seismic_at_0_5pct"]) for c in cores2]
        results["seismic_sensitivity"]["drift"] = drift2
        log("sensitivity (lower hazard) done")
    # columns again with the concrete as ordered on site (C35 cube = C28/35), gravity and wind only
    conc = b.cfg["materials"]["concrete"]
    fck0 = conc["fck"]
    conc["fck"] = 28
    d3 = Design(a)
    a.cases["E_hold"] = a.cases.pop("E")
    d3.combos = d3._combos()
    results["concrete_c28"] = {c["tag"]: c["util_gravity"] for c in d3.check_columns()}
    a.cases["E"] = a.cases.pop("E_hold")
    conc["fck"] = fck0
    log("C28/35 check done")
    (OUT / "results.json").write_text(json.dumps(results, indent=1, default=lambda o: o.item() if hasattr(o, "item") else (o.tolist() if hasattr(o, "tolist") else str(o))))
    export_viewer(b, a, d, results, OUT / "viewer-data.json")
    log(f"written {OUT/'results.json'}")


if __name__ == "__main__":
    main()
