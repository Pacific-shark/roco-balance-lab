import test from "node:test";
import assert from "node:assert/strict";
import { auditPvpBaseline } from "../scripts/audit-pvp-baseline.mjs";

test("observed baseline retains all 24 slots, correct bloodline routes and unresolved execution gaps", async () => {
  const report = await auditPvpBaseline();
  assert.equal(report.counts.sourceConsistentSlots, 24);
  assert.equal(report.members.find((m) => m.name === "彩蝶鲨").bloodline, "幽");
  assert.deepEqual(report.members.find((m) => m.name === "彩蝶鲨").moves[2].paths, ["幽血脉"]);
  assert.equal(report.members.find((m) => m.name === "水灵").moves[2].name, "气泡");
  assert.ok(report.missingMoves.some((m) => m.name === "晒太阳"));
  assert.ok(report.missingMoves.some((m) => m.name === "彗星"));
  assert.equal(report.missingMovesSubstituted, false);
  assert.equal(report.trainingAllowed, false);
  assert.equal(report.modelAllocated, false);
  assert.equal(report.members.every((m) => m.sourceAptitudeValues === null), true);
});
