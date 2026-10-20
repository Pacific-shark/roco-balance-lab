import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  kernelCatalog, sourceLegalMoves, createKernelBattle, stepKernelBattle,
  kernelCarriedMoveCost, kernelMoveCost, addKernelMark,
} from "../src/battle-kernel.mjs";
import { compileMove } from "../src/battle-programs.mjs";
import { presetBuild } from "../src/team-stats.mjs";

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url)));
const snapshot = await read("../data/catalog-s4-20261015.json");
const scope = await read("../docs/evidence/open-roster-pilot.json");
const legacy = await read("../public/data/team-2026-10-14.json");
const data = kernelCatalog(snapshot, legacy.types);
const water = "pet_000005", shark = "pet_000106";
const helpers = ["pet_000028", "pet_000007", "pet_000006", "pet_000034", "pet_000076"];
const skill = (name) => Object.keys(data.programs).find((id) => data.programs[id].name === name);
function member(id, names, bloodline = 2) {
  return {
    id, bloodline, ...presetBuild(data.creatures[id]),
    moves: names ? names.map(skill) : [...sourceLegalMoves(data, { id, bloodline })]
      .filter((id) => data.programs[id].status === "compiled").slice(0, 4),
  };
}
function fixture() {
  const teams = [
    [member(water, ["甩水", "润泽", "水泡盾", "寒风吹"]),
      member(shark, ["贮藏", "天洪", "针状物", "寒风吹"], 18),
      ...helpers.slice(0, 4).map((id) => member(id))],
    [water, ...helpers].map((id) => member(id)),
  ];
  return createKernelBattle(data, teams, { purpose: "mechanism-test" });
}

test("bloodline ids map to source labels across every candidate, preserving independent learning paths", () => {
  for (const candidate of scope.candidates) {
    const creature = data.creatures[candidate.id], l = data.learnsets[creature.learnset_id];
    const common = [...l.native_skills.filter((v) => v.level <= 60 && (v.stage ?? 1) <= creature.stage).map((v) => v.skill), ...l.skill_stones];
    for (const b of data.bloodlines.filter((b) => b.id <= 19)) {
      const expected = new Set([...common, ...l.blood_skills.filter((v) => v.blood === b.name && Number.isInteger(v.level) && v.level <= 60).map((v) => v.skill)]);
      assert.deepEqual(sourceLegalMoves(data, { id: candidate.id, bloodline: b.id }), expected, `${candidate.name}/${b.name}`);
    }
  }
  assert.ok(sourceLegalMoves(data, { id: shark, bloodline: 18 }).has(skill("针状物")));
  assert.ok(!sourceLegalMoves(data, { id: shark, bloodline: 2 }).has(skill("针状物")));
  assert.throws(() => sourceLegalMoves(data, { id: shark, bloodline: "幻" }), /explicit known bloodline/);
  assert.throws(() => sourceLegalMoves(data, { id: shark, bloodline: 23 }), /unresolved/);
});

test("a bloodline-only move works in a battle but is rejected after an incompatible bloodline change", () => {
  assert.doesNotThrow(fixture);
  const invalid = [member(shark, ["贮藏", "天洪", "针状物", "寒风吹"], 2), ...helpers.map((id) => member(id))];
  const opponents = [water, ...helpers].map((id) => member(id));
  assert.throws(() => createKernelBattle(data, [invalid, opponents], { purpose: "mechanism-test" }), /source inconsistent/);
});

test("stockpile without preparation grants only its base bonus and rejects unknown appended effects", () => {
  const state = fixture();
  stepKernelBattle(data, state, ["switch:1", "switch:0"]);
  const events = stepKernelBattle(data, state, ["move:0", "focus"]);
  const p = state.teams[0].pets[1];
  assert.equal(p.buffs.atk, 0.5);
  assert.equal(p.buffs.spa, 0.5);
  assert.equal(events.find((e) => e.kind === "carried-cost-snapshot").zeroCostCount, 0);
  const raw = snapshot.modules.Skills[skill("贮藏")];
  assert.equal(compileMove("x", { ...raw, desc: raw.desc + "交换双方特性。" }).status, "unsupported");
});

test("three actual allied water actions prepare shark's entry and its current-cost stockpile bonus", () => {
  const state = fixture();
  stepKernelBattle(data, state, ["switch:0", "switch:0"]);
  for (let i = 0; i < 3; i++) stepKernelBattle(data, state, ["move:0", "focus"]);
  assert.equal(state.teams[0].typeUses.水, 3);
  stepKernelBattle(data, state, ["switch:1", "focus"]);
  const p = state.teams[0].pets[1];
  assert.equal(p.cost, -3);
  const costs = p.moves.map((_, i) => kernelCarriedMoveCost(data, state, 0, i));
  assert.deepEqual(costs, [0, 4, 0, 0]);
  const restored = JSON.parse(JSON.stringify(state));
  const events = stepKernelBattle(data, state, ["move:0", "focus"]);
  stepKernelBattle(data, restored, ["move:0", "focus"]);
  assert.deepEqual(restored, state);
  assert.equal(p.buffs.atk, 2);
  assert.equal(p.buffs.spa, 2);
  assert.deepEqual(events.find((e) => e.kind === "carried-cost-snapshot").costs, costs);
  // The stockpile itself counts when it is zero cost; the original catalog
  // has no zero-cost move in these four slots, so counting base costs fails.
  stepKernelBattle(data, state, ["switch:0", "focus"]);
  assert.equal(p.buffs.atk, 0);
  assert.equal(p.cost, 0);
  stepKernelBattle(data, state, ["switch:1", "focus"]);
  assert.equal(p.cost, -3); // re-entry does not compound the same three uses twice
});

test("stockpile count changes with lasting slot modifiers and team marks", () => {
  const state = fixture();
  stepKernelBattle(data, state, ["switch:1", "switch:0"]);
  const p = state.teams[0].pets[1];
  p.moves[1].cost = -7; // explicit mechanism fixture: permanent cost reduction
  addKernelMark(state, 0, "湿润", 2, { kind: "fixture" });
  assert.deepEqual(p.moves.map((_, i) => kernelCarriedMoveCost(data, state, 0, i)), [0, 0, 1, 1]);
  const events = stepKernelBattle(data, state, ["move:0", "focus"]);
  assert.equal(p.buffs.spa, 1.5);
  assert.equal(events.find((e) => e.kind === "carried-cost-snapshot").zeroCostCount, 2);
});

test("carried costs handle choice headers and exclude one-use discounts in the provisional model", () => {
  const state = fixture();
  stepKernelBattle(data, state, ["switch:1", "switch:0"]);
  const p = state.teams[0].pets[1];
  // Injected boundary fixture; these are not claimed as shark's legal moves.
  p.moves[2].id = skill("补觉");
  p.moves[3].id = skill("超导");
  p.moves[3].cost = -1;
  assert.equal(kernelCarriedMoveCost(data, state, 0, 2), 2);
  assert.equal(kernelCarriedMoveCost(data, state, 0, 3), 2);
  assert.equal(kernelMoveCost(data, state, 0, 3), 0);
  assert.doesNotThrow(() => stepKernelBattle(data, state, ["move:0", "focus"]));
  assert.equal(p.buffs.spa, 0.5);
});
