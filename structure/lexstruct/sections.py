"""Reinforced-concrete section capacity by strain compatibility (EN 1992-1-1 6.1).

A section is concrete fibres plus bars. Its interaction surface (N, Mx, My) is sampled once for a
grid of neutral-axis angles and depths; a check then reads, for the design axial force, the moment
capacity in the direction of the design moment, so biaxial bending is handled directly.

Concrete: parabola-rectangle, fcd = alpha_cc fck / gamma_c, eps_c2 = 0.002, eps_cu2 = 0.0035, no
tension. Steel: elastic-plastic, fyd = fyk / gamma_s. Beyond the section (whole section in
compression) the strain pivots about the point 3/7 h from the compressed face (6.1(5)).
Compression positive. Lengths in m, forces kN, moments kNm.
"""
from __future__ import annotations

import math

import numpy as np

EPS_C2 = 0.002
EPS_CU = 0.0035


class Section:
    def __init__(self, conc: np.ndarray, bars: np.ndarray, fck: float, fyk: float, gamma_c=1.5, gamma_s=1.15, alpha_cc=1.0, Es=200e6, label=""):
        """conc: (n,3) fibre x, y, area (m, m, m2); bars: (m,3) x, y, area."""
        self.conc = conc
        self.bars = bars if len(bars) else np.zeros((0, 3))
        self.fcd = alpha_cc * fck / gamma_c * 1000  # kPa
        self.fyd = fyk / gamma_s * 1000
        self.Es = Es
        self.label = label
        A = conc[:, 2].sum()
        self.cx = (conc[:, 0] * conc[:, 2]).sum() / A
        self.cy = (conc[:, 1] * conc[:, 2]).sum() / A
        self.Ac = A
        self.As = self.bars[:, 2].sum()
        self.N_max = A * self.fcd + self.As * min(self.fyd, self.Es * EPS_C2)
        self.N_min = -self.As * self.fyd
        self._surface()

    def _resultants(self, theta: float, c: float):
        """Strain plane with the compressed side towards angle theta and neutral axis depth c."""
        ux, uy = math.cos(theta), math.sin(theta)
        allx = np.concatenate([self.conc[:, 0], self.bars[:, 0]])
        ally = np.concatenate([self.conc[:, 1], self.bars[:, 1]])
        proj = allx * ux + ally * uy
        top, bot = proj.max(), proj.min()
        D = top - bot
        d = top - proj  # depth from the compressed face
        if c <= D:
            eps = EPS_CU * (c - d) / c
        else:
            piv = 3 / 7 * D
            eps = EPS_C2 * (c - d) / (c - piv)
        n = len(self.conc)
        ec = eps[:n]
        sc = np.where(ec <= 0, 0.0, np.where(ec < EPS_C2, self.fcd * (1 - (1 - ec / EPS_C2) ** 2), self.fcd))
        fc = sc * self.conc[:, 2]
        es = eps[n:]
        ss = np.clip(self.Es * es, -self.fyd, self.fyd)
        fs = ss * self.bars[:, 2]
        N = fc.sum() + fs.sum()
        Mx = (fc * (self.conc[:, 1] - self.cy)).sum() + (fs * (self.bars[:, 1] - self.cy)).sum()
        My = -(fc * (self.conc[:, 0] - self.cx)).sum() - (fs * (self.bars[:, 0] - self.cx)).sum()
        return N, Mx, My

    def _surface(self, n_theta=48, n_c=70):
        """N, Mx, My for each angle over a range of neutral-axis depths (monotonic in N)."""
        self.thetas = np.linspace(0, 2 * math.pi, n_theta, endpoint=False)
        allx = np.concatenate([self.conc[:, 0], self.bars[:, 0]])
        ally = np.concatenate([self.conc[:, 1], self.bars[:, 1]])
        self.surf = []
        for th in self.thetas:
            proj = allx * math.cos(th) + ally * math.sin(th)
            D = proj.max() - proj.min()
            cs = np.concatenate([np.geomspace(D * 1e-3, D, n_c - 15), np.linspace(D * 1.05, D * 12, 15)])
            pts = np.array([self._resultants(th, c) for c in cs])
            # pure tension and pure compression ends
            pts = np.vstack([[self.N_min, 0, 0], pts, [self.N_max, 0, 0]])
            self.surf.append(pts)

    def utilisation(self, N: float, Mx: float, My: float) -> float:
        """Demand / capacity along the ray from (N, 0, 0) through the design moment, at the design N."""
        if N > self.N_max:
            return N / self.N_max
        if N < self.N_min:
            return N / self.N_min
        pts = []
        for s in self.surf:
            Ns = s[:, 0]
            k = np.searchsorted(Ns, N)
            if k <= 0 or k >= len(Ns):
                continue
            t = (N - Ns[k - 1]) / (Ns[k] - Ns[k - 1]) if Ns[k] != Ns[k - 1] else 0
            pts.append(s[k - 1, 1:] + t * (s[k, 1:] - s[k - 1, 1:]))
        pts = np.array(pts)
        M = math.hypot(Mx, My)
        if len(pts) < 3:
            return 0.0
        if M < 1e-9:
            return max(0.0, N / self.N_max) if N > 0 else N / self.N_min
        # capacity in the demand's direction: where the ray through it leaves the capacity polygon
        R = self._ray(pts, math.atan2(My, Mx))
        return M / R if R > 0 else 99.0

    @staticmethod
    def _ray(pts: np.ndarray, ang: float) -> float:
        d = np.array([math.cos(ang), math.sin(ang)])
        best = 0.0
        n = len(pts)
        order = np.argsort(np.arctan2(pts[:, 1], pts[:, 0]))
        P = pts[order]
        for i in range(n):
            p, q = P[i], P[(i + 1) % n]
            e = q - p
            den = d[0] * (-e[1]) - d[1] * (-e[0])
            if abs(den) < 1e-12:
                continue
            # solve t d = p + s e
            t = (p[0] * (-e[1]) - p[1] * (-e[0])) / den
            s = (d[0] * p[1] - d[1] * p[0]) / den
            if t > 0 and -1e-9 <= s <= 1 + 1e-9:
                best = max(best, t)
        return best


def rect_section(bx: float, by: float, n_bars: int, dia_mm: float, cover_mm: float, link_mm: float, fck, fyk, **kw) -> Section:
    """bx x by (m) rectangle with n bars spread evenly round the perimeter (corners first)."""
    nx, ny = max(4, int(round(bx / 0.03))), max(4, int(round(by / 0.03)))
    xs = (np.arange(nx) + 0.5) * bx / nx
    ys = (np.arange(ny) + 0.5) * by / ny
    X, Y = np.meshgrid(xs, ys)
    conc = np.column_stack([X.ravel(), Y.ravel(), np.full(X.size, bx * by / X.size)])
    bars = bar_ring(bx, by, n_bars, dia_mm, cover_mm, link_mm)
    return Section(conc, bars, fck, fyk, **kw)


def bar_ring(bx, by, n, dia_mm, cover_mm, link_mm):
    if n <= 0:
        return np.zeros((0, 3))
    e = (cover_mm + link_mm + dia_mm / 2) / 1000
    x0, x1, y0, y1 = e, bx - e, e, by - e
    a = math.pi * (dia_mm / 1000) ** 2 / 4
    if n <= 4:
        pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)][:n]
        return np.array([(x, y, a) for x, y in pts])
    # bars beyond the 4 corners go on the faces in proportion to their lengths, in pairs (symmetric)
    extra = n - 4
    W, H = x1 - x0, y1 - y0
    on_x = int(round(extra * W / (W + H) / 2))
    on_y = (extra - 2 * on_x) // 2
    if 4 + 2 * on_x + 2 * on_y < n:
        if W >= H:
            on_x += (n - 4 - 2 * on_x - 2 * on_y + 1) // 2
        else:
            on_y += (n - 4 - 2 * on_x - 2 * on_y + 1) // 2
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for k in range(1, on_x + 1):
        x = x0 + W * k / (on_x + 1)
        pts += [(x, y0), (x, y1)]
    for k in range(1, on_y + 1):
        y = y0 + H * k / (on_y + 1)
        pts += [(x0, y), (x1, y)]
    return np.array([(x, y, a) for x, y in pts])


def walls_section(segments, fck, fyk, rho_v: float, cover_mm=40, **kw) -> Section:
    """A section of wall strips (a core): segments (x0, y0, x1, y1, t) in m, centre lines, with a vertical
    bar ratio rho_v split equally between the two faces."""
    conc, bars = [], []
    for x0, y0, x1, y1, t in segments:
        L = math.dist((x0, y0), (x1, y1))
        if L <= 0:
            continue
        n = max(2, int(round(L / 0.05)))
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        nx, ny = -uy, ux
        for k in range(n):
            s = (k + 0.5) / n * L
            px, py = x0 + ux * s, y0 + uy * s
            for off in (-t / 4, t / 4):
                conc.append((px + nx * off, py + ny * off, L / n * t / 2))
            a = rho_v * t * L / n / 2
            for side in (-1, 1):
                off = side * (t / 2 - (cover_mm + 12) / 1000)
                bars.append((px + nx * off, py + ny * off, a))
    return Section(np.array(conc), np.array(bars), fck, fyk, **kw)
