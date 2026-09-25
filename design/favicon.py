"""The redesign's icons for MFL Live and MFL Manager (2026-09-25): "MFL" in
Barlow Condensed ExtraBold Italic, the cut both wordmarks use, with the
app's word under it in its wordmark's accent (LIVE in the live red,
MANAGER in the manager's mint, its deeper light-theme cut so it reads on
white). MFL Live is white letters on its dark canvas; MFL Manager dark
letters on white, so the two tell apart in a row of tabs.

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
    # name: (app dir, ground, ink, the word under MFL, its colour, write the maskable icon)
    "live": (LIVE_APP, CANVAS, WHITE, "LIVE", (255, 77, 77), True),        # the header's live red
    "manager": (MANAGER_APP, WHITE, CANVAS, "MANAGER", (11, 127, 107), False),   # --accent-text, light theme
}
SUB = 0.42   # the word's cap height against MFL's
SS = 8   # supersampling


def font_file():
    if not FONT.exists():
        FONT.parent.mkdir(parents=True, exist_ok=True)
        print(f"fetching {FONT_URL}")
        urllib.request.urlretrieve(FONT_URL, FONT)
    return str(FONT)


def draw(size, ground, ink, word, accent, *, radius, text_w, sub=None, word_w=None):
    """One icon: a tile (radius as a share of the side; 0 is full-bleed) with
    "MFL" set text_w of the side wide and the word under it at sub (SUB) of
    its height, never wider than word_w of the side (MFL's own width by
    default), the pair centred on their ink."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=round(S * radius), fill=ground + (255,))
    path = font_file()
    probe = ImageFont.truetype(path, 1000)
    px0, py0, px1, py1 = probe.getbbox("MFL")
    big = ImageFont.truetype(path, round(1000 * S * text_w / (px1 - px0)))
    bx0, by0, bx1, by1 = big.getbbox("MFL")
    bw, bh = bx1 - bx0, by1 - by0
    small = ImageFont.truetype(path, max(1, round(big.size * (sub or SUB))))
    limit = S * word_w if word_w else bw
    sx0, sy0, sx1, sy1 = small.getbbox(word)
    if sx1 - sx0 > limit:   # a long word (MANAGER) is held to the limit
        small = ImageFont.truetype(path, max(1, round(small.size * limit / (sx1 - sx0))))
        sx0, sy0, sx1, sy1 = small.getbbox(word)
    sw, sh = sx1 - sx0, sy1 - sy0
    gap = bh * 0.16
    top = (S - (bh + gap + sh)) / 2
    d.text(((S - bw) / 2 - bx0, top - by0), "MFL", font=big, fill=ink + (255,))
    d.text(((S - sw) / 2 - sx0, top + bh + gap - sy0), word, font=small, fill=accent + (255,))
    return img.resize((size, size), Image.LANCZOS)


def write(name):
    app, ground, ink, word, accent, maskable = APPS[name]
    if not app.exists():
        sys.exit(f"{app} not found")
    out = {
        # At 32px the word needs the room: MFL a touch smaller, the word taller and allowed nearly the tile's width.
        "favicon-32.png": draw(32, ground, ink, word, accent, radius=0.22, text_w=0.70, sub=0.62, word_w=0.90),
        "favicon-192.png": draw(192, ground, ink, word, accent, radius=0.22, text_w=0.72),
        "icon-512.png": draw(512, ground, ink, word, accent, radius=0.22, text_w=0.72),
        "apple-touch-icon.png": draw(180, ground, ink, word, accent, radius=0, text_w=0.70),
    }
    if maskable:
        out["icon-maskable-512.png"] = draw(512, ground, ink, word, accent, radius=0, text_w=0.56)   # inside the 80% safe circle
    for file, img in out.items():
        img.save(app / file, optimize=True)
        print(f"{app / file}")


if __name__ == "__main__":
    for name in sys.argv[1:] or APPS:
        write(name)
