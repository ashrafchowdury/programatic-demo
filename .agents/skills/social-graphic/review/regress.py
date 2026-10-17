"""Regression test for the audit: four posters rebuilt from a real broken series (2026-10-16). Each must fail with its defect.

    python3 .agents/skills/social-graphic/review/regress.py [--brand <pack dir>]

Run it after any change to render.mts or the kit. It exits non-zero if the audit lets one of these defects through.
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
args = sys.argv[1:]
pack = args[args.index("--brand") + 1] if "--brand" in args else ".agents/skills/agenta-social-graphic/brand"
work = os.path.join(ROOT, "social", "_regress")
shutil.rmtree(work, ignore_errors=True)
shutil.copytree(os.path.join(HERE, "regress"), work)
open(os.path.join(work, "brand"), "w").write(pack + "\n")
run = subprocess.run(["pnpm", "exec", "tsx", ".agents/skills/social-graphic/render.mts", "_regress"], cwd=ROOT, capture_output=True, text=True)
out = run.stdout + run.stderr
expect = {
    "01-title-case-chip": ["Title Case"],
    "02-small-chat": ["spills out of", "subject is too small"],
    "03-tiny-screenshot": ["mush in the feed", "subject is too small"],
    "04-diagram": ["Title Case", "subject is too small"],
    "05-title-covered": ["covers the title"],
    "06-glyph-icon": ["fell back to"],
    "series": ["use the accent face"],
}
blocks, cur = {}, None
for line in out.splitlines():
    if line.startswith(("ok ", "FAIL ")):
        cur = line.split()[1]
    elif line.startswith("series"):
        cur = "series"
    if cur:
        blocks.setdefault(cur, []).append(line)
missed = [f"{k}: {m}" for k, ms in expect.items() for m in ms if m not in "\n".join(blocks.get(k, []))]
shutil.rmtree(work, ignore_errors=True)
shutil.rmtree(os.path.join(ROOT, "out", "social", "_regress"), ignore_errors=True)
if missed:
    print("the audit let these defects through:\n  " + "\n  ".join(missed))
    sys.exit(1)
print(f"audit regression: all {sum(len(v) for v in expect.values())} known defects caught")
