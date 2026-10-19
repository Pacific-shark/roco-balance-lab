import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { kernelCatalog, sourceLegalMoves, createKernelBattle, stepKernelBattle,
  applyKernelDamage, addKernelMark, addKernelStatus } from "../src/battle-kernel.mjs";
import { compileMove, compileTrait } from "../src/battle-programs.mjs";
import { presetBuild } from "../src/team-stats.mjs";
const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url)));
const snapshot = await read("../data/catalog-s4-20261015.json");
const data = kernelCatalog(snapshot, (await read("../public/data/team-2026-10-14.json")).types);
const skill = (name) => Object.keys(data.programs).find((id) => data.programs[id].name === name);
const helperIds = ["pet_000005", "pet_000028", "pet_000007", "pet_000006", "pet_000034"];
function member(id, names) {
  return { id, bloodline: 5, ...presetBuild(data.creatures[id]),
    moves: names ? names.map(skill) : [...sourceLegalMoves(data, { id, bloodline: 5 })]
      .filter((k) => data.programs[k].status === "compiled").slice(0, 4) };
}
function fixture(enemy = "pet_000005", enemyMoves = ["气泡", "防御", "润泽", "寒风吹"]) {
  const a = member("pet_000071", ["倾泻", "高温回火", "幽灵爆发", "虹光冲击"]);
  const b = member(enemy, enemyMoves);
  const state = createKernelBattle(data, [[a, ...helperIds.map((id) => member(id))],
    [b, ...["pet_000174", ...helperIds].filter((id) => id !== enemy).slice(0, 5).map((id) => member(id))]], { purpose: "mechanism-test" });
  stepKernelBattle(data, state, ["switch:0", "switch:0"]);
  return state;
}

test("observed firebird damage transition: 286/354, incoming 320, one HP and enemy burn 15", () => {
  // This is a partial transition fixture, not a six-on-six replay. The opponent's
  // unsupported intrinsic trait is preserved and not executed by this primitive.
  const row = (id) => ({ id, types: data.creatures[id].types.map((t) => t.replace(/系$/, "")),
    program: data.programs[data.creatures[id].feature_skill_id], hp: 100,
    statuses: { 冻结: 0, 灼烧: 0 }, statusImmunities: [], lethalSurvivalUsed: false });
  const fire = { ...row("pet_000071"), hp: 286, maxHp: 354 };
  const foe = row("pet_000505"); // 离心舞者; its trait is not replaced with an empty program.
  const state = { round: null, events: [], teams: [{ active: 0, pets: [fire] }, { active: 0, pets: [foe] }] };
  assert.equal(applyKernelDamage(data, state, 0, fire, 320, { kind: "observed-attack" }), 285);
  assert.equal(fire.hp, 1);
  assert.equal(foe.statuses.灼烧, 15);
  assert.equal(fire.lethalSurvivalUsed, true);
  assert.equal(state.events.filter((e) => e.kind === "survive-lethal").length, 1);
});

test("firebird is once per battle, including after exit, re-entry and JSON restore", () => {
  const state = fixture(), p = state.teams[0].pets[0];
  applyKernelDamage(data, state, 0, p, p.maxHp + 100, { kind: "fixture-attack" });
  stepKernelBattle(data, state, ["switch:1", "focus"]);
  stepKernelBattle(data, state, ["switch:0", "focus"]);
  const restored = JSON.parse(JSON.stringify(state)), p2 = restored.teams[0].pets[0];
  applyKernelDamage(data, restored, 0, p2, 100, { kind: "fixture-attack" });
  assert.equal(p2.hp, 0);
  assert.equal(restored.events.filter((e) => e.kind === "survive-lethal").length, 1);
});

test("firebird does not turn survival into whole-turn invulnerability; fire opponents reject burns", () => {
  const s = fixture("pet_000006", null), p = s.teams[0].pets[0];
  applyKernelDamage(data, s, 0, p, p.maxHp, { kind: "fixture-hit-1" });
  assert.equal(p.hp, 1);
  assert.equal(s.teams[1].pets[0].statuses.灼烧, 0);
  applyKernelDamage(data, s, 0, p, 1, { kind: "fixture-hit-2" });
  assert.equal(p.hp, 0);
});

test("health consumption and freeze-threshold KO bypass the provisional damage-survival hook", () => {
  for (const source of [{ kind: "health-consumption" }, { kind: "status", reason: "freeze-threshold" }]) {
    const s = fixture(), p = s.teams[0].pets[0];
    applyKernelDamage(data, s, 0, p, p.hp, source);
    assert.equal(p.hp, 0);
    assert.equal(p.lethalSurvivalUsed, false);
  }
});

test("a lethal ordinary attack reaches the survival hook through the full action path", () => {
  const s = fixture(), p = s.teams[0].pets[0]; p.hp = 2;
  const events = stepKernelBattle(data, s, ["focus", "move:0"]);
  assert.equal(p.hp, 1);
  assert.equal(events.filter((e) => e.kind === "survive-lethal").length, 1);
  assert.equal(s.teams[0].magic, 4);
});

test("倾泻 clears both teams' marks but preserves statuses and intrinsic traits", () => {
  const s = fixture();
  for (const side of [0, 1]) {
    addKernelMark(s, side, "攻击", 2, { kind: "fixture" });
    addKernelMark(s, side, "减速", 1, { kind: "fixture" });
  }
  addKernelStatus(data, s, 1, "中毒", 1, { kind: "fixture" });
  const trait = structuredClone(s.teams[1].pets[0].program);
  stepKernelBattle(data, s, ["move:0", "focus"]);
  assert.deepEqual(s.teams.map((t) => t.marks), [{ positive: null, negative: null }, { positive: null, negative: null }]);
  assert.equal(s.teams[1].pets[0].statuses.中毒, 1);
  assert.deepEqual(s.teams[1].pets[0].program, trait);
});

test("a successful defense prevents 倾泻 mark clearing", () => {
  const s = fixture(); addKernelMark(s, 0, "湿润", 1, { kind: "fixture" });
  const events = stepKernelBattle(data, s, ["move:0", "move:1"]);
  assert.equal(s.teams[0].marks.positive.name, "湿润");
  assert.ok(events.some((e) => e.kind === "mark-clear-blocked"));
});

test("冰点 adds five normally and ten on defense, retaining ice immunity", () => {
  for (const [enemy, command, expected] of [["pet_000005", "focus", 5], ["pet_000005", "move:1", 10], ["pet_000217", "focus", 0]]) {
    // Legal 荆棘电环 stone move, replacing the fixture's lead for this test.
    const team = [member("pet_000174", ["冰点", "速冻", "倾泻", "导电撞击"]), ...helperIds.map((id) => member(id))];
    const other = [member(enemy, enemy === "pet_000005" ? ["气泡", "防御", "润泽", "寒风吹"] : null), ...["pet_000071", ...helperIds.slice(1)].map((id) => member(id))];
    const battle = createKernelBattle(data, [team, other], { purpose: "mechanism-test" });
    stepKernelBattle(data, battle, ["switch:0", "switch:0"]);
    stepKernelBattle(data, battle, ["move:0", command]);
    assert.equal(battle.teams[1].pets[0].statuses.冻结, expected);
  }
});

test("new compiler paths reject unknown suffixes rather than partially executing", () => {
  for (const name of ["倾泻", "冰点"]) {
    const id = skill(name), raw = snapshot.modules.Skills[id];
    assert.equal(compileMove(id, { ...raw, desc: raw.desc + "交换双方特性。" }).status, "unsupported");
  }
  const raw = snapshot.modules.Skills.skill_000069;
  assert.equal(compileTrait("x", { ...raw, desc: raw.desc + "再度复活。" }).status, "unsupported");
});

test("old snapshots cannot silently resume without once-per-battle state or defense-entry records", () => {
  const s = fixture(); s.version = "battle-kernel-2";
  const before = JSON.stringify(s);
  assert.throws(() => stepKernelBattle(data, s, ["focus", "focus"]), /version mismatch/);
  assert.equal(JSON.stringify(s), before);
});
