"""Design checks on the analysis results (EN 1990 / EN 1992-1-1 / EN 1998-1).

Load combinations (EN 1990 6.4.3.2, 6.4.3.4, 6.5.3):
  ULS1   1.35 G + 1.5 Q
  ULS2   1.35 G + 1.05 Q + 1.5 W     (wind in x or y, either way, with its torsion either way)
  ULS3   1.0 G + 1.5 W               (least axial force with wind)
  SEIS   G + psi2 Q +/- E            (E = Ex + 0.3 Ey or 0.3 Ex + Ey, each response at its peak)
  SLS    G + Q                       (foundation bearing, deflection)

Columns and walls: biaxial strain-compatibility capacity (sections.py) at both ends, with the
imperfection l0/400 and, where slender, the nominal-curvature second-order moment (5.8.8), in the
persistent combinations; first-order forces plus the minimum eccentricity in the seismic one (the
model's stability coefficient covers global P-delta, EN 1998-1 4.4.2.2). Where the engineer's bars
are known for a column (R10 schedule, same size) the check uses them; everywhere the steel ratio
needed is also worked out, so a column with no schedule yet still gets an answer.
"""
from __future__ import annotations

import json
import math
from itertools import product

import numpy as np

from .analysis import Analysis, Results
from .building import MODEL, Building
from .sections import Section, rect_section, walls_section

RHO_STEPS = [0.004, 0.006, 0.008, 0.010, 0.0125, 0.015, 0.02, 0.025, 0.03, 0.04]


class Design:
    def __init__(self, a: Analysis):
        self.a = a
        self.b: Building = a.b
        cfg = self.b.cfg
        m = cfg["materials"]
        self.fck = m["concrete"]["fck"]
        self.fyk = m["steel"]["fyk"]
        self.kw = dict(gamma_c=m["gamma_c"], gamma_s=m["gamma_s"], alpha_cc=m["alpha_cc"])
        self.cover = m["cover_mm"]
        self.fcd = m["alpha_cc"] * self.fck / m["gamma_c"]
        self.fyd = self.fyk / m["gamma_s"]
        self._sec_cache: dict = {}
        self.r10 = None
        p = MODEL / "r10_vertical.json"
        if p.exists():
            self.r10 = json.loads(p.read_text())
        self.combos = self._combos()

    # ------------------------------------------------------------------ combinations
    def _combos(self):
        c = self.a.cases
        G, Q = c["G"], c["Q"]
        imp = self.b.cfg["imposed"]
        out = {"ULS1": [1.35 * G + 1.5 * Q]}
        W = c.get("W")
        if W:
            uls2, uls3, slsw = [], [], []
            for d in ("x", "y"):
                for s, st in product((1, -1), (1, -1)):
                    w = s * W[d]["res"] + st * W[d]["tors"]
                    uls2.append(1.35 * G + imp["psi0"] * 1.5 * Q + 1.5 * w)
                    uls3.append(1.0 * G + 1.5 * w)
                    slsw.append(G + Q + 0.6 * w)
            out["ULS2"] = uls2
            out["ULS3"] = uls3
            out["SLSW"] = slsw
        out["SLS"] = [G + Q]
        out["QP"] = [G + imp["psi2"] * Q]
        return out

    def seismic_env(self, label="E") -> tuple[Results, Results]:
        """(static part G + psi2 Q, peak seismic part) with E = max(Ex + 0.3Ey, 0.3Ex + Ey) per response."""
        E = self.a.cases[label]
        ex, ey = E["x"]["total"], E["y"]["total"]
        env = Results.maximum(ex + 0.3 * ey, 0.3 * ex + ey)
        static = self.a.cases["G"] + self.b.cfg["imposed"]["psi2"] * self.a.cases["Q"]
        return static, env

    # ------------------------------------------------------------------ sections
    def section_for(self, bx_mm, by_mm, n_bars, dia):
        key = (round(bx_mm), round(by_mm), n_bars, dia)
        if key not in self._sec_cache:
            self._sec_cache[key] = rect_section(bx_mm / 1000, by_mm / 1000, n_bars, dia, self.cover["column"], 10, self.fck, self.fyk, **self.kw)
        return self._sec_cache[key]

    def bars_for_rho(self, bx_mm, by_mm, rho):
        As = rho * bx_mm * by_mm
        for dia in (12, 16, 20, 25, 32):
            n = math.ceil(As / (math.pi * dia**2 / 4))
            n = max(4, n + (n % 2))
            perim = 2 * (bx_mm + by_mm) - 8 * (self.cover["column"] + 10)
            if perim / n >= 100 or dia == 32:  # bars no closer than ~100 mm centres
                return n, dia
        return n, dia

    def r10_bars(self, fr) -> tuple[int, int, str] | None:
        """The engineer's bars for this column (R10 schedule) when its type and size match the as-built one."""
        if not self.r10:
            return None
        z = self.b.levels[fr["level"]].z
        for col in self.r10.get("columns", []) + self.r10.get("walls", []):
            if col.get("type") != fr["name"]:
                continue
            for st in col.get("stages", []):
                lo, hi = st.get("from_level_mm"), st.get("to_level_mm")
                if lo is None or hi is None or not (lo - 1 <= z < hi - 1):
                    continue
                size = st.get("size_mm")
                if size and sorted(map(round, size)) != sorted([round(fr["bx"]), round(fr["by"])]):
                    return None
                bars = st.get("bars") or st.get("vertical_bars")
                if not bars:
                    return None
                import re

                m = re.match(r"\s*(\d+)\s*-\s*[HTY]\s*(\d{2})", str(bars))
                if m:
                    return int(m.group(1)), int(m.group(2)), str(bars)
        return None

    # ------------------------------------------------------------------ columns and walls
    def column_demands(self, fr, idx):
        """Design (N, Mx, My) sets for one column: persistent combos with 2nd order, and seismic."""
        st = self.b.cfg["stiffness"]
        bx, by = fr["bx"] / 1000, fr["by"] / 1000
        h = fr["L"]
        l0 = 1.0 * h  # effective length: storey height (sway-permitting frame, conservative)
        out = []

        def second_order(N, m_i, m_j, depth, width):
            """EN 1992-1-1 5.8.8 for one axis: returns the design moment."""
            if N <= 0:
                return max(abs(m_i), abs(m_j))
            i_r = depth / math.sqrt(12)
            lam = l0 / i_r
            n = N / (bx * by * self.fcd * 1000)
            lam_lim = 20 * 0.7 * 1.1 * 0.7 / math.sqrt(max(n, 1e-3))
            ei = l0 / 400
            M02, M01 = (m_j, m_i) if abs(m_j) >= abs(m_i) else (m_i, m_j)
            same = M01 * M02 >= 0
            M02a = abs(M02) + N * ei
            M01a = (abs(M01) if same else -abs(M01)) + N * ei
            e0 = max(depth / 30, 0.02)
            M2 = 0.0
            if lam > lam_lim:
                d = depth - (self.cover["column"] + 10 + 10) / 1000
                omega = 0.01 * self.fyd / self.fcd  # 1 % steel for the curvature factor
                nu = 1 + omega
                Kr = min(1.0, max(0.0, (nu - n) / (nu - 0.4)))
                beta = 0.35 + self.fck / 200 - lam / 150
                Kphi = max(1.0, 1 + beta * 1.5)
                curv = Kr * Kphi * (self.fyd / 200000) / (0.45 * d)
                M2 = N * curv * l0**2 / 10
            M0e = max(0.6 * M02a + 0.4 * M01a, 0.4 * M02a)
            return max(M02a, M0e + M2, M01a + 0.5 * M2, N * e0)

        for name, combos in self.combos.items():
            if not name.startswith("ULS"):
                continue
            for r in combos:
                f = r.frames[idx]
                N = f[0]
                # local Mz bends about X (uses the depth along Y); local My bends about Y
                Mx = second_order(N, -f[5], f[11], by, bx)
                My = second_order(N, -f[4], f[10], bx, by)
                out.append((name, N, Mx, My))
        if "E" in self.a.cases:
            static, env = self.seismic_env("E")
            fs, fe = static.frames[idx], env.frames[idx]
            for end in (0, 6):
                # end forces act on the element: compression is +N at the bottom end (i) and -N at the top end (j)
                Ns = fs[0] if end == 0 else -fs[6]
                for sn in (1, -1):
                    N = Ns + sn * fe[end]
                    Mx = abs(fs[end + 5]) + fe[end + 5]
                    My = abs(fs[end + 4]) + fe[end + 4]
                    Mx = max(Mx, abs(N) * max(by / 30, 0.02))
                    My = max(My, abs(N) * max(bx / 30, 0.02))
                    out.append(("SEIS", N, Mx, My))
        return out

    def _rho_needed(self, fr, dem):
        for rho in RHO_STEPS:
            n, dia = self.bars_for_rho(fr["bx"], fr["by"], rho)
            sec = self.section_for(fr["bx"], fr["by"], n, dia)
            if max(max(sec.utilisation(N, Mx, My), sec.utilisation(N, Mx, -My)) for _, N, Mx, My in dem) <= 1.0:
                return rho
        return None

    def check_columns(self):
        rows = []
        for idx, fr in enumerate(self.a.frame_list):
            if fr["kind"] not in ("column", "wall"):
                continue
            dem = self.column_demands(fr, idx)
            pers = [d for d in dem if d[0] != "SEIS"]
            seis = [d for d in dem if d[0] == "SEIS"]
            prov = self.r10_bars(fr)
            up = us = None
            if prov:
                sec = self.section_for(fr["bx"], fr["by"], prov[0], prov[1])
                u = lambda ds: max(max(sec.utilisation(N, Mx, My), sec.utilisation(N, Mx, -My)) for _, N, Mx, My in ds) if ds else None
                up, us = u(pers), u(seis)
            rp = self._rho_needed(fr, pers)
            rs = self._rho_needed(fr, seis) if seis else None
            Nuls = max(d[1] for d in dem if d[0] == "ULS1")
            lv = self.b.levels[fr["level"]]
            rows.append(dict(
                tag=fr["tag"], kind=fr["kind"], name=fr["name"], ref=fr["ref"], level=lv.key, level_name=lv.name,
                size=f"{round(fr['bx'])}x{round(fr['by'])}", N_uls=round(Nuls), N_G=round(self.a.cases["G"].frames[idx][0]),
                N_Q=round(self.a.cases["Q"].frames[idx][0]), axial_ratio=round(Nuls / (fr["bx"] * fr["by"] / 1e6 * self.fcd * 1000), 2),
                rho_needed_gravity=rp, rho_needed_seismic=rs if seis else None,
                rho_needed=None if (rp is None or (seis and rs is None)) else max(rp, rs or 0),
                provided=prov[2] if prov else None,
                rho_provided=round(prov[0] * math.pi * prov[1] ** 2 / 4 / (fr["bx"] * fr["by"]), 4) if prov else None,
                util_gravity=round(up, 2) if up is not None else None, util_seismic=round(us, 2) if us is not None else None,
                measured=fr.get("measured", False),
            ))
        self.columns = rows
        return rows

    # ------------------------------------------------------------------ cores
    def _cut_setup(self):
        """Which core shells and nodes make each section cut (bottom of each storey of each core)."""
        if hasattr(self, "cut_keys"):
            return
        b = self.b
        self.cut_keys = []
        self._cut_rows = []  # per cut: list of (shell index, node slot, X, Y)
        for name, info in b.cores.items():
            x0, y0, x1, y1 = info["box"]
            cx, cY = (x0 + x1) / 2000, -(y0 + y1) / 2000
            for a in info["levels"]:
                rows = []
                for k, sh in enumerate(self.a.core_list):
                    if sh["core"] != name or sh["level"] != a or sh["sub"] != 0:
                        continue
                    for slot, nn in enumerate(sh["nodes"][:2]):  # the two bottom nodes
                        x, y, _ = b.xyz[nn]
                        rows.append((k, slot, x / 1000 - cx, -y / 1000 - cY))
                self.cut_keys.append((name, a))
                self._cut_rows.append(rows)

    def core_cut(self, res: Results) -> np.ndarray:
        """(cuts, 6): Fx Fy N(compression +) Mx My Mz about the core's box centre, on the wall above the cut."""
        self._cut_setup()
        out = np.zeros((len(self.cut_keys), 6))
        for c, rows in enumerate(self._cut_rows):
            for k, slot, X, Y in rows:
                ff = res.cores[k][6 * slot : 6 * slot + 6]
                out[c, :3] += ff[:3]
                out[c, 3] += ff[3] + Y * ff[2]
                out[c, 4] += ff[4] - X * ff[2]
                out[c, 5] += ff[5] + X * ff[1] - Y * ff[0]
        return out

    def core_forces(self, res: Results):
        arr = self.core_cut(res)
        return {key: arr[i] for i, key in enumerate(self.cut_keys)}

    def core_forces_seismic(self, label="E"):
        static = self.a.cases["G"] + self.b.cfg["imposed"]["psi2"] * self.a.cases["Q"]
        peak = self.a.env_peak(label, self.core_cut)
        return self.core_forces(static), {key: peak[i] for i, key in enumerate(self.cut_keys)}

    def check_cores(self, rho_v=0.005):
        b = self.b
        rows = []
        sec_cache = {}
        for name, info in b.cores.items():
            x0, y0, x1, y1 = info["box"]
            t = info["wall"] / 1000
            cx, cY = (x0 + x1) / 2000, -(y0 + y1) / 2000
            xl, xr = (x0 + info["wall"] / 2) / 1000 - cx, (x1 - info["wall"] / 2) / 1000 - cx
            yt, yb = -(y0 + info["wall"] / 2) / 1000 - cY, -(y1 - info["wall"] / 2) / 1000 - cY
            segs = [(xl, yt, xr, yt, t), (xl, yt, xl, yb, t), (xr, yt, xr, yb, t)]
            door = info.get("door")
            if door and door["side"] == "b":
                a0 = (x0 + door["from"]) / 1000 - cx
                a1 = a0 + door["width"] / 1000
                segs += [(xl, yb, a0, yb, t), (a1, yb, xr, yb, t)]
            else:
                segs.append((xl, yb, xr, yb, t))
            for rho in (rho_v, 0.01, 0.015, 0.02, 0.03, 0.04):
                key = (name, rho)
                if key not in sec_cache:
                    sec_cache[key] = walls_section(segs, self.fck, self.fyk, rho, **self.kw)
            stat = {k: self.core_forces(r) for k, r in (("G", self.a.cases["G"]), ("Q", self.a.cases["Q"]))}
            seis = self.core_forces_seismic("E") if "E" in self.a.cases else None
            for a in info["levels"]:
                G, Q = stat["G"][(name, a)], stat["Q"][(name, a)]
                dem = [("ULS1", 1.35 * G + 1.5 * Q, np.zeros(6))]
                if seis:
                    dem.append(("SEIS", seis[0][(name, a)], seis[1][(name, a)]))
                res_by = {}
                for fam in ("ULS1", "SEIS"):
                    fdem = [d_ for d_ in dem if d_[0] == fam]
                    if not fdem:
                        continue
                    first = None
                    need_f = None
                    for rho in (rho_v, 0.01, 0.015, 0.02, 0.03, 0.04):
                        sec = sec_cache[(name, rho)]
                        uu = []
                        for nm, s_, e_ in fdem:
                            for sx, sy, sn in product((1, -1), (1, -1), (1, -1)):
                                N = s_[2] + sn * e_[2]
                                uu.append(sec.utilisation(N, s_[3] + sx * e_[3] - sec.cy * N, s_[4] + sy * e_[4] + sec.cx * N))
                        u = max(uu)
                        first = u if first is None else first
                        if u <= 1.0:
                            need_f = rho
                            break
                    res_by[fam] = (first, need_f)
                V = None
                if seis:
                    s, e = seis[0][(name, a)], seis[1][(name, a)]
                    V = round(math.hypot(abs(s[0]) + e[0], abs(s[1]) + e[1]))
                rows.append(dict(core=name, level=b.levels[a].key, level_name=b.levels[a].name, N_G=round(G[2]), N_Q=round(Q[2]),
                                 util_gravity_at_0_5pct=round(res_by["ULS1"][0], 2), rho_needed_gravity=res_by["ULS1"][1],
                                 util_seismic_at_0_5pct=round(res_by["SEIS"][0], 2) if "SEIS" in res_by else None,
                                 rho_needed_seismic=res_by["SEIS"][1] if "SEIS" in res_by else None, V_seis=V,
                                 M_seis=round(math.hypot(seis[1][(name, a)][3], seis[1][(name, a)][4])) if seis else None))
        self.cores = rows
        return rows

    # ------------------------------------------------------------------ beams
    def _beam_steel(self, b, h, M_hog, M_sag, V):
        d = h - (self.cover["beam"] + 10 + 10) / 1000
        out = {}
        for side, M in (("top", M_hog), ("bottom", M_sag)):
            if M <= 0:
                out[side] = 0
                continue
            K = M / (b * d**2 * self.fck * 1000)
            if K > 0.167:
                # doubly reinforced (EC2 / IStructE manual): compression steel at d2 = 50 mm
                Mlim = 0.167 * b * d**2 * self.fck * 1000
                z = 0.82 * d
                As2 = (M - Mlim) / (self.fyd * 1000 * (d - 0.05))
                out[side] = round((Mlim / (self.fyd * 1000 * z) + As2) * 1e6)
                out[side + "_comp"] = round(As2 * 1e6)
            else:
                z = min(0.95 * d, d * (0.5 + math.sqrt(0.25 - K / 1.134)))
                out[side] = round(max(M / (self.fyd * 1000 * z), 0.0013 * b * d) * 1e6)
        z = 0.9 * d
        nu1 = 0.6 * (1 - self.fck / 250)
        cap = lambda cot: b * z * nu1 * self.fcd * 1000 / (cot + 1 / cot)
        cot = 2.5
        if V > cap(2.5):
            cot = None
            for c in np.linspace(2.5, 1.0, 61):
                if cap(c) >= V:
                    cot = c
                    break
        out["links"] = round(V / (z * self.fyd * 1000 * cot) * 1e6) if cot else None  # mm2 per m
        out["shear_ok"] = cot is not None
        out["As_max_ok"] = all(out.get(k, 0) <= 0.04 * b * h * 1e6 for k in ("top", "bottom"))
        return out

    def check_beams(self):
        """Steel needed in each beam run: gravity and wind (persistent) and seismic, separately."""
        rows: dict = {}
        pers_sets = [r for k, v in self.combos.items() if k.startswith("ULS") for r in v]
        seis = self.seismic_env("E") if "E" in self.a.cases else None
        env: dict = {}
        for idx, fr in enumerate(self.a.frame_list):
            if fr["kind"] != "beam":
                continue
            key = (fr["level"], fr["label"])
            e = env.setdefault(key, dict(ph=0.0, ps=0.0, pv=0.0, sh=0.0, ss=0.0, sv=0.0))
            for r in pers_sets:
                f = r.frames[idx]
                for m in (-f[4], f[10]):  # internal moments: + hogging, - sagging
                    e["ph"] = max(e["ph"], m)
                    e["ps"] = max(e["ps"], -m)
                e["pv"] = max(e["pv"], abs(f[2]), abs(f[8]))
            if seis:
                fs, fe = seis[0].frames[idx], seis[1].frames[idx]
                for m0, me in ((-fs[4], fe[4]), (fs[10], fe[10])):
                    e["sh"] = max(e["sh"], m0 + me)
                    e["ss"] = max(e["ss"], -(m0 - me))
                e["sv"] = max(e["sv"], abs(fs[2]) + fe[2], abs(fs[8]) + fe[8])
            rows.setdefault(key, dict(level=self.b.levels[fr["level"]].key, label=fr["label"], b=fr["b"], h=fr["h"], tags=[]))["tags"].append(fr["tag"])
        out = []
        for key, row in rows.items():
            e = env[key]
            b, h = row["b"] / 1000, row["h"] / 1000
            p = self._beam_steel(b, h, e["ph"], e["ps"], e["pv"])
            sres = self._beam_steel(b, h, e["sh"], e["ss"], e["sv"]) if seis else None
            out.append(dict(**row, M_hog=round(e["ph"]), M_sag=round(e["ps"]), V=round(e["pv"]),
                            As_top=p["top"], As_bottom=p["bottom"], As_comp=max(p.get("top_comp", 0), p.get("bottom_comp", 0)),
                            links_mm2_per_m=p["links"], ok=p["shear_ok"] and p["As_max_ok"],
                            seis=dict(M_hog=round(e["sh"]), M_sag=round(e["ss"]), V=round(e["sv"]), As_top=sres["top"], As_bottom=sres["bottom"],
                                      links=sres["links"], ok=sres["shear_ok"] and sres["As_max_ok"]) if sres else None))
        self.beams = out
        return out

    # ------------------------------------------------------------------ foundations
    def _groups_setup(self):
        if hasattr(self, "group_keys"):
            return
        b = self.b
        self.group_keys = []
        self._group_rows = []
        groups: dict[str, list] = {}
        for k, n in enumerate(self.a.base_nodes):
            groups.setdefault(b.fixed[n], []).append(k)
        for grp, ks in groups.items():
            xs = [b.xyz[self.a.base_nodes[k]][0] / 1000 for k in ks]
            Ys = [-b.xyz[self.a.base_nodes[k]][1] / 1000 for k in ks]
            cx, cy = float(np.mean(xs)), float(np.mean(Ys))
            self.group_keys.append(grp)
            self._group_rows.append([(k, X - cx, Y - cy) for k, X, Y in zip(ks, xs, Ys)])

    def group_react(self, res: Results) -> np.ndarray:
        """(groups, 6): Fx Fy Fz Mx My Mz of each foundation group's reactions about its centre."""
        self._groups_setup()
        out = np.zeros((len(self.group_keys), 6))
        for g, rows in enumerate(self._group_rows):
            for k, X, Y in rows:
                f = res.react[k]
                out[g, :3] += f[:3]
                out[g, 3] += f[3] + Y * f[2]
                out[g, 4] += f[4] - X * f[2]
                out[g, 5] += f[5] + X * f[1] - Y * f[0]
        return out

    def r10_base(self, name: str, ref: str):
        """The R10 base under a column or core, matched by its grid reference (or 'Lift core')."""
        if not self.r10:
            return None
        for bs in self.r10["foundations"].get("bases", []):
            under = [str(u) for u in bs.get("under") or []]
            bs["_under"] = under
            for u in under:
                if name.startswith("Lift") and u.lower().startswith("lift core"):
                    return bs
                if ref and (u.startswith(ref + " ") or u == ref or u.startswith(ref + ":")):
                    return bs
        return None

    def foundations(self):
        """Loads on each foundation (at the ground floor, +0.300) and the pad size the bearing pressure asks for.

        SLS: G + Q at the allowable 400 kPa (10 % added for the base's own weight and fill).
        Seismic: G + psi2 Q +/- E with the overturning moments; the pad is sized so the pressure under
        it stays within 1.33 x 400 kPa with no uplift (e <= B/6), the usual allowance for a transient load."""
        b = self.b
        qa = b.cfg["soil"]["bearing_kPa"]
        self._groups_setup()
        G = self.group_react(self.a.cases["G"])
        Q = self.group_react(self.a.cases["Q"])
        Es = self.a.env_peak("E", self.group_react) if "E" in self.a.cases else None
        psi2 = b.cfg["imposed"]["psi2"]
        out = []
        for i, grp in enumerate(self.group_keys):
            bd = b.base_direct.get(grp, {})
            NG = G[i][2] + bd.get("G_self", 0) + bd.get("G_super", 0)
            NQ = Q[i][2] + bd.get("Q", 0)
            Nk = NG + NQ
            area = 1.1 * Nk / qa
            side = math.sqrt(area)
            row = dict(group=grp, N_G=round(NG), N_Q=round(NQ), N_sls=round(Nk), N_uls=round(1.35 * NG + 1.5 * NQ),
                       base_area_m2=round(area, 2), base_side_m=round(side, 2))
            if Es is not None:
                Ns = NG + psi2 * NQ
                Emax = Es[i]
                Nmin = Ns - Emax[2]
                Nmax = Ns + Emax[2]
                M = math.hypot(abs(G[i][3] + psi2 * Q[i][3]) + Emax[3], abs(G[i][4] + psi2 * Q[i][4]) + Emax[4])
                # smallest square pad B with N/B2 (1 + 6e/B) <= 1.33 qa and e = M/N <= B/6
                Bs = side
                for _ in range(200):
                    e = M / max(Nmax * 1.1, 1e-6)
                    p = 1.1 * Nmax / Bs**2 * (1 + 6 * e / Bs)
                    if p <= 1.33 * qa and e <= Bs / 6:
                        break
                    Bs += 0.05
                row.update(N_seis_max=round(Nmax), N_seis_min=round(Nmin), M_seis=round(M), base_side_seis_m=round(Bs, 2), uplift=bool(Nmin < 0))
            fr = next((f for f in self.a.frame_list if f.get("group") == grp), None)
            row["name"], row["ref"] = (fr["name"], fr["ref"]) if fr else (grp, "")
            base = self.r10_base(row["name"], row["ref"])
            if base:
                A = base["L_mm"] * base["B_mm"] / 1e6
                row["r10_base"] = f"{base['type']} {base['L_mm']}x{base['B_mm']}x{base.get('thickness_mm')}"
                # a type is often repeated at several positions; it's one combined base only when it has fewer bases than positions
                row["r10_shared"] = bool(base.get("count")) and base["count"] < len(base["_under"])
                row["r10_sls_kPa"] = round(1.1 * Nk / A) if not row["r10_shared"] else None
            xs = [b.xyz[self.a.base_nodes[k]][0] for k, *_ in self._group_rows[i]]
            ys = [b.xyz[self.a.base_nodes[k]][1] for k, *_ in self._group_rows[i]]
            row["x"], row["y"] = round(float(np.mean(xs))), round(float(np.mean(ys)))
            out.append(row)
        out.sort(key=lambda r: -r["N_sls"])
        self.found = out
        return out

    # ------------------------------------------------------------------ drift and stability
    def drift(self):
        a = self.a
        s = self.b.cfg["seismic"]
        fl = a.floors
        zs = [self.b.base.z / 1000] + [f["z"] for f in fl]
        out = {}
        for d in ("x", "y"):
            E = a.cases["E"][d]
            mf = E["modal_floor"]  # (modes, 3n): ux, uy, twist per floor, per mode (peak)
            rows = []
            for i, f in enumerate(fl):
                h = zs[i + 1] - zs[i]
                worst = 0
                for (px, py) in ((f["x"].min(), f["Y"].min()), (f["x"].min(), f["Y"].max()), (f["x"].max(), f["Y"].min()), (f["x"].max(), f["Y"].max()), (f["xc"], f["yc"])):
                    def disp(j, k):
                        g = fl[j]
                        u = mf[:, 3 * j : 3 * j + 3]
                        dx, dy = px - g["xc"], py - g["yc"]
                        return u[:, 0] - u[:, 2] * dy if k == 0 else u[:, 1] + u[:, 2] * dx
                    for k in (0, 1):
                        top = disp(i, k)
                        bot = disp(i - 1, k) if i > 0 else 0 * top
                        dr = a.cqc(top - bot) * s["q"]
                        worst = max(worst, float(dr))
                # storey shear (CQC) from modal floor forces
                rows.append(dict(level=f["name"], h=h, drift_mm=round(worst * 1000, 1), drift_ratio=round(worst / h, 4), limit_ratio=0.005 / 0.5))
            # stability coefficient theta = Ptot dr / (Vtot h)
            amp = a.gamma[d] * E["sd"]
            n = len(fl)
            Mmat = a.M
            shears = []
            for k in range(len(a.T)):
                ff = amp[k] * (Mmat @ a.phi[:, k])
                comp = ff[0::3] if d == "x" else ff[1::3]
                shears.append(np.cumsum(comp[::-1])[::-1])
            V = a.cqc(np.array(shears))
            P = np.cumsum([f["W"] for f in fl][::-1])[::-1]
            for i, r in enumerate(rows):
                r["V_storey_kN"] = round(float(V[i]))
                r["theta"] = round(P[i] * r["drift_mm"] / 1000 / (V[i] * r["h"]), 3) if V[i] > 0 else None
            out[d] = rows
        # wind drift (characteristic, at the floors' extreme points)
        W = a.cases.get("W")
        if W:
            for d in ("x", "y"):
                rows = []
                res = W[d]["res"] + W[d]["tors"]
                prev = np.zeros(3)
                for i, f in enumerate(fl):
                    mo = a.floor_motion(res, f)
                    h = zs[i + 1] - zs[i]
                    ext = max(abs(f["x"] - f["xc"]).max(), abs(f["Y"] - f["yc"]).max())
                    dr = abs((mo[0] if d == "x" else mo[1]) - (prev[0] if d == "x" else prev[1])) + abs(mo[2] - prev[2]) * ext
                    prev = mo
                    rows.append(dict(level=f["name"], drift_mm=round(dr * 1000, 2), ratio=round(dr / h, 5)))
                out["wind_" + d] = rows
        self.drifts = out
        return out

    def torsional_radius(self):
        """EN 1998-1 4.2.3.2: torsional radius r vs the floor mass's radius of gyration ls (at mid-height)."""
        a = self.a
        n = len(a.floors)
        F = a.F
        out = []
        for i in range(n):
            # unit loads on every floor in one direction (or twist); response at floor i
            fx = np.zeros(3 * n); fx[0::3] = 1
            fy = np.zeros(3 * n); fy[1::3] = 1
            ft = np.zeros(3 * n); ft[2::3] = 1
            ux = (F @ fx)[3 * i]
            uy = (F @ fy)[3 * i + 1]
            th = (F @ ft)[3 * i + 2]
            Kx, Ky, Kt = 1 / ux, 1 / uy, 1 / th
            ls = math.sqrt(a.floors[i]["J"] / a.floors[i]["M"])
            out.append(dict(level=a.floors[i]["name"], r_x=round(math.sqrt(Kt / Ky), 2), r_y=round(math.sqrt(Kt / Kx), 2), l_s=round(ls, 2)))
        self.torsion = out
        return out
