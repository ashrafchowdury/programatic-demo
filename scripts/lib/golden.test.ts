import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ClickLog } from "../../src/lib/click-log";
import {
  compareClips,
  compareMetrics,
  footageParity,
  lengthOk,
} from "./golden";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../src/lib/__fixtures__/${name}.clicks.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ClickLog;

describe("golden comparisons", () => {
  it("pairs each clip with the hand clip that shows its first beat, and holds starts ±0.35s, ends ±0.75s", () => {
    const { rows, unshown, ok } = compareClips(
      [
        { fromS: 1.4, toS: 3.0, firstBeatS: 1.49, label: "Add skill" },
        { fromS: 4.0, toS: 9.8, firstBeatS: 4.54, label: "name the skill" },
      ],
      [
        { fromS: 1.45, toS: 3.15 },
        { fromS: 4.5, toS: 8.9 },
      ],
    );
    assert.deepEqual(
      rows.map((r) => [r.hand, r.ok]),
      [
        [1, true],
        [2, false],
      ],
    );
    assert.ok(Math.abs(rows[1].dStart! + 0.5) < 1e-9);
    assert.deepEqual(unshown, []);
    assert.equal(ok, false);
  });

  it("compares only the outer edges of a hand clip two beats share", () => {
    const { rows, ok } = compareClips(
      [
        { fromS: 1.94, toS: 6.45, firstBeatS: 1.98, label: "type slash" },
        {
          fromS: 6.55,
          toS: 8.6,
          firstBeatS: 6.59,
          label: "click /permissions",
        },
      ],
      [{ fromS: 1.85, toS: 8.35 }],
    );
    assert.deepEqual(
      rows.map((r) => [
        r.dStart === null ? null : Number(r.dStart.toFixed(2)),
        r.dEnd === null ? null : Number(r.dEnd.toFixed(2)),
        r.note,
      ]),
      [
        [0.09, null, "end inside hand clip 1, which has no cut there"],
        [null, 0.25, "start inside hand clip 1, which has no cut there"],
      ],
    );
    assert.equal(ok, true);
  });

  it("pairs a hand clip that enters just after the press", () => {
    const { rows } = compareClips(
      [{ fromS: 5.14, toS: 10.9, firstBeatS: 5.44, label: "search 1327 apps" }],
      [
        { fromS: 0.4, toS: 5.3 },
        { fromS: 5.5, toS: 11.2 },
      ],
    );
    assert.equal(rows[0].hand, 2);
  });

  it("fails a beat no hand clip shows, and a hand clip nothing pairs with", () => {
    const { rows, unshown, ok } = compareClips(
      [{ fromS: 10, toS: 12, firstBeatS: 10.3, label: "Done" }],
      [{ fromS: 1, toS: 3 }],
    );
    assert.equal(rows[0].note, 'no hand clip shows "Done"');
    assert.deepEqual(unshown, [1]);
    assert.equal(ok, false);
  });

  it("excuses a deliberate edit from the range check only", () => {
    const { rows } = compareClips(
      [{ fromS: 0.4, toS: 5.3, firstBeatS: 1.47, label: "Add tool" }],
      [{ fromS: 1.2, toS: 5.3 }],
      {
        1: "opens on the empty panel",
      },
    );
    assert.equal(rows[0].ok, true);
    assert.equal(rows[0].deliberate, "opens on the empty panel");
  });

  it("holds length to the house maximum", () => {
    assert.equal(lengthOk(29.9, 30), true);
    assert.equal(lengthOk(30.2, 30), false);
  });

  it("passes a re-shoot that only shifted, and names a missing label", () => {
    const parity = footageParity(
      fixture("brief-reshoot"),
      fixture("brief-basic"),
      1.25,
    );
    assert.equal(parity.ok, true);
    assert.equal(parity.rows.length, 7);
    const short = {
      ...fixture("brief-basic"),
      clicks: fixture("brief-basic").clicks.slice(0, 6),
    };
    const missing = footageParity(short, fixture("brief-basic"), 1.25);
    assert.equal(missing.ok, false);
    assert.equal(
      missing.firstDiff,
      'label 7: composed "(none)" vs hand "Create"',
    );
  });

  it("calls a metric worse by its distance from the style target", () => {
    const base = {
      meanShotS: 2.5,
      cutsPerMin: 20,
      movingFrac: 0.5,
      longestStillF: 40,
      footageLongestFrozenS: 0,
    };
    const rows = compareMetrics({ ...base, movingFrac: 0.3 }, base, {
      movingFrac: 0.678,
      meanShotS: 4.67,
    });
    const moving = rows.find((r) => r.metric === "movingFrac")!;
    assert.ok(Math.abs(moving.worseBy - 0.2) < 1e-9);
    assert.equal(moving.ok, false);
    assert.deepEqual(
      rows.filter((r) => !r.ok).map((r) => r.metric),
      ["movingFrac"],
    );
  });
});
