"""The redesign's icons for MFL Live and MFL Manager (2026-09-25): "MFL" in
Barlow Condensed ExtraBold Italic, the cut both wordmarks use. MFL Live is
the white letters on its dark canvas; MFL Manager the dark letters on white,
so the two tell apart in a row of tabs.

  python3 -m venv .venv && .venv/bin/pip install pillow
  .venv/bin/python design/favicon.py            # both apps
  .venv/bin/python design/favicon.py live       # one

The font comes from Google Fonts' own repository on first run and is kept
in design/.fonts (gitignored). Every size is drawn at 8x and scaled down, and
the letters are centred on their ink, not their box, so the italic's lean
does not pull them off centre.

Tab icons (favicon-32, favicon-192, icon-512) are rounded tiles on
transparency; the home-screen icons are full-bleed squares, since iOS
(apple-touch-icon) and Android's mask (icon-maskable-512, MFL Live only)
round them themselves, the maskable one with its letters inside the safe
zone. The manager's repo is expected beside this one (../mfl-manager).
"""
import sys, urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
LIVE_APP = HERE.parent / "app"
MANAGER_APP = HERE.parent.parent / "mfl-manager" / "app"
FONT_URL = "https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-ExtraBoldItalic.ttf"
FONT = HERE / ".fonts" / "BarlowCondensed-ExtraBoldItalic.ttf"

CANVAS, WHITE = (6, 10, 17), (255, 255, 255)   # #060a11, the dark canvas both apps share
APPS = {
    # name: (app dir, ground, ink, write the maskable icon)
    "live": (LIVE_APP, CANVAS, WHITE, True),
    "manager": (MANAGER_APP, WHITE, CANVAS, False),
}
SS = 8   # supersampling


def font_file():
    if not FONT.exists():
        FONT.parent.mkdir(parents=True, exist_ok=True)
        print(f"fetching {FONT_URL}")
        urllib.request.urlretrieve(FONT_URL, FONT)
    return str(FONT)


def draw(size, ground, ink, *, radius, text_w):
    """One icon: a tile (radius as a share of the side; 0 is full-bleed) with
    "MFL" set text_w of the side wide, centred on its ink."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=round(S * radius), fill=ground + (255,))
    # Size the type so the ink spans text_w of the tile.
    probe = ImageFont.truetype(font_file(), 1000)
    x0, y0, x1, y1 = probe.getbbox("MFL")
    f = ImageFont.truetype(font_file(), round(1000 * S * text_w / (x1 - x0)))
    x0, y0, x1, y1 = f.getbbox("MFL")
    d.text(((S - (x1 - x0)) / 2 - x0, (S - (y1 - y0)) / 2 - y0), "MFL", font=f, fill=ink + (255,))
    return img.resize((size, size), Image.LANCZOS)


def write(name):
    app, ground, ink, maskable = APPS[name]
    if not app.exists():
        sys.exit(f"{app} not found")
    out = {
        "favicon-32.png": draw(32, ground, ink, radius=0.22, text_w=0.84),   # a touch wider at 32px, where every pixel counts
        "favicon-192.png": draw(192, ground, ink, radius=0.22, text_w=0.72),
        "icon-512.png": draw(512, ground, ink, radius=0.22, text_w=0.72),
        "apple-touch-icon.png": draw(180, ground, ink, radius=0, text_w=0.70),
    }
    if maskable:
        out["icon-maskable-512.png"] = draw(512, ground, ink, radius=0, text_w=0.56)   # inside the 80% safe circle
    for file, img in out.items():
        img.save(app / file, optimize=True)
        print(f"{app / file}")


if __name__ == "__main__":
    for name in sys.argv[1:] or APPS:
        write(name)
