"""The windows on the architect's floor plans (Architecture_FINAL_FINAL_PRIINT.pdf, Jan/Feb 2025), as grid references,
so the 3D model can put each one on the as-built grid.

    pip install pymupdf
    python3 structure/tools/read_arch_windows.py Architecture_FINAL_FINAL_PRIINT.pdf > structure/model/arch_windows.json

How a window is read: its tag (W1-W10, CW1-CW5) sits just outside it; the window is the gap in the nearest wall face
behind the tag (the wall's thick outline stops at both jambs), about the scheduled width long. A window is kept as
- the wall line: the nearest grid line and the offset from it in mm (so a box that stands 1.2 m past grid 7 stays 1.2 m
  past the as-built grid 7);
- its middle along the wall: the fraction of the bay between the two grid lines either side (so a window in the middle
  of a bay stays in the middle of the as-built bay);
- which way it faces (the side the tag is on), and the size, sill and head from the window schedule (A119).

The architect's sheets are one storey behind the as-built names (their "ground floor" is the as-built 1st floor; their
"first & second floor" plan serves the 2nd and 3rd; their "sixth" is the 7th, the penthouses).
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict

import pymupdf

# PDF page (1-based) -> as-built floors that follow that plan
SHEETS = {5: ("A105 ground floor plan", ["1"]), 6: ("A106 first & second floor plan", ["2", "3"]), 7: ("A107 third floor plan", ["4"]),
          8: ("A108 fourth floor plan", ["5"]), 9: ("A109 fifth floor plan", ["6"]), 10: ("A110 sixth floor plan", ["7"])}

# window schedule A119: width, height, sill (mm), type, panes across
SCHEDULE = {
    "W1": (4950, 1200, 900, "sliding", 3), "W2": (4700, 1200, 900, "sliding", 3), "W3": (4000, 1200, 900, "sliding", 3),
    "W4": (2000, 1200, 900, "sliding", 3), "W5": (2400, 1200, 900, "sliding", 2), "W6": (1700, 1200, 900, "sliding", 2),
    "W7": (1500, 1200, 900, "sliding", 2), "W8": (1200, 1200, 900, "awning", 2), "W9": (900, 900, 1200, "awning", 1),
    "W10": (750, 900, 1200, "awning", 1),
    # curtain walls: floor to 2.7 m, a 400 mm top light over 2.15 m doors/panels
    "CW1": (10577, 2700, 0, "curtain", 8), "CW2": (6137, 2700, 0, "curtain", 5), "CW3": (4807, 2700, 0, "curtain", 4),
    "CW4": (2600, 2700, 0, "curtain", 2), "CW5": (1200, 2700, 0, "curtain", 1),
}
# Glazed walls whose openings the reader can't pick out (drawn in thin line, or the tag sits between two runs of glass),
# read off the sheets by eye: (page, tag, dir, line, along, width mm, facing, what)
MANUAL = [
    (5, "CW1", "h", ["2", 0], ["B1", "C", 0.317], 2700, -1, "cafe's north front, B1 to the WC"),
    (5, "CW3", "h", ["7", 530], ["C", "D", 0.5], 4807, 1, "gym's west front"),
    (10, "CW3", "v", ["C", 0], ["4", "5", 0.5], 3800, -1, "penthouse C-F, dining area's north wall"),
    (10, "CW1", "v", ["M", -58], ["3", "5", 0.5], 5600, 1, "penthouse H-M, dining area onto the M-N terrace"),
    (10, "CW1", "v", ["M", -58], ["6", "7", 0.41], 2350, 1, "penthouse H-M, lounge onto the terrace"),
]
LETTERS = ["A", "B", "B1", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N"]
ROWS = ["1", "2", "2A", "3", "4", "5", "6", "7"]
ARCH_X = {"A": 0, "B": 3750, "C": 9900, "D": 16000, "E": 18600, "F": 21200, "G": 27350, "H": 33500, "J": 36050, "K": 38600,
          "L": 44800, "M": 50950, "N": 56300}
ARCH_Y = {"1": 0, "2": 3750, "2A": 5700, "3": 9950, "4": 12100, "5": 16100, "6": 18450, "7": 21450}
MAX_OFF_PT = 32  # how far behind its tag a window's wall may be (about 2.6 m)


def bubbles(words, names):
    """The grid bubbles' positions along one side of the sheet: the band where most of these labels line up."""
    hits = [((w[0] + w[2]) / 2, (w[1] + w[3]) / 2, w[4]) for w in words if w[4] in names]
    return hits


def grid(words):
    xs = bubbles(words, set(LETTERS))
    ys = bubbles(words, set(ROWS))
    band = defaultdict(list)
    for x, y, t in xs:
        band[round(y)].append((t, x))
    top = max(band.values(), key=len)
    gx = {t: x for t, x in top}
    band = defaultdict(list)
    for x, y, t in ys:
        band[round(x)].append((t, y))
    left = max(band.values(), key=len)
    gy = {t: y for t, y in left}
    return gx, gy


def wall_segments(page):
    segs = {"h": [], "v": []}
    for d in page.get_drawings():
        if d["type"] != "s" or (d.get("width") or 0) < 0.8 or max(d.get("color") or (1,)) > 0.05:
            continue
        for it in d["items"]:
            pts = []
            if it[0] == "l":
                pts = [(it[1], it[2])]
            elif it[0] == "re":
                r = it[1]
                pts = [(pymupdf.Point(r.x0, r.y0), pymupdf.Point(r.x1, r.y0)), (pymupdf.Point(r.x1, r.y0), pymupdf.Point(r.x1, r.y1)),
                       (pymupdf.Point(r.x1, r.y1), pymupdf.Point(r.x0, r.y1)), (pymupdf.Point(r.x0, r.y1), pymupdf.Point(r.x0, r.y0))]
            for p, q in pts:
                if abs(p.y - q.y) < 0.2 and abs(p.x - q.x) > 0.3:
                    segs["h"].append(((p.y + q.y) / 2, min(p.x, q.x), max(p.x, q.x)))
                elif abs(p.x - q.x) < 0.2 and abs(p.y - q.y) > 0.3:
                    segs["v"].append(((p.x + q.x) / 2, min(p.y, q.y), max(p.y, q.y)))
    return segs


def find_wall(segs, orient, a, p, w):
    """The wall face nearest behind a tag (along-position a, across-position p) with a gap about w long round a.
    Returns (line, start, end, score, jambs) or None: the window's ends along the wall, from the jambs where the wall
    outline stops (both found and about w apart: the gap; one: w from it towards the tag; a gap much longer than w:
    w round the tag)."""
    lines = defaultdict(list)
    for c, s0, s1 in segs[orient]:
        if 0.4 < abs(c - p) < MAX_OFF_PT and s1 > a - 3 * w - 40 and s0 < a + 3 * w + 40:
            lines[round(c * 4) / 4].append((s0, s1))
    best = None
    for c, ivs in lines.items():
        ivs.sort()
        merged = []
        for s0, s1 in ivs:
            if merged and s0 <= merged[-1][1] + 0.3:
                merged[-1][1] = max(merged[-1][1], s1)
            else:
                merged.append([s0, s1])
        if any(m[0] < a - 0.2 * w and m[1] > a + 0.2 * w for m in merged):
            continue  # solid wall across the tag: not this face
        left = max([m[1] for m in merged if m[1] <= a + 0.35 * w], default=None)
        right = min([m[0] for m in merged if m[0] >= a - 0.35 * w], default=None)
        if left is not None and a - left > 1.5 * w:
            left = None
        if right is not None and right - a > 1.5 * w:
            right = None
        if left is None and right is None:
            continue
        if left is not None and right is not None:
            gap = right - left
            if gap <= 0:
                continue
            if gap <= 1.6 * w:
                g0, g1, fit, jambs = left, right, abs(gap - w) / w, 2
            else:
                mid = min(max(a, left + w / 2), right - w / 2)
                g0, g1, fit, jambs = mid - w / 2, mid + w / 2, 0.5, 2
        elif left is not None:
            g0, g1, fit, jambs = left, left + w, 0.4, 1
        else:
            g0, g1, fit, jambs = right - w, right, 0.4, 1
        score = abs(c - p) / 6 + fit * 3 + (2 - jambs)
        if best is None or score < best[3]:
            best = (c, g0, g1, score, jambs)
    return best


def ref(pos, ids, at):
    """Position in sheet points -> (nearest grid id, offset in mm) and (left id, right id, fraction)."""
    order = sorted((at[i], i) for i in ids if i in at)
    near = min(order, key=lambda t: abs(t[0] - pos))
    lo = max([t for t in order if t[0] <= pos], default=order[0])
    hi = min([t for t in order if t[0] > pos], default=order[-1])
    if hi[1] == lo[1]:
        lo, hi = (order[-2], order[-1]) if pos > order[-1][0] else (order[0], order[1])
    frac = (pos - lo[0]) / (hi[0] - lo[0])
    return near, (lo[1], hi[1], frac)


def main(path):
    doc = pymupdf.open(path)
    out = []
    for pno, (sheet, floors) in SHEETS.items():
        page = doc[pno - 1]
        words = page.get_text("words")
        gx, gy = grid(words)
        sx = (ARCH_X["N"] - ARCH_X["B"]) / (gx["N"] - gx["B"])
        sy = (ARCH_Y["7"] - ARCH_Y["2A"]) / (gy["7"] - gy["2A"])
        segs = wall_segments(page)
        for wd in words:
            tag = wd[4]
            if tag not in SCHEDULE:
                continue
            wmm, hmm, sill, kind, panes = SCHEDULE[tag]
            tx, ty = (wd[0] + wd[2]) / 2, (wd[1] + wd[3]) / 2
            cands = []
            for orient in ("h", "v"):
                a, p, s = (tx, ty, sx) if orient == "h" else (ty, tx, sy)
                f = find_wall(segs, orient, a, p, wmm / s)
                if f:
                    cands.append((f[3], orient, f))
            if not cands:
                print(f"no wall for {tag} on page {pno} at {tx:.0f},{ty:.0f}", file=sys.stderr)
                continue
            _, orient, (c, g0, g1, score, jambs) = min(cands)
            s = sx if orient == "h" else sy
            gap = (g1 - g0) * s
            if kind == "curtain":
                # glazed walls: the drawn opening is the size; without both jambs the tag can't be trusted
                if jambs < 2 or not 0.3 * wmm < gap < 1.2 * wmm:
                    print(f"{tag} on page {pno} at {tx:.0f},{ty:.0f}: no clear opening, left out", file=sys.stderr)
                    continue
                wmm = round(gap)
            mid = (g0 + g1) / 2
            if orient == "h":
                (lp, lid), _ = ref(c, ROWS, gy)
                line = [lid, round((c - lp) * sy)]
                facing = 1 if ty > c else -1
            else:
                (lp, lid), _ = ref(c, LETTERS, gx)
                line = [lid, round((c - lp) * sx)]
                facing = 1 if tx > c else -1
            # where the window's middle falls in its bay
            ids = ROWS if orient == "v" else LETTERS
            at = gy if orient == "v" else gx
            _, (a0, a1, fr) = ref(mid, ids, at)
            out.append(dict(sheet=sheet, page=pno, floors=floors, tag=tag, w=wmm, h=hmm, sill=sill, kind=kind, panes=panes,
                            dir=orient, line=line, along=[a0, a1, round(fr, 4)], facing=facing, gap_mm=round(gap), jambs=jambs,
                            fit=round(score, 2)))
    for pno, tag, orient, line, along, wmm, facing, what in MANUAL:
        _, hmm, sill, kind, panes = SCHEDULE[tag]
        sheet, floors = SHEETS[pno]
        out.append(dict(sheet=sheet, page=pno, floors=floors, tag=tag, w=wmm, h=hmm, sill=sill, kind=kind, panes=max(1, round(wmm / 1250)),
                        dir=orient, line=line, along=along, facing=facing, gap_mm=wmm, jambs=0, fit=None, read_by_eye=what))
    src = dict(drawing="Architecture_FINAL_FINAL_PRIINT.pdf (A105-A110 floor plans, A119 window schedule; Jan/Feb 2025)",
               note="dir h: wall along x (line = a row and offset in mm, +y down the sheet); dir v: wall along y (line = a lettered grid "
                    "line and offset). along: the window's middle as a fraction between two grid lines. facing: +1 means the outside is "
                    "towards +x / +y. Sizes, sills and heads from the schedule: frames anodised aluminium in matt black, laminated "
                    "glass in reflective ocean grey.",
               sheets={str(k): dict(title=v[0], floors=v[1]) for k, v in SHEETS.items()}, schedule=SCHEDULE)
    print(json.dumps(dict(source=src, windows=out), indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
