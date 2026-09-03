# Cuts the league mark out of design/mfllive-logo.jpeg and writes the files
# app/ serves. Needs Pillow and numpy:
#   python3 -m venv .venv && .venv/bin/pip install pillow numpy
#   .venv/bin/python design/cutout.py
#
# Two cuts of the same art:
#   - transparent: every white area is cleared except the laces, so the
#     hands and ball float on the page (the header mark, logo.png);
#   - disc: only the outside is cleared and the ring's interior stays
#     white, a badge that reads the same on dark and light (the icons).
import sys, numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from numpy.lib.stride_tricks import sliding_window_view

ROOT = Path(__file__).resolve().parent.parent
SRC, APP, DESIGN = ROOT / "design/mfllive-logo.jpeg", ROOT / "app", ROOT / "design"

im = Image.open(SRC).convert("RGB"); w, h = im.size
a = np.asarray(im).astype(np.int16)

# The source draws the ball in the page's mint; the mark uses leather. The
# ball is the only green in the art, so each pixel is scored by how far it
# leans green over red and blended toward LEATHER, keeping its own shading.
# Strokes, laces, hands and ring score zero; the ball's anti-aliased edge
# blends partially, so the outline stays clean.
LEATHER = (176, 96, 48)
f = a.astype(np.float64); r, g, b = f[..., 0], f[..., 1], f[..., 2]
mintness = np.clip((g - r - 20) / 60, 0, 1) * np.clip((g - b + 30) / 50, 0, 1)
lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255
leather = np.stack([lum * (LEATHER[i] / 255) / 0.75 for i in range(3)], axis=-1) * 255   # mint's lum is ~0.75
a = (f * (1 - mintness[..., None]) + np.clip(leather, 0, 255) * mintness[..., None]).round().astype(np.int16)
im = Image.fromarray(a.astype(np.uint8), "RGB")
rgb = a
whiteness = rgb.min(axis=2)

def flood_from_border(img, thresh=48):
    """Mask of pixels reachable from the image border through near-white."""
    f = img.copy(); SENT = (255, 0, 255)
    for x in range(0, w, 4):
        for y in (0, h - 1):
            if f.getpixel((x, y)) != SENT: ImageDraw.floodfill(f, (x, y), SENT, thresh=thresh)
    for y in range(0, h, 4):
        for x in (0, w - 1):
            if f.getpixel((x, y)) != SENT: ImageDraw.floodfill(f, (x, y), SENT, thresh=thresh)
    f = np.asarray(f); return (f[..., 0] == 255) & (f[..., 1] == 0) & (f[..., 2] == 255)

def soften(alpha, cleared):
    """Anti-aliased edge: ink mixed with white gets alpha from its whiteness
    and its colour un-mixed, so edges do not go pale."""
    pad = np.pad(cleared, 2, constant_values=True)
    ring = sliding_window_view(pad, (5, 5)).any(axis=(2, 3)) & ~cleared
    edge = np.clip((255 - whiteness) * 1.15, 0, 255)
    alpha = np.where(ring, np.minimum(alpha, edge), alpha).astype(np.float64)
    al = np.clip(alpha / 255, 1e-3, 1)[..., None]
    unmixed = np.clip((rgb - (1 - al) * 255) / al, 0, 255)
    out = np.where(ring[..., None], unmixed, rgb)
    return np.dstack([out, alpha]).round().astype(np.uint8)

def square(arr, margin=0.04):
    """Crop to the ink (from an eroded mask, so a stray speck cannot set the
    frame) and pad to a square."""
    al = arr[..., 3]
    m = np.asarray(Image.fromarray((al > 8).astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))) > 0
    ys, xs = np.where(m); x0, y0, x1, y1 = xs.min() - 3, ys.min() - 3, xs.max() + 4, ys.max() + 4
    keep = np.zeros_like(al, bool); keep[y0:y1, x0:x1] = True
    arr = arr.copy(); arr[..., 3] = np.where(keep, al, 0)
    crop = Image.fromarray(arr).crop((x0, y0, x1, y1))
    side = max(crop.size); mg = round(side * margin); side += 2 * mg
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2)); return sq

outside = flood_from_border(im)

# --- disc: outside cleared, then the ring's interior filled back to white.
disc = soften(np.where(outside, 0, 255), outside)
sq = square(disc); d = np.asarray(sq).copy(); al = d[..., 3]
ys, xs = np.where(al > 8); x0, x1, y1 = xs.min(), xs.max(), ys.max()
cx, r = (x0 + x1) / 2, (x1 - x0) / 2; cy = y1 - r          # ring = outermost ink left, right, bottom
yy, xx = np.mgrid[0:d.shape[0], 0:d.shape[1]]
fill = (np.hypot(xx - cx, yy - cy) <= r - 2) & (al < 255)
wt = (1 - al[fill] / 255.0)[:, None]
d[fill, :3] = np.clip(d[fill, :3] * (al[fill][:, None] / 255.0) + 255 * wt, 0, 255).astype(np.uint8); d[fill, 3] = 255
disc_img = Image.fromarray(d); disc_img.save(DESIGN / "mfllive-logo.png")
for name, s in (("favicon-32.png", 32), ("favicon-192.png", 192), ("apple-touch-icon.png", 180)):
    disc_img.resize((s, s), Image.LANCZOS).save(APP / name, optimize=True)

# --- transparent: every white region cleared except the laces. A white
# pocket is a lace when the ink around it is mostly the ball; the
# pockets between fingers are bordered by skin and navy.
white = whiteness > 225
mint = mintness > 0.5   # the ball, wherever the recolour put it
cleared = outside.copy(); lab = Image.fromarray(white.astype(np.uint8) * 255).convert("RGB")
seen = outside.copy(); comps = []
for y, x in zip(*np.where(white & ~outside)):
    if seen[y, x]: continue
    t = lab.copy(); ImageDraw.floodfill(t, (int(x), int(y)), (255, 0, 0), thresh=10)
    t = np.asarray(t); comp = (t[..., 0] == 255) & (t[..., 1] == 0); seen |= comp
    halo = sliding_window_view(np.pad(comp, 6), (13, 13)).any(axis=(2, 3)) & ~comp & ~white
    frac = mint[halo].mean() if halo.any() else 0
    comps.append((int(comp.sum()), round(float(frac), 2)))
    if frac < 0.3: cleared |= comp
print("white pockets (px, mint fraction):", comps)
trans = square(soften(np.where(cleared, 0, 255), cleared))
trans.save(DESIGN / "mfllive-logo-transparent.png")
trans.resize((256, 256), Image.LANCZOS).save(APP / "logo.png", optimize=True)
print("wrote", [p.name for p in sorted(APP.glob("*.png"))], "+ design masters")
