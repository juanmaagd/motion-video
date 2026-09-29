"""Logo fidelity, step 2: compare a rendered frame's mark with the shipped SVG rendered at the same box.

    python3 logoqa.py POSTER.png REF.png REF.json

Reports, inside the mark's box (padded 4 px): pixels whose largest channel difference exceeds 50%,
the mean absolute difference (0-1) and the largest difference. Grain adds at most a few levels; the
NUMBERS are a report, not a gate (no threshold is asserted on them -- treat 0 pixels > 50% different
and a mean abs diff under ~0.02 as passing; see brandqa.mjs, which renders REF.png/REF.json from the
shipped brand.logo at the box the composition's window.__logoBox(t) hook reports). A missing input
or an empty comparison box is a different thing from "the numbers were fine": that FAILs (exit 1)
rather than crash on a raw traceback or silently print nothing.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

if len(sys.argv) != 4:
    print("usage: logoqa.py POSTER.png REF.png REF.json", file=sys.stderr)
    sys.exit(2)
poster_path, ref_path, box_path = sys.argv[1], sys.argv[2], sys.argv[3]
missing = [p for p in (poster_path, ref_path, box_path) if not Path(p).exists()]
if missing:
    print(f"logo: FAIL -- missing input(s): {', '.join(missing)}", file=sys.stderr)
    sys.exit(1)

box = json.load(open(box_path))
a = np.asarray(Image.open(poster_path).convert("RGB")).astype(int)
b = np.asarray(Image.open(ref_path).convert("RGB")).astype(int)
x0, y0 = int(box["x"]) - 4, int(box["y"]) - 4
x1, y1 = int(box["x"] + box["w"]) + 5, int(box["y"] + box["h"]) + 5
crop_a, crop_b = a[y0:y1, x0:x1], b[max(0, y0):y1, max(0, x0):x1]
if crop_a.size == 0 or crop_b.size == 0:
    print(f"logo: FAIL -- box {box} crops to an empty region (poster {a.shape[1]}x{a.shape[0]}, "
          f"ref {b.shape[1]}x{b.shape[0]}) -- nothing was compared", file=sys.stderr)
    sys.exit(1)
d = np.abs(crop_a - crop_b).max(axis=2)
print(f"logo: box {x1 - x0}x{y1 - y0} px, pixels > 50% different: {(d > 127).sum()}, "
      f"mean abs diff {d.mean() / 255:.4f}, max diff {d.max() / 255:.3f}")
