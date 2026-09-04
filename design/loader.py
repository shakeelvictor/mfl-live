# Builds app/loader.webp (the loading scene) from design/loader-source.mp4,
# Shakeel's Midjourney animation of three players behind a field strip
# (624px, 24fps, 5.2s): clears the white background to alpha on every
# frame, crops the baked-in wordmark off the bottom (the page draws its
# own), and writes an animated WebP with alpha. Needs Pillow, numpy,
# scipy and imageio-ffmpeg (which bundles an ffmpeg binary):
#   .venv/bin/pip install pillow numpy scipy imageio-ffmpeg
import sys, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design/loader-source.mp4"
FPS = 24
OUT = ROOT / ("mockup" if (ROOT / "mockup/index.html").exists() else "app") / "loader.webp"
STEP = int(sys.argv[1]) if len(sys.argv) > 1 else 1   # keep every STEP-th frame (all 24fps by default)

# Decode the MP4 to frames with the bundled ffmpeg.
import subprocess, tempfile, imageio_ffmpeg
tmp = Path(tempfile.mkdtemp())
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-i", str(SRC), str(tmp / "f%04d.png")], check=True)
frames = [(Image.open(f).convert("RGB"), round(1000 / FPS)) for f in sorted(tmp.glob("f*.png"))]
w, h = frames[0][0].size
print(f"decoded {len(frames)} frames of {w}x{h}")

def cut(im):
    """Clear the white background to alpha: near-white pixels connected to
    the image border (so whites inside the drawing stay), with the
    anti-aliased edge given alpha from its whiteness and its colour
    un-mixed from white."""
    a = np.asarray(im).astype(np.int16); whiteness = a.min(axis=2)
    near_white = whiteness > 215
    labels, n = ndimage.label(near_white)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    bg = np.isin(labels, border[border > 0])
    ring = ndimage.binary_dilation(bg, iterations=2) & ~bg
    alpha = np.where(bg, 0, 255).astype(np.float64)
    alpha = np.where(ring, np.minimum(alpha, np.clip((255 - whiteness) * 1.15, 0, 255)), alpha)
    al = np.clip(alpha / 255, 1e-3, 1)[..., None]
    rgb = np.where(ring[..., None], np.clip((a - (1 - al) * 255) / al, 0, 255), a)
    return np.dstack([rgb, alpha]).round().astype(np.uint8)

cuts = [cut(im) for im, _ in frames]
# The wordmark sits under the field with a clear gap of empty rows between
# them: find that gap on the union of all frames and crop above it.
ink = np.zeros((h, w), bool)
for c in cuts: ink |= c[..., 3] > 8
rows = ink.any(axis=1); ys = np.where(rows)[0]
gaps = [(y, y2) for y, y2 in zip(ys[:-1], ys[1:]) if y2 - y > 6]
split = gaps[-1][0] + 1 if gaps else h            # the last gap is between field and text
top = ys[0]; bottom = split
cols = ink[top:bottom].any(axis=0); xs = np.where(cols)[0]; left, right = xs[0], xs[-1] + 1
print(f"content rows {top}-{bottom} (text cropped from {split}), cols {left}-{right}")
pad = 4
box = (max(0, left - pad), max(0, top - pad), min(w, right + pad), min(h, bottom + pad))
# The page shows the scene at up to 340 CSS px, so the 624px frames are
# already the 2x a Retina screen wants; no upscale. Lossy alpha
# (alpha_quality) is what keeps the file under 3MB.
imgs = [Image.fromarray(c).crop(box) for c in cuts][::STEP]
durs = [d for _, d in frames][::STEP]
durs = [d * STEP for d in durs]
imgs[0].save(OUT, save_all=True, append_images=imgs[1:], duration=durs, loop=0, quality=70, alpha_quality=60, method=6, minimize_size=True)
print("wrote", OUT.relative_to(ROOT), imgs[0].size, len(imgs), "frames", sum(durs), "ms", OUT.stat().st_size // 1024, "KB")
