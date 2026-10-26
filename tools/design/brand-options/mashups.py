#!/usr/bin/env python3
"""Mashups of brand directions 2 (Resonance, Outfit) and 6 (Sing-Along, Grandstander).

    python tools/design/brand-options/mashups.py

Reuses the fonts, drawing primitives and preview boards of build.py (run that first; same
requirements). Writes docs/design/brand-options/mashups/<variant>/ and overview-mashups.png.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

from playwright.sync_api import sync_playwright

import build as B
from build import (BERRY_DEEP, BRASS, BRASS_DEEP, BRASS_INK, FELT, INK, NOTE, PC, SKIN, HAIR, SPRUCE_DEEP, STAGE,
                   WHITE, WOOD, bell, circle, cmap, data_uri, glyph_paths, img, n, outlined, rrect, side_arcs,
                   tuning_fork)

OUT = B.OUT / "mashups"


# ── shared pieces ────────────────────────────────────────────────────────────


def sparkle(x, y, r, fill) -> str:
    k = r * 0.16
    return (f'<path d="M{n(x)} {n(y - r)}Q{n(x + k)} {n(y - k)} {n(x + r)} {n(y)}Q{n(x + k)} {n(y + k)} {n(x)} {n(y + r)}'
            f'Q{n(x - k)} {n(y + k)} {n(x - r)} {n(y)}Q{n(x - k)} {n(y - k)} {n(x)} {n(y - r)}Z" fill="{fill}"/>')


def yo_mark(theme="dark", small=False, *, handle="loop", wink=False, arcs=(), arc_w=22, flat=None, cheeks=None):
    """Yo, the living bell (direction 6), with mashup options:
    handle "loop" or "fork" (a tuning fork, direction 2), resonance arcs either side (direction 2),
    and `flat` = one fill colour with the face knocked out (mono and one-accent versions)."""
    mono = theme.startswith("mono")
    if mono:
        flat = B.mono_one(theme)
    arc_cols = list(arcs)
    if mono or flat:
        arc_cols = [flat] * len(arc_cols)
    s = ""
    if arc_cols:
        radii = [222 + 40 * i for i in range(len(arc_cols))]
        if small:
            radii, arc_cols = radii[:1], arc_cols[:1]
        s += side_arcs(256, 300, radii, arc_cols, arc_w * (1.5 if small else 1), 26)

    def handle_svg(col, wide=0):
        if handle == "fork":
            return tuning_fork(256, 140, 140 + wide, 108 + wide, 30 + wide, col)
        return (f'<path d="M234 124 V86 Q234 58 256 58 Q278 58 278 86 V124" fill="none" stroke="{col}" '
                f'stroke-width="{24 + wide}" stroke-linecap="round"/>')

    if flat:
        uid = f"yo-{theme}-{handle}-{int(wink)}-{flat[1:]}"
        holes = (('<path d="M196 262 Q214 244 232 262" fill="none" stroke="#000" stroke-width="14" stroke-linecap="round"/>'
                  if wink else '<ellipse cx="214" cy="262" rx="20" ry="28" fill="#000"/>')
                 + '<ellipse cx="298" cy="262" rx="20" ry="28" fill="#000"/>'
                 + '<path d="M222 318 Q256 356 290 318" fill="none" stroke="#000" stroke-width="16" stroke-linecap="round"/>')
        s += (f'<mask id="{uid}" maskUnits="userSpaceOnUse" x="0" y="-80" width="512" height="640">'
              f'<rect x="0" y="-80" width="512" height="640" fill="#fff"/>{holes}</mask><g mask="url(#{uid})">')
        s += handle_svg(flat) + bell(256, 120, 360, 330, flat, handle=False, clapper=flat)
        return s + "</g>"
    s += outlined(lambda c: handle_svg(INK, 16) + bell(256, 120, 360, 330, c[0], handle=False, clapper=c[0]), theme, 14)
    s += handle_svg(BRASS_DEEP)
    s += bell(256, 120, 360, 330, BRASS, handle=False, clapper=BRASS_DEEP, bow=BRASS_DEEP)
    s += '<ellipse cx="256" cy="270" rx="110" ry="88" fill="#fff" opacity="0.16"/>'
    if wink:
        s += f'<path d="M194 262 Q214 242 234 262" fill="none" stroke="{INK}" stroke-width="12" stroke-linecap="round"/>'
    else:
        s += f'<ellipse cx="214" cy="262" rx="20" ry="28" fill="{INK}"/>' + circle(220, 252, 7, "#fff")
    s += f'<ellipse cx="298" cy="262" rx="20" ry="28" fill="{INK}"/>' + circle(304, 252, 7, "#fff")
    if not small:
        ck = cheeks or PC["berry"]
        s += f'<ellipse cx="182" cy="306" rx="20" ry="11" fill="{ck}" opacity="0.6"/>'
        s += f'<ellipse cx="330" cy="306" rx="20" ry="11" fill="{ck}" opacity="0.6"/>'
        s += '<path d="M196 160 Q170 210 168 262" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" opacity="0.5"/>'
    s += f'<path d="M222 318 Q256 356 290 318 Z" fill="{INK}" stroke="{INK}" stroke-width="12" stroke-linejoin="round"/>'
    return s


def outfit_name(c, x0=0.0, size=200, face="outfit", y="fork", arcs=True, track=-1):
    """"HarmoniYo" in Outfit; the Y is direction 2's tuning fork (or the plain glyph)."""
    F = B.FACE[face]
    cap, stem = F.capx(size), F.stem(size)
    if y != "fork":
        g, w = F.layout("HarmoniYo", size, x=x0, track=track)
        return "".join(f'<path d="{x["d"]}" fill="{c["y"] if x["ch"] == "Y" else c["text"]}"/>' for x in g), w, cap
    a, wa = F.layout("Harmoni", size, x=x0, track=track)
    W = F.layout("Y", size)[0][0]["box"][2] * 0.80
    spread = stem * (1.0 if arcs else 0.30)
    yadv = W + 2 * spread
    xY = x0 + wa
    cx = xY + yadv / 2
    s = glyph_paths(a, c["text"]) + tuning_fork(cx, 0, cap, W, stem, c["y"])
    if arcs:
        s += side_arcs(cx, -cap * 0.80, [W / 2 + stem * 0.62], [c["a"]], stem * 0.26, 24)
    b, wb = F.layout("o", size, x=xY + yadv - 4)
    return s + glyph_paths(b, c["text"]), xY + yadv - 4 + wb - x0, cap


def grand_name(c, x0=0.0, size=200, amp=1.0, face="grand"):
    """"HarmoniYo" in Grandstander with direction 6's ringing tilt (amp scales it)."""
    F = B.FACE[face]
    g, w = F.layout("HarmoniYo", size, x=x0, track=4)
    cap = F.capx(size)
    s = ""
    for i, x in enumerate(g):
        bx, by, bw, bh = x["box"]
        rot, dy = ((-5, -6) if i % 2 else (4, 4))
        fill = c["y"] if x["ch"] == "Y" else c["text"]
        s += (f'<g transform="translate(0 {n(dy * amp)}) rotate({n(rot * amp)} {n(bx + bw / 2)} {n(by + bh / 2)})">'
              f'<path d="{x["d"]}" fill="{fill}"/></g>')
    yb = next(x for x in g if x["ch"] == "Y")["box"]
    if not c.get("mono") and c.get("spark"):
        s += sparkle(yb[0] + yb[2] * 0.95, yb[1] - cap * 0.12, 26, c["spark"])
    return s, w, cap


def go(text_face, size, colour, x=0.0, y=0.0, rot=0, track=6):
    g, w = B.FACE[text_face].layout("Go Go", size, x=0, track=track)
    return f'<g transform="translate({n(x)} {n(y)}) rotate({rot})">{glyph_paths(g, colour)}</g>', w


def mark_lockup(mark_svg, cap, gap, height=1.6, cy=None):
    """Place a 512-unit Yo mark `height` cap heights tall, left of x=0, centred on y=cy (default: mid cap)."""
    k = cap * height / 420
    cy = -cap / 2 if cy is None else cy
    return f'<g transform="translate({n(-gap - 575 * k)} {n(cy - 285 * k)}) scale({n(k)})">{mark_svg}</g>'


# ── variants ─────────────────────────────────────────────────────────────────

R_DARK = {"text": WHITE, "go": WHITE, "y": PC["spruce"], "a": PC["frost"]}
R_LIGHT = {"text": INK, "go": INK, "y": SPRUCE_DEEP, "a": SPRUCE_DEEP}


# A. Resonance wordmark + Sing-Along mark
def a_wordmark(theme, line=False):
    c = cmap(theme, R_DARK, R_LIGHT)
    g, gw = go("outfit-lt", 200, c["go"], track=0)
    s, w, cap = outfit_name(c, gw + 52)
    return g + s


def a_mark(theme="dark", small=False):
    return yo_mark(theme, small)


# B. Sing-Along wordmark + Resonance mark
def b_wordmark(theme, line=False):
    return B.d6_wordmark(theme, line)


def b_mark(theme="dark", small=False):
    return B.d2_mark(theme, small)


# C. Grandstander "Go Go" over Outfit "HarmoniYo"; Yo with resonance rings
def c_cols(theme):
    return cmap(theme, R_DARK | {"go": PC["candlelight"]}, R_LIGHT | {"go": WOOD})


def c_wordmark(theme, line=False):
    c = c_cols(theme)
    if line:
        g, gw = go("grand", 190, c["go"], rot=-3)
        s, w, cap = outfit_name(c, gw + 52)
        return g + s
    s, w, cap = outfit_name(c)
    g, _ = go("grand-md", 108, c["go"], x=6, y=-cap * 1.40, rot=-4)
    return s + g


def c_mark(theme="dark", small=False):
    arcs = (PC["frost"], PC["spruce"]) if theme == "dark" else (SPRUCE_DEEP, SPRUCE_DEEP)
    return yo_mark(theme, small, arcs=arcs)


# D. Outfit "Go Go" over Grandstander "HarmoniYo"; a tuning fork with Yo's spark
def d_cols(theme):
    return cmap(theme, {"text": WHITE, "go": WHITE, "y": PC["candlelight"], "spark": PC["frost"]},
                {"text": INK, "go": INK, "y": BRASS_INK, "spark": SPRUCE_DEEP})


def d_wordmark(theme, line=False):
    c = d_cols(theme)
    if line:
        g, gw = go("outfit-lt", 200, c["go"], track=0)
        s, w, cap = grand_name(c, gw + 56)
        return g + s
    s, w, cap = grand_name(c)
    g, _ = go("outfit-lt", 104, c["go"], x=8, y=-cap * 1.36, track=14)
    return s + g


def d_mark(theme="dark", small=False):
    mono = theme.startswith("mono")
    fork = B.mono_one(theme) if mono else BRASS_INK if theme == "light" else PC["candlelight"]
    spark = fork if mono else SPRUCE_DEEP if theme == "light" else PC["frost"]
    s = f'<g transform="rotate(-10 256 300)">{tuning_fork(256, 450, 370, 186, 58, fork)}</g>'
    s += sparkle(392, 92, 44 if not small else 56, spark)
    if not small:
        s += sparkle(120, 150, 22, spark)
    return s


# E. Yo resonates (palette-led): mark-led lockup, Outfit one line, Y in candlelight
E_ARCS_DARK = (PC["candlelight"], PC["pear"], PC["holly"])  # D, A, E: neighbours on the circle of fifths
E_ARCS_LIGHT = (BRASS_INK, SPRUCE_DEEP, BERRY_DEEP)


def e_mark(theme="dark", small=False):
    return yo_mark(theme, small, arcs=E_ARCS_DARK if theme != "light" else E_ARCS_LIGHT, arc_w=20)


def e_wordmark(theme, line=False):
    c = cmap(theme, {"text": WHITE, "go": WHITE, "y": PC["candlelight"]}, {"text": INK, "go": INK, "y": BRASS_INK})
    g, gw = go("outfit-lt", 200, c["go"], track=0)
    s, w, cap = outfit_name(c, gw + 52, y="glyph")
    return mark_lockup(e_mark(theme), cap, 70) + g + s


# F. Quiet Brass (calm, mono + one accent)
def f_wordmark(theme, line=False):
    c = cmap(theme, {"text": WHITE, "go": WHITE, "y": PC["candlelight"], "a": PC["candlelight"]},
             {"text": INK, "go": INK, "y": BRASS_INK, "a": BRASS_INK})
    g, gw = go("outfit-lt", 200, c["go"], track=0)
    s, w, cap = outfit_name(c, gw + 52, face="outfit-sb", arcs=False)
    return g + s


def f_mark(theme="dark", small=False):
    flat = None if theme.startswith("mono") else BRASS_INK if theme == "light" else PC["candlelight"]
    return yo_mark(theme, small, flat=flat)


# G. Ring-along (playful, kid-forward): big bounce, winking Yo with pitch-colour rings
G_ARCS = (PC["rosehip"], PC["candlelight"], PC["holly"])


def g_cols(theme):
    return cmap(theme, {"text": WHITE, "go": PC["ember"], "y": PC["candlelight"], "spark": PC["rosehip"]},
                {"text": INK, "go": WOOD, "y": BRASS_INK, "spark": BERRY_DEEP})


def g_mark(theme="dark", small=False):
    arcs = G_ARCS if theme != "light" else (BERRY_DEEP, BRASS_INK, SPRUCE_DEEP)
    return yo_mark(theme, small, wink=True, arcs=arcs, arc_w=24, cheeks=PC["rosehip"])


def g_wordmark(theme, line=False):
    c = g_cols(theme)
    if line:
        g, gw = go("grand", 190, c["go"], rot=-4)
        s, w, cap = grand_name(c, gw + 50, amp=1.6)
        return mark_lockup(g_mark(theme), cap, 60) + g + s
    s, w, cap = grand_name(c, amp=1.6)
    g, _ = go("grand", 120, c["go"], x=8, y=-cap * 1.46, rot=-6, track=10)
    return mark_lockup(g_mark(theme), cap, 60, height=2.9, cy=-cap * 1.2) + s + g


# H. Fork-handle Yo: Yo's handle is a tuning fork; Outfit one line with a candlelight fork Y
def h_cols(theme):
    return cmap(theme, {"text": WHITE, "go": WHITE, "y": PC["candlelight"], "a": PC["frost"]},
                {"text": INK, "go": INK, "y": BRASS_INK, "a": SPRUCE_DEEP})


def h_wordmark(theme, line=False):
    c = h_cols(theme)
    if line:
        g, gw = go("outfit-lt", 200, c["go"], track=0)
        s, w, cap = outfit_name(c, gw + 52)
        return g + s
    s, w, cap = outfit_name(c)
    g, _ = go("outfit-lt", 100, c["go"], x=6, y=-cap * 1.34, track=12)
    return s + g


def h_mark(theme="dark", small=False):
    arcs = (PC["frost"],) if theme == "dark" else (SPRUCE_DEEP,)
    return yo_mark(theme, small, handle="fork", arcs=arcs, arc_w=24)


def captain2(uid):
    return lambda: B.captain(0, 0, 1.0, skin=SKIN[1], hair=HAIR[1], style="bob", top=PC["frost"], uid=uid)


def yo6(uid, **kw):
    return lambda: B.living_bell(10, 10, 1.0, handle="curl", wink=True, cheeks=PC["rosehip"],
                                 arcs=kw.get("arcs", ("rosehip", "candlelight")), uid=uid)


MASHUPS = [
    dict(id="a-calm-type-friendly-icon", name="Calm type, friendly icon", parents="2 wordmark + 6 mark",
         font="Outfit", weight="Regular 400 / Bold 700", wordmark=a_wordmark, mark=a_mark,
         rationale="Resonance's one-line Outfit wordmark for every surface that must look professional, with Yo's face as the app icon so the brand still smiles on the home screen.",
         taglines=["Learn to ring, together.", "Yo! Let's ring."], tone="calm", mascot=yo6("ma"),
         mascot_note="Living bell (option 2) from Sing-Along"),
    dict(id="b-bouncy-type-fork-icon", name="Bouncy type, fork icon", parents="6 wordmark + 2 mark", stacked=True,
         font="Grandstander", weight="Black 900 / ExtraBold 800", wordmark=b_wordmark, mark=b_mark,
         rationale="The reverse: Sing-Along's hand-lettered energy in the title, with Resonance's crisp tuning fork as an icon that stays sharp at 16 px.",
         taglines=["Ring along with Yo.", "Real notes. Real bells. One team."], tone="playful", mascot=captain2("mb"),
         mascot_note="Bell captain (option 1, she/her) from Resonance"),
    dict(id="c-go-go-bounce", name="Go Go Bounce", parents="6 Go Go over 2 HarmoniYo; Yo + 2's rings", stacked=True,
         font="Grandstander + Outfit", weight="Grandstander ExtraBold 800 / Outfit Bold 700", wordmark=c_wordmark, mark=c_mark,
         rationale="\"Go Go\" bounces in Grandstander candlelight over a steady Outfit \"HarmoniYo\" with the tuning-fork Y: playful call, professional name. The icon puts Resonance's rings around Yo.",
         taglines=["Go go, ring together!", "Every ring counts."], tone="balanced", mascot=yo6("mc", arcs=("frost", "spruce")),
         mascot_note="Living bell Yo with Resonance's frost and spruce rings"),
    dict(id="d-steady-go", name="Steady Go", parents="2 Go Go over 6 HarmoniYo; fork + 6's sparkle", stacked=True,
         font="Outfit + Grandstander", weight="Outfit Regular 400 / Grandstander Black 900", wordmark=d_wordmark, mark=d_mark,
         rationale="The reverse pairing: a quiet, tracked Outfit \"Go Go\" over a ringing Grandstander \"HarmoniYo\". The mark is Resonance's fork in candlelight with Sing-Along's sparkle.",
         taglines=["Ring in harmony.", "Yo! Let's ring."], tone="balanced", mascot=captain2("md"),
         mascot_note="Bell captain (option 1, she/her)"),
    dict(id="e-yo-resonates", name="Yo Resonates", parents="6 character + 2 rings, palette-led", lockup_has_mark=True,
         font="Outfit", weight="Regular 400 / Bold 700", wordmark=e_wordmark, mark=e_mark,
         rationale="Palette-led: Yo rings and the sound leaves in three pitch colours that are neighbours on the circle of fifths (D, A, E). One-line Outfit name, Y in candlelight (D). Character in front, calm type behind.",
         taglines=["Every note has a colour.", "Ring together."], tone="balanced", mascot=yo6("me", arcs=("candlelight", "pear")),
         mascot_note="Living bell Yo; the rings take the colour of the pitch being rung"),
    dict(id="f-quiet-brass", name="Quiet Brass", parents="2 type, 6 silhouette; mono + one accent",
         font="Outfit", weight="Regular 400 / SemiBold 600", wordmark=f_wordmark, mark=f_mark,
         rationale="The calmest, most professional take: warm white Outfit with a single candlelight accent (the fork Y), and Yo reduced to a one-colour brass silhouette. Reads like a premium app.",
         taglines=["Real bells. Real harmony.", "Learn to ring, together."], tone="calm", mascot=captain2("mf"),
         mascot_note="Bell captain (option 1, she/her)"),
    dict(id="g-ring-along-kids", name="Ring-Along (kids)", parents="6 amplified + 2 rings in pitch colours", stacked=True,
         lockup_has_mark=True, font="Grandstander", weight="Black 900", wordmark=g_wordmark, mark=g_mark,
         rationale="The most playful, kid-forward take: bigger bounce, ember \"Go Go\", and a winking Yo with three pitch-colour rings locked up with the name. For a kids' or classroom edition.",
         taglines=["Yo! Let's ring.", "Grab a bell. Yo's got the tune."], tone="playful", mascot=yo6("mg", arcs=("rosehip", "holly")),
         mascot_note="Living bell Yo, mid-wink"),
    dict(id="h-fork-handle-yo", name="Fork-handle Yo", parents="6 character with 2's fork as its handle", stacked=True,
         font="Outfit", weight="Regular 400 / Bold 700", wordmark=h_wordmark, mark=h_mark,
         rationale="A true hybrid mark: Yo's handle is the tuning fork, and one frost ring each side. The Outfit wordmark repeats the fork as a candlelight Y, so the name and the character share one shape.",
         taglines=["Ring together.", "Real notes. Real bells. One team."], tone="balanced", mascot=yo6("mh"),
         mascot_note="Living bell Yo (the full mascot keeps its curl handle; the fork handle is for the mark)"),
]

for i, m in enumerate(MASHUPS):
    m["icon_bg"] = STAGE
    m["heading"] = f"Mashup {m['id'][0].upper()}: {m['name']} ({m['parents']})"


def overview_html(ms):
    rows = []
    for m in ms:
        f = m["files"]
        fv = data_uri(f["favicon"])
        rows.append(
            f'<div class="row" style="align-items:stretch">'
            f'<div class="panel stage" style="width:210px;display:flex;flex-direction:column;justify-content:center">'
            f'<div style="font-size:30px;font-weight:800">{m["id"][0].upper()}</div><div style="font-size:16px;font-weight:700">{m["name"]}</div>'
            f'<div style="font-size:12px;color:#b9b3a6">{m["parents"]}</div></div>'
            f'<div class="panel stage center" style="flex:1;height:150px">{img(data_uri(f["wordmark-dark"]), w=470, style="max-height:118px;object-fit:contain")}</div>'
            f'<div class="panel paper center" style="flex:1;height:150px">{img(data_uri(f["wordmark-light"]), w=470, style="max-height:118px;object-fit:contain")}</div>'
            f'<div class="panel" style="width:250px;background:#3a3d4c;display:flex;align-items:flex-end;justify-content:center;gap:10px">'
            f'{img(data_uri(f["app-icon"]), w=96, h=96)}{img(fv, w=32, h=32)}{img(fv, w=16, h=16)}'
            f'<canvas class="px" data-src="{fv}" data-size="16" data-zoom="3"></canvas></div></div>')
    return (f"<html><head><style>{B.CSS}</style></head><body><h1>Mashups of 2 Resonance and 6 Sing-Along</h1>"
            f"<div class='sub'>Wordmark on the stage and on paper; app icon at 96 px, favicon at 32 and 16 px and 16 px zoomed. "
            f"Generated by tools/design/brand-options/mashups.py. Not final art.</div>{''.join(rows)}<script>{B.PIXEL_JS}</script></body></html>")


def main():
    B.faces()
    B.FACE["outfit-sb"] = B.Face("outfit/Outfit[wght].ttf", 600)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        ms = B.build_assets(page, MASHUPS, OUT)
        B.warm_up(page, B.board_html(ms[0]))
        for m in ms:
            B.shoot(page, B.board_html(m), OUT / m["id"] / "board.png")
            print("board", m["id"])
        B.shoot(page, overview_html(ms), OUT / "overview-mashups.png")
        browser.close()


if __name__ == "__main__":
    main()
