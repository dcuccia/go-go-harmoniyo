#!/usr/bin/env python3
"""Vamps on mashup G (Ring-Along): colour-matched "Go Go", bigger "Go Go", and versions of Yo.

    python tools/design/brand-options/gvamps.py

Reuses build.py and mashups.py (same requirements). Writes docs/design/brand-options/g-vamps/.
Owner direction (2026-10-25): match the colour of "Go Go" with the bell and the Y, make "Go Go"
bigger, dark mode by default, and show different versions of the bell character.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

from playwright.sync_api import sync_playwright  # noqa: E402

import build as B  # noqa: E402
import mashups as M  # noqa: E402
from build import (BERRY_DEEP, BRASS_INK, FELT, INK, PAPER, PC, SPRUCE_DEEP, STAGE, WHITE, bell, circle,  # noqa: E402
                   contrast, data_uri, img, n, side_arcs)

OUT = B.OUT / "g-vamps"
PAGE = None  # headless page, used to measure marks when composing lockups

HUES = {"candlelight": PC["candlelight"], "ember": PC["ember"], "rosehip": PC["rosehip"]}
RINGS_DARK = (PC["rosehip"], PC["candlelight"], PC["holly"])  # F, D, E as in mashup G
RINGS_LIGHT = (BERRY_DEEP, BRASS_INK, SPRUCE_DEEP)


def shade(hex_, k):
    r, g, b = (int(hex_[i:i + 2], 16) for i in (1, 3, 5))
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v * k))) for v in (r, g, b))


def deep(hex_, target=4.6):
    """The same hue darkened until it has at least `target`:1 contrast on paper (light-mode text)."""
    k = 1.0
    while contrast(shade(hex_, k), PAPER) < target:
        k -= 0.01
    return shade(hex_, k)


# ── Yo, the bell character ───────────────────────────────────────────────────


def face(expr, col, glints=True, tongue=True, simple=False, lashes=False):
    rx, ry = (26, 34) if simple else (20, 28)
    sw = 16 if simple else 12
    stroke = f'fill="none" stroke="{col}" stroke-width="{sw}" stroke-linecap="round"'

    def eye(cx, big=False):
        a, b = (24, 32) if big else (rx, ry)
        e = f'<ellipse cx="{cx}" cy="262" rx="{a}" ry="{b}" fill="{col}"/>'
        return e + (circle(cx + 6, 250, 7, "#fff") if glints else "")

    s = ""
    if expr == "wink":
        s += f'<path d="M192 264 Q214 240 236 264" {stroke}/>' + eye(298)
    elif expr == "joy":
        s += "".join(f'<path d="M{cx - 24} 272 Q{cx} 240 {cx + 24} 272" {stroke}/>' for cx in (214, 298))
    elif expr == "calm":
        s += "".join(f'<path d="M{cx - 22} 256 Q{cx} 278 {cx + 22} 256" {stroke}/>' for cx in (214, 298))
    elif expr == "ding":
        s += eye(214, True) + eye(298, True)
    else:  # grin
        s += eye(214) + eye(298)
    if expr == "joy":
        s += f'<path d="M208 304 H304 Q302 370 256 372 Q210 370 208 304Z" fill="{col}"/>'
        if tongue:
            s += f'<ellipse cx="256" cy="352" rx="24" ry="12" fill="{PC["berry"]}"/>'
    elif expr == "calm":
        s += f'<path d="M226 320 Q256 344 286 320" {stroke}/>'
    elif expr == "ding":
        s += f'<ellipse cx="256" cy="332" rx="18" ry="22" fill="{col}"/>'
    else:
        s += (f'<path d="M222 318 Q256 356 290 318 Z" fill="{col}" stroke="{col}" stroke-width="{sw}" '
              f'stroke-linejoin="round"/>')
    if lashes:
        ls = f'fill="none" stroke="{col}" stroke-width="8" stroke-linecap="round"'
        s += f'<path d="M318 250 L336 238" {ls}/><path d="M321 262 L342 258" {ls}/>'
        if expr == "wink":
            s += f'<path d="M194 258 L176 250" {ls}/><path d="M199 250 L187 238" {ls}/>'
        else:
            s += f'<path d="M194 250 L176 238" {ls}/><path d="M191 262 L170 258" {ls}/>'
    return s


_UID = [0]


def yo(theme="dark", small=False, hue="candlelight", expr="wink", bow=False, lashes=False, hands=False,
       tilt=0, motion=False, bounce=False, rings=True, simple=False, ring_count=3):
    """Yo in a 512-unit box. `small` is the favicon cut (no rings, motion lines or shading)."""
    mono = theme.startswith("mono")
    light = theme == "light"
    base = HUES[hue]
    body = B.mono_one(theme) if mono else base
    dk = body if mono else shade(base, 0.70)
    plain = simple or small
    accent = body if mono else deep(base) if light else base
    bowc = body if mono else (PC["rosehip"] if hue != "rosehip" else PC["plum"])

    def handle(col, wide=0):
        return (f'<path d="M234 124 V86 Q234 58 256 58 Q278 58 278 86 V124" fill="none" stroke="{col}" '
                f'stroke-width="{24 + wide}" stroke-linecap="round"/>')

    def arms(col, ball, wide=0):
        if not hands:
            return ""
        s = ""
        for sx in (1, -1):
            x = lambda v: 256 + sx * (v - 256)  # noqa: E731
            s += (f'<path d="M{n(x(130))} 330 Q{n(x(76))} 318 {n(x(70))} 262" fill="none" stroke="{col}" '
                  f'stroke-width="{16 + wide}" stroke-linecap="round"/>') + circle(x(70), 252, 24, ball)
        return s

    def ribbon(col, knot):
        if not bow:
            return ""
        return ('<g transform="translate(46 -4) rotate(16 256 126)">'
                f'<path d="M256 126 C226 92 196 104 200 130 C204 156 232 150 256 126Z" fill="{col}"/>'
                f'<path d="M256 126 C286 92 316 104 312 130 C308 156 280 150 256 126Z" fill="{col}"/>'
                + circle(256, 126, 13, knot) + "</g>")

    fig = ""
    if light:  # ink outline behind the light-coloured bell so it keeps its edge on paper
        fig += (f'<g stroke="{INK}" stroke-width="14" stroke-linejoin="round">' + arms(INK, INK, 16) + handle(INK, 16)
                + bell(256, 120, 360, 330, INK, handle=False, clapper=INK) + ribbon(INK, INK) + "</g>")
    fig += arms(dk, body if mono else FELT) + handle(dk)
    fig += bell(256, 120, 360, 330, body, handle=False, clapper=dk, bow=None if plain or mono else dk)
    if not mono and not plain:
        fig += '<ellipse cx="256" cy="270" rx="110" ry="88" fill="#fff" opacity="0.16"/>'
        fig += ('<path d="M196 160 Q170 210 168 262" fill="none" stroke="#fff" stroke-width="16" '
                'stroke-linecap="round" opacity="0.5"/>')
        ck = PC["berry"] if hue == "rosehip" else PC["rosehip"]
        fig += (f'<ellipse cx="180" cy="306" rx="20" ry="11" fill="{ck}" opacity="0.6"/>'
                f'<ellipse cx="332" cy="306" rx="20" ry="11" fill="{ck}" opacity="0.6"/>')
    fig += ribbon(bowc, body if mono else shade(bowc, 0.72))
    tr = []
    if tilt:
        tr.append(f"rotate({tilt} 256 70)")
    if bounce:
        tr.append("translate(256 470) scale(1.06 0.94) translate(-256 -470)")
    wrap = (lambda s: f'<g transform="{" ".join(tr)}">{s}</g>') if tr else (lambda s: s)
    if mono:
        _UID[0] += 1
        mid = f"yo{_UID[0]}"
        holes = wrap(face(expr, "#000", glints=False, tongue=False, simple=simple, lashes=lashes))
        fig = (f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="-120" y="-120" width="752" height="752">'
               f'<rect x="-120" y="-120" width="752" height="752" fill="#fff"/>{holes}</mask>'
               f'<g mask="url(#{mid})">{wrap(fig)}</g>')
    else:
        fig = wrap(fig + face(expr, INK, simple=simple, lashes=lashes))

    back = ""
    if rings and not small:
        cols = [body] * 3 if mono else RINGS_LIGHT if light else RINGS_DARK
        r0 = 246 if hands else 222
        back += side_arcs(256, 300, [r0, r0 + 40, r0 + 80][:ring_count], cols[:ring_count], 22 + 8 * (3 - ring_count), 26)
    if motion and not small:
        back += "".join(f'<path d="{d}" fill="none" stroke="{accent}" stroke-width="14" stroke-linecap="round"/>'
                        for d in ("M100 214 Q70 290 100 366", "M62 238 Q42 290 62 342", "M28 262 Q16 290 28 318"))
        back += M.sparkle(414, 96, 34, body if mono else BERRY_DEEP if light else PC["rosehip"])
    if bounce and not small:
        if not mono:
            back += f'<ellipse cx="256" cy="500" rx="124" ry="12" fill="{accent}" opacity="0.35"/>'
        back += "".join(f'<path d="{d}" fill="none" stroke="{accent}" stroke-width="12" stroke-linecap="round"/>'
                        for d in ("M112 452 Q84 468 86 494", "M400 452 Q428 468 426 494"))
    return back + fig


# ── lockups ──────────────────────────────────────────────────────────────────


def place(mark, cap, top, bottom, gap, scale=1.12):
    """Scale `mark` to `scale` × (bottom − top) tall, its right edge `gap` left of x=0, centred vertically."""
    x, y, w, h = B.measure(PAGE, mark)
    k = (bottom - top) * scale / h
    tx = -gap - k * (x + w)
    ty = (top + bottom) / 2 - k * (y + h / 2)
    return f'<g transform="translate({n(tx)} {n(ty)}) scale({n(k)})">{mark}</g>'


def lockup(theme, line, hue, ratio, spec):
    """Yo + "Go Go" over "HarmoniYo" (Grandstander Black). "Go Go", the Y and Yo share one colour."""
    mono = theme.startswith("mono")
    base = HUES[hue]
    acc = B.mono_one(theme) if mono else base if theme == "dark" else deep(base)
    text = acc if mono else WHITE if theme == "dark" else INK
    spark = (PC["rosehip"] if hue != "rosehip" else PC["candlelight"]) if theme == "dark" else BERRY_DEEP
    c = {"text": text, "y": acc, "go": acc, "spark": spark} | ({"mono": True} if mono else {})
    F = B.FACE["grand"]
    size = 200
    cap = F.capx(size)
    mark = yo(theme, False, hue, **spec)
    if line:
        g, gw = M.go("grand", size, acc, track=8)
        s, _, _ = M.grand_name(c, gw + 0.28 * size, amp=1.6)
        return place(mark, cap, -cap, 0, 0.30 * size, scale=1.9) + g + s
    s, _, _ = M.grand_name(c, amp=1.6)
    gs = size * ratio
    gap = 0.30 * cap
    g, _ = M.go("grand", gs, acc, x=4, y=-cap - gap, rot=-3, track=8)
    top = -cap - gap - F.capx(gs)
    return place(mark, cap, top, 0, 0.30 * size) + s + g


# ── variants ─────────────────────────────────────────────────────────────────

TAGLINES = ["Yo! Let's ring.", "Grab a bell. Yo's got the tune."]
G_SPEC = dict(expr="wink", rings=True)


def variant(vid, heading, hue, ratio, spec, rationale, note):
    return dict(
        id=vid, heading=heading, name=heading, stacked=True, lockup_has_mark=True, icon_bg=STAGE,
        font="Grandstander", weight="Black 900", rationale=rationale, mascot_note=note, taglines=TAGLINES,
        hue=hue, ratio=ratio, spec=spec,
        wordmark=lambda theme, line=False: lockup(theme, line, hue, ratio, spec),
        mark=lambda theme="dark", small=False: yo(theme, small, hue, **spec),
        mascot=lambda: yo("dark", False, hue, **(spec | {"hands": True, "rings": True})),
    )


REFINE = [
    variant("g1-candlelight-1-25x", "G1: Candlelight, \"Go Go\" 1.25×", "candlelight", 0.75, G_SPEC,
            "\"Go Go\", the Y and Yo all in candlelight (D). \"Go Go\" is 1.25× its size in G (75 % of \"HarmoniYo\").",
            "Yo with felt hands and pitch-colour rings"),
    variant("g2-candlelight-1-5x", "G2: Candlelight, \"Go Go\" 1.5×", "candlelight", 0.9, G_SPEC,
            "\"Go Go\", the Y and Yo all in candlelight (D). \"Go Go\" is 1.5× its size in G (90 % of \"HarmoniYo\").",
            "Yo with felt hands and pitch-colour rings"),
    variant("g3-candlelight-equal", "G3: Candlelight, equal cap height", "candlelight", 1.0, G_SPEC,
            "\"Go Go\" and \"HarmoniYo\" at the same cap height: two equal lines, all three accents in candlelight (D).",
            "Yo with felt hands and pitch-colour rings"),
    variant("g4-ember-1-5x", "G4: Ember, \"Go Go\" 1.5×", "ember", 0.9, G_SPEC,
            "The G2 lockup in ember (G): a warmer, redder Yo, \"Go Go\" and Y.",
            "Ember Yo with felt hands and pitch-colour rings"),
]

YO_VERSIONS = [
    ("y1-wink", "Y1: Wink (at rest, neutral)", dict(expr="wink", rings=True),
     "G's Yo, refined: at rest, one cheeky wink, three pitch-colour rings. Gender-neutral.",
     "Wink, at rest"),
    ("y2-joy", "Y2: Joy (bouncing)", dict(expr="joy", bounce=True, rings=True),
     "Happy closed eyes and an open, laughing mouth, squashed mid-bounce with a shadow: the streak celebration.",
     "Joy, bouncing"),
    ("y3-calm", "Y3: Calm smile (at rest)", dict(expr="calm", rings=False),
     "Eyes softly closed, a gentle smile, no rings: the idle hum. The quietest version.",
     "Calm smile, at rest"),
    ("y4-ding", "Y4: Ding! (ringing, surprised)", dict(expr="ding", tilt=-16, motion=True, rings=False),
     "Mid-ring: tilted forward with motion lines and a sparkle, big round eyes and an \"o\" mouth.",
     "Ding!, ringing"),
    ("y5-cheer", "Y5: Cheer (full mascot)", dict(expr="grin", hands=True, rings=True),
     "The fuller mascot: felt-tipped hands raised, open eyes, a big grin and rings.",
     "Cheer, full mascot with hands"),
    ("y6-ribbon", "Y6: Ribbon (she)", dict(expr="grin", bow=True, rings=False),
     "Women-forward option: a rosehip ribbon tied at the handle like a hair bow, open eyes, a big grin.",
     "Ribbon bow, she/her"),
    ("y7-lashes", "Y7: Cheeky lashes (she)", dict(expr="wink", lashes=True, rings=True),
     "Women-forward option: the wink with eyelashes on both eyes, plus the rings.",
     "Wink with lashes, she/her"),
    ("y8-icon-grade", "Y8: Icon-grade (simple)", dict(expr="grin", simple=True, rings=False),
     "The simplest cut for tiny sizes: flat candlelight, no shading or cheeks, bigger eyes and a thicker smile.",
     "Icon-grade, flat"),
]

YOS = [variant(vid, h, "candlelight", 0.9, spec,
               f"{r} Shown with the G2 lockup (candlelight, \"Go Go\" 1.5×).", note)
       for vid, h, spec, r, note in YO_VERSIONS]

VARIANTS = REFINE + YOS


# ── boards (dark first; light mode is a secondary check) ─────────────────────


def board(d):
    f = d["files"]
    u = lambda k: data_uri(f[k])  # noqa: E731
    head = (f'<h1>{d["heading"]}</h1><div class="sub">{d["rationale"]} Grandstander Black (SIL OFL 1.1), outlined. '
            f'Dark mode is the default; light mode is a secondary check (last row).</div>')
    r1 = (f'<div class="row"><div class="panel stage center" style="flex:1;height:380px"><div class="lbl">Default: on the stage</div>'
          f'{img(u("wordmark-dark"), w=900, style="max-height:300px;object-fit:contain")}</div></div>'
          f'<div class="row"><div class="panel stage center" style="flex:1;height:150px"><div class="lbl">One-line lockup</div>'
          f'{img(u("wordmark-line-dark"), w=900, style="max-height:96px;object-fit:contain;margin-top:14px")}</div></div>')
    r2 = (f'<div class="row"><div class="panel stage center" style="width:300px;height:280px"><div class="lbl">Mark (Yo)</div>'
          f'{img(u("mark-dark"), w=220, h=220)}</div>'
          f'<div class="panel stage center" style="flex:1;height:280px;flex-direction:column"><div class="lbl">One colour, and 96 px minimum width</div>'
          f'<div style="display:flex;gap:22px;align-items:center;padding-top:14px">{img(u("wordmark-mono-white"), w=330)}'
          f'{img(u("mark-mono-white"), w=90, h=90)}{img(u("wordmark-line-mono-white"), w=300)}{img(u("wordmark-line-mono-white"), w=96)}</div></div></div>')
    r3 = f'<div class="row">{B.sizes_row(d)}</div>'
    r4 = (f'<div class="row" style="align-items:stretch">{B.tv_mock(d)}{B.phone_mock(d)}'
          f'<div class="panel stage center" style="flex:1;flex-direction:column"><div class="lbl">Full mascot</div>'
          f'{img(u("mascot"), w=300, style="max-height:330px;object-fit:contain;margin-top:20px")}'
          f'<div style="font-size:13px;color:#c9c3b6;text-align:center;margin-top:8px">{d["mascot_note"]}</div></div></div>')
    r5 = (f'<div class="row">{B.lobby_mock(d)}<div class="panel stage" style="flex:1"><div class="lbl">Taglines</div>'
          f'<div style="padding-top:26px;font-size:24px;line-height:1.7">'
          + "".join(f"<div>&ldquo;{t}&rdquo;</div>" for t in d["taglines"]) + "</div></div></div>")
    r6 = (f'<div class="row"><div class="panel paper center" style="flex:2;height:170px"><div class="lbl">Light mode check</div>'
          f'{img(u("wordmark-light"), w=420, style="max-height:130px;object-fit:contain")}</div>'
          f'<div class="panel paper center" style="flex:2;height:170px">{img(u("wordmark-line-light"), w=440, style="max-height:70px;object-fit:contain")}</div>'
          f'<div class="panel paper center" style="width:170px;height:170px">{img(u("mark-light"), w=120, h=120)}</div>'
          f'<div class="panel paper center" style="width:170px;height:170px">{img(u("mark-mono-ink"), w=120, h=120)}</div></div>')
    return f"<html><head><style>{B.CSS}</style></head><body>{head}{r1}{r2}{r3}{r4}{r5}{r6}<script>{B.PIXEL_JS}</script></body></html>"


def doc(inner, title="Go Go HarmoniYo"):
    x, y, w, h = B.measure(PAGE, inner)
    p = h * 0.04
    return B.svg_doc(inner, f"{n(x - p)} {n(y - p)} {n(w + 2 * p)} {n(h + 2 * p)}", title)


def page_html(title, sub, rows):
    return (f"<html><head><style>{B.CSS}</style></head><body><h1>{title}</h1><div class='sub'>{sub}</div>"
            f"{''.join(rows)}<script>{B.PIXEL_JS}</script></body></html>")


def icon_cell(ic, fv):
    return (f'<div class="panel" style="width:300px;background:#3a3d4c;display:flex;align-items:flex-end;justify-content:center;gap:10px">'
            f'{img(ic, w=96, h=96)}{img(ic, w=48, h=48)}{img(fv, w=32, h=32)}{img(fv, w=16, h=16)}'
            f'<canvas class="px" data-src="{fv}" data-size="16" data-zoom="3"></canvas></div>')


def overview_refine(vs):
    rows = []
    for v in vs:
        f = v["files"]
        rows.append(
            f'<div class="row" style="align-items:stretch"><div class="panel stage" style="width:200px;display:flex;align-items:center">'
            f'<div style="font-size:17px;font-weight:700">{v["heading"]}</div></div>'
            f'<div class="panel stage center" style="flex:1.2;height:190px">{img(data_uri(f["wordmark-dark"]), w=470, style="max-height:160px;object-fit:contain")}</div>'
            f'<div class="panel stage center" style="flex:1;height:190px">{img(data_uri(f["wordmark-line-dark"]), w=470, style="max-height:70px;object-fit:contain")}</div>'
            + icon_cell(data_uri(f["app-icon"]), data_uri(f["favicon"])) + "</div>")
    return page_html("G refinements: one colour for \"Go Go\", the Y and Yo; bigger \"Go Go\"",
                     "Dark mode (default). App icon at 96 and 48 px, favicon at 32 and 16 px and 16 px zoomed. "
                     "Generated by tools/design/brand-options/gvamps.py. Not final art.", rows)


def overview_yo(vs):
    cells = []
    for v in vs:
        f = v["files"]
        ic, fv = data_uri(f["app-icon"]), data_uri(f["favicon"])
        cells.append(
            f'<div class="panel stage" style="width:364px;display:flex;flex-direction:column;align-items:center;gap:10px">'
            f'<div style="font-size:17px;font-weight:700">{v["heading"]}</div>{img(data_uri(f["mark-dark"]), w=180, h=180)}'
            f'<div style="display:flex;gap:10px;align-items:flex-end">{img(ic, w=64, h=64)}{img(ic, w=48, h=48)}'
            f'{img(ic, w=32, h=32)}{img(fv, w=16, h=16)}<canvas class="px" data-src="{ic}" data-size="32" data-zoom="2"></canvas></div>'
            f'<div style="font-size:12px;color:#b9b3a6">64, 48, 32 px app icon; 16 px favicon; 32 px zoomed</div></div>')
    rows = [f'<div class="row">{"".join(cells[:4])}</div>', f'<div class="row">{"".join(cells[4:])}</div>']
    return page_html("Versions of Yo, the bell character", "Dark mode. Each version also has its own board with the G2 lockup. "
                     "Generated by tools/design/brand-options/gvamps.py. Not final art.", rows)


def overview_hues():
    rows = []
    for hue in HUES:
        stacked = doc(lockup("dark", False, hue, 0.9, G_SPEC))
        line = doc(lockup("dark", True, hue, 0.9, G_SPEC))
        d = {"icon_bg": STAGE, "mark": lambda theme="dark", small=False, h=hue: yo(theme, small, h, **G_SPEC)}
        di = {"icon_bg": STAGE, "mark": lambda theme="dark", small=False, h=hue: yo(theme, small, h, **(G_SPEC | {"ring_count": 1}))}
        ic = data_uri(B.svg_doc(B.icon_svg(di, box=B.measure(PAGE, di["mark"]())), "0 0 512 512", "icon"))
        fv = data_uri(B.svg_doc(B.icon_svg(d, small=True, box=B.measure(PAGE, d["mark"]("dark", True))), "0 0 512 512", "favicon"))
        rows.append(
            f'<div class="row" style="align-items:stretch"><div class="panel stage" style="width:200px;display:flex;align-items:center;flex-direction:column;justify-content:center">'
            f'<div style="font-size:20px;font-weight:700">{hue}</div><div style="font-size:14px;color:#b9b3a6">{HUES[hue]}</div></div>'
            f'<div class="panel stage center" style="flex:1.2;height:190px">{img(data_uri(stacked), w=470, style="max-height:160px;object-fit:contain")}</div>'
            f'<div class="panel stage center" style="flex:1;height:190px">{img(data_uri(line), w=470, style="max-height:70px;object-fit:contain")}</div>'
            + icon_cell(ic, fv) + "</div>")
    return page_html("Hue study: the G2 lockup in three palette colours",
                     "\"Go Go\", the Y and Yo always share one colour: candlelight (D), ember (G) or rosehip (F). Dark mode. "
                     "Generated by tools/design/brand-options/gvamps.py.", rows)


def main():
    global PAGE
    B.faces()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        PAGE = browser.new_page()
        vs = B.build_assets(PAGE, VARIANTS, OUT)
        for v in vs:  # app icon: one ring, so Yo stays large at 32-64 px
            d = {"icon_bg": STAGE, "mark": lambda theme="dark", small=False, v=v: yo(theme, small, v["hue"], **(v["spec"] | {"ring_count": 1}))}
            v["files"]["app-icon"] = B.svg_doc(B.icon_svg(d, box=B.measure(PAGE, d["mark"]())), "0 0 512 512", "Go Go HarmoniYo app icon")
            B.write(OUT / v["id"] / "app-icon.svg", v["files"]["app-icon"])
        B.warm_up(PAGE, board(vs[0]))
        for v in vs:
            B.shoot(PAGE, board(v), OUT / v["id"] / "board.png")
            print("board", v["id"])
        B.shoot(PAGE, overview_refine(vs[:len(REFINE)]), OUT / "overview-g-refinements.png")
        B.shoot(PAGE, overview_yo(vs[len(REFINE):]), OUT / "overview-yo-versions.png")
        B.shoot(PAGE, overview_hues(), OUT / "overview-hues.png")
        browser.close()


if __name__ == "__main__":
    main()
