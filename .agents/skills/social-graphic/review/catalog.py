"""Write every format a brand allows, on every ground it allows, into social/_catalog/ so one render shows the whole collection.

    python3 .agents/skills/social-graphic/review/catalog.py [--brand <pack dir>]
    pnpm exec tsx .agents/skills/social-graphic/render.mts _catalog

Dark templates are re-roled onto light grounds (carbon surfaces become paper, on-dark text becomes ink), and on an accent ground
anything that was the accent turns to the panel colour, so each variant keeps exactly one accent moment.
"""
import json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(SKILL, "..", "..", ".."))
args = sys.argv[1:]
pack = args[args.index("--brand") + 1] if "--brand" in args else os.environ.get("SOCIAL_BRAND", ".agents/skills/agenta-social-graphic/brand")
brand = json.load(open(os.path.join(ROOT, pack, "brand.json")))
T = os.path.join(SKILL, "kit", "templates")
D = os.path.join(ROOT, "social", "_catalog")
shutil.rmtree(D, ignore_errors=True)
shutil.copytree(os.path.join(T, "assets"), os.path.join(D, "assets"))
open(os.path.join(D, "brand"), "w").write(pack + "\n")

LIGHT_ROLES = "--dark: var(--panel); --dark-2: var(--tint); --dark-3: var(--panel-2); --dark-line: var(--line); --on-dark: var(--ink); --on-dark-2: var(--ink-2);"
formats = sorted(f[:-5] for f in os.listdir(T) if f.endswith(".html"))
allowed = formats if brand["archetypes"] == "all" else [f for f in formats if f in brand["archetypes"]]
grounds = brand.get("grounds") or ["paper", "yellow", "carbon"]
n = 0
for fmt in allowed:
    src = open(os.path.join(T, f"{fmt}.html")).read()
    native = re.search(r'class="post (paper|carbon|yellow)"', src).group(1)
    for g in grounds:
        # light-led formats are built for one ground; don't force them onto another
        if fmt in ("daylight", "window", "studio", "field", "aurora", "prompt", "milestone", "connect", "tiles") and g != "paper": continue
        if fmt == "spotlight" and g != "yellow": continue
        if fmt == "sunrise" and g != "yellow": continue
        if g not in brand.get("formatGrounds", {}).get(fmt, [g]): continue
        h = re.sub(r'class="post (paper|carbon|yellow)"', f'class="post {g}"', src, count=1)
        if native == "carbon" and g != "carbon":
            h = h.replace("<main ", f'<main style="{LIGHT_ROLES}" ', 1)
            for a, b in [("logo-dark-accent.svg", "logo-light.svg"), ("logo-dark.svg", "logo-light.svg"), ("mark-dark-accent.svg", "mark-light.svg"), ("mark-dark.svg", "mark-light.svg")]:
                h = h.replace(a, b)
        if g == "yellow":
            h = h.replace("btn primary", "btn dark").replace("ag-btn primary", "ag-btn dark")
            h = h.replace("mark-dark-accent.svg", "mark-dark.svg").replace("logo-dark-accent.svg", "logo-dark.svg")
            h = h.replace("background:var(--accent)", "background:var(--panel)").replace('y: "var(--accent)"', 'y: "var(--panel)"')
            h = h.replace('<div class="accent-block" style="', '<div style="background:var(--panel);')
        h = h.replace("color:var(--accent);font-size:calc(1em * var(--cap-display) / var(--cap-accent))",
                      "color:var(--ink);background:var(--tint);border-radius:var(--r-md);padding:0 0.1em;font-size:calc(1em * var(--cap-display) / var(--cap-accent))") if g != "carbon" else h
        open(os.path.join(D, f"{fmt}-{g}.html"), "w").write(h)
        n += 1
print(f"{n} variants of {len(allowed)} formats for {brand['name']} → social/_catalog/")
