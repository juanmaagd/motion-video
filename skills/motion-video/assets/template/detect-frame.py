"""Device-bezel screen detector: finds the transparent screen cut-out inside an official
device-bezel PNG from its own alpha channel, and writes a JSON sidecar `officialDeviceShot`
(engine.js) reads to place screen content under the bezel.

    python3 detect-frame.py BEZEL.png [--out SIDECAR.json] [--source-url URL --license LICENSE --author NAME]

Writes `<BEZEL.png>.json` by default: { file, imageWidth, imageHeight,
screen: { x, y, w, h, radius } }. Pass --source-url/--license/--author to also append a
provenance entry to SOURCES.json next to the PNG (same shape logos.mjs uses for brand/providers/).

Finding the SCREEN hole, not just "any transparent pixels": a rounded-corner bezel is also
transparent at its own four outer corners (outside the rounded silhouette), so a naive bbox of
every transparent pixel spans almost the whole canvas. The screen is the transparent region
ENCLOSED by opaque bezel pixels -- never touching the image border -- while the outer-corner
transparency always does touch the border. This detects the border-reachable transparent region by
flood fill and takes the screen as whatever transparent area is left over (an "enclosed hole").

A verifier that checked nothing must FAIL (references/pitfalls.md #61): a PNG with no enclosed
transparent region is not a usable bezel -- there is no screen to place content into -- so this
exits 1 rather than writing a sidecar with a zero-area or missing rect. An enclosed region under
8x8 px (alpha noise/fringe, not a real screen cut-out) FAILs the same way.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def enclosed_transparent_mask(alpha):
    """alpha: 2D uint8 array (0 = fully transparent). Returns a boolean mask of transparent pixels
    NOT reachable from the image border by 4-connected flood fill -- i.e. holes fully enclosed by
    opaque pixels. Vectorized (row/col shift + OR, iterated to a fixed point) instead of a
    pixel-by-pixel BFS: a rectangular background region converges in a handful of iterations
    because whole rows/columns propagate together.
    """
    transparent = alpha == 0
    reachable = np.zeros_like(transparent)
    reachable[0, :] = transparent[0, :]
    reachable[-1, :] = transparent[-1, :]
    reachable[:, 0] = transparent[:, 0]
    reachable[:, -1] = transparent[:, -1]
    while True:
        new = reachable.copy()
        new[1:, :] |= reachable[:-1, :] & transparent[1:, :]
        new[:-1, :] |= reachable[1:, :] & transparent[:-1, :]
        new[:, 1:] |= reachable[:, :-1] & transparent[:, 1:]
        new[:, :-1] |= reachable[:, 1:] & transparent[:, :-1]
        if np.array_equal(new, reachable):
            return transparent & ~reachable
        reachable = new


def corner_radius_estimate(mask, minx, miny, maxx, maxy):
    """Rough radius: how far in from the enclosed region's top row its left edge starts, compared
    to its position at the vertical middle (where a rounded rect's edge is at its widest).
    Approximate by design -- good enough to place content, not a geometric proof; verify visually.
    """
    mid_y = (miny + maxy) // 2
    row_mid = np.nonzero(mask[mid_y, minx:maxx + 1])[0]
    row_top = np.nonzero(mask[miny, minx:maxx + 1])[0]
    if row_mid.size == 0 or row_top.size == 0:
        return 0
    return int(max(0, row_top[0] - row_mid[0]))


def main():
    ap = argparse.ArgumentParser(description="Detect an official device bezel's screen cut-out from its alpha channel.")
    ap.add_argument("png", help="path to the official bezel PNG (must have an enclosed transparent screen hole)")
    ap.add_argument("--out", help="sidecar JSON path (default: <png>.json)")
    ap.add_argument("--source-url", help="where the PNG was downloaded from (recorded in SOURCES.json, not required)")
    ap.add_argument("--license", help="licence name/terms for this PNG (recorded in SOURCES.json)")
    ap.add_argument("--author", help="who made/owns this PNG (recorded in SOURCES.json)")
    args = ap.parse_args()

    png_path = Path(args.png)
    if not png_path.exists():
        print(f"FAIL -- {png_path} does not exist", file=sys.stderr)
        sys.exit(1)

    img = Image.open(png_path).convert("RGBA")
    w, h = img.size
    alpha = np.asarray(img.split()[3])

    mask = enclosed_transparent_mask(alpha)
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        print(f"FAIL -- no enclosed transparent screen hole found in {png_path} (either a fully "
              "opaque alpha channel, or its only transparency touches the image border).", file=sys.stderr)
        print("This is not a usable device-bezel PNG -- the screen must be a hole fully enclosed by "
              "the bezel; a solid product photo or a flattened mock-up has nothing to detect.", file=sys.stderr)
        sys.exit(1)

    minx, maxx, miny, maxy = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    screen_w, screen_h = maxx - minx + 1, maxy - miny + 1
    if screen_w < 8 or screen_h < 8:
        print(f"FAIL -- enclosed transparent region is only {screen_w}x{screen_h} px, too small to "
              "be a screen cut-out (likely alpha noise/fringe, not a real hole).", file=sys.stderr)
        sys.exit(1)

    radius = corner_radius_estimate(mask, minx, miny, maxx, maxy)
    sidecar = {
        "file": str(png_path.as_posix()),
        "imageWidth": w,
        "imageHeight": h,
        "screen": {"x": minx, "y": miny, "w": screen_w, "h": screen_h, "radius": radius},
        "detected": "alpha-enclosed-region",
    }
    out_path = Path(args.out) if args.out else png_path.with_suffix(png_path.suffix + ".json")
    out_path.write_text(json.dumps(sidecar, indent=2) + "\n")
    print(f"PASS screen rect {screen_w}x{screen_h} at ({minx},{miny}), corner radius ~{radius}px -> {out_path}")

    if args.source_url or args.license or args.author:
        sources_path = png_path.parent / "SOURCES.json"
        sources = json.loads(sources_path.read_text()) if sources_path.exists() else {"devices": []}
        entry = {
            "file": str(png_path.as_posix()), "sourceUrl": args.source_url,
            "license": args.license, "author": args.author,
        }
        sources.setdefault("devices", [])
        i = next((n for n, d in enumerate(sources["devices"]) if d.get("file") == entry["file"]), None)
        if i is not None:
            sources["devices"][i] = entry
        else:
            sources["devices"].append(entry)
        sources_path.write_text(json.dumps(sources, indent=2) + "\n")
        print(f"provenance recorded -> {sources_path}")


if __name__ == "__main__":
    main()
