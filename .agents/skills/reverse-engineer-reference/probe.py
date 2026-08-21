#!/usr/bin/env python3
"""
probe.py — measurement harness for reverse-engineering a reference.

Drives ffmpeg/ffprobe and reduces frames to numbers. No third-party deps
(no numpy, no PIL) so it runs anywhere ffmpeg does.

Works on video AND on single images (stills): every subcommand that takes
--frame accepts an image file, where frame 0 is the only frame.

    python3 probe.py info    ref.mp4
    python3 probe.py cuts    ref.mp4
    python3 probe.py sheet   ref.mp4 --from 0 --to 120 --every 6 --cols 4 --out sheet.png
    python3 probe.py track   ref.mp4 --from 98 --to 120 --axis y --pol dark
    python3 probe.py ink     ref.mp4 --from 98 --to 193 --pol dark
    python3 probe.py scale   ref.mp4 --from 184 --to 209 --band 222,238
    python3 probe.py color   ref.mp4 --frame 145 --at 100,100,ground --at 700,500,ink
    python3 probe.py type    ref.mp4 --frame 880 --pol dark
    python3 probe.py audio   ref.mp4
    python3 probe.py fit     --series 16,9,6,5,4,2,3,2,1,1,1,1,1
"""
import argparse, math, subprocess, sys, shutil

# ---------------------------------------------------------------- ffmpeg glue

def _need(binary):
    if not shutil.which(binary):
        sys.exit(f"{binary} not found on PATH")

def ff(args, want_bytes=True, loglevel="error"):
    """want_bytes -> raw stdout. Otherwise the decoded stream ffmpeg logged to.

    Two gotchas this wraps, both of which cost real time to find:
      * `showinfo` logs at INFO level to STDERR, so -loglevel error silences it.
      * `metadata=print:file=-` writes to STDOUT, not the log.
    """
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats",
                        "-loglevel", loglevel, *args], capture_output=True)
    if p.returncode != 0 and not p.stdout:
        sys.stderr.write(p.stderr.decode("utf-8", "replace"))
    return p.stdout if want_bytes else p.stderr.decode("utf-8", "replace")

def thr_expr(pol, thr):
    """Binary threshold. dark = bright ink on dark ground; light = the inverse."""
    cmp_ = f"gt(lum(X\\,Y)\\,{thr})" if pol == "dark" else f"lt(lum(X\\,Y)\\,{thr})"
    return f"geq=lum='if({cmp_}\\,255\\,0)'"

def sel(a, b):
    return f"select='between(n,{a},{b})'" if b is not None else f"select=eq(n\\,{a})"

def gray_frames(path, vf, width, height, a=None, b=None):
    """Yield raw gray planes of size width*height for the selected frames."""
    args = ["-i", path, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray"]
    if a is not None and b is None:
        args += ["-frames:v", "1"]
    else:
        args += ["-vsync", "0"]
    raw = ff(args + ["-"])
    n = width * height
    for i in range(len(raw) // n):
        yield raw[i * n:(i + 1) * n]

def runs_of(vals, min_len=1):
    out, cur = [], None
    for i, v in enumerate(vals):
        if v > 0 and cur is None:
            cur = i
        elif v == 0 and cur is not None:
            if i - cur >= min_len:
                out.append((cur, i - 1))
            cur = None
    if cur is not None and len(vals) - cur >= min_len:
        out.append((cur, len(vals) - 1))
    return out

def probe_fps(path):
    """Real fps from the container. NEVER assume 30 — 60fps sources are common
    and a wrong fps silently doubles every duration you report."""
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=r_frame_rate",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    txt = p.stdout.strip().split("\n")[0]
    try:
        num, den = txt.split("/")
        return float(num) / float(den)
    except (ValueError, ZeroDivisionError):
        try:
            return float(txt)
        except ValueError:
            return 30.0

def dims(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height",
                        "-of", "csv=p=0:s=x", path], capture_output=True, text=True)
    w, h = p.stdout.strip().split("\n")[0].split("x")
    return int(w), int(h)

# ---------------------------------------------------------------------- info

def cmd_info(a):
    _need("ffprobe")
    print(subprocess.run(
        ["ffprobe", "-v", "error",
         "-show_entries", "format=duration,size,bit_rate",
         "-show_entries", "stream=index,codec_type,codec_name,width,height,"
                          "r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels",
         "-of", "default=noprint_wrappers=0", a.file],
        capture_output=True, text=True).stdout)
    print("REMINDER: note the bitrate. Under ~1 Mbps for 1080p, a sub-2% opacity")
    print("ramp will not survive the encoder — 'no fade' means 'no fade visible")
    print("at this bitrate'. Say so in the writeup.")

# ---------------------------------------------------------------------- cuts

def luma_track(path):
    """(frame -> (mean_luma, stdev)) via showinfo. One decode pass."""
    txt = ff(["-i", path, "-vf", "showinfo", "-f", "null", "-"],
             want_bytes=False, loglevel="info")
    out = {}
    for line in txt.splitlines():
        if "mean:[" not in line or "n:" not in line:
            continue
        try:
            n = int(line.split("n:")[1].split()[0])
            mean = int(line.split("mean:[")[1].split()[0])
            sd = float(line.split("stdev:[")[1].split()[0])
            out[n] = (mean, sd)
        except (IndexError, ValueError):
            continue
    return out

def yavg_track(path):
    """Per-frame difference energy. THE motion metric. Full resolution."""
    raw = ff(["-i", path, "-vf",
              "tblend=all_mode=difference,signalstats,"
              "metadata=print:key=lavfi.signalstats.YAVG:file=-",
              "-f", "null", "-"]).decode("utf-8", "replace")
    return [float(l.split("=", 1)[1]) for l in raw.splitlines() if "YAVG=" in l]

def cmd_cuts(a):
    _need("ffmpeg")
    lum = luma_track(a.file)
    y = yavg_track(a.file)
    if not lum:
        sys.exit("no frames parsed from showinfo — is this a video file?")
    total = max(lum) + 1 if lum else len(y) + 1
    fps = a.fps if a.fps else probe_fps(a.file)

    hits = [i + 1 for i, v in enumerate(y) if v >= a.yavg]
    cuts = [c for c in hits
            if c in lum and c - 1 in lum and abs(lum[c][0] - lum[c - 1][0]) >= a.luma_delta]
    same = [c for c in hits if c not in cuts]

    print(f"frames={total}  dur={total/fps:.3f}s  fps={fps}")
    print(f"\nCUTS (YAVG>={a.yavg} AND |dLuma|>={a.luma_delta}): {len(cuts)}")
    print("  " + ", ".join(map(str, cuts)) if cuts else "  none")
    if same:
        print(f"\nHIGH-ENERGY, LOW-LUMA-DELTA frames: {len(same)}")
        print("  " + ", ".join(map(str, same[:60])) + (" …" if len(same) > 60 else ""))
        print("  ^ these are word reveals, fast in-shot moves — OR cuts between")
        print("    two shots on the SAME ground. Check with `ink` before assuming.")

    if not cuts and same:
        print("\n  !! NO CUT PASSED THE |dLuma| GATE, but high-energy frames exist.")
        print("     Either this reference has no hard cuts (one continuous take),")
        print("     or its cuts are between shots of SIMILAR tone — the default")
        print("     gate is tuned to high-contrast slams and will miss those.")
        print("     Re-run with --luma-delta 4, and confirm each candidate on a")
        print("     contact sheet before believing either answer.")
        print("     The shot table below assumes ONE shot. Do not quote it yet.")

    bounds = [0] + cuts + [total]
    lens = [bounds[i + 1] - bounds[i] for i in range(len(bounds) - 1)]
    print(f"\nSHOTS: {len(lens)}")
    print("      shot  frames            dur   midluma  f0.sd  note")
    for i, (st, n) in enumerate(zip(bounds[:-1], lens), 1):
        mid = st + n // 2
        m = lum.get(mid, (0, 0))[0]
        sd0 = lum.get(st, (0, 0))[1]
        note = ("starts EMPTY (untrimmed head)" if sd0 < 1.0
                else "starts with content (cut mid-reveal?)" if sd0 > 5 else "")
        print(f"  {i:>3}  f{st:<6}-{st+n-1:<6} {n:>5}f {n/fps:>7.3f}s  "
              f"{m:>3}    {sd0:>5.1f}  {note}")
    print("  f0.sd = stdev of the shot's FIRST frame. ~0 on a flat ground means the")
    print("  shot opens completely empty; a high value means content is already")
    print("  present, i.e. the shot was cut into mid-reveal. That distinction is a")
    print("  real authoring parameter — do not skip it.")
    srt = sorted(lens)
    print(f"\n  mean   {sum(lens)/len(lens):>7.1f}f = {sum(lens)/len(lens)/fps:.3f}s")
    print(f"  median {srt[len(srt)//2]:>7}f = {srt[len(srt)//2]/fps:.3f}s")
    print(f"  min/max {min(lens)}f / {max(lens)}f")
    print(f"  cut rate {len(cuts)/(total/fps)*60:.1f}/min")
    if cuts:
        print("  cut luma deltas: " +
              ", ".join(str(abs(lum[c][0] - lum[c-1][0])) for c in cuts))

    if not y:
        print("\nMOTION  unavailable (no YAVG rows parsed)"); return
    moving = sum(1 for v in y if v > 0.2)
    still = 0; best = 0
    for v in y:
        still = still + 1 if v <= 0.2 else 0
        best = max(best, still)
    print(f"\nMOTION  moving(YAVG>0.2) {moving}/{len(y)} = {100*moving/len(y):.1f}%")
    print(f"        longest still run {best}f = {best/fps:.2f}s")
    print("\nNOTE: a dissolve shows intermediate luma over several frames. Verify")
    print("      any boundary you care about with: probe.py track --axis y, or by")
    print("      eyeballing the luma either side. Single-frame jump = hard cut.")

# --------------------------------------------------------------------- sheet

def cmd_sheet(a):
    _need("ffmpeg")
    idx = list(range(a.frm, a.to + 1, a.every))
    cols = a.cols
    rows = math.ceil(len(idx) / cols)
    crop = f"crop={a.crop}," if a.crop else ""
    vf = (f"select='between(n,{a.frm},{a.to})*not(mod(n-{a.frm},{a.every}))',"
          f"{crop}scale={a.w}:-1,"
          f"tile={cols}x{rows}:margin=4:padding=6:color=0x{a.color}")
    ff(["-i", a.file, "-vf", vf, "-frames:v", "1", "-y", a.out])
    print(f"wrote {a.out}  ({len(idx)} frames, {cols}x{rows}, row-major)")
    print("frames: " + ", ".join(f"f{n}" for n in idx))

# --------------------------------------------------------------------- track

def cmd_track(a):
    _need("ffmpeg")
    W, H = dims(a.file)
    if a.crop:
        cw, ch, cx, cy = (int(v) for v in a.crop.split(":"))
    else:
        cw, ch, cx, cy = W, H, 0, 0
    n, sc = (ch, f"1:{ch}") if a.axis == "y" else (cw, f"{cw}:1")
    crop = f"crop={cw}:{ch}:{cx}:{cy}," if a.crop else ""
    vf = f"{sel(a.frm, a.to)},format=gray,{crop}{thr_expr(a.pol, a.thr)},scale={sc}:flags=area"
    off = cy if a.axis == "y" else cx
    print(f"axis={a.axis} pol={a.pol} thr={a.thr}   (values are absolute px)")
    plo = phi = None
    for i, row in enumerate(gray_frames(a.file, vf, *( (1, ch) if a.axis=="y" else (cw, 1) ), a.frm, a.to)):
        idx = [j for j, v in enumerate(row) if v > 0]
        f = a.frm + i
        if not idx:
            print(f"  f{f:<6} empty"); plo = phi = None; continue
        lo, hi = idx[0] + off, idx[-1] + off
        dl = f"{lo-plo:+5d}" if plo is not None else "     ."
        dh = f"{hi-phi:+5d}" if phi is not None else "     ."
        print(f"  f{f:<6} lo={lo:<6}{dl}  hi={hi:<6}{dh}  span={hi-lo+1}")
        plo, phi = lo, hi
    print("\nTRAP: area-scaling a whole axis averages away thin antialiased strokes,")
    print("      so ABSOLUTE extents under-read. Frame-to-frame DELTAS are sound —")
    print("      the same glyphs are compared against themselves. For a true")
    print("      absolute box use `type`, which reads real 2D pixels.")

# ----------------------------------------------------------------------- ink

def cmd_ink(a):
    """Ink mass per frame. Steps up = a word/item appeared. Collapse = new card."""
    _need("ffmpeg")
    W, H = 96, 54
    vf = f"{sel(a.frm, a.to)},format=gray,{thr_expr(a.pol, a.thr)},scale={W}:{H}:flags=area"
    vals = [sum(fr) for fr in gray_frames(a.file, vf, W, H, a.frm, a.to)]
    print(f"pol={a.pol} thr={a.thr}  step>=|{a.step}|")
    last = None
    for i, v in enumerate(vals):
        if i == 0:
            print(f"  f{a.frm:<6} ink={v}"); continue
        d = v - vals[i - 1]
        if abs(d) >= a.step:
            f = a.frm + i
            gap = f"   (+{f-last}f)" if last is not None else ""
            kind = "REVEAL" if d > 0 else "COLLAPSE -> new card / cut on same ground"
            print(f"  f{f:<6} ink {vals[i-1]} -> {v}  {d:+7d}  {kind}{gap}")
            last = f
    print("\nUse the gaps: a constant gap is the word/item stagger. A COLLAPSE on an")
    print("unchanged ground is a cut your luma detector could not see.")

# --------------------------------------------------------------------- scale

def cmd_scale(a):
    """Track one element's size by isolating its fill colour. Survives motion blur."""
    _need("ffmpeg")
    lo, hi = (int(v) for v in a.band.split(","))
    W, H = dims(a.file)
    vf = (f"{sel(a.frm, a.to)},format=gray,"
          f"geq=lum='if(between(lum(X\\,Y)\\,{lo}\\,{hi})\\,255\\,0)',"
          "erosion,erosion,erosion,dilation,dilation,scale=1:%d:flags=area" % H)
    print(f"fill band {lo}..{hi}   (longest vertical run = the element)")
    prev = None; base = None
    for i, row in enumerate(gray_frames(a.file, vf, 1, H, a.frm, a.to)):
        idx = [j for j, v in enumerate(row) if v > 0]
        f = a.frm + i
        if not idx:
            print(f"  f{f:<6} none"); prev = None; continue
        rs, cur, p = [], idx[0], idx[0]
        for j in idx[1:]:
            if j > p + 2: rs.append((cur, p)); cur = j
            p = j
        rs.append((cur, p))
        s, e = max(rs, key=lambda r: r[1] - r[0]); ht = e - s + 1
        if base is None: base = ht
        d = f"{ht-prev:+6d}" if prev is not None else "      ."
        print(f"  f{f:<6} y {s:>4}..{e:<4}  h={ht:<5} {ht/base:>6.2f}x {d}")
        prev = ht
    print("\nFirst frame is taken as 1.00x. Erosion kills antialiasing; the two")
    print("dilations restore the edge it ate. Blurred in-between frames during a")
    print("very fast move are UNRELIABLE — trust the endpoints and the settle tail.")

# ------------------------------------------------------------------- framing

def cmd_framing(a):
    """Does the picture bleed to the frame edge, or float on a backdrop?

    Discriminator is corner-vs-centre COLOUR, not ink extent. A full-bleed shot
    of a white app page has white corners AND a white centre; a framed shot has
    backdrop corners and a window centre. Window edges are then found as the
    sharpest luma discontinuity near each side, which survives a gradient
    backdrop where a flat-border test does not.
    """
    _need("ffmpeg")
    W, H = dims(a.file)
    rgb = ff(["-i", a.file, "-vf", f"{sel(a.frame, None)},format=rgb24",
              "-f", "rawvideo", "-pix_fmt", "rgb24", "-frames:v", "1", "-"])[:W*H*3]
    if len(rgb) < W * H * 3:
        sys.exit("could not read frame")

    def patch(cx, cy, r=12):
        px = [(rgb[(y*W+x)*3], rgb[(y*W+x)*3+1], rgb[(y*W+x)*3+2])
              for y in range(max(0,cy-r), min(H,cy+r))
              for x in range(max(0,cx-r), min(W,cx+r))]
        n = len(px)
        return tuple(sum(c[i] for c in px)/n for i in range(3))

    corners = [patch(20,20), patch(W-20,20), patch(20,H-20), patch(W-20,H-20)]
    centre  = patch(W//2, H//2)
    def dist(p, q): return max(abs(p[i]-q[i]) for i in range(3))
    cmean = tuple(sum(c[i] for c in corners)/4 for i in range(3))
    spread = max(dist(c, cmean) for c in corners)
    gap = dist(cmean, centre)

    hexs = lambda p: "#%02X%02X%02X" % tuple(int(v) for v in p)
    print(f"frame {a.frame}  {W}x{H}")
    print(f"  corners {[hexs(c) for c in corners]}")
    print(f"  corner spread {spread:.0f}   centre {hexs(centre)}   corner-centre gap {gap:.0f}")

    # per-axis means for edge detection
    gray = [ (rgb[i*3]*299 + rgb[i*3+1]*587 + rgb[i*3+2]*114)//1000 for i in range(W*H) ]
    colm = [sum(gray[y*W+x] for y in range(H))/H for x in range(W)]
    rowm = [sum(gray[y*W+x] for x in range(W))/W for y in range(H)]
    def first_edge(arr, start, stop, step):
        """First real discontinuity scanning INWARD from the frame edge.

        Not the strongest: interior UI panels routinely out-edge the window
        boundary on a dark screencast, and taking the max lands you on a
        sidebar divider with a confidently wrong number.
        """
        d = [abs(arr[i+1] - arr[i-1]) for i in range(1, len(arr)-1)]
        idx = list(range(start, stop, step))
        probe_n = max(4, len(idx)//10)
        noise = sorted(abs(d[min(max(i-1,0), len(d)-1)]) for i in idx[:probe_n])
        base = noise[len(noise)//2]
        thresh = max(a.edge, 4*base)
        for i in idx:
            j = min(max(i-1, 0), len(d)-1)
            if d[j] >= thresh:
                return i, d[j], thresh
        return (start, 0.0, thresh)

    if gap < a.gap:
        print(f"\n  VERDICT: FULL-BLEED. Corners and centre are the same surface")
        print(f"  (gap {gap:.0f} < {a.gap}) — there is no backdrop, the picture runs")
        print("  edge to edge. Spec it as crop+scale of one recording: no radius,")
        print("  no shadow, no margin.")
        print("  (Ink may still sit inside the frame — that is the app's own")
        print("   whitespace, NOT a frame inset. Do not report it as one.)")
        return

    l, ls, th = first_edge(colm, 1, W//2, 1)
    r, rs, _  = first_edge(colm, W-2, W//2, -1)
    t, ts, _  = first_edge(rowm, 1, H//2, 1)
    b, bs2, _ = first_edge(rowm, H-2, H//2, -1)
    print(f"\n  first edge inward (threshold {th:.1f}): "
          f"L{l}({ls:.0f}) R{r}({rs:.0f}) T{t}({ts:.0f}) B{b}({bs2:.0f})")
    sharps = {"L": ls, "R": rs, "T": ts, "B": bs2}
    # Judge each edge against the noise floor it had to clear, NOT against the
    # strongest edge: one very sharp side (a window meeting a bright part of a
    # gradient) would otherwise condemn three perfectly good ones.
    weak = [k for k, v in sharps.items() if v < max(2 * th, a.edge)]
    marg = {"L": l, "R": W-1-r, "T": t, "B": H-1-b}
    asym = (max(marg["L"], marg["R"]) > 3 * max(1, min(marg["L"], marg["R"])) or
            max(marg["T"], marg["B"]) > 3 * max(1, min(marg["T"], marg["B"])))
    if weak or asym:
        print(f"\n  !! BOX IS UNRELIABLE.")
        if weak:
            print(f"     Weak edges: {', '.join(weak)} — barely clear the noise "
                  f"floor ({2*th:.0f}).")
        if asym:
            print(f"     Margins are lopsided (L{marg['L']} R{marg['R']} "
                  f"T{marg['T']} B{marg['B']}), which a centred window is not.")
        print("     This happens when part of the window is the same tone as the")
        print("     backdrop — a dark UI on a dark ground has no edge to find there.")
        print("     DO NOT QUOTE these numbers. Run `grid` and read the window box")
        print("     off the image by eye, and label it OBSERVED.")
    wpct, hpct = 100*(r-l+1)/W, 100*(b-t+1)/H
    print(f"\n  window box: x {l}..{r}  y {t}..{b}   ({r-l+1} x {b-t+1})")
    print(f"  = {wpct:.1f}% x {hpct:.1f}% of frame")
    print(f"  margins  L{l}  R{W-1-r}  T{t}  B{H-1-b}")
    cx, cy = (l+r)/2, (t+b)/2
    print(f"  centre offset ({cx-W/2:+.0f}, {cy-H/2:+.0f})")
    print(f"\n  VERDICT: FRAMED on a backdrop. Quote window fit as {wpct:.1f}% of")
    print("  frame width. Backdrop is " +
          ("a gradient/texture" if spread > 24 else f"flat {hexs(cmean)}") + ".")
    print("  Corner radius and shadow are NOT measurable this way — read them off")
    print("  a frame by eye and label them OBSERVED.")

# ---------------------------------------------------------------------- hist

def cmd_hist(a):
    """Luma histogram of one frame. RUN THIS BEFORE PICKING ANY THRESHOLD."""
    _need("ffmpeg")
    W, H = dims(a.file)
    raw = ff(["-i", a.file, "-vf", f"{sel(a.frame, None)},format=gray",
              "-f", "rawvideo", "-pix_fmt", "gray", "-frames:v", "1", "-"])[:W*H]
    if len(raw) < W * H:
        sys.exit("could not read frame")
    b = [0] * 16
    for v in raw:
        b[v // 16] += 1
    tot = len(raw)
    print(f"frame {a.frame}  {W}x{H}  mean={sum(raw)/tot:.1f}  min={min(raw)} max={max(raw)}")
    for i, c in enumerate(b):
        pct = 100 * c / tot
        bar = "#" * int(pct / 2)
        print(f"  {i*16:>3}-{i*16+15:<3} {pct:5.1f}% {bar}")
    ink_hi = sum(c for i, c in enumerate(b) if i >= 8)
    print(f"\n  bright (>=128): {100*ink_hi/tot:.1f}%   dark (<128): {100*(1-ink_hi/tot):.1f}%")
    print("\nPICK THRESHOLDS FROM THIS, not from the defaults. The defaults (90 dark /")
    print("128 light) assume a high-contrast card. A dark screencast can be 97% pure")
    print("black with its content living above 200 — thr=90 then matches noise.")
    print("Choose a value in an EMPTY part of the histogram, between the two modes.")

# ---------------------------------------------------------------------- grid

def has_filter(name):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"],
                         capture_output=True, text=True).stdout
    return any(line.split()[1:2] == [name] for line in out.splitlines() if line.strip())

def cmd_grid(a):
    """Dump a frame under a coordinate grid, so you can read off the x,y to hand
    to `color`, `--crop` or `track`. Guessing coordinates wastes a pass — on a
    dark reference every guess lands in background and reads #000000."""
    _need("ffmpeg")
    import os
    W, H = dims(a.file)
    step = a.step
    labels = has_filter("drawtext")
    draw = []
    for i, x in enumerate(range(0, W, step)):
        major = (i % 5 == 0)
        draw.append(f"drawbox=x={x}:y=0:w={2 if major else 1}:h={H}:"
                    f"color=0xff00ff@{0.9 if major else 0.35}:t=fill")
        if labels:
            draw.append(f"drawtext=text='{x}':x={x+3}:y=3:fontcolor=0xff00ff:fontsize=14")
    for i, y in enumerate(range(0, H, step)):
        major = (i % 5 == 0)
        draw.append(f"drawbox=x=0:y={y}:w={W}:h={2 if major else 1}:"
                    f"color=0xff00ff@{0.9 if major else 0.35}:t=fill")
        if labels:
            draw.append(f"drawtext=text='{y}':x=3:y={y+3}:fontcolor=0xff00ff:fontsize=14")
    vf = f"{sel(a.frame, None)}," + ",".join(draw)
    ff(["-i", a.file, "-vf", vf, "-frames:v", "1", "-y", a.out])
    if not os.path.exists(a.out) or os.path.getsize(a.out) == 0:
        sys.exit(f"grid failed to write {a.out}")
    print(f"wrote {a.out}  ({W}x{H}, {step}px grid)")
    if labels:
        print("Lines are labelled. Read coordinates off the image.")
    else:
        print(f"This ffmpeg has no drawtext, so lines are UNLABELLED.")
        print(f"Every 5th line is brighter: those are {step*5}px apart, "
              f"i.e. 0, {step*5}, {step*10}, ... from the top-left.")
    print("Feed what you read to --at / --crop / --band.")

# --------------------------------------------------------------------- color

def cmd_color(a):
    _need("ffmpeg")
    W, H = dims(a.file)
    for spec in a.at:
        parts = spec.split(",")
        x, y = int(parts[0]), int(parts[1])
        label = parts[2] if len(parts) > 2 else f"{x},{y}"
        if not (0 <= x <= W - 6 and 0 <= y <= H - 6):
            print(f"  {label:<24} OUT OF FRAME ({W}x{H}) — ffmpeg would clamp "
                  f"and hand you a neighbouring pixel. Skipped."); continue
        raw = ff(["-i", a.file, "-vf",
                  f"{sel(a.frame, None)},crop=6:6:{x}:{y},scale=1:1",
                  "-f", "rawvideo", "-pix_fmt", "rgb24", "-frames:v", "1", "-"])[:3]
        if len(raw) < 3:
            print(f"  {label:<24} (out of frame?)"); continue
        print(f"  {label:<24} #{raw[0]:02X}{raw[1]:02X}{raw[2]:02X}  rgb{tuple(raw)}")
    print("\n6x6 average, so it survives noise but WILL lie on an edge or a gradient.")
    print("Sample flat areas. For ink, land inside a thick stroke, not on its edge.")

# ---------------------------------------------------------------------- type

def cmd_type(a):
    """True 2D metrics: cap height, line bands, pitch, column width."""
    _need("ffmpeg")
    FW, FH = dims(a.file)
    if a.crop:
        W, H, CX, CY = (int(v) for v in a.crop.split(":"))
        vf = f"{sel(a.frame, None)},crop={W}:{H}:{CX}:{CY},format=gray"
    else:
        W, H, CX, CY = FW, FH, 0, 0
        vf = f"{sel(a.frame, None)},format=gray"
    raw = ff(["-i", a.file, "-vf", vf,
              "-f", "rawvideo", "-pix_fmt", "gray", "-frames:v", "1", "-"])[:W*H]
    if len(raw) < W * H:
        sys.exit("could not read frame")
    hit = (lambda v: v > a.thr) if a.pol == "dark" else (lambda v: v < a.thr)
    rowhit = [1 if any(hit(raw[r*W+c]) for c in range(W)) else 0 for r in range(H)]
    bands = runs_of(rowhit, min_len=3)
    print(f"frame {a.frame}  region {W}x{H} at ({CX},{CY}) of {FW}x{FH}  pol={a.pol} thr={a.thr}")
    print("\nLINE BANDS (true 2D, nothing averaged away):")
    for s, e in bands:
        print(f"  y {s+CY:>5}..{e+CY:<5} h={e-s+1}")
    tops = [s for s, _ in bands]
    if len(tops) > 1:
        pitches = [tops[i+1]-tops[i] for i in range(len(tops)-1)]
        print(f"\n  line pitch: {pitches}   mean {sum(pitches)/len(pitches):.1f} px")
    if bands:
        s, e = bands[0]
        seg = [1 if any(hit(raw[r*W+c]) for r in range(s, e+1)) else 0 for c in range(W)]
        cr = runs_of(seg, 1)
        if cr:
            print(f"\n  first line x {cr[0][0]+CX}..{cr[-1][1]+CX}  "
                  f"w={cr[-1][1]-cr[0][0]+1} = {100*(cr[-1][1]-cr[0][0]+1)/FW:.1f}% of frame width")
            g = cr[0]
            gs = [r for r in range(s, e+1) if any(hit(raw[r*W+c]) for c in range(g[0], g[1]+1))]
            if gs:
                print(f"  FIRST GLYPH cap/extent: y {gs[0]+CY}..{gs[-1]+CY}  h={gs[-1]-gs[0]+1} px")
    print("\nCAP HEIGHT IS THE SPEC, NOT font-size. Pick a glyph with no descender")
    print("(a capital) and read its height. nominal size = cap / face's cap-ratio")
    print("(~0.715 for a typical grotesque). Quote cap height AND pitch; a reader")
    print("with a different face needs both to reproduce your film.")

# --------------------------------------------------------------------- audio

def audio_envelope(path, win):
    """RMS dBFS per `win` seconds. The shape of the mix over time."""
    n = int(8000 * win)
    raw = ff(["-i", path, "-af",
              f"aresample=8000,asetnsamples={n}:p=0,astats=metadata=1:reset=1,"
              "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
              "-f", "null", "-"]).decode("utf-8", "replace")
    out = []
    for l in raw.splitlines():
        if "RMS_level=" in l:
            v = l.split("RMS_level=")[1].strip()
            try:
                out.append(float(v))
            except ValueError:
                out.append(-120.0)   # ffmpeg prints "-inf" on digital silence
    return out

def cmd_audio(a):
    _need("ffmpeg")
    has = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0",
                          "-show_entries", "stream=codec_name,sample_rate,channels",
                          "-of", "default=nw=1", a.file],
                         capture_output=True, text=True).stdout.strip()
    if not has:
        print("NO AUDIO STREAM.")
        print("Silence is a design decision, not an omission — record it as one.")
        print("A silent reference tells you the film must read with sound off.")
        return
    print("--- stream ---")
    for l in has.splitlines(): print("  " + l)

    print("\n--- loudness ---")
    txt = ff(["-i", a.file, "-af", "ebur128=peak=true", "-f", "null", "-"],
             want_bytes=False, loglevel="info")
    keep = False; lufs = lra = None
    for line in txt.splitlines():
        if "Integrated loudness" in line: keep = True
        if not keep or not line.strip(): continue
        if line.lstrip().startswith(("[", "frame=", "video:")): break
        t = line.strip(); print("  " + t)
        if t.startswith("I:"):   lufs = float(t.split()[1])
        if t.startswith("LRA:"): lra  = float(t.split()[1])

    print("\n--- silence (< -50dB, > 0.3s) ---")
    txt = ff(["-i", a.file, "-af", "silencedetect=n=-50dB:d=0.3", "-f", "null", "-"],
             want_bytes=False, loglevel="info")
    gaps = []
    for l in txt.splitlines():
        if "silence_start" in l:
            gaps.append(("start", float(l.split("silence_start:")[1].split()[0])))
        elif "silence_end" in l:
            gaps.append(("end", float(l.split("silence_end:")[1].split()[0])))
    if gaps:
        for k, v in gaps[:20]: print(f"  {k:<6} {v:.3f}s")
        if len(gaps) > 20: print(f"  … {len(gaps)-20} more")
    else:
        print("  none — signal present throughout")

    env = audio_envelope(a.file, a.window)
    if env:
        print(f"\n--- RMS envelope, {a.window}s windows (dBFS) ---")
        # A fully silent window measures -inf dBFS, and one of those poisons
        # min/max: the span becomes inf or nan and the bar width is then
        # `int(nan)`, which raises rather than printing. Scale against the
        # FINITE windows only and render the silent ones as a marker, so a
        # reference with a silent head or tail still gets an envelope.
        finite = [v for v in env if math.isfinite(v)]
        if not finite:
            print("  (every window is silent)")
        else:
            lo, hi = min(finite), max(finite)
            span = max(hi - lo, 1e-6)
            for i, v in enumerate(env):
                if not math.isfinite(v):
                    print(f"  {i*a.window:6.1f}s     -inf  (silent)")
                    continue
                bar = "#" * max(0, min(28, int(28 * (v - lo) / span)))
                print(f"  {i*a.window:6.1f}s {v:7.1f} {bar}")

    # ---- classification -------------------------------------------------
    print("\n--- reading ---")
    dur = float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
                                "-of","csv=p=0",a.file],capture_output=True,
                               text=True).stdout.strip() or 0)
    starts = [v for k, v in gaps if k == "start"]
    late = [v for v in starts if v > 2.0]
    if not late:
        print("  CONTINUOUS BED. No silence after the head — a sustained music or")
        print("  ambience layer, not discrete SFX. Reproduce as one audio track.")
    else:
        print(f"  DISCRETE / GAPPED. {len(late)} silence gaps after 2s: the mix is")
        print("  event-driven (SFX, speech) rather than a continuous bed.")
    if starts and starts[0] < 2.0:
        print(f"  HEAD FADE: silence crosses -50dB around {starts[0]:.2f}s — the")
        print("  track fades in rather than starting at level.")
    if lufs is not None:
        d = lufs - (-14.0)
        print(f"  LEVEL: {lufs:.1f} LUFS is {abs(d):.1f} LU "
              f"{'BELOW' if d < 0 else 'ABOVE'} the -14 social norm.")
        if d < -10:
            print("  That is deliberately subliminal — a texture, not a soundtrack.")
            print("  Match this or the film will feel loud and cheap beside it.")
    if lra is not None and lra < 4:
        print(f"  LRA {lra} LU is narrow — heavily compressed / evenly mixed.")
    if env and dur:
        peak_i = env.index(max(env)); trough_i = env.index(min(env))
        print(f"  LOUDEST around {peak_i*a.window:.1f}s, QUIETEST around "
              f"{trough_i*a.window:.1f}s. Cross-check those against the shot table:")
        print("  if quiet lands on cards and loud on footage, the bed is ducking or")
        print("  the arrangement is cut to the edit.")

# --------------------------------------------------------------------- report

def cmd_report(a):
    """Run the standard battery and emit a markdown skeleton to build on.

    This is a STARTING POINT, not an analysis. It fills in what a machine can
    measure and leaves explicit TODOs for everything that needs eyes. Do not
    ship its output as a spec.
    """
    _need("ffmpeg")
    import io, contextlib, os
    W, H = dims(a.file)
    fps = probe_fps(a.file)
    B = _battery(a.file, 8.0, a.luma_delta)
    if not B:
        sys.exit("could not measure")
    mid = B["frames"] // 2

    def cap(fn, ns):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            try: fn(argparse.Namespace(**ns))
            except SystemExit: pass
        return buf.getvalue()

    name = os.path.basename(a.file)
    print(f"# Reverse-engineering: {name}\n")
    print("Generated by `probe.py report`. Every number here is MEASURED; every")
    print("TODO needs a human pass. Delete this banner when the doc is real.\n")
    print("## Source\n")
    print(f"| | |\n| --- | --- |")
    print(f"| resolution | {B['res']} |\n| fps | {B['fps']:g} |")
    print(f"| duration | {B['dur']:.3f}s ({B['frames']} frames) |")
    bitrate = subprocess.run(["ffprobe","-v","error","-show_entries","format=bit_rate",
                              "-of","csv=p=0",a.file],capture_output=True,text=True).stdout.strip()
    print(f"| bitrate | {bitrate} bps |")
    if bitrate.isdigit() and int(bitrate) < 1_000_000:
        print("\n> Low bitrate. 'No fade' below means *no fade measurable at this")
        print("> bitrate* — a sub-2% opacity ramp would not survive the encoder.\n")

    print("\n## Structure (MEASURED)\n")
    print("```")
    print(cap(cmd_cuts, dict(file=a.file, fps=None, yavg=8.0, luma_delta=a.luma_delta)).rstrip())
    print("```\n")
    print("TODO: confirm every boundary on a contact sheet. A same-ground cut will")
    print("not appear above — check the high-energy list with `ink`.\n")

    print("## Framing (MEASURED)\n```")
    print(cap(cmd_framing, dict(file=a.file, frame=mid, gap=18.0, edge=6.0)).rstrip())
    print("```\n")

    print("## Tone (MEASURED)\n```")
    print(cap(cmd_hist, dict(file=a.file, frame=mid)).rstrip())
    print("```\n")

    print("## Audio (MEASURED)\n```")
    print(cap(cmd_audio, dict(file=a.file, window=max(1.0, B["dur"]/12))).rstrip())
    print("```\n")

    print("""## Still to do — none of this is machine-measurable

- [ ] **Genre.** Card film / screencast / composited / still? Contact-sheet it
      first; it decides what the rest of this document is even for.
- [ ] **Per-shot content.** What appears, disappears, changes; where attention
      is meant to go.
- [ ] **Motion.** `track` / `scale` each moving element, then `fit` the deltas.
      Two elements agreeing means you have found the film's one curve.
- [ ] **Entrances and exits.** Distance, frames, and whether the shot is cut
      mid-move (deltas still growing on the last frame).
- [ ] **Transitions.** Verify each boundary is a hard cut. Check whether any
      shot starts already in motion — that is what replaces a dissolve.
- [ ] **Type.** `type --crop` on a text frame. Quote cap height AND pitch,
      never nominal font-size.
- [ ] **Colour.** `grid` for coordinates, then `color` on flat areas.
- [ ] **Cursor / input affordances.** Shape, ripple or none, whether it leads
      the beat. By eye.
- [ ] **Corner radius and shadow.** By eye. Label OBSERVED.
- [ ] **Compare against our own output** with `compare`, same thresholds.
- [ ] **Label every claim** OBSERVED / MEASURED / INFERRED / UNKNOWN.""")

# -------------------------------------------------------------------- compare

def _battery(path, yavg, luma_delta):
    lum = luma_track(path)
    y = yavg_track(path)
    if not lum or not y:
        return None
    fps = probe_fps(path)
    total = max(lum) + 1
    hits = [i + 1 for i, v in enumerate(y) if v >= yavg]
    cuts = [c for c in hits if c in lum and c - 1 in lum
            and abs(lum[c][0] - lum[c-1][0]) >= luma_delta]
    bounds = [0] + cuts + [total]
    lens = sorted(bounds[i+1] - bounds[i] for i in range(len(bounds)-1))
    moving = sum(1 for v in y if v > 0.2)
    best = cur = 0
    for v in y:
        cur = cur + 1 if v <= 0.2 else 0
        best = max(best, cur)
    W, H = dims(path)
    return {
        "res": f"{W}x{H}", "fps": fps, "frames": total, "dur": total / fps,
        "shots": len(lens), "cuts": len(cuts),
        "mean": sum(lens)/len(lens)/fps, "median": lens[len(lens)//2]/fps,
        "shortest": min(lens)/fps, "longest": max(lens)/fps,
        "rate": len(cuts)/(total/fps)*60,
        "moving": 100*moving/len(y), "still": best/fps,
        "deltas": [abs(lum[c][0]-lum[c-1][0]) for c in cuts],
    }

def cmd_compare(a):
    """Run the identical battery over two files and table them side by side.

    Comparing a reference's MEASURED numbers against your own SOURCE CONSTANTS
    is not a comparison — constants lie about what actually renders. Measure
    both outputs, through the same code path, or do not claim a gap.
    """
    _need("ffmpeg")
    A = _battery(a.file, a.yavg, a.luma_delta)
    B = _battery(a.other, a.yavg, a.luma_delta)
    if not A or not B:
        sys.exit("could not measure one of the inputs")
    na = a.label or "REFERENCE"
    nb = a.other_label or "OURS"
    rows = [
        ("resolution",        A["res"],                  B["res"]),
        ("fps",               f"{A['fps']:g}",           f"{B['fps']:g}"),
        ("duration",          f"{A['dur']:.2f}s",        f"{B['dur']:.2f}s"),
        ("shots",             A["shots"],                B["shots"]),
        ("cuts",              A["cuts"],                 B["cuts"]),
        ("mean shot",         f"{A['mean']:.2f}s",       f"{B['mean']:.2f}s"),
        ("median shot",       f"{A['median']:.2f}s",     f"{B['median']:.2f}s"),
        ("shortest shot",     f"{A['shortest']:.2f}s",   f"{B['shortest']:.2f}s"),
        ("longest shot",      f"{A['longest']:.2f}s",    f"{B['longest']:.2f}s"),
        ("cut rate /min",     f"{A['rate']:.1f}",        f"{B['rate']:.1f}"),
        ("moving frames",     f"{A['moving']:.1f}%",     f"{B['moving']:.1f}%"),
        ("longest still run", f"{A['still']:.2f}s",      f"{B['still']:.2f}s"),
    ]
    w = max(len(r[0]) for r in rows)
    print(f"  {'metric':<{w}}  {na:>14}  {nb:>14}")
    print(f"  {'-'*w}  {'-'*14}  {'-'*14}")
    for k, x, y_ in rows:
        print(f"  {k:<{w}}  {str(x):>14}  {str(y_):>14}")
    print(f"\n  cut luma deltas")
    print(f"    {na}: {A['deltas']}")
    print(f"    {nb}: {B['deltas']}")
    print("\n  Large deltas (~200) mean contrast carries the cut; small ones (<30)")
    print("  mean motion has to. A film that has neither reads as a slideshow.")
    print("  Compare `moving frames` honestly: matching a reference's pacing while")
    print("  moving twice as much is the most common way to miss its feel.")

# ----------------------------------------------------------------------- fit

def cmd_fit(a):
    d = [abs(float(x)) for x in a.series.split(",") if x.strip()]
    d = [x for x in d if x > 0]
    if len(d) < 3:
        sys.exit("need >=3 non-zero deltas")
    r = (d[-1] / d[0]) ** (1 / (len(d) - 1))
    tau = -1 / (a.fps * math.log(r)) if 0 < r < 1 else float("inf")
    print(f"n={len(d)}  first={d[0]:g}  last={d[-1]:g}")
    print(f"decay ratio r = {r:.3f} per frame")
    print(f"time constant tau = {tau*1000:.0f} ms  @ {a.fps}fps")
    print(f"total travel = {sum(d):g} px")
    print("\nratios step to step: " +
          ", ".join(f"{d[i+1]/d[i]:.2f}" for i in range(len(d)-1) if d[i]))
    if r >= 1:
        print("\nr >= 1: this is ACCELERATING — an ease-IN, i.e. an exit. If it is")
        print("still accelerating on the last frame, the shot was CUT MID-MOVE.")
    else:
        print(f"\nr < 1: decelerating ease-OUT. Roughly cubic-bezier equivalent:")
        print("  fast-out-slow-in; fit against your codebase's curve rather than")
        print("  inventing one. Reversing this series gives the matching exit.")

# ----------------------------------------------------------------------- cli

def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, fn, needs_file=True):
        s = sub.add_parser(name)
        if needs_file: s.add_argument("file")
        s.set_defaults(fn=fn)
        return s

    add("info", cmd_info)

    s = add("cuts", cmd_cuts)
    s.add_argument("--fps", type=float, default=None,
                   help="override; read from the file by default")
    s.add_argument("--yavg", type=float, default=8.0)
    s.add_argument("--luma-delta", type=int, default=25)

    s = add("sheet", cmd_sheet)
    s.add_argument("--from", dest="frm", type=int, required=True)
    s.add_argument("--to", type=int, required=True)
    s.add_argument("--every", type=int, default=5)
    s.add_argument("--cols", type=int, default=5)
    s.add_argument("--w", type=int, default=380)
    s.add_argument("--crop", default=None, help="w:h:x:y")
    s.add_argument("--color", default="00aa00")
    s.add_argument("--out", required=True)

    s = add("track", cmd_track)
    s.add_argument("--from", dest="frm", type=int, required=True)
    s.add_argument("--to", type=int, required=True)
    s.add_argument("--axis", choices=["x", "y"], required=True)
    s.add_argument("--pol", choices=["dark", "light"], default="dark")
    s.add_argument("--thr", type=int, default=None)
    s.add_argument("--crop", default=None, help="w:h:x:y")

    s = add("ink", cmd_ink)
    s.add_argument("--from", dest="frm", type=int, required=True)
    s.add_argument("--to", type=int, required=True)
    s.add_argument("--pol", choices=["dark", "light"], default="dark")
    s.add_argument("--thr", type=int, default=None)
    s.add_argument("--step", type=int, default=400)

    s = add("scale", cmd_scale)
    s.add_argument("--from", dest="frm", type=int, required=True)
    s.add_argument("--to", type=int, required=True)
    s.add_argument("--band", required=True, help="lo,hi luma of the element's fill")

    s = add("color", cmd_color)
    s.add_argument("--frame", type=int, default=0)
    s.add_argument("--at", action="append", required=True, help="x,y[,label]")

    s = add("type", cmd_type)
    s.add_argument("--frame", type=int, default=0)
    s.add_argument("--crop", default=None,
                   help="w:h:x:y — scope to one region. REQUIRED on any frame "
                        "with more than one ground, or the band scan matches "
                        "the whole image.")
    s.add_argument("--pol", choices=["dark", "light"], default="dark")
    s.add_argument("--thr", type=int, default=None)

    s = add("framing", cmd_framing)
    s.add_argument("--frame", type=int, default=0)
    s.add_argument("--gap", type=float, default=18.0,
                   help="min corner-vs-centre channel difference to call it "
                        "framed (default 18)")
    s.add_argument("--edge", type=float, default=6.0,
                   help="min sharpness for a window edge to count (default 6)")

    s = add("hist", cmd_hist)
    s.add_argument("--frame", type=int, default=0)

    s = add("grid", cmd_grid)
    s.add_argument("--frame", type=int, default=0)
    s.add_argument("--step", type=int, default=100)
    s.add_argument("--out", required=True)

    s = add("audio", cmd_audio)
    s.add_argument("--window", type=float, default=1.0,
                   help="RMS envelope window in seconds (default 1.0)")

    s = add("report", cmd_report)
    s.add_argument("--luma-delta", type=int, default=25)

    s = add("compare", cmd_compare)
    s.add_argument("other", help="the second file — usually our own render")
    s.add_argument("--label", default=None)
    s.add_argument("--other-label", default=None)
    s.add_argument("--yavg", type=float, default=8.0)
    s.add_argument("--luma-delta", type=int, default=25)

    s = add("fit", cmd_fit, needs_file=False)
    s.add_argument("--series", required=True, help="comma-separated per-frame deltas")
    s.add_argument("--fps", type=float, default=30)

    a = p.parse_args()
    if getattr(a, "thr", None) is None and hasattr(a, "pol"):
        a.thr = 90 if a.pol == "dark" else 128
    a.fn(a)

if __name__ == "__main__":
    main()
