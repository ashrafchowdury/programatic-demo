#!/usr/bin/env python3
"""
gap.py — paired measurement of OUR output against a REFERENCE.

The companion to `reverse-engineer-reference/probe.py`. That one takes a single
file apart. This one runs the *identical* chain over two files and prints the
distance between them, one metric per row, each with a verdict.

Two files in, one table out:

    python3 gap.py score ref.mp4 out/reel/ours.mp4
    python3 gap.py score ref.mp4 ours.mp4 --json .diag/gap/run-a.json
    python3 gap.py delta .diag/gap/run-a.json .diag/gap/run-b.json

    python3 gap.py sheet ref.mp4 ours.mp4 --out /tmp/pairs.png
    python3 gap.py shots ref.mp4 ours.mp4
    python3 gap.py ink   ref.mp4 ours.mp4 --ref-frame 742 --our-frame 300
    python3 gap.py color ref.mp4 ours.mp4 --ref-frame 40 --our-frame 40 \
                         --at 100,100,ground --at 960,540,centre

No third-party deps. ffmpeg + ffprobe only, same as probe.py.

WHY THIS IS NOT probe.py's `compare`
------------------------------------
`probe.py compare` scores motion with YAVG, the mean absolute frame difference.
YAVG is amplitude-based and therefore NOT bitrate-invariant: a noisier encode
scores as "moving" on provably static content. Measured in this repo, a
2560x1440 CRF-16 render read 52% moving against a 1920x1080 reference's 28% on
comparable content, and the entire signal was diffuse encoder noise — no pixel
on the worst card changed by more than 6 levels. It sent a real investigation
chasing a defect that did not exist.

Everything here thresholds EACH PIXEL first and then counts: a frame moves when
more than `--move-frac` of its pixels changed by more than `--thr` levels. That
discards the noise floor instead of integrating it, so the number depends on
the picture rather than on the encoder. It is the only honest way to compare
two files that were not encoded the same way — which is always the case when
one of them is someone else's delivered film.
"""
import argparse, json, math, os, shutil, subprocess, sys

# ---------------------------------------------------------------- ffmpeg glue

def _need(*binaries):
    for b in binaries:
        if not shutil.which(b):
            sys.exit(f"{b} not found on PATH")

def ff(args, want_bytes=True, loglevel="error"):
    """Same two gotchas probe.py wraps, for the same reasons:
      * `showinfo` logs at INFO level to STDERR, so -loglevel error hides it.
      * `metadata=print:file=-` writes to STDOUT, not to the log.
    """
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats",
                        "-loglevel", loglevel, *args], capture_output=True)
    if p.returncode != 0 and not p.stdout:
        sys.stderr.write(p.stderr.decode("utf-8", "replace"))
    return p.stdout if want_bytes else p.stderr.decode("utf-8", "replace")

def probe1(path, entries, stream="v:0"):
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", stream,
                        "-show_entries", entries, "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return p.stdout.strip().split("\n")[0]

def probe_fps(path):
    """Real fps from the container. NEVER assume 30 — at the wrong fps every
    duration and the cut rate are out by a factor and nothing looks broken."""
    txt = probe1(path, "stream=r_frame_rate")
    try:
        num, den = txt.split("/")
        return float(num) / float(den)
    except (ValueError, ZeroDivisionError):
        try:
            return float(txt)
        except ValueError:
            return 30.0

def dims(path):
    txt = probe1(path, "stream=width,height")
    try:
        w, h = txt.replace(",", "x").split("x")[:2]
        return int(w), int(h)
    except ValueError:
        sys.exit(f"could not read dimensions of {path}")

def has_audio(path):
    return bool(probe1(path, "stream=codec_type", stream="a:0"))

def bitrate(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=bit_rate", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        return int(p.stdout.strip())
    except ValueError:
        return 0

# ------------------------------------------------------------------- signals

CELL_W, CELL_H = 128, 72

def change_track(path, thr=8):
    """Per-frame fraction of pixels that changed by more than `thr` levels.

    THE metric. `lut` applies the same per-pixel binary threshold `geq` would,
    through an 8-bit lookup table instead of an expression evaluated per pixel,
    which is ~13x faster and verified byte-identical on gray8. The `area` downscale
    afterwards is an average of an already-thresholded image, so it counts
    pixels; downscaling BEFORE the threshold would average the noise back in
    and is the mistake this whole file exists to avoid.

    Index i of the result is frame i+1 — tblend emits one fewer frame than it
    consumes, and off-by-one here silently misaligns every cut you report.
    """
    vf = (f"format=gray,tblend=all_mode=difference,"
          f"lut=y='if(gt(val\\,{thr})\\,255\\,0)',"
          f"scale={CELL_W}:{CELL_H}:flags=area")
    raw = ff(["-i", path, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray",
              "-fps_mode", "passthrough", "-"])
    n = CELL_W * CELL_H
    return [sum(raw[i:i + n]) / (255.0 * n) for i in range(0, len(raw) - n + 1, n)]

def luma_track(path):
    """Per-frame mean luma, for cut CONTRAST (not for cut detection)."""
    raw = ff(["-i", path, "-vf",
              "format=gray,signalstats,"
              "metadata=print:key=lavfi.signalstats.YAVG:file=-",
              "-f", "null", "-"]).decode("utf-8", "replace")
    return [float(l.split("=", 1)[1]) for l in raw.splitlines() if "YAVG=" in l]

def sharpness(path):
    """Median Laplacian edge energy at a fixed 640px width.

    Normalising the width is what makes this comparable across a 1080p
    reference and a 1440p render. Low against the reference means soft
    footage — usually a capture that was upscaled to fill the frame.
    """
    raw = ff(["-i", path, "-vf",
              "format=gray,scale=640:-1," +
              "convolution=" + ":".join(["0 -1 0 -1 4 -1 0 -1 0"] * 4) +
              ",signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
              "-f", "null", "-"]).decode("utf-8", "replace")
    v = sorted(float(l.split("=", 1)[1]) for l in raw.splitlines() if "YAVG=" in l)
    return v[len(v) // 2] if v else 0.0

def gray_frame(path, n, w=None, h=None):
    """One frame as a full-resolution gray plane."""
    W, H = dims(path)
    vf = f"select=eq(n\\,{n}),format=gray"
    if w:
        vf += f",scale={w}:{h}"
        W, H = w, h
    raw = ff(["-i", path, "-vf", vf, "-frames:v", "1",
              "-f", "rawvideo", "-pix_fmt", "gray", "-"])
    return raw[:W * H], W, H

def frame_pair_delta(path, a, b, thr=8):
    """Fraction of pixels differing by > thr between two frames of one file.

    Used for bookends: a film whose first and last frames are the same render
    ends where it started. Both frames are compared at the reference's own
    resolution, so this is resolution-independent by construction.
    """
    fa, W, H = gray_frame(path, a)
    fb, _, _ = gray_frame(path, b)
    if len(fa) < W * H or len(fb) < W * H:
        # Returning 0.0 here would read as "the bookends are identical", which
        # is a finding. A frame that failed to decode is not one. Say nothing.
        return None
    n = W * H
    return sum(1 for i in range(n) if abs(fa[i] - fb[i]) > thr) / n

def lufs(path):
    if not has_audio(path):
        return None
    txt = ff(["-i", path, "-filter:a", "ebur128=peak=true", "-f", "null", "-"],
             want_bytes=False, loglevel="info")
    for line in reversed(txt.splitlines()):
        if "I:" in line and "LUFS" in line:
            try:
                return float(line.split("I:")[1].split("LUFS")[0].strip())
            except (IndexError, ValueError):
                continue
    return None

# --------------------------------------------------------------- the battery

def battery(path, thr, move_frac, cut_frac, want_audio=True, want_sharp=True):
    ch = change_track(path, thr)
    if not ch:
        sys.exit(f"no frames decoded from {path}")
    lum = luma_track(path)
    fps = probe_fps(path)
    W, H = dims(path)
    total = len(ch) + 1

    # A cut is a frame where a large share of the picture changed at once.
    # Amplitude-free, so it survives a low-contrast cut between two shots on
    # the same ground — which a luma-delta detector cannot see at all.
    cuts = [i + 1 for i, v in enumerate(ch) if v >= cut_frac]
    cuts = [c for i, c in enumerate(cuts) if i == 0 or c - cuts[i - 1] > 1]

    deltas = []
    for c in cuts:
        if c < len(lum) and c - 1 >= 0:
            deltas.append(abs(lum[c] - lum[c - 1]))

    bounds = [0] + cuts + [total]
    lens = sorted(bounds[i + 1] - bounds[i] for i in range(len(bounds) - 1))

    # Cut frames are excluded: a cut is not motion, and leaving them in makes a
    # fast-cut film look restless when every shot inside it is dead still.
    body = [v for v in ch if v < cut_frac]
    moving = sum(1 for v in body if v > move_frac)
    # A cut ENDS a still run. Letting a cut fall through the counter merges
    # two calm shots into one implausibly long rest and over-reports the
    # film's stillest moment by ~50%.
    best = cur = 0
    for v in ch:
        cur = 0 if v > move_frac else cur + 1
        best = max(best, cur)

    invisible = sum(1 for d in deltas if d < 30)
    return {
        "file": os.path.basename(path),
        "w": W, "h": H, "fps": fps, "frames": total, "dur": total / fps,
        "bitrate_kbps": round(bitrate(path) / 1000),
        "shots": len(lens), "cuts": len(cuts),
        "mean_shot": sum(lens) / len(lens) / fps,
        "median_shot": lens[len(lens) // 2] / fps,
        "shortest_shot": min(lens) / fps,
        "longest_shot": max(lens) / fps,
        "cut_rate": len(cuts) / (total / fps) * 60,
        "moving_pct": 100.0 * moving / len(body) if body else 0.0,
        "longest_still": best / fps,
        "cut_delta_median": sorted(deltas)[len(deltas) // 2] if deltas else 0.0,
        "cuts_invisible": invisible,
        "cuts_invisible_pct": 100.0 * invisible / len(cuts) if cuts else 0.0,
        "bookend_delta_pct": (lambda d: None if d is None else 100.0 * d)(
            frame_pair_delta(path, 0, total - 1, thr)),
        "sharpness": sharpness(path) if want_sharp else None,
        "audio": has_audio(path),
        "lufs": lufs(path) if want_audio else None,
        "cut_frames": cuts,
        "cut_deltas": [round(d, 1) for d in deltas],
    }

# -------------------------------------------------------------------- verdict

MATCH, NEAR, GAP, INFO = "match", "near", "gap", "info"
MARK = {MATCH: "OK  ", NEAR: "near", GAP: "GAP ", INFO: "    "}

def band(ours, ref, tol, near=None, lower_is_ok=False, higher_is_ok=False):
    """Verdict for a number against the reference, as a relative tolerance."""
    if ref == 0:
        return INFO
    d = abs(ours - ref) / abs(ref)
    if (lower_is_ok and ours <= ref) or (higher_is_ok and ours >= ref):
        return MATCH
    if d <= tol:
        return MATCH
    if near is not None and d <= near:
        return NEAR
    return GAP

def rows_film(R, O):
    """Every row is (label, ref, ours, verdict, note).

    Tolerances are set so the two Cursor reference films PASS against each
    other on the pacing rows. A tolerance that flags one reference against
    another is measuring the film, not the grammar.
    """
    def pct(x):
        return f"{x:.1f}%"
    def s(x):
        return f"{x:.2f}s"

    out = [
        ("resolution", f"{R['w']}x{R['h']}", f"{O['w']}x{O['h']}",
         MATCH if abs(R['w'] / R['h'] - O['w'] / O['h']) < 0.01 else GAP,
         "aspect must match; pixel count need not"),
        ("fps", f"{R['fps']:g}", f"{O['fps']:g}",
         MATCH if abs(R['fps'] - O['fps']) < 0.5 else GAP, ""),
        ("bitrate", f"{R['bitrate_kbps']}k", f"{O['bitrate_kbps']}k", INFO,
         "bounds what a low-amplitude ramp can survive"),
        ("duration", s(R['dur']), s(O['dur']), INFO, "a choice, not a target"),
        ("shots", R['shots'], O['shots'],
         band(O['shots'], R['shots'], 0.25, 0.45), ""),
        ("mean shot", s(R['mean_shot']), s(O['mean_shot']),
         band(O['mean_shot'], R['mean_shot'], 0.20, 0.35), ""),
        ("median shot", s(R['median_shot']), s(O['median_shot']),
         band(O['median_shot'], R['median_shot'], 0.20, 0.35), ""),
        ("shortest shot", s(R['shortest_shot']), s(O['shortest_shot']),
         band(O['shortest_shot'], R['shortest_shot'], 0.25, 0.45),
         "a shot below the reference floor reads as a flash"),
        ("longest shot", s(R['longest_shot']), s(O['longest_shot']),
         band(O['longest_shot'], R['longest_shot'], 0.30, 0.50), ""),
        ("cut rate /min", f"{R['cut_rate']:.1f}", f"{O['cut_rate']:.1f}",
         band(O['cut_rate'], R['cut_rate'], 0.25, 0.40), ""),
        ("moving frames", pct(R['moving_pct']), pct(O['moving_pct']),
         band(O['moving_pct'], R['moving_pct'], 0.25, 0.45),
         "over budget reads busy; under reads like a slideshow"),
        ("longest still run", s(R['longest_still']), s(O['longest_still']),
         band(O['longest_still'], R['longest_still'], 0.30, 0.55),
         "the reference's stillest moment is a deliberate rest"),
        ("median cut delta", f"{R['cut_delta_median']:.0f}",
         f"{O['cut_delta_median']:.0f}",
         band(O['cut_delta_median'], R['cut_delta_median'], 0.30, 0.55),
         "luma contrast carrying the cut"),
        ("invisible cuts", f"{R['cuts_invisible']}/{R['cuts']}",
         f"{O['cuts_invisible']}/{O['cuts']}",
         INFO if not R['cuts'] or not O['cuts']
         else MATCH if O['cuts_invisible_pct'] <= R['cuts_invisible_pct'] + 10
         else NEAR if O['cuts_invisible_pct'] <= R['cuts_invisible_pct'] + 30
         else GAP,
         "delta < 30: motion has to carry these, or they vanish"),
        ("bookend difference",
         pct(R['bookend_delta_pct']) if R['bookend_delta_pct'] is not None
         else "unread",
         pct(O['bookend_delta_pct']) if O['bookend_delta_pct'] is not None
         else "unread",
         INFO if None in (R['bookend_delta_pct'], O['bookend_delta_pct'])
         else band(O['bookend_delta_pct'], R['bookend_delta_pct'], 0.40, 0.70,
                   higher_is_ok=True),
         "first vs last frame; near zero = the film ends where it started"),
        ("sharpness", f"{R['sharpness']:.2f}", f"{O['sharpness']:.2f}",
         band(O['sharpness'], R['sharpness'], 0.20, 0.40, higher_is_ok=True),
         "low = soft footage, usually an upscaled capture"),
        ("audio", "yes" if R['audio'] else "none",
         "yes" if O['audio'] else "none",
         MATCH if R['audio'] == O['audio'] else GAP,
         "silence is a decision; make it deliberately"),
    ]
    if R['lufs'] is not None or O['lufs'] is not None:
        out.append(("loudness",
                    f"{R['lufs']:.1f}" if R['lufs'] is not None else "-",
                    f"{O['lufs']:.1f}" if O['lufs'] is not None else "-",
                    MATCH if (R['lufs'] is not None and O['lufs'] is not None
                              and abs(R['lufs'] - O['lufs']) <= 3) else INFO,
                    "LUFS integrated"))
    return out

# ---------------------------------------------------------------------- score

def cmd_score(a):
    _need("ffmpeg", "ffprobe")
    for p in (a.reference, a.ours):
        if not os.path.exists(p):
            sys.exit(f"no such file: {p}")
    R = battery(a.reference, a.thr, a.move_frac, a.cut_frac)
    O = battery(a.ours, a.thr, a.move_frac, a.cut_frac)
    na, nb = a.ref_label or "REFERENCE", a.our_label or "OURS"

    if R["cuts"] == 0 or O["cuts"] == 0:
        which = a.reference if R["cuts"] == 0 else a.ours
        print(f"\n  WARNING: no cuts detected in {os.path.basename(which)}.")
        print(f"  Every pacing row below is then a comparison against one long")
        print(f"  shot and means nothing. Either it genuinely is a single take —")
        print(f"  in which case ignore rows 4-11 — or the cut detector missed")
        print(f"  them. Re-run with a lower --cut-frac (try 0.08) and confirm")
        print(f"  the boundaries on a `sheet` before believing either answer.")

    rows = rows_film(R, O)
    w = max(len(r[0]) for r in rows)
    print(f"\n  {'':5}{'metric':<{w}}  {na:>16}  {nb:>16}")
    print(f"  {'':5}{'-' * w}  {'-' * 16}  {'-' * 16}")
    for k, x, y, v, note in rows:
        print(f"  {MARK[v]} {k:<{w}}  {str(x):>16}  {str(y):>16}"
              + (f"   {note}" if note and v in (GAP, NEAR) else ""))

    scored = [r for r in rows if r[3] != INFO]
    ok = sum(1 for r in scored if r[3] == MATCH)
    gaps = [r for r in scored if r[3] == GAP]
    print(f"\n  {ok}/{len(scored)} metrics inside tolerance.")
    if gaps:
        print("  GAPS: " + ", ".join(r[0] for r in gaps))

    print(f"\n  cut frames  {na}: {R['cut_frames']}")
    print(f"  cut frames  {nb}: {O['cut_frames']}")
    print(f"  cut deltas  {na}: {R['cut_deltas']}")
    print(f"  cut deltas  {nb}: {O['cut_deltas']}")

    print("""
  There is deliberately NO composite score. A single number invites tuning the
  film until the number moves, and the two changes this repo has had to revert
  both matched a reference number exactly while looking wrong on screen. Read
  the rows.

  This table cannot see: type size, colour, layout, framing, whether the copy
  is any good, or whether one small element is animating (a logo mark is ~0.4%
  of frame, under the moving-frame floor). Run `ink`, `color`, `sheet`, and
  probe.py's `type` and `framing` for those, and LOOK AT THE FRAMES before you
  rank anything.""")

    if a.json:
        os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
        with open(a.json, "w") as fh:
            json.dump({"reference": R, "ours": O,
                       "params": {"thr": a.thr, "move_frac": a.move_frac,
                                  "cut_frac": a.cut_frac},
                       "verdicts": {r[0]: r[3] for r in rows}}, fh, indent=2)
        print(f"\n  wrote {a.json}   (compare later with: gap.py delta old new)")

# ---------------------------------------------------------------------- delta

TRACKED = [
    ("dur", "duration", "s", 0),
    ("shots", "shots", "", 0),
    ("mean_shot", "mean shot", "s", 0),
    ("median_shot", "median shot", "s", 0),
    ("shortest_shot", "shortest shot", "s", 0),
    ("cut_rate", "cut rate /min", "", 0),
    ("moving_pct", "moving frames", "%", 0),
    ("longest_still", "longest still", "s", 0),
    ("cut_delta_median", "median cut delta", "", 0),
    ("cuts_invisible", "invisible cuts", "", 0),
    ("bookend_delta_pct", "bookend difference", "%", 0),
    ("sharpness", "sharpness", "", 0),
]

def cmd_delta(a):
    """Did the change help? Two scorecards, one direction-of-travel table."""
    old = json.load(open(a.old))
    new = json.load(open(a.new))
    if old["params"] != new["params"]:
        print("  WARNING: the two runs used different thresholds. The numbers")
        print("  are not comparable. Re-run both with the same flags.\n")
    ref = new["reference"]
    if old["reference"]["file"] != ref["file"]:
        print(f"  WARNING: reference changed "
              f"({old['reference']['file']} -> {ref['file']}). "
              f"'closer' below is meaningless.\n")

    rows = []
    for key, label, unit, _ in TRACKED:
        r, o, n = ref.get(key), old["ours"].get(key), new["ours"].get(key)
        if r is None or o is None or n is None:
            continue
        was, now = abs(o - r), abs(n - r)
        move = ("closer" if now < was - 1e-9 else
                "FURTHER" if now > was + 1e-9 else "same")
        rows.append((label, f"{r:.2f}{unit}", f"{o:.2f}{unit}",
                     f"{n:.2f}{unit}", move))
    w = max(len(r[0]) for r in rows)
    print(f"\n  {'metric':<{w}}  {'reference':>12}  {'before':>12}  "
          f"{'after':>12}   verdict")
    print(f"  {'-' * w}  {'-' * 12}  {'-' * 12}  {'-' * 12}")
    for label, r, o, n, move in rows:
        print(f"  {label:<{w}}  {r:>12}  {o:>12}  {n:>12}   {move}")
    worse = [r[0] for r in rows if r[4] == "FURTHER"]
    print(f"\n  {sum(1 for r in rows if r[4] == 'closer')} closer, "
          f"{sum(1 for r in rows if r[4] == 'FURTHER')} further, "
          f"{sum(1 for r in rows if r[4] == 'same')} unchanged.")
    if worse:
        print("  REGRESSED: " + ", ".join(worse))
    print("""
  A row moving the wrong way is not automatically a bug — a change that fixes
  the picture may cost a pacing metric, and that trade can be the right one.
  It is a bug when nobody noticed it happened.""")

# ---------------------------------------------------------------------- shots

def cmd_shots(a):
    _need("ffmpeg", "ffprobe")
    R = battery(a.reference, a.thr, a.move_frac, a.cut_frac,
                want_audio=False, want_sharp=False)
    O = battery(a.ours, a.thr, a.move_frac, a.cut_frac,
                want_audio=False, want_sharp=False)

    def table(B, name):
        b = [0] + B["cut_frames"] + [B["frames"]]
        print(f"\n  {name}  ({B['shots']} shots, {B['frames']} f "
              f"@ {B['fps']:g}fps)")
        print(f"    {'#':>3}  {'in':>6}  {'out':>6}  {'len':>6}  {'sec':>6}"
              f"  {'cut Δ':>6}")
        for i in range(len(b) - 1):
            n = b[i + 1] - b[i]
            d = B["cut_deltas"][i - 1] if 0 < i <= len(B["cut_deltas"]) else 0
            print(f"    {i+1:>3}  {b[i]:>6}  {b[i+1]-1:>6}  {n:>6}"
                  f"  {n/B['fps']:>6.2f}  {d:>6.0f}")

    table(R, a.ref_label or "REFERENCE")
    table(O, a.our_label or "OURS")
    print("""
  Line the two up by ROLE, not by index: bookend, card, shot, card, shot,
  bookend. A film that matches on mean shot length while spending its long shots
  in the wrong places has the same statistics and a different shape.""")

# ------------------------------------------------------------------------ ink

def ink_box(path, n, pol, thr, crop=None):
    """2D bounding box of ink on one frame, at full resolution.

    Read as real pixels, NOT via an axis reduction. Collapsing 1080 rows with
    `scale=W:1` averages a one-pixel antialiased stem to nothing, so absolute
    extents under-read — deltas survive, extents do not.
    """
    W, H = dims(path)
    vf = f"select=eq(n\\,{n})"
    if crop:
        vf += f",crop={crop}"
        cw, ch = crop.split(":")[:2]
        W, H = int(cw), int(ch)
    cmp_ = f"gt(val\\,{thr})" if pol == "dark" else f"lt(val\\,{thr})"
    vf += f",format=gray,lut=y='if({cmp_}\\,255\\,0)'"
    raw = ff(["-i", path, "-vf", vf, "-frames:v", "1",
              "-f", "rawvideo", "-pix_fmt", "gray", "-"])
    if len(raw) < W * H:
        return None
    x0, y0, x1, y1, count = W, H, -1, -1, 0
    for y in range(H):
        row = raw[y * W:(y + 1) * W]
        if 255 not in row:
            continue
        y0 = min(y0, y); y1 = max(y1, y)
        x0 = min(x0, row.index(255))
        x1 = max(x1, W - 1 - row[::-1].index(255))
        count += sum(1 for v in row if v == 255)
    if y1 < 0:
        return None
    return {"x": x0, "y": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1,
            "ink": count, "W": W, "H": H,
            "fill": 100.0 * count / (W * H)}

def cmd_ink(a):
    """Paired ink geometry, normalised to a common width.

    This is the row that found the largest gap this repo has had: UI text
    rendering at 13 px where the reference's rendered at 30 px, both at 1920.
    Absolute pixel sizes across two different output resolutions are not
    comparable and comparing them anyway will tell you everything is fine.
    """
    _need("ffmpeg", "ffprobe")
    N = a.normalise
    out = []
    for path, frame, crop, label in (
            (a.reference, a.ref_frame, a.ref_crop, a.ref_label or "REFERENCE"),
            (a.ours, a.our_frame, a.our_crop, a.our_label or "OURS")):
        b = ink_box(path, frame, a.pol, a.ink_thr, crop)
        if not b:
            sys.exit(f"no ink found in {label} frame {frame} at --pol {a.pol} "
                     f"--ink-thr {a.ink_thr}. Wrong polarity is the usual "
                     f"cause; run probe.py hist on this frame.")
        k = N / b["W"]
        out.append((label, b, k))
    w = max(len(o[0]) for o in out)
    print(f"\n  ink geometry, normalised to {N} px wide\n")
    print(f"  {'':<{w}}  {'frame':>6}  {'box @src':>14}  {'box @' + str(N):>14}"
          f"  {'fill':>7}")
    for (label, b, k), frame in zip(out, (a.ref_frame, a.our_frame)):
        src = f"{b['w']}x{b['h']}"
        nrm = f"{round(b['w'] * k)}x{round(b['h'] * k)}"
        print(f"  {label:<{w}}  {frame:>6}  {src:>14}  {nrm:>14}"
              f"  {b['fill']:>6.1f}%")
    (la, ba, ka), (lb, bb, kb) = out
    print(f"\n  height ratio {lb}/{la}: {(bb['h'] * kb) / (ba['h'] * ka):.2f}x")
    if ba["fill"]:
        print(f"  fill  ratio {lb}/{la}: {bb['fill'] / ba['fill']:.2f}x")
    for label, b, _ in out:
        if b["fill"] > 80:
            print(f"\n  WARNING: {label} reads {b['fill']:.0f}% ink — almost"
                  f" certainly the wrong --pol,\n  or an --ink-thr on the wrong"
                  f" side of the content. Run `probe.py hist`\n  on that frame"
                  f" and pick a threshold from it. The box above is garbage.")
        elif b["fill"] < 0.05:
            print(f"\n  WARNING: {label} reads {b['fill']:.2f}% ink — a few"
                  f" stray pixels, not an\n  element. Check the polarity and"
                  f" the crop before quoting this box.")
    print("""
  For TYPE, crop to a single line first and read the box height as cap height.
  A box spanning two lines measures the line pitch, not the type. Quote cap
  height AND pitch — nominal font-size means nothing without the face's cap
  ratio, and a reader with a different face cannot reproduce your film from it.

  If ours is small: fix it UPSTREAM, at capture scale. Cropping tighter to buy
  text size trades the picture for the number, and that trade has been made
  and reverted here once already.""")

# ---------------------------------------------------------------------- color

def sample(path, n, x, y, size=6):
    raw = ff(["-i", path, "-vf",
              f"select=eq(n\\,{n}),crop={size}:{size}:{x}:{y},"
              f"scale=1:1:flags=area,format=rgb24",
              "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    if len(raw) < 3:
        return None
    return raw[0], raw[1], raw[2]

def srgb_to_lab(rgb):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(float(c)) for c in rgb)
    X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    Y = (0.2126 * r + 0.7152 * g + 0.0722 * b)
    Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(X), f(Y), f(Z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)

def de76(a, b):
    la, lb = srgb_to_lab(a), srgb_to_lab(b)
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(la, lb)))

def cmd_color(a):
    """Paired colour sampling with a perceptual distance.

    Hex strings are not comparable by eye: #0a0a0a and #16120d differ by 6
    levels and read as cool-black versus warm-black across a whole film.
    dE76 below ~2 is invisible, ~5 is a noticeable shift, above ~10 is a
    different colour.

    Sample FLAT areas. A 6x6 average on an edge or a gradient is a blend of
    two things and belongs to neither. Take coordinates from probe.py's
    `grid`, never by guessing — on a dark reference almost every guess
    returns #000000 and looks like a broken tool.
    """
    _need("ffmpeg", "ffprobe")
    print(f"\n  {'point':<16}  {'REFERENCE':>10}  {'OURS':>10}  {'dE76':>6}")
    print(f"  {'-'*16}  {'-'*10}  {'-'*10}  {'-'*6}")
    for spec in a.at:
        parts = spec.split(",")
        x, y = int(parts[0]), int(parts[1])
        name = parts[2] if len(parts) > 2 else f"{x},{y}"
        ca = sample(a.reference, a.ref_frame, x, y, a.size)
        cb = sample(a.ours, a.our_frame, x, y, a.size)
        if not ca or not cb:
            print(f"  {name:<16}  sample failed (is the point inside frame?)")
            continue
        d = de76(ca, cb)
        flag = "" if d < 2 else "  <- visible" if d < 10 else "  <- different"
        ha = f"#{ca[0]:02x}{ca[1]:02x}{ca[2]:02x}"
        hb = f"#{cb[0]:02x}{cb[1]:02x}{cb[2]:02x}"
        print(f"  {name:<16}  {ha:>10}  {hb:>10}  {d:>6.1f}{flag}")
    print("\n  Same coordinates in both files. If the two are different sizes,")
    print("  scale the point yourself — this does not guess for you.")

# ---------------------------------------------------------------------- sheet

def cmd_sheet(a):
    """One contact sheet per file, at a matched cadence, stacked.

    The step this workflow exists to force. Every reverted change in this
    repo's history measured correctly and looked wrong, and the frames are
    where that shows up.
    """
    _need("ffmpeg", "ffprobe")
    tmp = []
    for i, (path, label) in enumerate(((a.reference, "ref"), (a.ours, "our"))):
        fps = probe_fps(path)
        step = a.every
        dst = os.path.join(os.path.dirname(os.path.abspath(a.out)),
                           f".{label}-strip.png")
        ff(["-i", path, "-vf",
            f"select='not(mod(n\\,{step}))',scale=320:-1,"
            f"tile={a.cols}x{a.rows}:padding=4:color=0x333333",
            "-frames:v", "1", "-y", dst])
        if not os.path.exists(dst):
            sys.exit(f"ffmpeg wrote no sheet for {path}")
        tmp.append(dst)
    ff(["-i", tmp[0], "-i", tmp[1], "-filter_complex",
        "[0:v]pad=iw:ih+8:0:0:color=0x333333[a];[a][1:v]vstack=inputs=2",
        "-frames:v", "1", "-y", a.out])
    for t in tmp:
        os.remove(t)
    if not os.path.exists(a.out):
        sys.exit("stack failed — are the two sheets different widths? "
                 "use the same --cols for both")
    print(f"  wrote {a.out}   (reference on top, ours below, every {a.every} f)")
    print("  Open it. Read what CHANGES between panels, not what is in them.")

# ------------------------------------------------------------------------ cli

def main():
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(s, pair=True):
        if pair:
            s.add_argument("reference")
            s.add_argument("ours")
        s.add_argument("--ref-label")
        s.add_argument("--our-label")
        s.add_argument("--thr", type=int, default=8,
                       help="per-pixel change threshold, 0-255 (default 8)")
        s.add_argument("--move-frac", type=float, default=0.002,
                       help="frame moves above this pixel fraction (0.002)")
        s.add_argument("--cut-frac", type=float, default=0.25,
                       help="frame is a cut above this pixel fraction (0.25)")
        return s

    s = common(sub.add_parser("score"))
    s.add_argument("--json", help="write a scorecard for `delta` to read")
    s.set_defaults(fn=cmd_score)

    s = common(sub.add_parser("shots"))
    s.set_defaults(fn=cmd_shots)

    s = sub.add_parser("delta")
    s.add_argument("old")
    s.add_argument("new")
    s.set_defaults(fn=cmd_delta)

    s = common(sub.add_parser("ink"))
    s.add_argument("--ref-frame", type=int, default=0)
    s.add_argument("--our-frame", type=int, default=0)
    s.add_argument("--ref-crop", help="W:H:X:Y in the reference's own pixels")
    s.add_argument("--our-crop", help="W:H:X:Y in our own pixels")
    s.add_argument("--pol", choices=("dark", "light"), default="dark",
                   help="dark = bright ink on dark ground")
    s.add_argument("--ink-thr", type=int, default=128)
    s.add_argument("--normalise", type=int, default=1920)
    s.set_defaults(fn=cmd_ink)

    s = common(sub.add_parser("color"))
    s.add_argument("--ref-frame", type=int, default=0)
    s.add_argument("--our-frame", type=int, default=0)
    s.add_argument("--at", action="append", default=[],
                   metavar="X,Y[,NAME]", help="repeatable sample point")
    s.add_argument("--size", type=int, default=6)
    s.set_defaults(fn=cmd_color)

    s = common(sub.add_parser("sheet"))
    s.add_argument("--out", required=True)
    s.add_argument("--every", type=int, default=30)
    s.add_argument("--cols", type=int, default=6)
    s.add_argument("--rows", type=int, default=4)
    s.set_defaults(fn=cmd_sheet)

    a = p.parse_args()
    a.fn(a)

if __name__ == "__main__":
    main()
