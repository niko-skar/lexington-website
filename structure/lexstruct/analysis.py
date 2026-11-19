"""Load cases on the model, and the lateral (wind and seismic) analysis.

Every case is a linear static solve on the same factorised stiffness (OpenSees 'Linear -factorOnce'),
so each one after the first costs a back-substitution. Results kept per case:
  frames  local end forces of every column, wall and beam (12 values: N Vy Vz T My Mz at each end)
  cores   global nodal forces of every core shell (for the core's section forces at each storey)
  disp    every node's 6 displacements
  react   reactions of every base node

Seismic: a response-spectrum analysis to EN 1998-1. The floors are condensed to their in-plane
motion (x, y and twist about each floor's centre of mass) by applying unit mass-proportional loads
and reading back the mass-weighted floor motion; the 3n x 3n stiffness that comes out, with the
floor masses, gives the modes. Each mode's member forces come from one more static solve with that
mode's inertia forces, and the modes are combined by CQC.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.linalg import eigh

from .building import G_ACC, Building


PARTS = ("frames", "cores", "disp", "react", "raft")


class Results:
    """One load case's results. raft: per raft shell, the mean over its Gauss points of
    (p11 p22 p12 m11 m22 m12 q1 q2), forces per metre."""

    def __init__(self, frames, cores, disp, react, raft=None):
        self.frames = frames
        self.cores = cores
        self.disp = disp
        self.react = react
        self.raft = raft if raft is not None else np.zeros((0, 8))

    def _map(self, fn, o=None):
        if o is None:
            return Results(*[fn(getattr(self, p)) for p in PARTS])
        return Results(*[fn(getattr(self, p), getattr(o, p)) for p in PARTS])

    def __add__(self, o):
        return self._map(lambda a, b: a + b, o)

    def __mul__(self, k: float):
        return self._map(lambda a: a * k)

    __rmul__ = __mul__

    def abs(self):
        return self._map(np.abs)

    @staticmethod
    def maximum(a, b):
        return a._map(np.maximum, b)


class Analysis:
    def __init__(self, b: Building):
        self.b = b
        self.ops = b.ops
        self.frame_list = [f for f in b.frames if f["kind"] in ("column", "wall", "beam")]
        self.core_list = [s for s in b.shells if s["kind"] == "core"]
        self.raft_list = [s for s in b.shells if s["kind"] == "raft"]
        self.base_nodes = sorted(b.fixed)
        self.pattern = 0
        self.cases: dict[str, Results] = {}
        ops = self.ops
        ops.constraints("Transformation")
        ops.numberer("RCM")
        ops.system("UmfPack")
        ops.test("NormDispIncr", 1e-8, 6)
        ops.algorithm("Linear", "-factorOnce")
        ops.integrator("LoadControl", 1.0)
        ops.analysis("Static")
        ops.timeSeries("Constant", 1)

    # -------------------------------------------------------------- one static case
    def solve(self, loads: dict[int, np.ndarray]) -> Results:
        ops = self.ops
        if self.pattern:
            ops.remove("loadPattern", self.pattern)
        self.pattern += 1
        ops.pattern("Plain", self.pattern, 1)
        for n, f in loads.items():
            if np.any(f):
                ops.load(int(n), *map(float, f))
        ok = ops.analyze(1)
        if ok != 0:
            raise RuntimeError("analysis failed")
        frames = np.array([ops.eleResponse(f["tag"], "localForce") for f in self.frame_list])
        cores = np.array([ops.eleResponse(s["tag"], "forces") for s in self.core_list])
        disp = np.zeros((self.b.ntag + 1, 6))
        for t in range(1, self.b.ntag + 1):
            disp[t] = ops.nodeDisp(t)
        ops.reactions()
        react = np.array([ops.nodeReaction(n) for n in self.base_nodes])
        raft = np.array([np.asarray(ops.eleResponse(s["tag"], "stresses")).reshape(-1, 8).mean(axis=0) for s in self.raft_list]) if self.raft_list else np.zeros((0, 8))
        return Results(frames, cores, disp, react, raft)

    def run_gravity(self):
        for case, loads in self.b.loads.items():
            self.cases[case] = self.solve(loads)
        self.cases["G"] = self.cases["G_self"] + self.cases["G_super"]

    # -------------------------------------------------------------- floor masses
    def floor_masses(self):
        """Seismic mass at each level above the base: G + psiE Q, gathered to the level's nodes."""
        b = self.b
        imp = b.cfg["imposed"]
        top = b.levels[-1].idx
        level_z = {lv.idx: lv.z for lv in b.levels}
        node_at = {}
        for lv in b.levels:
            for (i, j), tag in lv.nodes.items():
                node_at[(lv.idx, round(b.xs[i]), round(b.ys[j]))] = tag
        w: dict[int, dict[int, float]] = {lv.idx: {} for lv in b.levels}
        for case, loads in b.loads.items():
            for n, f in loads.items():
                fz = -f[2]
                if case == "Q":
                    lvl_guess = min(level_z, key=lambda k: abs(level_z[k] - b.xyz[n][2]))
                    psi = imp["psi2"] * (imp["phi_roof"] if lvl_guess == top else imp["phi_floor"])
                    fz *= psi
                x, y, z = b.xyz[n]
                lvl = min(level_z, key=lambda k: abs(level_z[k] - z))
                tag = node_at.get((lvl, round(x), round(y)))
                if tag is None:  # a free column end etc.: nearest node of that level
                    tag, _ = b.nearest_level_node(b.levels[lvl], x, y)
                w[lvl][tag] = w[lvl].get(tag, 0.0) + fz
        self.floors = []
        for lv in b.levels:
            if lv.idx == b.base.idx or not w[lv.idx]:
                continue
            tags = np.array(list(w[lv.idx].keys()))
            m = np.array([w[lv.idx][t] for t in tags]) / G_ACC  # tonnes
            x = np.array([b.xyz[t][0] for t in tags]) / 1000
            Y = -np.array([b.xyz[t][1] for t in tags]) / 1000
            M = m.sum()
            xc, yc = (m * x).sum() / M, (m * Y).sum() / M
            J = (m * ((x - xc) ** 2 + (Y - yc) ** 2)).sum()
            self.floors.append(dict(level=lv.idx, name=lv.name, z=lv.z / 1000, tags=tags, m=m, x=x, Y=Y, M=M, xc=xc, yc=yc, J=J,
                                    W=M * G_ACC, Lx=x.max() - x.min(), Ly=Y.max() - Y.min()))

    def floor_load(self, fl, ux=0.0, uy=0.0, th=0.0, scale=1.0, by_mass=True):
        """Nodal forces on one floor for a rigid in-plane motion pattern (ux, uy, twist) times its mass."""
        dx, dy = fl["x"] - fl["xc"], fl["Y"] - fl["yc"]
        m = fl["m"] if by_mass else np.ones_like(fl["m"]) * fl["M"] / len(fl["m"])
        fx = scale * m * (ux - th * dy)
        fy = scale * m * (uy + th * dx)
        return {int(t): np.array([fx[k], fy[k], 0, 0, 0, 0]) for k, t in enumerate(fl["tags"])}

    def floor_motion(self, res: Results, fl):
        d = res.disp[fl["tags"]]
        m = fl["m"]
        ux = (m * d[:, 0]).sum() / fl["M"]
        uy = (m * d[:, 1]).sum() / fl["M"]
        th = (m * ((fl["x"] - fl["xc"]) * d[:, 1] - (fl["Y"] - fl["yc"]) * d[:, 0])).sum() / fl["J"]
        return np.array([ux, uy, th])

    # -------------------------------------------------------------- modes
    def condense(self):
        n = len(self.floors)
        F = np.zeros((3 * n, 3 * n))
        for a, fl in enumerate(self.floors):
            for k, (ux, uy, th) in enumerate([(1 / fl["M"], 0, 0), (0, 1 / fl["M"], 0), (0, 0, 1 / fl["J"])]):
                res = self.solve(self.floor_load(fl, ux, uy, th))
                for c, fl2 in enumerate(self.floors):
                    F[3 * c : 3 * c + 3, 3 * a + k] = self.floor_motion(res, fl2)
        F = (F + F.T) / 2
        self.F = F
        self.K = np.linalg.inv(F)
        self.K = (self.K + self.K.T) / 2
        self.M = np.diag(np.concatenate([[fl["M"], fl["M"], fl["J"]] for fl in self.floors]))
        w2, phi = eigh(self.K, self.M)
        self.omega = np.sqrt(w2)
        self.T = 2 * math.pi / self.omega
        self.phi = phi  # mass-normalised: phi.T M phi = I
        r = {"x": np.tile([1.0, 0, 0], n), "y": np.tile([0, 1.0, 0], n)}
        Mtot = sum(fl["M"] for fl in self.floors)
        self.gamma = {d: phi.T @ self.M @ r[d] for d in r}
        self.meff = {d: self.gamma[d] ** 2 / Mtot for d in r}
        # rotational participation (share of each mode's kinetic energy that is twist)
        self.twist_share = np.array([sum(self.M[3 * a + 2, 3 * a + 2] * phi[3 * a + 2, k] ** 2 for a in range(n)) for k in range(3 * n)])
        self.Mtot = Mtot

    # -------------------------------------------------------------- spectrum
    def Sd(self, T: float, agR_g: float | None = None) -> float:
        s = self.b.cfg["seismic"]
        ag = (agR_g if agR_g is not None else s["agR_g"]) * s["gamma_I"] * G_ACC
        q, beta = s["q"], s["beta"]
        params = {"A": (1.0, 0.15, 0.4, 2.0), "B": (1.2, 0.15, 0.5, 2.0), "C": (1.15, 0.2, 0.6, 2.0), "D": (1.35, 0.2, 0.8, 2.0), "E": (1.4, 0.15, 0.5, 2.0)}
        best = 0.0
        for gt in s["ground_types"]:
            S, TB, TC, TD = params[gt]
            if T <= TB:
                v = ag * S * (2 / 3 + T / TB * (2.5 / q - 2 / 3))
            elif T <= TC:
                v = ag * S * 2.5 / q
            elif T <= TD:
                v = max(ag * S * 2.5 / q * TC / T, beta * ag)
            else:
                v = max(ag * S * 2.5 / q * TC * TD / T**2, beta * ag)
            best = max(best, v)
        return best

    def cqc(self, R: np.ndarray) -> np.ndarray:
        """R: (modes, ...) peak modal responses -> CQC combination."""
        z = self.b.cfg["seismic"]["damping"]
        w = self.omega
        r = w[None, :] / w[:, None]
        rho = 8 * z**2 * (1 + r) * r**1.5 / ((1 - r**2) ** 2 + 4 * z**2 * r * (1 + r) ** 2)
        flat = R.reshape(R.shape[0], -1)
        out = np.einsum("i...,ij,j...->...", flat, rho, flat)
        return np.sqrt(np.maximum(out, 0)).reshape(R.shape[1:])

    def run_seismic(self, agR_g: float | None = None, label="E"):
        """Response spectrum in x and y (CQC), plus accidental torsion, per EN 1998-1 4.3.3.3."""
        s = self.b.cfg["seismic"]
        nm = len(self.T)
        if not hasattr(self, "mode_res"):
            self.mode_res = []
            for k in range(nm):
                ph = self.phi[:, k]
                loads = {}
                for a, fl in enumerate(self.floors):
                    for t, f in self.floor_load(fl, *ph[3 * a : 3 * a + 3]).items():
                        loads[t] = loads.get(t, 0) + f
                self.mode_res.append(self.solve(loads))
        sd = np.array([self.Sd(T, agR_g) for T in self.T])
        out = {}
        for d in ("x", "y"):
            amp = self.gamma[d] * sd  # mode k response = amp[k] * unit response
            comb = {}
            for part in ("frames", "cores", "disp", "react", "raft"):
                R = np.array([amp[k] * getattr(self.mode_res[k], part) for k in range(nm)])
                comb[part] = self.cqc(R) if R.size else getattr(self.mode_res[0], part) * 0
            rsa = Results(comb["frames"], comb["cores"], comb["disp"], comb["react"], comb["raft"])
            # floor motion per mode for drifts (at each floor's centre of mass)
            modal_floor = np.array([amp[k] * self.phi[:, k] / self.omega[k] ** 2 for k in range(nm)])  # (modes, 3n)
            # accidental torsion: torques e * F_i from the lateral force distribution
            T1 = max(self.T[np.argmax(self.meff[d])], 0.0)
            lam = 0.85 if T1 <= 2 * 0.6 and len(self.floors) > 2 else 1.0
            Fb = self.Sd(T1, agR_g) * self.Mtot * lam
            zm = np.array([fl["z"] * fl["M"] for fl in self.floors])
            Fi = Fb * zm / zm.sum()
            loads = {}
            for fl, F in zip(self.floors, Fi):
                L = fl["Ly"] if d == "x" else fl["Lx"]
                torque = s["accidental_e"] * L * F
                for t, f in self.floor_load(fl, 0, 0, torque / fl["J"]).items():
                    loads[t] = loads.get(t, 0) + f
            tors = self.solve(loads)
            out[d] = dict(rsa=rsa, tors=tors, total=rsa + tors.abs(), modal_floor=modal_floor, Fb=Fb, Fi=Fi, T1=T1, sd=sd, amp=amp)
        self.cases[label] = out
        return out

    def peak(self, label: str, d: str, fn) -> np.ndarray:
        """Peak of a quantity derived from the results (a section cut, a group of reactions): the
        quantity is worked out in each mode first, then the modes are combined (CQC), plus the
        accidental torsion. fn(Results) -> array, linear in the results."""
        E = self.cases[label][d]
        vals = np.array([fn(r) for r in self.mode_res])
        vals = vals * E["amp"].reshape(-1, *([1] * (vals.ndim - 1)))
        return self.cqc(vals) + np.abs(fn(E["tors"]))

    def env_peak(self, label: str, fn) -> np.ndarray:
        """EN 1998-1 4.3.3.5.1: the worse of Ex + 0.3 Ey and 0.3 Ex + Ey."""
        ex, ey = self.peak(label, "x", fn), self.peak(label, "y", fn)
        return np.maximum(ex + 0.3 * ey, 0.3 * ex + ey)

    # -------------------------------------------------------------- wind
    def wind_qp(self, z: float) -> float:
        w = self.b.cfg["wind"]
        z0, zmin = w["z0"], w["zmin"]
        z = max(z, zmin)
        kr = 0.19 * (z0 / 0.05) ** 0.07
        cr = kr * math.log(z / z0)
        vm = cr * w["vb0"]
        Iv = 1 / math.log(z / z0)
        return (1 + 7 * Iv) * 0.5 * w["rho"] * vm**2 / 1000  # kN/m2

    def run_wind(self):
        """EN 1991-1-4: net pressure (windward + leeward) on each storey's facade, as floor forces; torsion e = b/10."""
        w = self.b.cfg["wind"]
        top = self.floors[-1]
        H = top["z"] + 1.0  # parapet
        zbase = self.b.base.z / 1000
        out = {}
        for d in ("x", "y"):
            b_face = max(fl["Ly"] if d == "x" else fl["Lx"] for fl in self.floors)  # facade width the wind hits
            Fi = []
            zs = [self.b.base.z / 1000] + [fl["z"] for fl in self.floors]
            for a, fl in enumerate(self.floors):
                lo = (zs[a] + zs[a + 1]) / 2
                hi = (zs[a + 1] + zs[a + 2]) / 2 if a + 2 < len(zs) else H
                zmid = (lo + hi) / 2
                h_above = H - zbase
                # reference height zone (EN 1991-1-4 Fig 7.4)
                if h_above <= b_face:
                    ze = H
                elif h_above <= 2 * b_face:
                    ze = zbase + b_face if zmid - zbase <= b_face else H
                else:
                    ze = min(max(zmid, zbase + b_face), H)
                qp = self.wind_qp(ze - zbase)
                width = fl["Ly"] if d == "x" else fl["Lx"]
                Fi.append((w["cpe_windward"] - w["cpe_leeward"]) * qp * width * (hi - lo))
            Fi = np.array(Fi)
            loads, tl = {}, {}
            for fl, F in zip(self.floors, Fi):
                for t, f in self.floor_load(fl, F / fl["M"] if d == "x" else 0, F / fl["M"] if d == "y" else 0).items():
                    loads[t] = loads.get(t, 0) + f
                width = fl["Ly"] if d == "x" else fl["Lx"]
                for t, f in self.floor_load(fl, 0, 0, F * w["torsion_e_frac"] * width / fl["J"]).items():
                    tl[t] = tl.get(t, 0) + f
            out[d] = dict(F=Fi, base_shear=Fi.sum(), res=self.solve(loads), tors=self.solve(tl))
        self.cases["W"] = out
        return out
