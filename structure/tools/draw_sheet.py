"""A setting-out drawing sheet of one floor from the as-built record: an A1 sheet at 1:100 (PDF) for the structural
engineer to detail the reinforcement from, and the same plan as a DXF (mm, 1:1, on layers) for his CAD.

    node structure/tools/export-sheet.ts asbuilt_live.json 2 > structure/private/sheets/sheet-2.json
    python3 structure/tools/draw_sheet.py structure/private/sheets/sheet-2.json structure/private/sheets/LEX-AB-02

Needs reportlab and ezdxf. What is drawn, from the record (export-sheet.ts, the as-built app's own geometry):
- the grid as built, with bubbles both ends and the spacings (figures taped on site marked with a triangle);
- the slab outline and every edge set out from its grid line;
- columns and walls of this floor, solid, with their type and size; the columns of the floor below dashed where they
  sit more than the app's 25 mm away from the column above;
- lift cores with their doors, stair openings, voids with their sizes and set-out from the grid;
- the fixed point; schedules of columns and openings with every face set out from its grid lines; the record's
  drawing notes; a title block.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
from pathlib import Path

from reportlab.lib.colors import Color, black, white
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
pdfmetrics.registerFont(TTFont("Sans", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Sans-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))

W, H = 841.0, 594.0  # A1 landscape, mm
SCALE = 1 / 100
STRIP = 128.0  # title strip width, mm
TOL_WARN = 25.0  # mm: the app's "more than 25 mm off"
RED = Color(0.70, 0.12, 0.10)
AMBER = Color(0.72, 0.48, 0.05)
GREEN = Color(0.18, 0.50, 0.30)
GREY = Color(0.45, 0.45, 0.45)
LIGHT = Color(0.82, 0.82, 0.82)
BLUEGREY = Color(0.30, 0.42, 0.52)
MEAS = "▲"  # measured on site


def pt(size):
    """Font size in points for text whose capitals stand about `size` mm high."""
    return size * 2.8346 * 1.3


def fmt(v, signed=False):
    if v is None:
        return "–"
    v = round(float(v))
    s = f"{abs(v):,}".replace(",", " ")
    if signed:
        return ("+" if v > 0 else "−" if v < 0 else "±") + s
    return ("−" if v < 0 else "") + s


class Sheet:
    def __init__(self, data, out):
        self.d = data
        self.c = canvas.Canvas(str(out), pagesize=(W * mm, H * mm))
        self.c.setTitle(f"The Lexington - {data['floor']['name']} as-built setting-out plan")
        self.c.setAuthor("The Lexington as-built record")
        gx = {g["id"]: g["actual"] for g in data["grid"]["x"]}
        gy = {g["id"]: g["actual"] for g in data["grid"]["y"]}
        self.gx, self.gy = gx, gy
        pts = [p for p in (data["corners"] or [])]
        xs = [p[0] for p in pts] + list(gx.values())
        ys = [p[1] for p in pts] + list(gy.values())
        self.ext = (min(xs), min(ys), max(xs), max(ys))
        # the plan sits in the top of the drawing area, centred across it
        area_l, area_r = 20.0, W - 10.0 - STRIP - 6.0
        x0, y0, x1, y1 = self.ext
        self.ox = (area_l + area_r) / 2 - (x0 + x1) / 2 * SCALE
        self.oy = H - 10.0 - 52.0 + y0 * SCALE  # Y(y0) = top of plan, 52 mm below the frame for bubbles and strings
        self.plan_bottom = self.Y(y1)

    # ---- coordinates (record mm -> sheet mm, reportlab points)
    def X(self, x):
        return self.ox + x * SCALE

    def Y(self, y):
        return self.oy - y * SCALE

    def P(self, x, y):
        return self.X(x) * mm, self.Y(y) * mm

    # ---- drawing helpers (sheet mm)
    def line(self, x1, y1, x2, y2, w=0.18, col=black, dash=None):
        c = self.c
        c.setStrokeColor(col)
        c.setLineWidth(w * mm)
        c.setDash(dash or [], 0)
        c.line(x1 * mm, y1 * mm, x2 * mm, y2 * mm)
        c.setDash([], 0)

    def rect(self, x0, y0, x1, y1, w=0.25, col=black, fill=None, dash=None):
        c = self.c
        c.setStrokeColor(col)
        c.setLineWidth(w * mm)
        if dash:
            c.setDash(dash, 0)
        if fill is not None:
            c.setFillColor(fill)
        c.rect(min(x0, x1) * mm, min(y0, y1) * mm, abs(x1 - x0) * mm, abs(y1 - y0) * mm, stroke=1 if w else 0, fill=1 if fill is not None else 0)
        c.setDash([], 0)

    def text(self, x, y, s, size=2.5, bold=False, col=black, align="c", rot=0):
        c = self.c
        c.saveState()
        c.setFillColor(col)
        c.setFont("Sans-Bold" if bold else "Sans", pt(size))
        c.translate(x * mm, y * mm)
        if rot:
            c.rotate(rot)
        if align == "c":
            c.drawCentredString(0, 0, s)
        elif align == "r":
            c.drawRightString(0, 0, s)
        else:
            c.drawString(0, 0, s)
        c.restoreState()

    def twidth(self, s, size=2.5, bold=False):
        return pdfmetrics.stringWidth(s, "Sans-Bold" if bold else "Sans", pt(size)) / 2.8346

    def tick(self, x, y, w=0.25):
        self.line(x - 0.8, y - 0.8, x + 0.8, y + 0.8, w)

    def dim_h(self, xa, xb, y, label, size=2.2, col=black, above=True):
        """Horizontal dimension between sheet x positions xa, xb at sheet height y (ticks at both ends)."""
        if abs(xb - xa) < 0.3:
            return
        self.line(min(xa, xb) - 1.2, y, max(xa, xb) + 1.2, y, 0.13, col)
        for xx in (xa, xb):
            self.tick(xx, y)
        w = self.twidth(label, size)
        mid = (xa + xb) / 2
        lift = 0.0
        if w + 1.0 > abs(xb - xa):
            lift = size + 1.2  # no room between the ticks: a second row, clear of the neighbours' figures
        self.text(mid, y + (0.7 + lift if above else -size - 0.6 - lift), label, size, col=col)

    def dim_v(self, ya, yb, x, label, size=2.2, col=black, left=True):
        """Vertical dimension between sheet heights ya, yb at sheet x (text reads up the page)."""
        if abs(yb - ya) < 0.3:
            return
        self.line(x, min(ya, yb) - 1.2, x, max(ya, yb) + 1.2, 0.13, col)
        for yy in (ya, yb):
            self.tick(x, yy)
        w = self.twidth(label, size)
        mid = (ya + yb) / 2
        out = 0.0
        if w + 1.0 > abs(yb - ya):
            out = size + 1.2  # no room between the ticks: a second column, clear of the neighbours' figures
        self.text(x + (-0.7 - out if left else size + 0.6 + out), mid, label, size, col=col, rot=90)

    def bubble(self, x, y, label, r=4.2):
        c = self.c
        c.setStrokeColor(black)
        c.setLineWidth(0.25 * mm)
        c.setFillColor(white)
        c.circle(x * mm, y * mm, r * mm, stroke=1, fill=1)
        self.text(x, y - 1.25, label, 3.2, bold=True)

    # ---- the plan
    def grid(self):
        d = self.d
        x0, y0, x1, y1 = self.ext
        top, bot = self.Y(y0) + 34, self.Y(y1) - 34
        lft, rgt = self.X(x0) - 34, self.X(x1) + 34
        # a bubble too close to the one before it steps further out, on a short leader
        def stagger(lines, pos):
            out, last, k = [], None, 0
            for g in lines:
                p = pos(g["actual"])
                k = k + 1 if last is not None and abs(p - last) < 9.0 and k == 0 else 0
                out.append((g, p, k))
                last = p
            return out
        for g, X, k in stagger(d["grid"]["x"], self.X):
            t, b = top + 9 * k, bot - 9 * k
            self.line(X, b + 4.2, X, t - 4.2, 0.13, BLUEGREY, dash=[6, 1.2, 1, 1.2])
            self.bubble(X, t, g["id"])
            self.bubble(X, b, g["id"])
        for g, Y, k in stagger(d["grid"]["y"], self.Y):
            lf, rg = lft - 9 * k, rgt + 9 * k
            self.line(lf + 4.2, Y, rg - 4.2, Y, 0.13, BLUEGREY, dash=[6, 1.2, 1, 1.2])
            self.bubble(lf, Y, g["id"])
            self.bubble(rg, Y, g["id"])
        # spacings: inner string between lines, outer string overall, top and left; bottom and right inner only
        xs = d["grid"]["x"]
        ys = d["grid"]["y"]
        yi, yo = self.Y(y0) + 14, self.Y(y0) + 22
        for a, b in zip(xs[:-1], xs[1:]):
            lab = fmt(b["actual"] - a["actual"]) + (" " + MEAS if b.get("measured") else "")
            self.dim_h(self.X(a["actual"]), self.X(b["actual"]), yi, lab)
            self.dim_h(self.X(a["actual"]), self.X(b["actual"]), self.Y(y1) - 14, lab, above=False)
        self.dim_h(self.X(xs[0]["actual"]), self.X(xs[-1]["actual"]), yo, fmt(xs[-1]["actual"] - xs[0]["actual"]), 2.5)
        xi, xo = self.X(x0) - 14, self.X(x0) - 22
        for a, b in zip(ys[:-1], ys[1:]):
            lab = fmt(b["actual"] - a["actual"]) + (" " + MEAS if b.get("measured") else "")
            self.dim_v(self.Y(a["actual"]), self.Y(b["actual"]), xi, lab)
            self.dim_v(self.Y(a["actual"]), self.Y(b["actual"]), self.X(x1) + 14, lab, left=False)
        self.dim_v(self.Y(ys[0]["actual"]), self.Y(ys[-1]["actual"]), xo, fmt(ys[-1]["actual"] - ys[0]["actual"]), 2.5)

    def slab(self):
        d = self.d
        pts = d["corners"]
        c = self.c
        # slab tone, then the outline
        p = c.beginPath()
        for k, (x, y) in enumerate(pts):
            (p.moveTo if k == 0 else p.lineTo)(*self.P(x, y))
        p.close()
        c.setFillColor(Color(0.95, 0.94, 0.91))
        c.setStrokeColor(black)
        c.setLineWidth(0.6 * mm)
        c.drawPath(p, stroke=1, fill=1)
        # the drawing's outline where the record differs from it, dashed
        if d.get("corners_design") and d["corners_design"] != pts:
            p = c.beginPath()
            for k, (x, y) in enumerate(d["corners_design"]):
                (p.moveTo if k == 0 else p.lineTo)(*self.P(x, y))
            p.close()
            c.setStrokeColor(GREY)
            c.setLineWidth(0.18 * mm)
            c.setDash([2, 1.2], 0)
            c.drawPath(p, stroke=1, fill=0)
            c.setDash([], 0)

    def edge_dims(self):
        """Each slab edge set out from its grid line, near the edge's middle."""
        d = self.d
        for e in d["edges"]:
            if not e.get("segment"):
                continue
            (ax, ay), (bx, by) = e["segment"]
            off = e["offset_actual"]
            if off is None or abs(off) < 1:
                continue
            col = RED if e.get("deviation") and abs(e["deviation"]) > TOL_WARN else black
            lab = fmt(abs(off)) + (" " + MEAS if e["measured"] else "")
            if e.get("deviation") and abs(e["deviation"]) > 1:
                lab += f" (dwg {fmt(abs(e['offset_design']))})"
            # along the edge, the first spot whose dimension and figure keep clear of columns and openings
            w = self.twidth(lab, 2.0) + 2
            if e["axis"] == "y":  # an edge across the page: dimension down from its row line
                line_y = self.gy[e["ref"]]
                ya_, yb_ = sorted((self.Y(line_y), self.Y(e["actual"])))
                spot = self.clear_spot(ax, bx, lambda s: (self.X(s) - 3.5, ya_ - w / 2, self.X(s) + 0.5, yb_ + w / 2), along="x")
                self.dim_v(self.Y(line_y), self.Y(e["actual"]), self.X(spot), lab, 2.0, col)
            else:
                line_x = self.gx[e["ref"]]
                xa_, xb_ = sorted((self.X(line_x), self.X(e["actual"])))
                spot = self.clear_spot(ay, by, lambda s: (xa_ - w / 2, self.Y(s) - 0.5, xb_ + w / 2, self.Y(s) + 3.5), along="y")
                self.dim_h(self.X(line_x), self.X(e["actual"]), self.Y(spot), lab, 2.0, col)

    def clear_spot(self, a, b, footprint, along):
        """A point between a and b (record mm) where a dimension's footprint (sheet mm box from footprint(s)) misses every
        column, wall, core and opening; the middle if none does."""
        boxes = []
        for el in self.d["columns"] + self.d["cores"] + self.d["openings"]:
            x0, y0, x1, y1 = el["box"]
            boxes.append((self.X(x0) - 1.5, self.Y(y1) - 1.5, self.X(x1) + 1.5, self.Y(y0) + 1.5))
        lo, hi = sorted((a, b))
        for t in (0.5, 0.35, 0.65, 0.22, 0.78, 0.12, 0.88):
            s = lo + (hi - lo) * t
            fx0, fy0, fx1, fy1 = footprint(s)
            if not any(fx0 < bx1 and fx1 > bx0 and fy0 < by1 and fy1 > by0 for bx0, by0, bx1, by1 in boxes):
                return s
        return (lo + hi) / 2

    def boxes(self):
        d = self.d
        below = {c["key"]: c for c in (d.get("below") or {}).get("columns", [])}
        self.flags = []
        for c in d["columns"]:
            x0, y0, x1, y1 = c["box"]
            fill = black if not c["measured"] else (RED if c["status"] == "off" else AMBER if c["status"] == "warn" else GREEN)
            self.rect(self.X(x0), self.Y(y0), self.X(x1), self.Y(y1), 0.25, black, fill=fill)
            if c.get("ends"):
                self.rect(self.X(x0) + 0.5, self.Y(y0) - 0.5, self.X(x1) - 0.5, self.Y(y1) + 0.5, 0.1, white, fill=white)
            size = f"{round(x1 - x0)}×{round(y1 - y0)}"
            # label to the upper right, or the left near the right edge of the building
            right = c["box"][2] < self.ext[2] - 2500
            lx = (self.X(x1) + 1.2) if right else (self.X(x0) - 1.2)
            self.text(lx, self.Y(y0) + 0.6, c["name"], 2.2, bold=True, align="l" if right else "r")
            self.text(lx, self.Y(y0) - 2.2, size, 1.8, col=GREY, align="l" if right else "r")
            b = below.get(c["key"])
            if b and b.get("box"):
                bx0, by0, bx1, by1 = b["box"]
                dx = (bx0 + bx1) / 2 - (x0 + x1) / 2
                dy = (by0 + by1) / 2 - (y0 + y1) / 2
                if math.hypot(dx, dy) > TOL_WARN or abs((bx1 - bx0) - (x1 - x0)) > TOL_WARN or abs((by1 - by0) - (y1 - y0)) > TOL_WARN:
                    self.rect(self.X(bx0), self.Y(by0), self.X(bx1), self.Y(by1), 0.25, RED, dash=[1.2, 0.8])
                    self.flags.append((c, dx, dy))
        for k in d["cores"]:
            x0, y0, x1, y1 = k["box"]
            t = k.get("wall") or 300
            X0, Y0, X1, Y1 = self.X(x0), self.Y(y0), self.X(x1), self.Y(y1)
            tt = t * SCALE
            # four walls, the door left out of its side
            walls = [(X0, Y0, X1, Y0 - tt, "t"), (X0, Y1 + tt, X1, Y1, "b"), (X0, Y0 - tt, X0 + tt, Y1 + tt, "l"), (X1 - tt, Y0 - tt, X1, Y1 + tt, "r")]
            door = k.get("door")
            for a, b, cc, dd, side in walls:
                if door and door.get("side") == side and side in ("t", "b"):
                    da = X0 + door["from"] * SCALE
                    db = da + door["width"] * SCALE
                    self.rect(a, b, da, dd, 0.25, black, fill=black)
                    self.rect(db, b, cc, dd, 0.25, black, fill=black)
                else:
                    self.rect(a, b, cc, dd, 0.25, black, fill=black)
            self.line(X0 + tt, Y0 - tt, X1 - tt, Y1 + tt, 0.13)
            self.line(X0 + tt, Y1 + tt, X1 - tt, Y0 - tt, 0.13)
            self.text((X0 + X1) / 2, (Y0 + Y1) / 2 + 3.2, k["name"].upper(), 2.4, bold=True)
            self.text((X0 + X1) / 2, (Y0 + Y1) / 2 - 5.6, f"{round(x1 - x0)}×{round(y1 - y0)}", 1.8, col=GREY)
        # openings: stairs with treads, voids crossed
        for o in d["openings"]:
            x0, y0, x1, y1 = o["box"]
            X0, Y0, X1, Y1 = self.X(x0), self.Y(y0), self.X(x1), self.Y(y1)
            col = black if o["kind"] != "void" or not o.get("added") else BLUEGREY
            self.rect(X0, Y0, X1, Y1, 0.35, col, fill=white)
            w, h = round(x1 - x0), round(y1 - y0)
            if o["kind"] == "stair":
                n = int(abs(Y0 - Y1) / 2.5)
                for k in range(1, n):
                    yy = Y1 + k * (Y0 - Y1) / n
                    self.line(X0, yy, X1, yy, 0.1, GREY)
                self.line(X0, Y1, X1, Y0, 0.13)  # the cut line
                self.text((X0 + X1) / 2, (Y0 + Y1) / 2 + 1.0, o["name"].upper(), 2.2, bold=True)
                self.text((X0 + X1) / 2, (Y0 + Y1) / 2 - 2.0, f"{w}×{h}", 1.8, col=GREY)
            else:
                self.line(X0, Y0, X1, Y1, 0.13, col)
                self.line(X0, Y1, X1, Y0, 0.13, col)
                # a tag above the opening (north); its name, size and set-out are in the schedule
                tag = self.otag[o["key"]]
                tw = self.twidth(tag, 1.9, True) + 1.6
                cx = (X0 + X1) / 2
                self.rect(cx - tw / 2, Y0 + 0.8, cx + tw / 2, Y0 + 4.0, 0.15, col, fill=white)
                self.text(cx, Y0 + 1.6, tag, 1.9, bold=True, col=col)
        # the fixed point
        fk = d.get("fixed")
        fc = next((c for c in d["columns"] if c["key"] == fk), None)
        if fc:
            x0, y0, x1, y1 = fc["box"]
            cx, cy = self.X((x0 + x1) / 2), self.Y((y0 + y1) / 2)
            self.c.setStrokeColor(BLUEGREY)
            self.c.setLineWidth(0.25 * mm)
            self.c.setDash([1.5, 1], 0)
            self.c.circle(cx * mm, cy * mm, 4.5 * mm, stroke=1, fill=0)
            self.c.setDash([], 0)
            self.text(cx + 5.5, cy - 7.5, "FIXED POINT", 2.0, bold=True, col=BLUEGREY, align="l")
            self.text(cx + 5.5, cy - 10.2, "everything set out from here", 1.7, col=BLUEGREY, align="l")

    def level_tag(self):
        d = self.d
        lv = d["floor"]["level"] / 1000
        # in the middle of the slab between the cores
        pts = d["corners"]
        xs = sorted(self.gx.values())
        x = (xs[len(xs) // 2 - 1] + xs[len(xs) // 2]) / 2
        y = self.gy.get("4", (pts[0][1] + pts[2][1]) / 2) + 1600
        X, Y = self.X(x), self.Y(y)
        self.rect(X - 15, Y - 2.8, X + 15, Y + 4.6, 0.25, black, fill=white)
        self.text(X, Y, f"SSL +{lv:.3f}", 3.2, bold=True)

    # ---- schedules
    def table(self, x, y, cols, rows, title, size=2.0, rh=4.2):
        """cols: [(heading, width, align)]; rows: [[cells]] (a cell may be (text, colour)). Returns the bottom y."""
        self.text(x, y + 2.0, title, 3.0, bold=True, align="l")
        y -= 1.5
        tw = sum(c[1] for c in cols)
        self.line(x, y, x + tw, y, 0.35)
        xx = x
        for head, w_, al in cols:
            self.text(xx + (w_ / 2 if al == "c" else w_ - 1 if al == "r" else 1), y - rh + 1.2, head, size, bold=True, align=al)
            xx += w_
        y -= rh
        self.line(x, y, x + tw, y, 0.25)
        for k, row in enumerate(rows):
            if k % 2 == 1:
                self.rect(x, y, x + tw, y - rh, 0, fill=Color(0.955, 0.955, 0.955))
            xx = x
            for (head, w_, al), cell in zip(cols, row):
                col = black
                if isinstance(cell, tuple):
                    cell, col = cell
                self.text(xx + (w_ / 2 if al == "c" else w_ - 1 if al == "r" else 1), y - rh + 1.2, str(cell), size, col=col, align=al)
                xx += w_
            y -= rh
        self.line(x, y, x + tw, y, 0.35)
        return y

    def faces(self, el):
        """The box's faces from its own grid lines: l, r from its lettered line; t, b from its numbered line."""
        x0, y0, x1, y1 = el["box"]
        gx, gy = self.gx.get(el["x"]), self.gy.get(el["y"])
        if gx is None or gy is None:
            return "–"
        return f"{fmt(x0 - gx, True)} / {fmt(x1 - gx, True)}  ·  {fmt(y0 - gy, True)} / {fmt(y1 - gy, True)}"

    def schedules(self):
        d = self.d
        below = {c["key"]: c for c in (d.get("below") or {}).get("columns", [])}
        top = self.plan_bottom - 44
        rows = []
        for c in sorted(d["columns"] + d["cores"], key=lambda c: (self.gy.get(c["y"], 0), self.gx.get(c["x"], 0))):
            x0, y0, x1, y1 = c["box"]
            if c["measured"]:
                dv = c.get("deviation") or {}
                off = f"{fmt(dv.get('dx'), True)}, {fmt(dv.get('dy'), True)}"
                rec = (MEAS + " taped", RED if c["status"] == "off" else AMBER if c["status"] == "warn" else GREEN)
                offc = (off, RED if c["status"] == "off" else black)
            else:
                rec, offc = ("drawing", "–")
            b = below.get(c["key"])
            if b and b.get("box"):
                bx0, by0, bx1, by1 = b["box"]
                dx = (bx0 + bx1) / 2 - (x0 + x1) / 2
                dy = (by0 + by1) / 2 - (y0 + y1) / 2
                far = math.hypot(dx, dy) > TOL_WARN
                bel = (f"{fmt(dx, True)}, {fmt(dy, True)}" + (" " + MEAS if b["measured"] else ""), RED if far else black)
            else:
                bel = "–"
            rows.append([c["ref"], c["name"], f"{round(x1 - x0)}×{round(y1 - y0)}", self.faces(c), rec, offc, bel])
        cols = [("Grid", 14, "l"), ("Type", 14, "l"), ("Size b×h", 20, "c"), ("Faces from grid: left / right  ·  top / bottom", 70, "c"),
                ("Record", 18, "c"), ("Off drawing x, y", 26, "c"), ("Column below vs this, x, y", 34, "c")]
        x = 20.0
        half = (len(rows) + 1) // 2
        bottom = self.table(x, top, cols, rows[:half], "COLUMNS, WALLS AND LIFT CORES", 1.9, 4.0)
        x2 = x + sum(c[1] for c in cols) + 8
        self.table(x2, top, cols, rows[half:], "", 1.9, 4.0)
        # openings
        orows = []
        for o in self.openings:
            x0, y0, x1, y1 = o["box"]
            if o.get("added"):
                status = ("made on site " + MEAS, BLUEGREY)
            elif o["measured"]:
                status = (MEAS + " taped" + (", moved" if o.get("status") in ("warn", "off") else ""), RED if o.get("status") == "off" else black)
            else:
                status = "drawing"
            orows.append([self.otag[o["key"]], o["name"], o["ref"], f"{round(x1 - x0)}×{round(y1 - y0)}", self.faces(o), status])
        ocols = [("Tag", 14, "l"), ("Opening", 26, "l"), ("Grid", 12, "l"), ("Size", 18, "c"), ("Faces from grid: left / right  ·  top / bottom", 70, "c"), ("Record", 28, "c")]
        ob = self.table(x, bottom - 12, ocols, orows, "SLAB OPENINGS", 1.9, 4.0)
        self.changes(x2 + 2, bottom - 12)
        return ob

    def changes(self, x, y):
        """What the record has that the engineer's drawing doesn't: taped edges, columns and grid spacings that differ,
        openings made or moved on site, and columns below that sit off the ones above."""
        d = self.d
        lines = []
        for e in d["edges"]:
            dev = e.get("deviation")
            if e["measured"] and dev is not None and abs(dev) > 10:
                a, b = e["segment"] if e.get("segment") else ((0, 0), (0, 0))
                where = f"between {self.near(a)} and {self.near(b)}"
                lines.append((f"Slab edge {where}, set out from grid {e['ref']}: {fmt(abs(e['offset_actual']))} {MEAS} "
                              f"(drawing {fmt(abs(e['offset_design']))}, {fmt(dev, True)})", RED if abs(dev) > TOL_WARN else black))
        for c in d["columns"] + d["cores"]:
            dv = c.get("deviation")
            if c["measured"] and dv and dv.get("worst", 0) > 10:
                size = ""
                if abs(dv.get("dw", 0)) > 1 or abs(dv.get("dh", 0)) > 1:
                    x0, y0, x1, y1 = c["box"]
                    size = f", size {round(x1 - x0)}×{round(y1 - y0)}"
                lines.append((f"{c['name']} at {c['ref']}: centre {fmt(dv['dx'], True)} across, {fmt(dv['dy'], True)} down the page {MEAS}{size}",
                              RED if dv["worst"] > TOL_WARN else black))
        for o in self.openings:
            tag = self.otag[o["key"]]
            if o.get("added"):
                x0, y0, x1, y1 = o["box"]
                lines.append((f"{tag} {o['name']} {round(x1 - x0)}×{round(y1 - y0)} by {o['ref']}: made on site, not on the drawing", BLUEGREY))
            elif o["measured"] and o.get("status") in ("warn", "off"):
                lines.append((f"{tag} {o['name']}: moved on site {MEAS} (see the schedule)", RED))
        for axis, ids in (("x", d["grid"]["x"]), ("y", d["grid"]["y"])):
            for a, b in zip(ids[:-1], ids[1:]):
                if b.get("measured"):
                    act, dsg = b["actual"] - a["actual"], b["design"] - a["design"]
                    if abs(act - dsg) > 10:
                        lines.append((f"Grid {a['id']}–{b['id']}: {fmt(act)} {MEAS} (drawing {fmt(dsg)})", black))
        if self.flags:
            refs = ", ".join(f"{c['ref']} ({fmt(dx, True)}, {fmt(dy, True)})" for c, dx, dy in self.flags[:14])
            more = f" and {len(self.flags) - 14} more" if len(self.flags) > 14 else ""
            bname = (d.get("below") or {}).get("name", "floor below")
            lines.append((f"Columns of the {bname} below (as recorded) sit more than 25 mm from the columns above at {refs}{more}: "
                          "dashed red on the plan, offsets in the schedule.", RED))
        self.text(x, y + 2.0, "DIFFERENT FROM THE DRAWING", 3.0, bold=True, align="l")
        y -= 3.5
        width = W - 10 - STRIP - 8 - x
        if not lines:
            self.text(x, y - 3, "Nothing yet: every figure on this floor is the drawing's.", 2.0, align="l")
            return
        for txt, col in lines:
            words, cur, wrapped = txt.split(), "", []
            for w_ in words:
                t = (cur + " " + w_).strip()
                if self.twidth(t, 2.0) > width - 5:
                    wrapped.append(cur)
                    cur = w_
                else:
                    cur = t
            wrapped.append(cur)
            self.text(x, y - 3, "•", 2.0, col=col, align="l")
            for ln in wrapped:
                self.text(x + 3, y - 3, ln, 2.0, col=col, align="l")
                y -= 3.3
            y -= 1.2

    def near(self, p):
        """The grid intersection nearest a point, as 'B/2'."""
        gx = min(self.gx.items(), key=lambda kv: abs(kv[1] - p[0]))[0]
        gy = min(self.gy.items(), key=lambda kv: abs(kv[1] - p[1]))[0]
        return f"{gx}/{gy}"

    # ---- title strip
    def title(self):
        d = self.d
        c = self.c
        x0, x1 = W - 10 - STRIP, W - 10
        self.rect(x0, 10, x1, H - 10, 0.5)
        y = H - 10
        def band(h):
            nonlocal y
            y -= h
            self.line(x0, y, x1, y, 0.35)
            return y
        # north (the drawings' north is to the left of the plan)
        yb = band(46)
        cx, cy = x0 + 22, yb + 23
        c.setStrokeColor(black)
        c.setLineWidth(0.3 * mm)
        c.circle(cx * mm, cy * mm, 13 * mm, stroke=1, fill=0)
        p = c.beginPath()
        p.moveTo((cx - 13) * mm, cy * mm)
        p.lineTo((cx + 3) * mm, (cy + 4) * mm)
        p.lineTo((cx + 1) * mm, cy * mm)
        p.lineTo((cx + 3) * mm, (cy - 4) * mm)
        p.close()
        c.setFillColor(black)
        c.drawPath(p, stroke=0, fill=1)
        self.text(cx - 17, cy - 1.3, "N", 3.6, bold=True)
        self.text(x0 + 42, yb + 30, "NORTH", 3.0, bold=True, align="l")
        self.text(x0 + 42, yb + 24, "as on the architect's", 2.2, align="l")
        self.text(x0 + 42, yb + 20, "drawings: grid B is the", 2.2, align="l")
        self.text(x0 + 42, yb + 16, "north end, row 7 the west", 2.2, align="l")
        self.text(x0 + 42, yb + 12, "face (balconies)", 2.2, align="l")
        # notes
        exported = d.get("exported", "")[:16].replace("T", " ")
        notes = [
            "All dimensions in millimetres, levels in metres. Do not scale.",
            f"Positions are from the site's as-built record ({d['floor']['name']}), read with the site app's own geometry on {exported} UTC. "
            f"{MEAS} marks figures taped on site; all other figures are the drawing's ({d['floor']['source'].split('.')[0]}).",
            "Solid: columns, walls and lift cores standing on this floor, as recorded (black = not taped yet; colour = taped: "
            "green within 10 mm of the drawing, amber 10-25 mm, red more than 25 mm off).",
            f"Dashed red: the column below ({(d.get('below') or {}).get('name', 'floor below')}, as recorded) where it sits more than 25 mm from the column above. "
            "The slab sits on these.",
            "Slab edges are set out from the grid line named in the schedule of the record; the drawing's outline is dashed grey where the record differs.",
            "Openings: faces set out from their own grid lines (schedule). Blue: openings made on site, not on the drawings.",
            "The grid is set out from the fixed point; spacings and set-outs not marked " + MEAS + " are still to be checked on site.",
            "Slab thickness, beams and reinforcement: by the structural engineer (not shown).",
        ] + [f"Record note: {n}" for n in d["floor"].get("notes", [])]
        yy = band(0) - 6
        self.text(x0 + 3, yy, "NOTES", 3.0, bold=True, align="l")
        yy -= 5
        for k, n in enumerate(notes, 1):
            words, line_, lines = n.split(), "", []
            for w_ in words:
                t = (line_ + " " + w_).strip()
                if self.twidth(t, 1.9) > STRIP - 13:
                    lines.append(line_)
                    line_ = w_
                else:
                    line_ = t
            lines.append(line_)
            self.text(x0 + 3, yy, f"{k}.", 1.9, align="l")
            for ln in lines:
                self.text(x0 + 8, yy, ln, 1.9, align="l")
                yy -= 2.9
            yy -= 1.2
        # legend
        yy -= 2
        self.text(x0 + 3, yy, "LEGEND", 3.0, bold=True, align="l")
        yy -= 6
        items = [("solid", "Column / wall on this floor (black: drawing figure)"), ("below", "Column below, where off the one above"),
                 ("core", "Lift core, walls solid, door gap"), ("stair", "Stair opening"), ("void", "Void / riser opening"),
                 ("grid", "Grid line as built"), ("edge", "Drawing's slab edge where the record differs")]
        for kind, lab in items:
            lx = x0 + 4
            if kind == "solid":
                self.rect(lx, yy - 1, lx + 6, yy + 2, 0.25, fill=black)
            elif kind == "below":
                self.rect(lx, yy - 1, lx + 6, yy + 2, 0.25, RED, dash=[1.2, 0.8])
            elif kind == "core":
                self.rect(lx, yy - 1.5, lx + 6, yy + 2.5, 0.8, black)
            elif kind == "stair":
                self.rect(lx, yy - 1.5, lx + 6, yy + 2.5, 0.3)
                for k in range(1, 4):
                    self.line(lx, yy - 1.5 + k, lx + 6, yy - 1.5 + k, 0.1, GREY)
            elif kind == "void":
                self.rect(lx, yy - 1.5, lx + 6, yy + 2.5, 0.3)
                self.line(lx, yy - 1.5, lx + 6, yy + 2.5, 0.13)
                self.line(lx, yy + 2.5, lx + 6, yy - 1.5, 0.13)
            elif kind == "grid":
                self.line(lx, yy + 0.5, lx + 6, yy + 0.5, 0.15, BLUEGREY, dash=[2.5, 0.8, 0.6, 0.8])
            elif kind == "edge":
                self.line(lx, yy + 0.5, lx + 6, yy + 0.5, 0.18, GREY, dash=[2, 1.2])
            self.text(lx + 9, yy - 0.2, lab, 1.9, align="l")
            yy -= 5.2
        self.text(x0 + 4, yy - 0.2, MEAS, 2.2, align="l")
        self.text(x0 + 13, yy - 0.2, "Taped on site (others: drawing figures)", 1.9, align="l")
        # revisions, project, title, number
        yb = 10 + 92
        self.line(x0, yb, x1, yb, 0.35)
        self.text(x0 + 3, yb - 5, "REV", 2.0, bold=True, align="l")
        self.text(x0 + 14, yb - 5, "DATE", 2.0, bold=True, align="l")
        self.text(x0 + 36, yb - 5, "DESCRIPTION", 2.0, bold=True, align="l")
        today = dt.date.today().strftime("%d %b %Y")
        self.text(x0 + 3, yb - 10, "A", 2.0, align="l")
        self.text(x0 + 14, yb - 10, today, 2.0, align="l")
        self.text(x0 + 36, yb - 10, "First issue, from the as-built record", 2.0, align="l")
        self.line(x0, yb - 14, x1, yb - 14, 0.25)
        self.text(x0 + 3, yb - 20, "PROJECT", 2.0, col=GREY, align="l")
        self.text(x0 + 3, yb - 27, "THE LEXINGTON", 5.0, bold=True, align="l")
        self.text(x0 + 3, yb - 32, "Seven-storey apartment building, Shiashie, East Legon, Accra", 2.0, align="l")
        self.line(x0, yb - 36, x1, yb - 36, 0.25)
        self.text(x0 + 3, yb - 42, "DRAWING", 2.0, col=GREY, align="l")
        self.text(x0 + 3, yb - 49, f"{d['floor']['name'].upper()} SLAB, SSL +{d['floor']['level'] / 1000:.3f}", 3.6, bold=True, align="l")
        self.text(x0 + 3, yb - 54.5, "AS-BUILT SETTING-OUT PLAN", 3.6, bold=True, align="l")
        self.text(x0 + 3, yb - 59.5, "for reinforcement detailing", 2.2, align="l")
        self.line(x0, yb - 63, x1, yb - 63, 0.25)
        cells = [("SCALE", "1:100 @ A1  ·  1:200 @ A3"), ("DATE", today), ("STATUS", "AS BUILT / FOR DETAILING"), ("DRG NO.", self.number)]
        cw = STRIP / 2
        for k, (h_, v) in enumerate(cells):
            cx_ = x0 + (k % 2) * cw
            cy_ = yb - 63 - (k // 2) * 14
            self.text(cx_ + 3, cy_ - 4.5, h_, 1.9, col=GREY, align="l")
            self.text(cx_ + 3, cy_ - 10, v, 2.6 if k != 3 else 3.6, bold=k == 3, align="l")
        self.line(x0 + cw, yb - 63, x0 + cw, 10, 0.25)
        self.line(x0, yb - 77, x1, yb - 77, 0.25)

    def frame(self):
        self.rect(10, 10, W - 10, H - 10, 0.7)
        # a 1:100 scale bar under the plan, left
        x, y = 20.0, self.plan_bottom - 30
        for k in range(5):
            self.rect(x + k * 10, y, x + (k + 1) * 10, y + 1.6, 0.18, fill=black if k % 2 == 0 else white)
        for k in range(6):
            self.text(x + k * 10, y - 3.2, f"{k}", 1.9)
        self.text(x + 53, y - 3.2, "m   (1:100 at A1)", 1.9, align="l")

    def draw(self, number):
        self.number = number
        # opening tags in schedule order: stairs by name, then the others north to south, west to east
        order = sorted(self.d["openings"], key=lambda o: (o["kind"] != "stair", o["box"][1] // 1000 if o["kind"] != "stair" else 0, o["box"][0]))
        self.openings = order
        self.otag = {o["key"]: o["name"] for o in order if o["kind"] == "stair"}
        self.otag.update({o["key"]: f"O{k}" for k, o in enumerate([o for o in order if o["kind"] != "stair"], 1)})
        self.frame()
        self.slab()
        self.grid()
        self.boxes()
        self.edge_dims()
        self.level_tag()
        self.schedules()
        self.title()
        self.c.showPage()
        self.c.save()


def dxf(data, path):
    """The plan at 1:1 in mm (y up, so y = -record y), on layers, with real dimensions for the grid and edges."""
    import ezdxf
    from ezdxf.enums import TextEntityAlignment

    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.MM
    msp = doc.modelspace()
    for name, colour, lt in [("A-GRID", 8, "DASHDOT"), ("A-GRID-TEXT", 7, "CONTINUOUS"), ("S-SLAB-EDGE", 7, "CONTINUOUS"),
                             ("S-SLAB-EDGE-DWG", 9, "DASHED"), ("S-COLS", 7, "CONTINUOUS"), ("S-COLS-BELOW", 1, "DASHED"),
                             ("S-CORE", 7, "CONTINUOUS"), ("S-STAIR", 3, "CONTINUOUS"), ("S-VOID", 4, "CONTINUOUS"),
                             ("A-DIMS", 7, "CONTINUOUS"), ("A-TEXT", 7, "CONTINUOUS")]:
        doc.layers.add(name, color=colour, linetype=lt)
    P = lambda x, y: (x, -y)  # noqa: E731
    gx = {g["id"]: g["actual"] for g in data["grid"]["x"]}
    gy = {g["id"]: g["actual"] for g in data["grid"]["y"]}
    pts = data["corners"]
    x0 = min(min(p[0] for p in pts), min(gx.values())) - 3000
    x1 = max(max(p[0] for p in pts), max(gx.values())) + 3000
    y0 = min(min(p[1] for p in pts), min(gy.values())) - 3000
    y1 = max(max(p[1] for p in pts), max(gy.values())) + 3000
    def staggered(lines):
        """(id, pos, step): a bubble within 950 mm of the one before steps 1 m further out."""
        out, last, k = [], None, 0
        for name, v in sorted(lines.items(), key=lambda kv: kv[1]):
            k = k + 1 if last is not None and abs(v - last) < 950 and k == 0 else 0
            out.append((name, v, k))
            last = v
        return out
    for k, v, st in staggered(gx):
        msp.add_line(P(v, y0 - 1000 * st), P(v, y1 + 1000 * st), dxfattribs={"layer": "A-GRID", "ltscale": 20})
        for yy in (y0 - 600 - 1000 * st, y1 + 600 + 1000 * st):
            msp.add_circle(P(v, yy), 450, dxfattribs={"layer": "A-GRID-TEXT"})
            msp.add_text(k, height=350, dxfattribs={"layer": "A-GRID-TEXT"}).set_placement(P(v, yy), align=TextEntityAlignment.MIDDLE_CENTER)
    for k, v, st in staggered(gy):
        msp.add_line(P(x0 - 1000 * st, v), P(x1 + 1000 * st, v), dxfattribs={"layer": "A-GRID", "ltscale": 20})
        for xx in (x0 - 600 - 1000 * st, x1 + 600 + 1000 * st):
            msp.add_circle(P(xx, v), 450, dxfattribs={"layer": "A-GRID-TEXT"})
            msp.add_text(k, height=350, dxfattribs={"layer": "A-GRID-TEXT"}).set_placement(P(xx, v), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_lwpolyline([P(*p) for p in pts], close=True, dxfattribs={"layer": "S-SLAB-EDGE", "const_width": 0})
    if data.get("corners_design") and data["corners_design"] != pts:
        msp.add_lwpolyline([P(*p) for p in data["corners_design"]], close=True, dxfattribs={"layer": "S-SLAB-EDGE-DWG", "ltscale": 10})
    def rect(b, layer, **kw):
        bx0, by0, bx1, by1 = b
        msp.add_lwpolyline([P(bx0, by0), P(bx1, by0), P(bx1, by1), P(bx0, by1)], close=True, dxfattribs={"layer": layer, **kw})
    below = {c["key"]: c for c in (data.get("below") or {}).get("columns", [])}
    for c in data["columns"]:
        rect(c["box"], "S-COLS")
        hatch = msp.add_hatch(color=7, dxfattribs={"layer": "S-COLS"})
        bx0, by0, bx1, by1 = c["box"]
        hatch.paths.add_polyline_path([P(bx0, by0), P(bx1, by0), P(bx1, by1), P(bx0, by1)], is_closed=True)
        msp.add_text(f"{c['name']} {round(bx1 - bx0)}x{round(by1 - by0)}", height=180, dxfattribs={"layer": "A-TEXT"}).set_placement(P(bx1 + 120, by0 - 60))
        b = below.get(c["key"])
        if b and b.get("box"):
            cx0, cy0, cx1, cy1 = b["box"]
            if math.hypot((cx0 + cx1 - bx0 - bx1) / 2, (cy0 + cy1 - by0 - by1) / 2) > TOL_WARN:
                rect(b["box"], "S-COLS-BELOW", ltscale=5)
    for k in data["cores"]:
        bx0, by0, bx1, by1 = k["box"]
        t = k.get("wall") or 300
        rect(k["box"], "S-CORE")
        rect([bx0 + t, by0 + t, bx1 - t, by1 - t], "S-CORE")
        msp.add_text(k["name"], height=250, dxfattribs={"layer": "A-TEXT"}).set_placement(P((bx0 + bx1) / 2, (by0 + by1) / 2), align=TextEntityAlignment.MIDDLE_CENTER)
    for o in data["openings"]:
        bx0, by0, bx1, by1 = o["box"]
        layer = "S-STAIR" if o["kind"] == "stair" else "S-VOID"
        rect(o["box"], layer)
        msp.add_line(P(bx0, by0), P(bx1, by1), dxfattribs={"layer": layer})
        msp.add_line(P(bx0, by1), P(bx1, by0), dxfattribs={"layer": layer})
        msp.add_text(f"{o['name']} {round(bx1 - bx0)}x{round(by1 - by0)}", height=150, dxfattribs={"layer": "A-TEXT"}).set_placement(P(bx1 + 100, by0))
    # dimensions: grid spacings top and left, each slab edge from its grid line; mm as drawn (no scale factor),
    # whole numbers, figures above the line, architectural ticks
    style = "EZDXF"
    DIMS = {"dimlfac": 1, "dimdec": 0, "dimtad": 1, "dimtsz": 120, "dimexo": 150, "dimexe": 150, "dimgap": 60}
    ytop = min(min(p[1] for p in pts), min(gy.values())) - 1500
    xs = sorted(gx.values())
    for a, b in zip(xs[:-1], xs[1:]):
        msp.add_linear_dim(base=P(a, ytop), p1=P(a, ytop + 500), p2=P(b, ytop + 500), dimstyle=style, override=dict(DIMS, dimtxt=200), dxfattribs={"layer": "A-DIMS"}).render()
    xl = min(min(p[0] for p in pts), min(gx.values())) - 1500
    ys = sorted(gy.values())
    for a, b in zip(ys[:-1], ys[1:]):
        msp.add_linear_dim(base=P(xl, a), p1=P(xl + 500, a), p2=P(xl + 500, b), angle=90, dimstyle=style, override=dict(DIMS, dimtxt=200), dxfattribs={"layer": "A-DIMS"}).render()
    for e in data["edges"]:
        if not e.get("segment") or not e.get("offset_actual") or abs(e["offset_actual"]) < 1:
            continue
        (ax, ay), (bx, by) = e["segment"]
        if e["axis"] == "y":
            mx = (ax + bx) / 2
            ref = gy[e["ref"]]
            msp.add_linear_dim(base=P(mx, ref), p1=P(mx, ref), p2=P(mx, e["actual"]), angle=90, dimstyle=style, override=dict(DIMS, dimtxt=160), dxfattribs={"layer": "A-DIMS"}).render()
        else:
            my = (ay + by) / 2
            ref = gx[e["ref"]]
            msp.add_linear_dim(base=P(ref, my), p1=P(ref, my), p2=P(e["actual"], my), dimstyle=style, override=dict(DIMS, dimtxt=160), dxfattribs={"layer": "A-DIMS"}).render()
    msp.add_text(f"{data['floor']['name']} slab SSL +{data['floor']['level'] / 1000:.3f}: as-built setting out (from the as-built record, "
                 f"{data.get('exported', '')[:10]}). mm, 1:1. Grid B = x 0, grid {data['grid']['y'][0]['id']} = y 0.", height=300,
                 dxfattribs={"layer": "A-TEXT"}).set_placement(P(x0, y0 - 1500))
    doc.saveas(str(path))


def main():
    src, stem = sys.argv[1], sys.argv[2]
    data = json.loads(Path(src).read_text())
    number = Path(stem).name
    Sheet(data, f"{stem}.pdf").draw(number)
    dxf(data, f"{stem}.dxf")
    print(f"{stem}.pdf, {stem}.dxf")


if __name__ == "__main__":
    main()
