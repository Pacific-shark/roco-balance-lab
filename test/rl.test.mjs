import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  qUpdate,
  train,
  learnedPolicy,
  legalMoves,
  assess,
} from "../src/rl.mjs";
import { createFighter } from "../src/engine.mjs";
import { makeReport } from "../src/report.mjs";
import { defaultPatch } from "../src/data.mjs";
test("Q update uses terminal reward without bootstrapping from future state", () => {
  const q = { s: { m: 0.2 }, next: { m: 100 } };
  qUpdate(q, "s", "m", 1, "next", ["m"], true, 0.5, 0.9);
  assert.ok(Math.abs(q.s.m - 0.6) < 1e-12);
  qUpdate(q, "s", "m", 0, "next", ["m"], false, 1, 0.9);
  assert.equal(q.s.m, 90);
});
test("two agents really learn and same seed gives identical model", () => {
  const a = train({ episodes: 300, seed: 7 }),
    b = train({ episodes: 300, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.agents.length, 2);
  assert.ok(a.states.every((n) => n > 0));
  assert.ok(
    Object.values(a.agents[0].q).some((row) =>
      Object.values(row).some((v) => v !== 0),
    ),
  );
  const c = train({ episodes: 300, seed: 8 });
  assert.notDeepEqual(a.agents, c.agents);
});
test("frozen evaluation cannot update Q tables; all selected actions stay legal", async () => {
  const model = JSON.parse(
    await readFile(
      new URL("../public/models/selfplay-42.json", import.meta.url),
      "utf8",
    ),
  );
  const hash = () =>
    createHash("sha256").update(JSON.stringify(model.agents)).digest("hex");
  const before = hash();
  const a = createFighter("029"),
    b = createFighter("007");
  const policy = learnedPolicy(model.agents[0]);
  assert.ok(legalMoves(a).includes(policy(a, b, 1).id));
  const result = assess(model, "020");
  assert.equal(hash(), before);
  assert.equal(result.skills.length, 4);
  assert.ok(Number.isFinite(result.coverageDelta));
  const report = makeReport(
    result.base,
    null,
    defaultPatch("020"),
    "测试假设",
    "证据不足",
    model,
  );
  assert.match(report, /24000/);
  assert.match(report, /未运行调整/);
  assert.match(report, /independent-q-v1/);
});
test("training rejects invalid counts and NaN seed", () => {
  assert.throws(() => train({ episodes: 0 }));
  assert.throws(() => train({ seed: NaN }));
});
