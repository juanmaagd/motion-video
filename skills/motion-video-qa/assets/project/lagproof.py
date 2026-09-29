"""Lag proof: proves motion is continuous, never stepped and never parked.

Frame-to-frame difference (YAVG of |frame(n) - frame(n-1)| at 480x270 via ffmpeg
tblend=all_mode=difference + signalstats) over [0, END]. FAILs any run of more than 6 consecutive
frames below `thr` unless it falls entirely inside a declared hold, and FAILs any every-Nth-frame
stepping cadence (N = 2..8, checked in 0.5 s windows) -- the signature of quantized/stepped motion.
Imported by qa.py (frame_diffs/still_runs/cadence) and runnable standalone:

    python3 lagproof.py VIDEO [END] [--thr=1.2] [--scale=1.0] [--fps=60] [--holds='[[5.0,5.3]]'] [--blocks]

Reads `fps`, `duration`, `holds` and `lagThreshold` from timeline.json in this directory unless
overridden by a CLI flag. `holds` is the same `[[start, end], ...]` (seconds) list qa.py reads:
declared still windows (the only still allowed is a designed breath <= 0.3 s with something
still moving, e.g. the anticipation ring -- see references/motion-craft.md). `lagThreshold` may be
one number or a per-scale {"full": N, "preview": M} object -- pass --scale to pick which (default
1.0, i.e. "full"; a preview encode you inspect with `--scale=0.5` should also pass `--scale=0.5`
here so the right calibrated number is used).

Calibrate `thr` on your own encode: render a deliberately still hold (or use --blocks on any
render to see the floor), then set `thr` to roughly 2.5x that floor. Calibrate the FINAL and any
PREVIEW encode separately -- a preview's faster/higher-CRF pass is often far more destructive to
subtle motion (grain, a slow drift) than the final (pitfall 59), so the two numbers commonly
differ a lot. Two examples from real projects: full-resolution final, floor 0.46 -> thr 1.2;
half-size preview, floor 0.11 -> thr 0.85 -- re-measure your own rather than reusing these.

A missing/unreadable VIDEO, or a read that produced implausibly few diffs, is a FAIL, never a
silent "0 frame diffs ... PASS" (pitfall: a verifier that checked nothing must FAIL).
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

MAXRUN = 6  # frames; more than this below `thr` and outside a declared hold is a FAIL


class LagProofError(RuntimeError):
    """Raised when the lag proof could not actually measure anything -- a verifier that checked
    nothing must never report PASS (pitfall: "a verifier that checked nothing must FAIL")."""


def frame_diffs(video, end):
    """YAVG of |frame(n) - frame(n-1)| at 480x270 for every frame in [0, end] seconds.

    Raises LagProofError (never returns a value that would let the caller silently "pass") when
    ffmpeg fails -- e.g. a missing/unreadable video -- or produces implausibly few diffs for the
    requested window (below ~95% of the expected frame count), which is what a truncated, corrupt,
    or wrong-duration input looks like."""
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", "0", "-t", str(end), "-i", video, "-vf",
         "scale=480:270,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
         "-an", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise LagProofError(f"ffmpeg exited {out.returncode} reading {video!r}: {out.stderr.strip() or '(no stderr)'}")
    return [float(v) for v in re.findall(r"YAVG=([\d.]+)", out.stdout + out.stderr)]


def check_coverage(vals, end, fps, min_ratio=0.95):
    """Raises LagProofError when `vals` has fewer entries than a healthy read of [0, end] at `fps`
    would produce (tblend emits one diff per frame after the first). A silently-truncated read
    (e.g. a corrupt file ffmpeg partially decodes without a nonzero exit) must not read as "PASS"
    just because the handful of diffs it did get all happened to clear the threshold."""
    expected = max(round(end * fps) - 1, 0)
    if expected > 0 and len(vals) < min_ratio * expected:
        raise LagProofError(f"only {len(vals)} frame diffs for a {end:g} s / {fps:g} fps window (expected ~{expected}, "
                             f"< {min_ratio:.0%} coverage) -- the read is incomplete, not just quiet")


def still_runs(vals, thr, maxrun=MAXRUN):
    """[start_frame, end_frame] (1-based) runs longer than `maxrun` with diff < thr."""
    runs, cur = [], None
    for i, v in enumerate(vals):
        f = i + 1
        if v < thr:
            cur = cur or [f, f]
            cur[1] = f
        elif cur:
            runs.append(cur)
            cur = None
    if cur:
        runs.append(cur)
    return [r for r in runs if r[1] - r[0] + 1 > maxrun]


def cadence(vals, thr):
    """[(window_start_frame, period)] where every Nth frame (N=2..8) spikes above the rest of a
    0.5 s (30-frame) window: the signature of stepped/quantized motion."""
    hits = []
    for w0 in range(0, len(vals) - 30, 30):
        win = vals[w0:w0 + 30]
        for n in range(2, 9):
            for ph in range(n):
                on = [win[k] for k in range(ph, 30, n)]
                off = [win[k] for k in range(30) if (k - ph) % n]
                if on and off and min(on) > 1.5 * max(off) + 0.3 and max(off) < thr:
                    hits.append((w0, n))
                    break
            else:
                continue
            break
    return hits


def _load_defaults():
    tl_path = Path(__file__).parent / "timeline.json"
    return json.loads(tl_path.read_text()) if tl_path.exists() else {}


if __name__ == "__main__":
    tl = _load_defaults()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("video")
    ap.add_argument("end", nargs="?", type=float, default=None, help="seconds to check (default: timeline.json duration)")
    ap.add_argument("--thr", type=float, default=None, help="still threshold (default: timeline.json lagThreshold or 1.2)")
    ap.add_argument("--scale", type=float, default=1.0, help="resolves a per-scale lagThreshold object (default 1.0 = full)")
    ap.add_argument("--fps", type=float, default=None, help="default: timeline.json fps or 60")
    ap.add_argument("--holds", default=None, help='JSON [[start,end],...] (default: timeline.json holds)')
    ap.add_argument("--blocks", action="store_true", help="print a 0.25 s-per-column still/moving map")
    a = ap.parse_args()

    fps = a.fps or tl.get("fps", 60)
    end = a.end if a.end is not None else tl.get("duration", 16)
    if a.thr is not None:
        thr = a.thr
    else:
        _cfg = tl.get("lagThreshold")
        if isinstance(_cfg, dict):
            thr = _cfg.get("full" if a.scale >= 1 else "preview", 1.2 if a.scale >= 1 else 0.85)
        else:
            thr = _cfg if _cfg is not None else 1.2
    holds = json.loads(a.holds) if a.holds else tl.get("holds", [])

    try:
        vals = frame_diffs(a.video, end)
        check_coverage(vals, end, fps)
    except LagProofError as e:
        print(f"lag proof: FAIL -- {e}", file=sys.stderr)
        sys.exit(1)
    bad = still_runs(vals, thr)
    cad = cadence(vals, thr)

    print(f"{len(vals)} frame diffs over 0-{end:g} s (threshold {thr}); frames below it: {sum(v < thr for v in vals)}")
    fails = 0
    eps = 0.5 / fps  # half a frame: absorbs rounding when a hold is hand-typed from printed (3 dp) times
    for f0, f1 in bad:
        t0, t1 = f0 / fps, f1 / fps
        inside = any(h0 <= t0 + eps and t1 <= h1 + eps for h0, h1 in holds)
        tag = "hold" if inside else "FAIL"
        note = "" if inside else " -- not inside any declared hold"
        print(f"  [{tag}] {t0:6.3f}-{t1:6.3f} s ({f1 - f0 + 1} frames){note}")
        if inside and (t1 - t0) > 0.3:
            print(f"  [WARN] that hold is {t1 - t0:.3f} s; the only still allowed is <= 0.3 s")
        fails += 0 if inside else 1
    print("cadence: " + (", ".join(f"{w0 / fps:.2f}s x{n}" for w0, n in cad) if cad else "none (no every-Nth-frame pattern)"))
    if a.blocks:
        print("still/moving map (# = moving, . = below threshold), 0.25 s per column:")
        for b in range(0, len(vals), 15):
            blk = vals[b:b + 15]
            print(f"  {(b + 1) / fps:6.2f}s min {min(blk):5.2f} max {max(blk):5.2f}  " + "".join("#" if v >= thr else "." for v in blk))
    result = "FAIL" if (fails or cad) else "PASS"
    print(f"lag proof: {result}")
    sys.exit(1 if (fails or cad) else 0)
