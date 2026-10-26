#!/usr/bin/env python3
"""Generate the Go Go HarmoniYo brand-option SVGs and PNG previews.

    python -m pip install -r tools/design/brand-options/requirements.txt
    python -m playwright install chromium
    python tools/design/brand-options/build.py

Everything is procedural: wordmarks are set in SIL OFL fonts (docs/design/brand-options/fonts/,
pinned in attribution/register.json), shaped with HarfBuzz (kerning on) and converted to plain SVG
paths, so the logo files have no font dependency. Marks, icons and mascot sketches are drawn from
the primitives below. Headless Chromium tightens each SVG's viewBox and renders the PNG previews.
Output: docs/design/brand-options/ (see README.md there).
"""
from __future__ import annotations

import base64
import json
import math
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "design" / "brand-options"
FONTS = OUT / "fonts"
PALETTE = json.loads((ROOT / "docs" / "design" / "pitch-class-palette.json").read_text("utf-8"))
PC = {p["token"]: p["hex"] for p in PALETTE["pitchClasses"]}
NOTE = {p["name"].split("/")[0]: p["hex"] for p in PALETTE["pitchClasses"]}
FIFTHS = ["C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "F"]

STAGE = PALETTE["background"]  # #0b0d17
INK = PALETTE["textOnFill"]  # #10121c
PAPER = "#f7f2e8"  # warm paper for light previews
WHITE = "#fbf7ef"  # warm white for text on the stage
# Brand accents outside the pitch palette (brand guide: "warm candlelight, brass and wood").
BRASS = "#e8b04c"
BRASS_DEEP = "#b97c1c"  # mascot shading and accents on the stage
BRASS_INK = "#8f5d10"  # brass for logo parts on paper (5.0:1 on #f7f2e8)
WOOD = "#7a3e14"  # deep wood, used for accents on light backgrounds
SPRUCE_DEEP = "#00654f"
BERRY_DEEP = "#a8262f"
FELT = "#f4ece0"

SKIN = ["#f1c7a5", "#d79b72", "#a96a43", "#6e4129"]
HAIR = ["#2b1a12", "#5a3218", "#1b1410", "#a0522d"]


def n(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


# ── type ─────────────────────────────────────────────────────────────────────


class Face:
    def __init__(self, rel: str, wght: float | None = None):
        path = FONTS / rel
        self.font = hb.Font(hb.Face(hb.Blob.from_file_path(str(path))))
        if wght:
            self.font.set_variations({"wght": wght})
        self.upem = self.font.face.upem
        tt = TTFont(str(path))
        self.cap = tt["OS/2"].sCapHeight
        self.xh = tt["OS/2"].sxHeight

    def layout(self, text: str, size: float, x: float = 0, y: float = 0, track: float = 0):
        """Shape `text` (kerning on) and return per-glyph outlines in SVG coordinates."""
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.font, buf, {"kern": True, "liga": True})
        s = size / self.upem
        out, pen = [], x
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            gx, gy = pen + pos.x_offset * s, y - pos.y_offset * s
            sp = SVGPathPen(None, ntos=n)
            self.font.draw_glyph_with_pen(info.codepoint, TransformPen(sp, (s, 0, 0, -s, gx, gy)))
            e = self.font.get_glyph_extents(info.codepoint)
            out.append({
                "ch": text[info.cluster], "d": sp.getCommands(), "x": gx, "y": gy,
                "adv": pos.x_advance * s,
                "box": (gx + e.x_bearing * s, gy - e.y_bearing * s, e.width * s, -e.height * s),
            })
            pen += pos.x_advance * s + track
        return out, pen - track - x

    def capx(self, size: float) -> float:
        return self.cap * size / self.upem

    def stem(self, size: float, ch: str = "l") -> float:
        g, _ = self.layout(ch, size)
        return g[0]["box"][2]


FACE = {}


def faces():
    FACE.update({
        "fredoka": Face("fredoka/Fredoka[wdth,wght].ttf", 650),
        "fredoka-md": Face("fredoka/Fredoka[wdth,wght].ttf", 560),
        "outfit": Face("outfit/Outfit[wght].ttf", 700),
        "outfit-lt": Face("outfit/Outfit[wght].ttf", 400),
        "sniglet": Face("sniglet/Sniglet-ExtraBold.ttf"),
        "nunito": Face("nunito/Nunito[wght].ttf", 900),
        "nunito-md": Face("nunito/Nunito[wght].ttf", 800),
        "lilita": Face("lilitaone/LilitaOne-Regular.ttf"),
        "grand": Face("grandstander/Grandstander[wght].ttf", 900),
        "grand-md": Face("grandstander/Grandstander[wght].ttf", 800),
    })


def glyph_paths(glyphs, fill, skip=(), extra=""):
    return "".join(
        f'<path d="{g["d"]}" fill="{fill}"{extra}/>' for g in glyphs if g["ch"] not in skip and g["d"]
    )


# ── drawing primitives ───────────────────────────────────────────────────────

# Handbell body profile, mouth down: u across (-0.5..0.5 of the lip width), v down (0 dome, 1 lip).
BELL = [
    ("M", [(-0.30, 0.32)]),
    ("C", [(-0.30, -0.03), (0.30, -0.03), (0.30, 0.32)]),
    ("C", [(0.30, 0.60), (0.42, 0.78), (0.50, 0.91)]),
    ("Q", [(0.535, 0.985), (0.45, 0.995)]),
    ("C", [(0.20, 1.04), (-0.20, 1.04), (-0.45, 0.995)]),
    ("Q", [(-0.535, 0.985), (-0.50, 0.91)]),
    ("C", [(-0.42, 0.78), (-0.30, 0.60), (-0.30, 0.32)]),
    ("Z", []),
]


def profile_path(cmds, f) -> str:
    parts = []
    for op, pts in cmds:
        parts.append(op + " ".join(f"{n(x)} {n(y)}" for x, y in (f(u, v) for u, v in pts)))
    return "".join(parts)


def rrect(x, y, w, h, r) -> str:
    r = min(r, w / 2, h / 2)
    k = 0.5523 * r
    return (f"M{n(x + r)} {n(y)}H{n(x + w - r)}C{n(x + w - r + k)} {n(y)} {n(x + w)} {n(y + r - k)} {n(x + w)} {n(y + r)}"
            f"V{n(y + h - r)}C{n(x + w)} {n(y + h - r + k)} {n(x + w - r + k)} {n(y + h)} {n(x + w - r)} {n(y + h)}"
            f"H{n(x + r)}C{n(x + r - k)} {n(y + h)} {n(x)} {n(y + h - r + k)} {n(x)} {n(y + h - r)}"
            f"V{n(y + r)}C{n(x)} {n(y + r - k)} {n(x + r - k)} {n(y)} {n(x + r)} {n(y)}Z")


def circle(cx, cy, r, fill, extra="") -> str:
    return f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{fill}"{extra}/>'


def arc(cx, cy, r, a0, a1, stroke, width, extra="") -> str:
    """Arc from angle a0 to a1 (degrees, counter-clockwise, 0 = east, y up)."""
    x0, y0 = cx + r * math.cos(math.radians(a0)), cy - r * math.sin(math.radians(a0))
    x1, y1 = cx + r * math.cos(math.radians(a1)), cy - r * math.sin(math.radians(a1))
    large = 1 if abs(a1 - a0) > 180 else 0
    return (f'<path d="M{n(x0)} {n(y0)}A{n(r)} {n(r)} 0 {large} 0 {n(x1)} {n(y1)}" fill="none" '
            f'stroke="{stroke}" stroke-width="{n(width)}" stroke-linecap="round"{extra}/>')


def bell(cx, y0, w, h, fill, up=False, handle=None, grip=0.17, reach=0.42, collar=True,
         clapper=None, sheen=None, bow=None) -> str:
    """A handbell. The body spans y0..y0+h; the handle sticks out beyond the dome by reach*h."""
    def f(u, v):
        return cx + u * w, y0 + ((1 - v) if up else v) * h

    s = ""
    hf = handle or fill
    gw, gl = grip * w, reach * h
    if handle is not False:
        gy = y0 - gl + 0.06 * h if not up else y0 + h - 0.06 * h
        s += f'<path d="{rrect(cx - gw / 2, gy, gw, gl, gw * 0.5)}" fill="{hf}"/>'
        if collar:
            cw, ch = w * 0.30, h * 0.08
            cy = y0 - ch * 0.35 if not up else y0 + h - ch * 0.65
            s += f'<path d="{rrect(cx - cw / 2, cy, cw, ch, ch * 0.5)}" fill="{hf}"/>'
    if clapper and not up:
        s += circle(cx, y0 + h * 1.04, w * 0.075, clapper)
    s += f'<path d="{profile_path(BELL, f)}" fill="{fill}"/>'
    if bow:  # the darker "sound bow" band just above the lip
        band = [("M", [(-0.47, 0.86)]), ("C", [(-0.2, 0.92), (0.2, 0.92), (0.47, 0.86)]),
                ("L", [(0.50, 0.91)]), ("Q", [(0.535, 0.985), (0.45, 0.995)]),
                ("C", [(0.20, 1.04), (-0.20, 1.04), (-0.45, 0.995)]), ("Q", [(-0.535, 0.985), (-0.50, 0.91)]), ("Z", [])]
        s += f'<path d="{profile_path(band, f)}" fill="{bow}"/>'
    if sheen:
        a, b = f(-0.17, 0.2), f(-0.27, 0.72)
        c = f(-0.24, 0.45)
        s += (f'<path d="M{n(a[0])} {n(a[1])}Q{n(c[0])} {n(c[1])} {n(b[0])} {n(b[1])}" fill="none" stroke="{sheen}" '
              f'stroke-width="{n(w * 0.06)}" stroke-linecap="round" opacity="0.55"/>')
    return s


def ring_arcs(cx, cy, radii, colors, width, a0=35, a1=145) -> str:
    return "".join(arc(cx, cy, r, a0, a1, c, width) for r, c in zip(radii, colors))


def side_arcs(cx, cy, radii, colors, width, spread=28) -> str:
    s = ""
    for r, c in zip(radii, colors):
        s += arc(cx, cy, r, -spread, spread, c, width) + arc(cx, cy, r, 180 - spread, 180 + spread, c, width)
    return s


def tuning_fork(cx, base, height, width, stem, fill) -> str:
    """A tuning fork shaped like a capital Y: stem below, U-shaped tines above."""
    split = base - height * 0.40
    tine = stem * 0.92
    outer = width
    r_out = outer / 2
    top = base - height
    # U from the split point upward, drawn as a thick U path filled.
    x0, x1 = cx - r_out, cx + r_out
    xi0, xi1 = x0 + tine, x1 - tine
    ri = r_out - tine
    ubot = split - 0.02 * height
    d = (f"M{n(x0)} {n(top + tine * 0.5)}"
         f"V{n(ubot - r_out)}"
         f"A{n(r_out)} {n(r_out)} 0 0 0 {n(x1)} {n(ubot - r_out)}"
         f"V{n(top + tine * 0.5)}"
         f"A{n(tine / 2)} {n(tine / 2)} 0 0 0 {n(xi1)} {n(top + tine * 0.5)}"
         f"V{n(ubot - r_out)}"
         f"A{n(ri)} {n(ri)} 0 0 1 {n(xi0)} {n(ubot - r_out)}"
         f"V{n(top + tine * 0.5)}"
         f"A{n(tine / 2)} {n(tine / 2)} 0 0 0 {n(x0)} {n(top + tine * 0.5)}Z")
    stem_top = ubot - r_out + r_out - tine * 0.3
    s = f'<path d="{d}" fill="{fill}"/>'
    s += f'<path d="{rrect(cx - stem / 2, stem_top, stem, base - stem_top, stem * 0.5)}" fill="{fill}"/>'
    return s


# ── mascots ──────────────────────────────────────────────────────────────────


def living_bell(x, y, s=1.0, body=BRASS, bow=BRASS_DEEP, handle="loop", cheeks=PC["berry"],
                arcs=("candlelight", "pear"), halo=False, wink=False, uid="lb") -> str:
    """Yo as a living handbell, about 240 x 300 units at s=1, origin top-left."""
    g = [f'<g transform="translate({n(x)} {n(y)}) scale({n(s)})">']
    g.append(f'<defs><radialGradient id="{uid}-glow"><stop offset="0" stop-color="{BRASS}" stop-opacity="0.45"/>'
             f'<stop offset="1" stop-color="{BRASS}" stop-opacity="0"/></radialGradient></defs>')
    g.append(f'<ellipse cx="120" cy="175" rx="125" ry="120" fill="url(#{uid}-glow)"/>')
    if halo:
        for i, nm in enumerate(FIFTHS):
            a = math.radians(90 - i * 30)
            g.append(circle(120 + 150 * math.cos(a), 160 - 150 * math.sin(a), 10 if "#" not in nm else 8, NOTE[nm]))
    # felt-tipped arms
    g.append(f'<path d="M48 196 Q20 190 18 156" fill="none" stroke="{bow}" stroke-width="8" stroke-linecap="round"/>')
    g.append(f'<path d="M192 196 Q222 186 226 150" fill="none" stroke="{bow}" stroke-width="8" stroke-linecap="round"/>')
    g.append(circle(18, 150, 13, FELT) + circle(226, 144, 13, FELT))
    if handle == "curl":
        g.append(f'<path d="M120 72 C118 40 140 26 158 34 C176 42 172 66 154 66 C142 66 140 52 150 50" fill="none" '
                 f'stroke="{bow}" stroke-width="13" stroke-linecap="round"/>')
        g.append(f'<path d="{rrect(104, 62, 32, 14, 7)}" fill="{bow}"/>')
    else:
        g.append(f'<path d="M104 70 V44 Q104 22 120 22 Q136 22 136 44 V70" fill="none" stroke="{bow}" '
                 f'stroke-width="12" stroke-linecap="round"/>')
        g.append(f'<path d="{rrect(100, 62, 40, 14, 7)}" fill="{bow}"/>')
    g.append(bell(120, 70, 220, 200, body, handle=False, clapper=bow, sheen=None, bow=bow))
    # face in the shine
    g.append(f'<ellipse cx="120" cy="170" rx="62" ry="52" fill="#fff" opacity="0.16"/>')
    if wink:
        g.append(f'<path d="M88 160 Q98 150 108 160" fill="none" stroke="{INK}" stroke-width="6" stroke-linecap="round"/>')
    else:
        g.append(f'<ellipse cx="98" cy="160" rx="10" ry="14" fill="{INK}"/>' + circle(101, 154, 4, "#fff"))
    g.append(f'<ellipse cx="142" cy="160" rx="10" ry="14" fill="{INK}"/>' + circle(145, 154, 4, "#fff"))
    g.append(f'<ellipse cx="82" cy="186" rx="12" ry="7" fill="{cheeks}" opacity="0.6"/>')
    g.append(f'<ellipse cx="158" cy="186" rx="12" ry="7" fill="{cheeks}" opacity="0.6"/>')
    g.append(f'<path d="M104 188 Q120 208 136 188" fill="{INK}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>')
    g.append(f'<path d="M104 92 Q86 120 84 150" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity="0.5"/>')
    for i, tok in enumerate(arcs):
        g.append(arc(218, 70, 26 + i * 18, 20, 80, PC[tok], 7))
    g.append("</g>")
    return "".join(g)


def captain(x, y, s=1.0, skin=SKIN[2], hair=HAIR[0], style="bun", top=PC["spruce"], bell_fill=BRASS,
            arcs=("berry", "candlelight"), uid="cap") -> str:
    """Yo as a bell captain (she/her), about 260 x 340 units at s=1, origin top-left."""
    g = [f'<g transform="translate({n(x)} {n(y)}) scale({n(s)})">']
    # back hair
    if style == "curls":
        for cx, cy, r in [(130, 92, 66), (82, 110, 34), (178, 110, 34), (92, 70, 34), (168, 70, 34), (130, 48, 36)]:
            g.append(circle(cx, cy, r, hair))
    elif style == "bob":
        g.append(f'<path d="M72 100 Q70 40 130 38 Q190 40 188 100 L192 150 Q130 160 68 150 Z" fill="{hair}"/>')
    else:
        g.append(circle(130, 40, 26, hair))
        g.append(circle(130, 98, 60, hair))
    # torso (gown/tunic) and collar
    g.append(f'<path d="M66 340 L78 214 Q84 186 130 180 Q176 186 182 214 L194 340 Z" fill="{top}"/>')
    g.append(f'<path d="M108 182 L130 214 L152 182 Z" fill="{FELT}"/>')
    g.append(f'<rect x="118" y="150" width="24" height="40" rx="10" fill="{skin}"/>')
    # head and face
    g.append(circle(130, 110, 50, skin))
    if style == "bun":
        g.append(f'<path d="M80 104 Q86 58 130 58 Q174 58 180 104 Q150 76 118 84 Q98 90 80 104 Z" fill="{hair}"/>')
    elif style == "curls":
        g.append(f'<path d="M80 100 Q92 62 130 64 Q168 62 180 100 Q160 84 130 86 Q100 84 80 100 Z" fill="{hair}"/>')
    else:
        g.append(f'<path d="M78 112 Q80 58 130 58 Q180 58 182 112 Q160 80 128 82 Q96 82 78 112 Z" fill="{hair}"/>')
    # bell-shaped hair clip
    g.append(f'<g transform="rotate(-25 172 76)">{bell(172, 66, 22, 20, BRASS, handle=False)}</g>')
    g.append(f'<ellipse cx="112" cy="114" rx="6" ry="8" fill="{INK}"/>' + circle(114, 111, 2.4, "#fff"))
    g.append(f'<ellipse cx="148" cy="114" rx="6" ry="8" fill="{INK}"/>' + circle(150, 111, 2.4, "#fff"))
    g.append(f'<path d="M104 102 Q112 96 120 101" fill="none" stroke="{hair}" stroke-width="3.5" stroke-linecap="round"/>')
    g.append(f'<path d="M140 101 Q148 96 156 102" fill="none" stroke="{hair}" stroke-width="3.5" stroke-linecap="round"/>')
    g.append(f'<ellipse cx="100" cy="130" rx="9" ry="5" fill="{PC["berry"]}" opacity="0.45"/>')
    g.append(f'<ellipse cx="160" cy="130" rx="9" ry="5" fill="{PC["berry"]}" opacity="0.45"/>')
    g.append(f'<path d="M114 132 Q130 148 146 132" fill="none" stroke="{INK}" stroke-width="4.5" stroke-linecap="round"/>')
    # raised arm (viewer's right) holding a bell at rest, mouth up
    g.append(f'<path d="M176 206 Q214 210 214 150" fill="none" stroke="{top}" stroke-width="30" stroke-linecap="round"/>')
    g.append(bell(214, 64, 62, 54, bell_fill, up=True, handle=BRASS_DEEP, grip=0.2, reach=0.62, collar=True))
    g.append(circle(214, 140, 17, FELT))
    for i, tok in enumerate(arcs):
        g.append(arc(214, 62, 40 + i * 16, 50, 130, PC[tok], 6))
    # lowered arm with a mallet tucked in the sleeve
    g.append(f'<path d="M84 206 Q58 250 74 290" fill="none" stroke="{top}" stroke-width="30" stroke-linecap="round"/>')
    g.append(f'<path d="M66 286 L42 236" stroke="{WOOD}" stroke-width="6" stroke-linecap="round"/>')
    g.append(circle(40, 230, 11, FELT))
    g.append(circle(76, 294, 16, FELT))
    g.append("</g>")
    return "".join(g)


# ── directions ───────────────────────────────────────────────────────────────
# Each wordmark function takes a colour map and returns SVG markup (any origin; the viewBox is
# tightened later). Colour maps: "dark" (on the stage), "light" (on paper), "mono-white", "mono-ink".
# `line=True` asks for the one-line lockup used in small headers.


_UID = [0]


def ybell(cx, base, cap, W, stem, fill, notch=0.38, split=0.42):
    """A capital Y drawn as a handbell held at rest, mouth up: the handle is the stem and a V cut
    into the bell's mouth makes the arms. (No collar: a bar across the stem would read as a yen sign.)"""
    _UID[0] += 1
    mid = f"ybell{_UID[0]}"
    H = cap
    yT, yS = base - H, base - split * H
    body = profile_path(BELL, lambda u, v: (cx + u * W, yT + (1 - v) * (yS - yT)))
    vcut = f"M{n(cx - W * 0.30)} {n(yT - H)}L{n(cx)} {n(yT + notch * H)}L{n(cx + W * 0.30)} {n(yT - H)}Z"
    x, y, w, h = cx - W, yT - H, 2 * W, 3 * H
    s = (f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}">'
         f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}" fill="#fff"/>'
         f'<path d="{vcut}" fill="#000" stroke="#000" stroke-width="{n(stem * 0.25)}" stroke-linejoin="round"/></mask>')
    s += f'<path d="{body}" fill="{fill}" mask="url(#{mid})"/>'
    s += f'<path d="{rrect(cx - stem / 2, yS - stem * 0.3, stem, base - yS + stem * 0.3, stem / 2)}" fill="{fill}"/>'
    return s

def burst(cx, cy, radii, colors, width, a=(14, 58)) -> str:
    """Rings of sound leaving both lips of a mouth-up bell (left and right, not a Wi-Fi fan)."""
    s = ""
    for r, c in zip(radii, colors):
        s += arc(cx, cy, r, a[0], a[1], c, width) + arc(cx, cy, r, 180 - a[1], 180 - a[0], c, width)
    return s


def cmap(theme, dark: dict, light: dict) -> dict:
    if theme == "dark":
        return dark
    if theme == "light":
        return light
    one = WHITE if theme == "mono-white" else INK
    return {k: one for k in dark} | {"mono": True}


def mono_one(theme):
    return WHITE if theme == "mono-white" else INK


# 1. Ring Burst (Fredoka) ────────────────────────────────────────────────────


def d1_harmoniyo(c, x0=0.0, size=200):
    F = FACE["fredoka"]
    cap, stem = F.capx(size), F.stem(size)
    a, wa = F.layout("Harmoni", size, x=x0, track=2)
    yadv = F.layout("Y", size)[0][0]["adv"] * 1.02
    xY = x0 + wa + 2
    cx = xY + yadv / 2
    s = glyph_paths(a, c["text"]) + ybell(cx, 0, cap, yadv * 1.0, stem, c["y"])
    s += burst(cx, -cap * 0.90, [yadv * 0.66], [c["a1"]], stem * 0.36, (18, 50))
    b, wb = F.layout("o", size, x=xY + yadv + 2)
    return s + glyph_paths(b, c["text"]), xY + yadv + 2 + wb - x0, cap


def d1_wordmark(theme, line=False):
    c = cmap(theme, {"text": WHITE, "go": PC["candlelight"], "y": PC["candlelight"], "a1": PC["pear"]},
             {"text": INK, "go": WOOD, "y": BRASS_INK, "a1": WOOD})
    Fm = FACE["fredoka-md"]
    if line:
        go, gw = Fm.layout("Go Go", 200, track=4)
        s, w, cap = d1_harmoniyo(c, gw + 56)
        return glyph_paths(go, c["go"]) + s
    s, w, cap = d1_harmoniyo(c)
    go, gw = Fm.layout("Go Go", 112, track=6)
    return s + f'<g transform="translate(8 {n(-cap * 1.40)})">{glyph_paths(go, c["go"])}</g>'


def d1_mark(theme="dark", small=False):
    mono = theme.startswith("mono")
    body = mono_one(theme) if mono else BRASS_INK if theme == "light" else PC["candlelight"]
    s = ybell(256, 448, 330, 300, 62, body)
    cols = [body] * 2 if mono else [SPRUCE_DEEP, PC["frost"]] if theme == "light" else [PC["pear"], PC["holly"]]
    if small:
        s += burst(256, 150, [200], cols[:1], 40, (18, 56))
    else:
        s += burst(256, 150, [194, 244], cols, 28, (16, 54))
    return s


# 2. Resonance (Outfit) ──────────────────────────────────────────────────────


def d2_wordmark(theme, line=True):
    c = cmap(theme, {"text": WHITE, "go": WHITE, "y": PC["spruce"], "a": PC["frost"]},
             {"text": INK, "go": INK, "y": SPRUCE_DEEP, "a": SPRUCE_DEEP})
    F, Fl = FACE["outfit"], FACE["outfit-lt"]
    size = 200
    cap, stem = F.capx(size), F.stem(size)
    go, gw = Fl.layout("Go Go", size)
    a, wa = F.layout("Harmoni", size, x=gw + size * 0.26, track=-1)
    W = F.layout("Y", size)[0][0]["box"][2] * 0.80
    spread = stem * 1.35
    yadv = W + 2 * spread
    xY = gw + size * 0.26 + wa
    cx = xY + yadv / 2
    s = glyph_paths(go, c["go"]) + glyph_paths(a, c["text"]) + tuning_fork(cx, 0, cap, W, stem, c["y"])
    s += side_arcs(cx, -cap * 0.80, [W / 2 + stem * 0.95], [c["a"]], stem * 0.28, 24)
    b, _ = F.layout("o", size, x=xY + yadv - 4)
    return s + glyph_paths(b, c["text"])


def d2_mark(theme="dark", small=False):
    mono = theme.startswith("mono")
    fork = mono_one(theme) if mono else SPRUCE_DEEP if theme == "light" else PC["spruce"]
    s = tuning_fork(256, 440, 360, 176, 54, fork)
    cols = [fork] * 2 if mono else [PC["frost"], PC["winter-sky"]]
    if small:
        s += side_arcs(256, 180, [150], cols[:1], 34, 26)
    else:
        s += side_arcs(256, 180, [138, 190], cols, 24, 26)
    return s


# 3. Triad (Sniglet) ─────────────────────────────────────────────────────────


def d3_harmoniyo(c, theme, x0=0.0, size=200):
    F = FACE["sniglet"]
    g, w = F.layout("HarmoniYo", size, x=x0, track=-3)
    xh = F.xh * size / F.upem
    s = ""
    for x in g:
        if x["ch"] == "i":
            bx, by, bw, bh = x["box"]
            cid = f"d3i-{theme}-{int(x0)}"
            s += (f'<clipPath id="{cid}"><rect x="{n(bx - 4)}" y="{n(-xh - 6)}" width="{n(bw + 8)}" '
                  f'height="{n(xh + 60)}"/></clipPath>')
            s += f'<path d="{x["d"]}" fill="{c["text"]}" clip-path="url(#{cid})"/>'
            bwid, bht = bw * 1.22, bw * 1.0
            y0 = -xh - size * 0.07 - bht
            s += (f'<g transform="rotate(-12 {n(bx + bw / 2)} {n(y0 + bht / 2)})">'
                  + bell(bx + bw / 2, y0, bwid, bht, c["dot"], handle=False, clapper=c["dot"]) + "</g>")
        else:
            s += f'<path d="{x["d"]}" fill="{c["y"] if x["ch"] == "Y" else c["text"]}"/>'
    return s, w, F.capx(size)


def d3_wordmark(theme, line=False):
    c = cmap(theme, {"text": WHITE, "go": WHITE, "y": PC["berry"], "dot": PC["ember"]},
             {"text": INK, "go": INK, "y": BERRY_DEEP, "dot": WOOD})
    F = FACE["sniglet"]
    if line:
        go, gw = F.layout("Go Go", 200, track=-3)
        s, w, cap = d3_harmoniyo(c, theme, gw + 54)
        return glyph_paths(go, c["go"]) + s
    s, w, cap = d3_harmoniyo(c, theme)
    go, gw = F.layout("Go Go", 100, track=4)
    return s + f'<g transform="translate(6 {n(-cap * 1.36)})">{glyph_paths(go, c["go"])}</g>'


def d3_mark(theme="dark", small=False):
    mono = theme.startswith("mono")
    cols = [mono_one(theme)] * 3 if mono else [PC["berry"], PC["holly"], PC["ember"]]
    # A handbell set on the table: C (largest), E, G (smallest) ring a major chord together.
    base = 420
    spec = [(118, 190, -10), (262, 150, 0), (392, 116, 10)]
    if small:
        spec = [(130, 210, -10), (272, 165, 0), (400, 128, 10)]
    def draw(colours):
        out = ""
        for (cx, w, rot), col in zip(spec, colours):
            h = w * 0.98
            out += (f'<g transform="rotate({rot} {n(cx)} {n(base)})">'
                    + bell(cx, base - h, w, h, col, reach=0.0 if small else 0.34, handle=False if small else None,
                           clapper=col) + "</g>")
        return out

    return outlined(draw, theme) + draw(cols)


def outlined(draw, theme, width=16) -> str:
    """On paper, light palette fills get an ink outline (drawn behind) so the mark keeps its edge."""
    if theme != "light":
        return ""
    return f'<g stroke="{INK}" stroke-width="{width}" stroke-linejoin="round">{draw([INK] * 3)}</g>'


# 4. Pitch Wheel (Nunito) ────────────────────────────────────────────────────


def d4_wordmark(theme, line=True):
    """Mark-led lockup: the pitch wheel, then the name with the Y in candlelight (D, our home key).
    (An earlier take filled every o with a pitch colour; dropped because the HARMONIX logo stylizes
    its O as a filled dot.)"""
    mono = theme.startswith("mono")
    c = cmap(theme, {"text": WHITE, "y": PC["candlelight"]}, {"text": INK, "y": BRASS_INK})
    F = FACE["nunito"]
    size = 200
    cap = F.capx(size)
    k = cap * 1.55 / 454
    gap = size * 0.22
    x0 = 454 * k + gap
    g, w = F.layout("Go Go HarmoniYo", size, x=x0, track=-2)
    s = f'<g transform="translate({n(-29 * k)} {n(-cap / 2 - 256 * k)}) scale({n(k)})">{d4_mark(theme)}</g>'
    for x in g:
        if x["d"]:
            s += f'<path d="{x["d"]}" fill="{c["y"] if x["ch"] == "Y" and not mono else c["text"]}"/>'
    return s


def d4_mark(theme="dark", small=False):
    mono = theme.startswith("mono")
    one = mono_one(theme)
    centre = one if mono else (INK if theme == "light" else WHITE)
    s = ""
    for i, nm in enumerate(FIFTHS):
        a = math.radians(90 - i * 30)
        r = (34 if "#" not in nm else 28) if small else (27 if "#" not in nm else 21)
        s += circle(256 + 200 * math.cos(a), 256 - 200 * math.sin(a), r, one if mono else NOTE[nm],
                    f' stroke="{INK}" stroke-width="5"' if theme == "light" else "")
    s += bell(256, 196, 196, 176, centre, reach=0.34, clapper=centre)
    return s


# 5. Bell Tag (Lilita One) ───────────────────────────────────────────────────


def d5_wordmark(theme, line=False):
    c = cmap(theme,
             {"text": PC["candlelight"], "shadow": "#5b2a0c", "y": PC["berry"], "tab": PC["berry"], "tabtext": INK},
             {"text": WOOD, "shadow": PC["candlelight"], "y": BERRY_DEEP, "tab": BERRY_DEEP, "tabtext": WHITE})
    F = FACE["lilita"]
    size = 220
    gsize = size * (0.40 if line else 0.36)
    go, gw = F.layout("GO GO", gsize, track=gsize * 0.16)
    gcap = F.capx(gsize)
    pad = gcap * 0.62
    tw, th = gw + pad * 2.2, gcap + pad * 1.5
    cap = F.capx(size)
    x0 = tw + size * 0.14 if line else 0
    g, w = F.layout("HarmoniYo", size, x=x0, track=2)
    s = ""
    if not c.get("mono"):
        s += f'<g transform="translate(0 {n(size * 0.05)})">{glyph_paths(g, c["shadow"])}</g>'
    s += glyph_paths(g, c["text"], skip="Y")
    s += "".join(f'<path d="{x["d"]}" fill="{c["y"]}"/>' for x in g if x["ch"] == "Y")
    tx, ty = ((0, -cap / 2 - th / 2) if line else ((w - tw) / 2, -cap - th - cap * 0.14))
    if c.get("mono"):
        s += f'<path d="{rrect(tx, ty, tw, th, th / 2)}" fill="none" stroke="{c["tab"]}" stroke-width="{n(gcap * 0.16)}"/>'
        tf = c["tab"]
    else:
        s += f'<path d="{rrect(tx, ty, tw, th, th / 2)}" fill="{c["tab"]}"/>'
        tf = c["tabtext"]
    return s + f'<g transform="translate({n(tx + pad * 1.1)} {n(ty + th / 2 + gcap / 2)})">{glyph_paths(go, tf)}</g>'


def d5_mark(theme="dark", small=False):
    mono = theme.startswith("mono")
    body = mono_one(theme) if mono else PC["candlelight"]
    s = outlined(lambda c: bell(256, 150, 330, 300, c[0], reach=0.32, grip=0.15, clapper=c[0]), theme, 14)
    s += bell(256, 150, 330, 300, body, reach=0.32, grip=0.15, clapper=body)
    g, _ = FACE["lilita"].layout("Y", 260)
    bx, by, bw, bh = g[0]["box"]
    ypath = f'<path d="{g[0]["d"]}" transform="translate({n(256 - bx - bw / 2)} {n(330 - by - bh / 2)})"'
    if not mono:
        return s + ypath + f' fill="{INK}"/>'
    mid = f"d5m-{theme}"
    return (f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">'
            f'<rect width="512" height="512" fill="#fff"/>{ypath} fill="#000"/></mask><g mask="url(#{mid})">{s}</g>')


# 6. Sing-Along (Grandstander) ───────────────────────────────────────────────


def d6_harmoniyo(c, x0=0.0, size=200):
    F = FACE["grand"]
    g, w = F.layout("HarmoniYo", size, x=x0, track=4)
    cap = F.capx(size)
    s = ""
    for i, x in enumerate(g):
        bx, by, bw, bh = x["box"]
        rot, dy = (-5, -6) if i % 2 else (4, 4)
        fill = c["y"] if x["ch"] == "Y" else c["text"]
        s += (f'<g transform="translate(0 {dy}) rotate({rot} {n(bx + bw / 2)} {n(by + bh / 2)})">'
              f'<path d="{x["d"]}" fill="{fill}"/></g>')
    yb = next(x for x in g if x["ch"] == "Y")["box"]
    if not c.get("mono"):
        sx, sy = yb[0] + yb[2] * 0.95, yb[1] - cap * 0.12
        s += (f'<path d="M{n(sx)} {n(sy - 26)}Q{n(sx + 4)} {n(sy - 4)} {n(sx + 26)} {n(sy)}Q{n(sx + 4)} {n(sy + 4)} '
              f'{n(sx)} {n(sy + 26)}Q{n(sx - 4)} {n(sy + 4)} {n(sx - 26)} {n(sy)}Q{n(sx - 4)} {n(sy - 4)} {n(sx)} {n(sy - 26)}Z" '
              f'fill="{c["spark"]}"/>')
    return s, w, cap


def d6_wordmark(theme, line=False):
    c = cmap(theme, {"text": WHITE, "go": PC["candlelight"], "y": PC["candlelight"], "spark": PC["rosehip"]},
             {"text": INK, "go": WOOD, "y": BRASS_INK, "spark": BERRY_DEEP})
    Fm = FACE["grand-md"]
    if line:
        go, gw = Fm.layout("Go Go", 190, track=6)
        s, w, cap = d6_harmoniyo(c, gw + 50)
        return f'<g transform="rotate(-3 0 0)">{glyph_paths(go, c["go"])}</g>' + s
    s, w, cap = d6_harmoniyo(c)
    go, gw = Fm.layout("Go Go", 110, track=8)
    return s + f'<g transform="translate(10 {n(-cap * 1.38)}) rotate(-4)">{glyph_paths(go, c["go"])}</g>'


def d6_mark(theme="dark", small=False):
    mono = theme.startswith("mono")
    if mono:
        one = mono_one(theme)
        mid = f"d6m-{theme}"
        holes = ('<ellipse cx="214" cy="262" rx="20" ry="28" fill="#000"/><ellipse cx="298" cy="262" rx="20" ry="28" fill="#000"/>'
                 '<path d="M222 318 Q256 356 290 318" fill="none" stroke="#000" stroke-width="16" stroke-linecap="round"/>')
        s = (f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">'
             f'<rect width="512" height="512" fill="#fff"/>{holes}</mask><g mask="url(#{mid})">')
        s += bell(256, 120, 360, 330, one, handle=False, clapper=one)
        s += (f'<path d="M236 120 V84 Q236 60 256 60 Q276 60 276 84 V120" fill="none" stroke="{one}" '
              f'stroke-width="22" stroke-linecap="round"/>')
        return s + "</g>"
    s = outlined(lambda c: f'<path d="M234 124 V86 Q234 58 256 58 Q278 58 278 86 V124" fill="none" stroke-width="40" '
                           f'stroke-linecap="round"/>' + bell(256, 120, 360, 330, c[0], handle=False, clapper=c[0]),
                 theme, 14)
    s += (f'<path d="M234 124 V86 Q234 58 256 58 Q278 58 278 86 V124" fill="none" stroke="{BRASS_DEEP}" '
          f'stroke-width="24" stroke-linecap="round"/>')
    s += bell(256, 120, 360, 330, BRASS, handle=False, clapper=BRASS_DEEP, bow=BRASS_DEEP)
    s += '<ellipse cx="256" cy="270" rx="110" ry="88" fill="#fff" opacity="0.16"/>'
    s += f'<ellipse cx="214" cy="262" rx="20" ry="28" fill="{INK}"/>' + circle(220, 252, 7, "#fff")
    s += f'<ellipse cx="298" cy="262" rx="20" ry="28" fill="{INK}"/>' + circle(304, 252, 7, "#fff")
    if not small:
        s += f'<ellipse cx="182" cy="306" rx="20" ry="11" fill="{PC["berry"]}" opacity="0.6"/>'
        s += f'<ellipse cx="330" cy="306" rx="20" ry="11" fill="{PC["berry"]}" opacity="0.6"/>'
        s += '<path d="M196 160 Q170 210 168 262" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" opacity="0.5"/>'
    s += f'<path d="M222 318 Q256 356 290 318 Z" fill="{INK}" stroke="{INK}" stroke-width="12" stroke-linejoin="round"/>'
    return s


DIRECTIONS = [
    {
        "id": "1-ring-burst", "stacked": True, "name": "Ring Burst", "font": "Fredoka", "weight": "SemiBold 650 / Medium 560",
        "wordmark": d1_wordmark, "mark": d1_mark, "icon_bg": STAGE,
        "mascot": lambda: living_bell(10, 10, 1.0, uid="m1"),
        "mascot_note": "Living bell (brief option 2), brass with a face in the shine and felt-tipped hands",
    },
    {
        "id": "2-resonance", "name": "Resonance", "font": "Outfit", "weight": "Bold 700 / Regular 400",
        "wordmark": d2_wordmark, "mark": d2_mark, "icon_bg": STAGE,
        "mascot": lambda: captain(0, 0, 1.0, skin=SKIN[1], hair=HAIR[1], style="bob", top=PC["frost"], uid="m2"),
        "mascot_note": "Bell captain (brief option 1, she/her): bob haircut, gloves, bell hair clip, mallet in her sleeve",
    },
    {
        "id": "3-triad", "stacked": True, "name": "Triad", "font": "Sniglet", "weight": "ExtraBold 800",
        "wordmark": d3_wordmark, "mark": d3_mark, "icon_bg": STAGE,
        "mascot": lambda: captain(0, 0, 0.82, skin=SKIN[3], hair=HAIR[2], style="curls", top=PC["plum"], uid="m3a")
        + living_bell(205, 70, 0.72, arcs=("holly", "ember"), uid="m3b"),
        "mascot_note": "Duo (brief option 3): living-bell Yo cheers, a bell captain (she/her) coaches",
    },
    {
        "id": "4-pitch-wheel", "lockup_has_mark": True, "name": "Pitch Wheel", "font": "Nunito", "weight": "Black 900",
        "wordmark": d4_wordmark, "mark": d4_mark, "icon_bg": STAGE,
        "mascot": lambda: living_bell(10, 10, 1.0, halo=True, arcs=(), uid="m4"),
        "mascot_note": "Living bell (option 2, gender-neutral) wearing a halo of the twelve pitch colours",
    },
    {
        "id": "5-bell-tag", "stacked": True, "name": "Bell Tag", "font": "Lilita One", "weight": "Regular 400",
        "wordmark": d5_wordmark, "mark": d5_mark, "icon_bg": STAGE,
        "mascot": lambda: captain(0, 0, 1.0, skin=SKIN[2], hair=HAIR[0], style="bun", top=PC["berry"],
                                  arcs=("candlelight", "pear"), uid="m5"),
        "mascot_note": "Bell captain (option 1, she/her): high bun with a bell clip, gloves, mallet tucked in her sleeve",
    },
    {
        "id": "6-sing-along", "stacked": True, "name": "Sing-Along", "font": "Grandstander", "weight": "Black 900 / ExtraBold 800",
        "wordmark": d6_wordmark, "mark": d6_mark, "icon_bg": STAGE,
        "mascot": lambda: living_bell(10, 10, 1.0, handle="curl", wink=True, cheeks=PC["rosehip"],
                                      arcs=("rosehip", "candlelight"), uid="m6"),
        "mascot_note": "Living bell (option 2, she): a curl for a handle, mid-wink; Yo is also the app icon",
    },
]

# ── SVG assembly ─────────────────────────────────────────────────────────────


def svg_doc(inner, vb, title, w=None, h=None):
    size = f' width="{n(w)}" height="{n(h)}"' if w else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{size} role="img" aria-label="{title}">'
            f"<title>{title}</title>{inner}</svg>\n")


def icon_svg(d, small=False, box=None):
    """App icon: the dark mark centred on a rounded stage tile. `box` is the mark's measured bbox."""
    bg = d["icon_bg"]
    x, y, w, h = box
    k = 512 * (0.70 if small else 0.66) / max(w, h)
    tx, ty = 256 - k * (x + w / 2), 256 - k * (y + h / 2)
    inner = (f'<defs><radialGradient id="glow" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="{BRASS}" '
             f'stop-opacity="0.28"/><stop offset="1" stop-color="{BRASS}" stop-opacity="0"/></radialGradient></defs>'
             f'<rect width="512" height="512" rx="112" fill="{bg}"/>'
             + ("" if small else '<rect width="512" height="512" rx="112" fill="url(#glow)"/>')
             + f'<g transform="translate({n(tx)} {n(ty)}) scale({n(k)})">{d["mark"]("dark", small)}</g>')
    return inner


def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, "utf-8", newline="\n")


def data_uri(svg: str) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode()


def luminance(hex_: str) -> float:
    def ch(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hex_[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return round((la + 0.05) / (lb + 0.05), 2)


def measure(page, inner: str):
    page.set_content('<svg xmlns="http://www.w3.org/2000/svg" id="s" width="10" height="10" style="overflow:visible">'
                     f'<g id="art">{inner}</g></svg>')
    return page.evaluate("""() => {
      const g = document.getElementById('art');
      const b = g.getBBox({stroke: true});
      return [b.x, b.y, b.width, b.height];
    }""")


def build_assets(page, dirs=None, root=OUT):
    meta = []
    for d in dirs or DIRECTIONS:
        folder = root / d["id"]
        files = {}
        layouts = [("wordmark", False)] + ([("wordmark-line", True)] if d.get("stacked") else [])
        for stem, line in layouts:
            for theme in ("dark", "light", "mono-white", "mono-ink"):
                inner = d["wordmark"](theme, line=line)
                x, y, w, h = measure(page, inner)
                pad = h * 0.04
                vb = f"{n(x - pad)} {n(y - pad)} {n(w + 2 * pad)} {n(h + 2 * pad)}"
                files[f"{stem}-{theme}"] = svg_doc(inner, vb, "Go Go HarmoniYo")
        for theme in ("dark", "light", "mono-white", "mono-ink"):
            inner = d["mark"](theme)
            x, y, w, h = measure(page, inner)
            side = max(w, h) * 1.06
            cx, cy = x + w / 2, y + h / 2
            vb = f"{n(cx - side / 2)} {n(cy - side / 2)} {n(side)} {n(side)}"
            files[f"mark-{theme}"] = svg_doc(inner, vb, "Go Go HarmoniYo mark")
        files["app-icon"] = svg_doc(icon_svg(d, box=measure(page, d["mark"]("dark"))), "0 0 512 512",
                                    "Go Go HarmoniYo app icon")
        files["favicon"] = svg_doc(icon_svg(d, small=True, box=measure(page, d["mark"]("dark", True))), "0 0 512 512",
                                   "Go Go HarmoniYo favicon")
        inner = d["mascot"]()
        x, y, w, h = measure(page, inner)
        pad = 12
        files["mascot"] = svg_doc(inner, f"{n(x - pad)} {n(y - pad)} {n(w + 2 * pad)} {n(h + 2 * pad)}",
                                  "HarmoniYo (Yo) mascot sketch")
        for k, v in files.items():
            write(folder / f"{k}.svg", v)
        d["files"] = files
        meta.append(d)
    return meta


# ── previews ─────────────────────────────────────────────────────────────────

CSS = """
*{box-sizing:border-box;margin:0}
body{font-family:'Segoe UI',system-ui,-apple-system,Roboto,sans-serif;background:#1a1c26;color:#e9e4da;width:1600px;padding:28px}
h1{font-size:30px;font-weight:700;margin-bottom:4px} .sub{color:#b9b3a6;font-size:17px;margin-bottom:18px}
.row{display:flex;gap:18px;margin-bottom:18px}
.panel{border-radius:16px;padding:18px;position:relative;overflow:hidden}
.lbl{position:absolute;left:14px;top:10px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}
.stage{background:radial-gradient(ellipse at 50% 40%,#2a2117 0%,#0b0d17 62%);color:#e9e4da}
.paper{background:#f7f2e8;color:#3a3326}
.center{display:flex;align-items:center;justify-content:center}
.ink{color:#10121c}
.tile{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;opacity:.95}
canvas.px{image-rendering:pixelated}
.tab{display:flex;align-items:center;gap:8px;background:#2b2e3b;color:#e6e6e6;border-radius:10px 10px 0 0;padding:8px 14px;font-size:13px;width:250px}
.tv{width:760px;height:428px;border-radius:10px;border:10px solid #050508;position:relative;background:radial-gradient(ellipse at 50% 45%,#231b14 0%,#0b0d17 65%)}
.phone{width:300px;height:428px;border-radius:34px;border:10px solid #050508;background:#111;overflow:hidden;position:relative}
.qr{width:120px;height:120px;background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#888;font:700 22px monospace}
.pill{width:56px;height:84px;border-radius:28px;display:flex;align-items:center;justify-content:center;font:800 26px 'Segoe UI',sans-serif;color:#10121c}
"""

PIXEL_JS = """
async function px(){
  await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));
  const cs=[...document.querySelectorAll('canvas[data-src]')];
  await Promise.all(cs.map(c=>new Promise(res=>{const im=new Image();im.onload=()=>{const s=+c.dataset.size;c.width=s;c.height=s;c.getContext('2d').drawImage(im,0,0,s,s);c.style.width=(s*+c.dataset.zoom)+'px';c.style.height=(s*+c.dataset.zoom)+'px';res()};im.src=c.dataset.src})));
  await document.fonts.ready;
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  window.__ready=true;
}
px();
"""


def img(uri, w=None, h=None, style=""):
    a = f' width="{w}"' if w else ""
    a += f' height="{h}"' if h else ""
    return f'<img src="{uri}"{a} style="{style}">'


def lobby_mock(d, w=360):
    wm = data_uri(d["files"]["wordmark-dark"])
    return (f'<div class="panel" style="width:{w + 40}px;background:#151a33;border:1px solid #2c3566">'
            f'<div class="lbl">Lobby header (TV)</div><div class="center" style="flex-direction:column;gap:10px;padding-top:18px">'
            f'{img(wm, w=w - 40)}<div style="font-size:15px;color:#c9c3b6">Scan to join with your phone</div>'
            f'<div class="qr">QR</div><div style="font:700 14px monospace;color:{PC["candlelight"]}">https://192.168.1.20:18863/</div></div></div>')


def phone_mock(d):
    mk = data_uri(d["files"]["mark-dark"])
    wm = data_uri(d["files"].get("wordmark-line-dark", d["files"]["wordmark-dark"]))
    pills = "".join(f'<div class="pill" style="background:{NOTE[x]}">{x}</div>' for x in ["E", "G", "A", "C"])
    return (f'<div class="phone"><div style="display:flex;align-items:center;gap:8px;padding:14px 14px 10px;background:#181a24;border-bottom:1px solid #2a2d3a">'
            f'{"" if d.get("lockup_has_mark") else img(mk, w=30, h=30)}{img(wm, w=200, style="max-height:34px;object-fit:contain")}</div>'
            f'<div style="color:#eee;font-weight:600;font-size:15px;text-align:center;padding:12px 6px">Ringer 1 &middot; Silent Night (easy)</div>'
            f'<div class="center" style="padding:6px 0 10px"><div style="width:120px;height:120px;border-radius:50%;background:{NOTE["A"]};display:flex;align-items:center;justify-content:center;font:800 56px Segoe UI;color:#10121c">A</div></div>'
            f'<div style="display:flex;gap:10px;justify-content:center;padding-top:12px">{pills}</div></div>')


def tv_mock(d):
    wm = data_uri(d["files"]["wordmark-dark"])
    mk = data_uri(d["files"]["mark-dark"])
    return (f'<div class="tv center" style="flex-direction:column;gap:16px">{img(wm, w=380)}'
            f'<div style="color:#d9d2c4;font-size:16px;letter-spacing:.04em">Grab a bell. Scan to join.</div>'
            f'<div style="position:absolute;right:16px;top:14px;display:flex;align-items:center;gap:6px;opacity:.9">{img(mk, w=34, h=34)}</div>'
            f'<div style="position:absolute;left:14px;bottom:10px;font-size:11px;color:#8b8577">TV title at 1/2.5 scale (1920 x 1080); corner mark at in-game size</div></div>')


def sizes_row(d):
    ic = data_uri(d["files"]["app-icon"])
    fv = data_uri(d["files"]["favicon"])
    tiles = "".join(f'<div class="tile">{img(ic, w=s, h=s)}<span>{s} px</span></div>' for s in (180, 96, 48))
    tiles += "".join(f'<div class="tile">{img(fv, w=s, h=s)}<span>{s} px</span></div>' for s in (32, 16))
    zoom = "".join(f'<div class="tile"><canvas class="px" data-src="{fv}" data-size="{s}" data-zoom="{z}"></canvas>'
                   f'<span>{s} px &times;{z}</span></div>' for s, z in ((32, 3), (16, 6)))
    tab = f'<div class="tab">{img(fv, w=16, h=16)}<span>Go Go HarmoniYo</span></div>'
    home = (f'<div class="tile" style="background:linear-gradient(160deg,#3a4a7a,#7a5a8a);padding:14px 18px;border-radius:14px">'
            f'{img(ic, w=60, h=60, style="border-radius:14px")}<span style="color:#fff">Go Go Har&hellip;</span></div>')
    return (f'<div class="panel" style="flex:1;background:#3a3d4c"><div class="lbl">App icon, favicon (actual pixels and zoomed), browser tab, home screen</div>'
            f'<div style="display:flex;align-items:flex-end;gap:22px;padding-top:24px">{tiles}{zoom}'
            f'<div class="tile">{tab}<span>tab</span></div>{home}</div></div>')


def board_html(d):
    f = d["files"]
    head = (f'<h1>{d.get("heading") or "Direction " + d["id"].split("-")[0] + ": " + d["name"]}</h1>'
            f'<div class="sub">Wordmark in {d["font"]} ({d["weight"]}, SIL OFL 1.1), converted to outlines. {d["rationale"]}</div>')
    r1 = (f'<div class="row"><div class="panel stage center" style="flex:1;height:330px"><div class="lbl">On the stage</div>'
          f'{img(data_uri(f["wordmark-dark"]), w=600, style="max-height:250px;object-fit:contain")}</div>'
          f'<div class="panel paper center" style="flex:1;height:330px"><div class="lbl">On paper</div>'
          f'{img(data_uri(f["wordmark-light"]), w=600, style="max-height:250px;object-fit:contain")}</div></div>')
    if "wordmark-line-dark" in f:
        r1 += (f'<div class="row"><div class="panel stage center" style="flex:1;height:130px"><div class="lbl">One-line lockup (headers, tight spaces)</div>'
               f'{img(data_uri(f["wordmark-line-dark"]), w=560, style="max-height:80px;object-fit:contain;margin-top:14px")}</div>'
               f'<div class="panel paper center" style="flex:1;height:130px"><div class="lbl">One-line lockup on paper</div>'
               f'{img(data_uri(f["wordmark-line-light"]), w=560, style="max-height:80px;object-fit:contain;margin-top:14px")}</div></div>')
    r2 = (f'<div class="row">'
          f'<div class="panel stage center" style="width:250px;height:250px"><div class="lbl">Mark</div>{img(data_uri(f["mark-dark"]), w=170, h=170)}</div>'
          f'<div class="panel paper center" style="width:250px;height:250px"><div class="lbl">Mark on paper</div>{img(data_uri(f["mark-light"]), w=170, h=170)}</div>'
          f'<div class="panel stage center" style="flex:1;height:250px;flex-direction:column;gap:16px"><div class="lbl">One colour, and 96 px minimum width</div>'
          f'<div style="display:flex;gap:18px;align-items:center;padding-top:14px">{img(data_uri(f["wordmark-mono-white"]), w=230)}{img(data_uri(f["mark-mono-white"]), w=70, h=70)}'
          f'{img(data_uri(f["wordmark-mono-white"]), w=96)}</div></div>'
          f'<div class="panel paper center" style="flex:1;height:250px;flex-direction:column;gap:16px"><div class="lbl">One colour on paper</div>'
          f'<div style="display:flex;gap:18px;align-items:center;padding-top:14px">{img(data_uri(f["wordmark-mono-ink"]), w=230)}{img(data_uri(f["mark-mono-ink"]), w=70, h=70)}'
          f'{img(data_uri(f["wordmark-mono-ink"]), w=96)}</div></div></div>')
    r3 = f'<div class="row">{sizes_row(d)}</div>'
    r4 = (f'<div class="row" style="align-items:stretch">{tv_mock(d)}{phone_mock(d)}'
          f'<div class="panel stage center" style="flex:1;flex-direction:column"><div class="lbl">Mascot sketch</div>'
          f'{img(data_uri(f["mascot"]), w=300, style="max-height:330px;object-fit:contain;margin-top:20px")}'
          f'<div style="font-size:13px;color:#c9c3b6;text-align:center;margin-top:8px">{d["mascot_note"]}</div></div></div>')
    r5 = f'<div class="row">{lobby_mock(d)}<div class="panel stage" style="flex:1"><div class="lbl">Taglines</div><div style="padding-top:26px;font-size:24px;line-height:1.7">' + "".join(
        f'<div>&ldquo;{t}&rdquo;</div>' for t in d["taglines"]) + "</div></div></div>"
    return f"<html><head><style>{CSS}</style></head><body>{head}{r1}{r2}{r3}{r4}{r5}<script>{PIXEL_JS}</script></body></html>"


def overview_html(dirs, kind):
    rows = []
    if kind == "wordmarks":
        for d in dirs:
            f = d["files"]
            rows.append(f'<div class="row"><div class="panel stage center" style="width:120px;height:170px;font-size:40px;font-weight:800">{d["id"][0]}</div>'
                        f'<div class="panel stage center" style="flex:1;height:170px">{img(data_uri(f["wordmark-dark"]), w=520, style="max-height:140px;object-fit:contain")}</div>'
                        f'<div class="panel paper center" style="flex:1;height:170px">{img(data_uri(f["wordmark-light"]), w=520, style="max-height:140px;object-fit:contain")}</div></div>')
        title = "Go Go HarmoniYo: wordmark directions on the stage and on paper"
    elif kind == "icons":
        cells = []
        for d in dirs:
            f = d["files"]
            fv = data_uri(f["favicon"])
            cells.append(f'<div class="panel stage" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:12px">'
                         f'<div style="font-size:20px;font-weight:700">{d["id"][0]}. {d["name"]}</div>{img(data_uri(f["app-icon"]), w=150, h=150)}'
                         f'<div style="display:flex;gap:12px;align-items:flex-end">{img(fv, w=48, h=48)}{img(fv, w=32, h=32)}{img(fv, w=16, h=16)}'
                         f'<canvas class="px" data-src="{fv}" data-size="16" data-zoom="4"></canvas></div>'
                         f'<div class="panel paper center" style="width:100%">{img(data_uri(f["mark-light"]), w=90, h=90)}</div></div>')
        rows.append(f'<div class="row">{"".join(cells)}</div>')
        title = "App icons at 150, 48, 32 and 16 px (and 16 px zoomed), plus the mark on paper"
    else:
        cells = []
        for d in dirs:
            cells.append(f'<div class="panel stage" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px">'
                         f'<div style="font-size:20px;font-weight:700">{d["id"][0]}. {d["name"]}</div>'
                         f'{img(data_uri(d["files"]["mascot"]), w=220, style="max-height:250px;object-fit:contain")}'
                         f'<div style="font-size:13px;color:#c9c3b6;text-align:center">{d["mascot_note"]}</div></div>')
        rows.append(f'<div class="row">{"".join(cells)}</div>')
        title = "Mascot sketch directions for HarmoniYo (Yo)"
    return f"<html><head><style>{CSS}</style></head><body><h1>{title}</h1><div class='sub'>Generated by tools/design/brand-options/build.py. Not final art.</div>{''.join(rows)}<script>{PIXEL_JS}</script></body></html>"


def warm_up(page, html):
    """The first canvas draw in a fresh browser can differ by one colour level; render once and discard."""
    page.set_content(html)
    page.wait_for_function("window.__ready === true")


def shoot(page, html, path):
    page.set_viewport_size({"width": 1600, "height": 900})
    page.set_content(html)
    page.wait_for_function("window.__ready === true")
    page.screenshot(path=str(path), full_page=True)


RATIONALE = {
    "1-ring-burst": "The capital Y is a handbell held at rest, mouth up, the way ringers really hold it; two rings of sound rise from it.",
    "2-resonance": "A calm, professional one-line wordmark whose Y is a tuning fork: music education first, game second.",
    "3-triad": "Three bells of different sizes ring a major chord (C, E, G): the team is the hero. The i is dotted with a tiny bell.",
    "4-pitch-wheel": "Our pitch-class palette is the logo: twelve notes in circle-of-fifths order around a bell, locked up with the name; the Y glows candlelight (D).",
    "5-bell-tag": "A warm, chunky holiday-gift look: a candlelight bell badge with a knocked-out Y and a GO GO tab.",
    "6-sing-along": "Mascot-led and bouncy: hand-lettered, ringing letters, and Yo's face is the app icon.",
}

TAGLINES = {
    "1-ring-burst": ["Ring together.", "Every ring counts.", "Pick up a bell. Make some harmony."],
    "2-resonance": ["Learn to ring, together.", "Real notes. Real bells. One team."],
    "3-triad": ["It takes everyone to make a chord.", "Your family, in harmony."],
    "4-pitch-wheel": ["Every note has a colour.", "Find your note. Ring it."],
    "5-bell-tag": ["Ring in the fun.", "Grab a bell. Yo's got the tune."],
    "6-sing-along": ["Yo! Let's ring.", "Ring along with Yo."],
}


def main():
    faces()
    for d in DIRECTIONS:
        d["rationale"] = RATIONALE[d["id"]]
        d["taglines"] = TAGLINES[d["id"]]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        dirs = build_assets(page)
        warm_up(page, board_html(dirs[0]))
        for d in dirs:
            shoot(page, board_html(d), OUT / d["id"] / "board.png")
            print("board", d["id"])
        for kind in ("wordmarks", "icons", "mascots"):
            shoot(page, overview_html(dirs, kind), OUT / f"overview-{kind}.png")
        browser.close()
    metrics = {
        "$comment": "Generated by tools/design/brand-options/build.py: WCAG 2 contrast ratios of the main logo colours against the stage (#0b0d17) and paper (#f7f2e8) backgrounds.",
        "contrast": {name: {"stage": contrast(hexv, STAGE), "paper": contrast(hexv, PAPER)} for name, hexv in {
            "warm white #fbf7ef": WHITE, "ink #10121c": INK, "wood #7a3e14": WOOD, "brass deep #b97c1c": BRASS_DEEP,
            "spruce deep #00654f": SPRUCE_DEEP, "brass ink #8f5d10": BRASS_INK, "berry deep #a8262f": BERRY_DEEP, "brass #e8b04c": BRASS,
            **{f"{p['token']} {p['hex']}": p["hex"] for p in PALETTE["pitchClasses"]}}.items()},
    }
    write(OUT / "metrics.json", json.dumps(metrics, indent=2) + "\n")


if __name__ == "__main__":
    main()
