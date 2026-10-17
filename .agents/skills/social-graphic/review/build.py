"""Build the review gallery: one page with every rendered poster, a Keep / Update / Drop mark and a note on each.

    python3 .agents/skills/social-graphic/review/build.py <out dir> "Section title=out/social/<name>" ["…=…" …]

Writes <out dir>/index.html and <out dir>/img/*.jpg (1600 px) and prints the `files` map for the Artifact publish.
Publish with capabilities {"db": {}}; notes land in the artifact's "notes" collection, one document per poster id
({status: keep|update|drop|"", note, updatedAt}). Read them back with ArtifactData list collection "notes".
"""
import glob, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
out = os.path.abspath(sys.argv[1]); os.makedirs(os.path.join(out, "img"), exist_ok=True)
items, sections = [], []
for spec in sys.argv[2:]:
    title, folder = spec.split("=", 1)
    key = re.sub(r"[^a-z0-9]+", "-", os.path.basename(folder.rstrip("/")).lower()).strip("-")
    pngs = sorted(f for f in glob.glob(os.path.join(folder, "*.png")) if not f.endswith(".feed.png") and not os.path.basename(f).startswith("_"))
    sections.append({"key": key, "title": title, "sub": f"{len(pngs)} posters from {folder}"})
    for f in pngs:
        name = os.path.basename(f)[:-4]
        html = open(f[:-4] + ".html").read() if os.path.exists(f[:-4] + ".html") else ""
        fmt = (re.search(r'data-archetype="([^"]+)"', html) or [None, "?"])[1]
        ground = (re.search(r'class="post (paper|yellow|carbon)', html) or [None, "?"])[1]
        lit = "data-light" in html or 'class="grain"' in html
        iid = f"{key}--{name}"
        jpg = f"img/{iid}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f, "-vf", "scale=1600:-2", "-q:v", "4", os.path.join(out, jpg)], check=True)
        label = re.sub(r"^\d+-(\d{4}-\d\d-\d\d-)?", lambda m: m.group(0)[:3], name).replace("-", " ").strip()
        items.append({"id": iid, "section": key, "label": label, "ground": {"paper": "White", "yellow": "Yellow", "carbon": "Dark"}.get(ground, ground), "meta": fmt + (" · lit" if lit else ""), "src": jpg})
page = open(os.path.join(HERE, "page.html")).read()
page = page.replace("__ITEMS__", json.dumps(items)).replace("__SECTIONS__", json.dumps(sections))
open(os.path.join(out, "index.html"), "w").write(page)
files = {it["src"]: it["src"] for it in items}
json.dump(files, open(os.path.join(out, "files.json"), "w"))
print(f"{len(items)} posters in {len(sections)} sections → {out}/index.html  (files map: {out}/files.json)")
