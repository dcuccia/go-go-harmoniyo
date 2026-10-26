#!/usr/bin/env python3
"""Build the chosen Go Go HarmoniYo identity (owner decision 2026-10-25) into docs/design/brand/.

    python tools/design/brand/build.py

Chosen: lockup G2 (Grandstander Black; "Go Go" at 90 % of "HarmoniYo"; "Go Go", the Y and Yo share
candlelight #f3b01d) with Yo version Y1 (wink) as the mark and app icon. Recommended defaults the
owner can change: favicon Y8 (icon-grade), in-game states Y3 idle, Y4 ring, Y2/Y5 cheer.
Reuses tools/design/brand-options (same requirements.txt). Output is deterministic.
"""
from __future__ import annotations

import base64
import struct
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "brand-options"))

from playwright.sync_api import sync_playwright  # noqa: E402

import build as B  # noqa: E402
import gvamps as G  # noqa: E402
from build import BRASS, STAGE, WHITE, n  # noqa: E402

OUT = B.ROOT / "docs" / "design" / "brand"
HUE = "candlelight"
RATIO = 0.9  # "Go Go" cap height / "HarmoniYo" cap height (G2)
WINK = dict(expr="wink", rings=True)  # Y1
STATES = {  # file -> (Yo version, spec)
    "yo-wink": ("Y1 wink: the mark", WINK),
    "yo-idle": ("Y3 calm smile: idle hum", dict(expr="calm", rings=False)),
    "yo-ring": ("Y4 ding!: ringing", dict(expr="ding", tilt=-16, motion=True, rings=False)),
    "yo-cheer": ("Y2 joy: cheer, bouncing", dict(expr="joy", bounce=True, rings=True)),
    "yo-cheer-hands": ("Y5 cheer: full mascot with hands", dict(expr="grin", hands=True, rings=True)),
    "yo-icon": ("Y8 icon-grade: tiny sizes", dict(expr="grin", simple=True, rings=False)),
}
TAGLINE = "Yo! Let's ring."
PAGE = None


def mark(theme="dark", rings=3):
    return G.yo(theme, False, HUE, **(WINK | {"ring_count": rings}))


def fit(inner, box, frac):
    """Scale and centre `inner` in a 512 box so its larger side is `frac` of 512."""
    x, y, w, h = box
    k = 512 * frac / max(w, h)
    return f'<g transform="translate({n(256 - k * (x + w / 2))} {n(256 - k * (y + h / 2))}) scale({n(k)})">{inner}</g>'


GLOW = (f'<defs><radialGradient id="glow" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="{BRASS}" '
        f'stop-opacity="0.28"/><stop offset="1" stop-color="{BRASS}" stop-opacity="0"/></radialGradient></defs>')


def tile(inner, rounded=True, glow=True, frac=0.66):
    rx = ' rx="112"' if rounded else ""
    return (GLOW + f'<rect width="512" height="512"{rx} fill="{STAGE}"/>'
            + (f'<rect width="512" height="512"{rx} fill="url(#glow)"/>' if glow else "")
            + fit(inner, B.measure(PAGE, inner), frac))


def tight(inner, title, pad=0.04):
    x, y, w, h = B.measure(PAGE, inner)
    p = h * pad
    return B.svg_doc(inner, f"{n(x - p)} {n(y - p)} {n(w + 2 * p)} {n(h + 2 * p)}", title)


def square(inner, title):
    x, y, w, h = B.measure(PAGE, inner)
    s = max(w, h) * 1.06
    return B.svg_doc(inner, f"{n(x + w / 2 - s / 2)} {n(y + h / 2 - s / 2)} {n(s)} {n(s)}", title)


def og_image():
    """1200 x 630 social card: G2 lockup and tagline on the stage."""
    logo = G.lockup("dark", False, HUE, RATIO, WINK)
    x, y, w, h = B.measure(PAGE, logo)
    k = 860 / w
    tg, tw = B.FACE["grand-md"].layout(TAGLINE, 56)
    body = (f'<defs><radialGradient id="og" cx="0.5" cy="0.45" r="0.7"><stop offset="0" stop-color="#2a2117"/>'
            f'<stop offset="0.62" stop-color="{STAGE}"/></radialGradient></defs>'
            f'<rect width="1200" height="630" fill="{STAGE}"/><rect width="1200" height="630" fill="url(#og)"/>'
            f'<g transform="translate({n(600 - k * (x + w / 2))} {n(270 - k * (y + h / 2))}) scale({n(k)})">{logo}</g>'
            f'<g transform="translate({n(600 - tw / 2)} 545)">{B.glyph_paths(tg, WHITE)}</g>')
    return B.svg_doc(body, "0 0 1200 630", "Go Go HarmoniYo: Yo! Let's ring.", 1200, 630)


def png(svg, w, h, path=None):
    uri = "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()
    PAGE.set_viewport_size({"width": w, "height": h})
    PAGE.set_content(f'<html><body style="margin:0;background:transparent"><img id="i" src="{uri}" '
                     f'width="{w}" height="{h}" style="display:block"></body></html>')
    PAGE.evaluate("document.getElementById('i').decode()")
    data = PAGE.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": w, "height": h})
    if path:
        path.write_bytes(data)
    return data


def ico(pngs: dict[int, bytes]) -> bytes:
    """A .ico holding PNG images (supported by every current browser and Windows Vista+)."""
    head = struct.pack("<HHH", 0, 1, len(pngs))
    entries, blobs, off = b"", b"", 6 + 16 * len(pngs)
    for size, data in sorted(pngs.items()):
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), off)
        blobs += data
        off += len(data)
    return head + entries + blobs


def preview(files):
    u = lambda k: B.data_uri(files[k])  # noqa: E731
    img = B.img
    yo = "".join(f'<div class="tile">{img(u("yo/" + k + ".svg"), w=150, h=150)}<span>{v[0]}</span></div>' for k, v in STATES.items())
    sizes = "".join(f'<div class="tile">{img(u("app-icon.svg"), w=s, h=s)}<span>{s} px</span></div>' for s in (180, 96, 64, 48, 32))
    sizes += "".join(f'<div class="tile">{img(u("favicon.svg"), w=s, h=s)}<span>favicon {s}</span></div>' for s in (32, 16))
    sizes += (f'<div class="tile">{img(u("app-icon-maskable.svg"), w=96, h=96, style="border-radius:50%")}'
              f'<span>maskable (circle crop)</span></div>')
    rows = [
        f'<div class="row"><div class="panel stage center" style="flex:1;height:360px"><div class="lbl">Primary: stacked lockup (dark, default)</div>{img(u("logo-stacked-dark.svg"), w=760)}</div></div>',
        f'<div class="row"><div class="panel stage center" style="flex:1;height:140px"><div class="lbl">One-line lockup</div>{img(u("logo-line-dark.svg"), w=760, style="margin-top:14px")}</div></div>',
        f'<div class="row"><div class="panel stage center" style="flex:1;height:200px;gap:40px"><div class="lbl">One colour</div>{img(u("logo-stacked-mono-white.svg"), w=330)}{img(u("logo-line-mono-white.svg"), w=420)}{img(u("mark-mono-white.svg"), w=110, h=110)}</div>'
        f'<div class="panel paper center" style="width:470px;height:200px;gap:30px"><div class="lbl">Light (secondary)</div>{img(u("logo-stacked-light.svg"), w=300)}{img(u("mark-light.svg"), w=110, h=110)}</div></div>',
        f'<div class="row"><div class="panel" style="flex:1;background:#3a3d4c"><div class="lbl">App icon (Y1), favicon (Y8), maskable</div><div style="display:flex;align-items:flex-end;gap:22px;padding-top:26px">{sizes}</div></div></div>',
        f'<div class="row"><div class="panel stage" style="flex:1"><div class="lbl">Yo states</div><div style="display:flex;justify-content:space-around;padding-top:26px">{yo}</div></div></div>',
        f'<div class="row"><div class="panel" style="flex:1;background:#3a3d4c"><div class="lbl">Social card 1200 x 630</div><div class="center" style="padding-top:24px">{img(u("og-image.svg"), w=760, h=399)}</div></div></div>',
    ]
    return (f"<html><head><style>{B.CSS}</style></head><body><h1>Go Go HarmoniYo: brand assets</h1>"
            f"<div class='sub'>Chosen by the owner on 2026-10-25: lockup G2 (candlelight, \"Go Go\" 1.5×) and Yo Y1 (wink). "
            f"Generated by tools/design/brand/build.py.</div>{''.join(rows)}<script>{B.PIXEL_JS}</script></body></html>")


def main():
    global PAGE
    B.faces()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        PAGE = G.PAGE = browser.new_page()
        f = {}
        for theme in ("dark", "light", "mono-white", "mono-ink"):
            f[f"logo-stacked-{theme}.svg"] = tight(G.lockup(theme, False, HUE, RATIO, WINK), "Go Go HarmoniYo")
            f[f"logo-line-{theme}.svg"] = tight(G.lockup(theme, True, HUE, RATIO, WINK), "Go Go HarmoniYo")
            f[f"mark-{theme}.svg"] = square(mark(theme), "Go Go HarmoniYo: Yo")
        f["app-icon.svg"] = B.svg_doc(tile(mark(rings=1)), "0 0 512 512", "Go Go HarmoniYo app icon")
        # Maskable: full bleed; the mark stays inside the central 80 % safe circle.
        f["app-icon-maskable.svg"] = B.svg_doc(tile(mark(rings=1), rounded=False, frac=0.54), "0 0 512 512",
                                               "Go Go HarmoniYo app icon (maskable)")
        f["apple-touch-icon.svg"] = B.svg_doc(tile(mark(rings=1), rounded=False), "0 0 512 512", "Go Go HarmoniYo app icon")
        f["favicon.svg"] = B.svg_doc(tile(G.yo("dark", True, HUE, **STATES["yo-icon"][1]), glow=False, frac=0.74),
                                     "0 0 512 512", "Go Go HarmoniYo")
        f["og-image.svg"] = og_image()
        for k, (title, spec) in STATES.items():
            f[f"yo/{k}.svg"] = square(G.yo("dark", False, HUE, **spec), f"HarmoniYo (Yo): {title}")
        for k, v in f.items():
            B.write(OUT / k, v)

        B.warm_up(PAGE, preview(f))
        png(f["app-icon.svg"], 512, 512)  # warm the image path as well
        for s in (192, 512):
            png(f["app-icon.svg"], s, s, OUT / f"icon-{s}.png")
            png(f["app-icon-maskable.svg"], s, s, OUT / f"icon-maskable-{s}.png")
        png(f["apple-touch-icon.svg"], 180, 180, OUT / "apple-touch-icon.png")
        png(f["og-image.svg"], 1200, 630, OUT / "og-image.png")
        (OUT / "favicon.ico").write_bytes(ico({s: png(f["favicon.svg"], s, s) for s in (16, 32, 48)}))
        B.shoot(PAGE, preview(f), OUT / "preview.png")
        browser.close()
    print("wrote", OUT)


if __name__ == "__main__":
    main()
