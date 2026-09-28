"""Contact sheet: tile stills named t<seconds>.png with their timestamps.

    python3 sheet.py DIR OUT.png [--cols 4] [--width 480]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

args = sys.argv[1:]
src, out = Path(args[0]), Path(args[1])
cols = int(args[args.index("--cols") + 1]) if "--cols" in args else 4
tw = int(args[args.index("--width") + 1]) if "--width" in args else 480

files = sorted(src.glob("t*.png"))
if not files:
    sys.exit(f"no t*.png stills in {src}")
w0, h0 = Image.open(files[0]).size
th = round(tw * h0 / w0)
pad, lab = 6, 18
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + lab + pad) + pad), (40, 42, 48))
draw = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((tw, th), Image.LANCZOS)
    x = pad + (i % cols) * (tw + pad)
    y = pad + (i // cols) * (th + lab + pad)
    sheet.paste(im, (x, y + lab))
    draw.text((x + 2, y + 3), f.stem[1:].lstrip("0") or "0", fill=(230, 230, 230))
sheet.save(out)
print(f"sheet: {len(files)} frames -> {out}")
