"""Internal A/B: score each post's three candidates, lay them side by side, and promote the winner. The user only ever sees the winner.

    pnpm exec tsx .agents/skills/social-graphic/render.mts <name> --candidates     # renders social/<name>/_candidates/
    python3 .agents/skills/social-graphic/review/ab.py <name>                       # scores + one comparison sheet per post
    python3 .agents/skills/social-graphic/review/ab.py <name> --promote 01-…=b 02-…=a   # copy the chosen ones into the series
    python3 .agents/skills/social-graphic/review/ab.py <name> --promote auto            # or take the top score for every post
    python3 .agents/skills/social-graphic/review/ab.py --baselines                       # after rendering _catalog: store each format's own measurements

Candidates are named <post>--a.html, <post>--b.html, <post>--c.html, where <post> is the final file's name
(01-2026-10-16-agents-on-whatsapp). Promoting copies the winner to social/<name>/<post>.html.

The score only ranks what can be measured: a candidate with any audit error is out, and the rest lose points for warnings, an empty
or crowded canvas, off-centre weight and a title-to-subject gap away from 6.5 %H. Each is measured against the format's own template
(the brand pack's baselines.json, from the catalog render), so a format is never marked down for what its design is: hub, window
and milestone are airy, monogram and bento-split sit off-centre. Without baselines, the sparse and asymmetric premium formats lost
to any centred title over a card. It cannot tell whether the picture says what the
message says. Open each sheet and make that call yourself: message fit first, then cleanliness. Take a lower-scoring candidate when
it tells the message better, and write why in plan.md.
"""
import json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
args = sys.argv[1:]
if not args:
    sys.exit(__doc__)


def pack_of(series):
    f = os.path.join(ROOT, "social", series, "brand")
    return open(f).read().strip() if os.path.exists(f) else os.environ.get("SOCIAL_BRAND", ".agents/skills/social-graphic/brands/example")


if args[0] == "--baselines":
    # one row per format: the template's own bare ground, weight and warnings, averaged over the grounds it renders on
    cat = os.path.join(ROOT, "out", "social", "_catalog", "_report.json")
    if not os.path.exists(cat):
        sys.exit("render the catalog first: review/catalog.py, then render.mts _catalog")
    base = {}
    for r in json.load(open(cat)):
        if r["errors"]:
            continue
        b = base.setdefault(r["archetype"], {"bare": [], "weight": [], "warnings": set()})
        b["bare"].append(r["bare"]); b["weight"].append(r["weight"])
        b["warnings"] |= {w.split(":")[0] for w in r["warnings"]}
    out = {k: {"bare": round(sum(v["bare"]) / len(v["bare"]), 3), "weight": round(sum(v["weight"]) / len(v["weight"]), 3), "warnings": sorted(v["warnings"])} for k, v in sorted(base.items())}
    dest = os.path.join(ROOT, pack_of("_catalog"), "baselines.json")
    json.dump(out, open(dest, "w"), indent=1)
    print(f"{len(out)} format baselines → {os.path.relpath(dest, ROOT)}")
    sys.exit(0)

name = args[0]
post_dir = os.path.join(ROOT, "social", name)
cand_dir = os.path.join(post_dir, "_candidates")
out_dir = os.path.join(ROOT, "out", "social", name, "_candidates")
report_path = os.path.join(out_dir, "_report.json")
if not os.path.exists(report_path):
    sys.exit(f"no report at {os.path.relpath(report_path, ROOT)}: render the candidates first with --candidates")
rows = json.load(open(report_path))
base_path = os.path.join(ROOT, pack_of(name), "baselines.json")
BASE = json.load(open(base_path)) if os.path.exists(base_path) else {}
if not BASE:
    print(f"no {os.path.relpath(base_path, ROOT)}: scoring without format baselines (run --baselines after rendering _catalog)")


def score(r):
    """100 for a clean poster; points off for each measured problem. None when the audit failed it."""
    if r["errors"]:
        return None
    s = 100.0
    b = BASE.get(r["archetype"], {})
    # a warning the format's own template carries is its design, not this candidate's fault
    s -= 8 * len([w for w in r["warnings"] if w.split(":")[0] not in b.get("warnings", [])])
    bare = r["bare"] * 100
    # only the extremes: flat formats on white are meant to be airy, so 25-88 % bare costs nothing, nor up to the template's own
    if bare < 25: s -= (25 - bare) * 0.6        # crowded: no air around the subject
    empty = max(88, b.get("bare", 0) * 100 + 3)
    if bare > empty: s -= (bare - empty) * 1.0  # emptier than the format is meant to be
    # off-centre weight, past the template's own offset (monogram and bento-split are asymmetric by design)
    s -= max(0, abs(r["weight"] - 0.5) - abs(b.get("weight", 0.5) - 0.5)) * 120
    if r.get("gap") is not None:
        s -= abs(r["gap"] - 6.5) * 3            # title and subject drifting from the house rhythm
    return round(max(s, 0), 1)


posts = {}
for r in rows:
    m = re.match(r"(.+)--([a-z])$", r["variant"])
    if not m:
        continue
    posts.setdefault(m.group(1), []).append((m.group(2), r, score(r)))

if "--promote" in args:
    picks = args[args.index("--promote") + 1:]
    chosen = {}
    if picks == ["auto"]:
        for post, cs in posts.items():
            ok = [c for c in cs if c[2] is not None]
            if ok:
                chosen[post] = max(ok, key=lambda c: c[2])[0]
    else:
        for p in picks:
            post, letter = p.rsplit("=", 1)
            chosen[post] = letter
    for post, letter in chosen.items():
        src = os.path.join(cand_dir, f"{post}--{letter}.html")
        if not os.path.exists(src):
            sys.exit(f"no candidate {os.path.relpath(src, ROOT)}")
        row = next(c for c in posts.get(post, []) if c[0] == letter)
        if row[2] is None:
            sys.exit(f"{post}--{letter} failed the audit; fix it or pick another")
        shutil.copy(src, os.path.join(post_dir, f"{post}.html"))
        print(f"promoted {post}--{letter}  [{row[1]['archetype']} · {row[1]['ground']}]  score {row[2]}")
    sys.exit(0)

lines = ["# Internal A/B", "", "Scores rank only what can be measured; the final pick is message fit first, then cleanliness.", ""]
for post in sorted(posts):
    cs = sorted(posts[post], key=lambda c: c[0])
    ranked = sorted([c for c in cs if c[2] is not None], key=lambda c: -c[2])
    lines += [f"## {post}", "", "| | format | ground | score | notes |", "| --- | --- | --- | --- | --- |"]
    for letter, r, sc in cs:
        notes = "; ".join(r["errors"] or r["warnings"])[:160]
        lines.append(f"| {letter} | {r['archetype']} | {r['ground']} | {'out' if sc is None else sc} | {notes} |")
    lines += ["", f"Top score: {ranked[0][0] if ranked else 'none passed'}", ""]
    # one sheet per post: the three feed previews side by side, in letter order
    feeds = [r["feed"] for _, r, _ in cs if os.path.exists(r["feed"])]
    if feeds:
        ins = sum([["-i", f] for f in feeds], [])
        fc = ";".join(f"[{j}]scale=568:-2,pad=580:ih:6:0:color=gray[s{j}]" for j in range(len(feeds))) + ";" + "".join(f"[s{j}]" for j in range(len(feeds))) + f"hstack=inputs={len(feeds)}"
        if len(feeds) == 1:
            fc = "[0]scale=568:-2[s0];[s0]null"
        subprocess.run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", fc, "-frames:v", "1", os.path.join(out_dir, f"{post}.ab.png")], check=True)
    print(f"{post}: " + "  ".join(f"{l}={'out' if sc is None else sc}" for l, _, sc in cs) + f"   → top {ranked[0][0] if ranked else '-'}")
open(os.path.join(out_dir, "_ab.md"), "w").write("\n".join(lines))
print(f"\nsheets: {os.path.relpath(out_dir, ROOT)}/<post>.ab.png (a | b | c)   table: {os.path.relpath(out_dir, ROOT)}/_ab.md")
