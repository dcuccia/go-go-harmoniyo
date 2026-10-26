# Go Go HarmoniYo brand assets

These are the production files for the identity the owner chose on 2026-10-25: lockup G2 with Yo
Y1 (wink) in candlelight, dark mode first. The rules (colours, type, clear space, minimum sizes,
do and don't) are in the [brand guide §3](../brand.md#3-logo-and-visual-identity).

![Brand asset sheet](preview.png)

| File | What | Notes |
|---|---|---|
| `logo-stacked-{dark,light,mono-white,mono-ink}.svg` | Primary lockup | Dark is the default |
| `logo-line-{dark,light,mono-white,mono-ink}.svg` | One-line lockup | For headers |
| `mark-{dark,light,mono-white,mono-ink}.svg` | Yo (Y1 wink) with three sound rings | |
| `app-icon.svg` | Rounded tile, Y1 with one ring | Source for `icon-192.png` and `icon-512.png` (PWA `purpose: any`) |
| `app-icon-maskable.svg` | Full bleed, mark inside the 80 % safe circle | Source for `icon-maskable-{192,512}.png` (PWA `purpose: maskable`) |
| `apple-touch-icon.svg` | Full bleed, square | Source for `apple-touch-icon.png` (180); iOS rounds the corners itself |
| `favicon.svg`, `favicon.ico` | Y8 icon-grade on a rounded tile | The `.ico` holds 16, 32 and 48 px PNGs |
| `og-image.svg`, `og-image.png` | 1200 × 630 social card | Tagline "Yo! Let's ring." |
| `yo/yo-wink.svg` | Y1: the mark | |
| `yo/yo-idle.svg` | Y3 calm smile: idle hum | Default, owner may change |
| `yo/yo-ring.svg` | Y4 ding!: ringing | Default, owner may change |
| `yo/yo-cheer.svg` | Y2 joy, bouncing: cheer | Default, owner may change |
| `yo/yo-cheer-hands.svg` | Y5 full mascot with hands: big cheer | Default, owner may change |
| `yo/yo-icon.svg` | Y8 icon-grade: tiny sizes | The favicon's Yo |
| `preview.png` | Sheet of everything above | |

Every file is generated, so don't edit them by hand:

```powershell
python -m pip install -r tools/design/brand-options/requirements.txt
python -m playwright install chromium
python tools/design/brand/build.py
```

The output is deterministic.

## Where the game uses them

The prototype ([I2](../../../spikes/i2-web-phones/README.md#branding) on the TV,
[S1](../../../spikes/s1-phone-bell/README.md) on the phones) uses these files directly. Nothing is
copied into the repo: the I2 build copies what it needs into its gitignored `public/brand/`, and
the S1 host serves this folder at `/brand/`.

| Where | File |
|---|---|
| TV lobby header | `logo-stacked-dark.svg` |
| TV lobby, next to *Scan to join* | `yo/yo-idle.svg` (Y3) |
| TV lobby, a phone's row when it rings | `yo/yo-ring.svg` (Y4) |
| TV corner join card (with *Join Go Go HarmoniYo*) | `mark-dark.svg` |
| TV results | `yo/yo-cheer-hands.svg` (Y5) from 80 % team accuracy, else `yo/yo-cheer.svg` (Y2) |
| Phone start screen, host dashboard | `logo-line-dark.svg` |
| Phone play view (with the name) | `yo/yo-idle.svg`, `yo/yo-ring.svg` for a moment on each ring |
| Tabs, home screen, installed app | `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-*.png`; `theme-color` `#0b0d17` |
| Repository README | `logo-stacked-dark.svg`, `logo-stacked-light.svg` (light theme) |

**Licence:** CC BY 4.0, "© 2026 David Cuccia and Go Go HarmoniYo contributors". The asset register
lists them as `brand-identity` (owner-approved) and `brand-yo-defaults` (recommended defaults). The
lettering is outlined from Grandstander (SIL OFL 1.1). Logos made with an OFL font aren't covered
by the OFL ([OFL-FAQ](https://openfontlicense.org/ofl-faq/) 1.1).
