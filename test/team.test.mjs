import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createTeamBattle,
  stepTeamBattle,
  teamLegalActions,
  activePet,
  statPanel,
  typeMultiplier,
  runTeamBattle,
} from "../src/team-engine.mjs";
import {
  trainTeams,
  teamLearnedPolicy,
  teamRulePolicy,
  TEAM_POLICY_PRIOR,
} from "../src/team-rl.mjs";
const data = JSON.parse(
  await readFile(
    new URL("../public/data/team-2026-10-14.json", import.meta.url),
    "utf8",
  ),
);
const team = (id) => data.teams.find((t) => t.id === id).members;
const name = (n) => Object.values(data.moves).find((m) => m.name === n).id;
const move = (n) => "move:" + name(n);
function start(a = "balanced", b = "fire", leadA = 0, leadB = 0) {
  const s = createTeamBattle(data, team(a), team(b));
  stepTeamBattle(data, s, [`switch:${leadA}`, `switch:${leadB}`]);
  return s;
}
test("six full members and four legal skills are required", () => {
  assert.throws(
    () => createTeamBattle(data, team("grass").slice(0, 5), team("fire")),
    /六/,
  );
  const bad = structuredClone(team("grass"));
  bad[0].moves[0] = "unregistered";
  assert.throws(() => createTeamBattle(data, bad, team("fire")), /技能/);
  const s = start();
  assert.equal(s.sides[0].pets.length, 6);
  assert.equal(s.sides[0].magic, 4);
});
test("species-based HP and contemporary type chart replace uniform HP", () => {
  assert.equal(statPanel(112, 10, true), 411);
  assert.equal(statPanel(128, 10), 234);
  assert.equal(typeMultiplier(data, "普通", ["火"]), 1);
  assert.equal(typeMultiplier(data, "普通", ["地"]), 0.5);
  assert.equal(typeMultiplier(data, "火", ["草", "冰"]), 3);
  const s = start();
  assert.notEqual(s.sides[0].pets[0].maxHp, s.sides[0].pets[1].maxHp);
});
test("focus adds five energy, caps at ten, and does not consume reserve actions", () => {
  const s = start();
  activePet(s, 0).energy = 2;
  stepTeamBattle(data, s, ["focus", "focus"]);
  assert.equal(activePet(s, 0).energy, 7);
  stepTeamBattle(data, s, ["focus", "focus"]);
  assert.equal(activePet(s, 0).energy, 10);
});
test("voluntary switch consumes the action; incoming pet receives the attack", () => {
  const s = start();
  const old = activePet(s, 0);
  old.hp -= 25;
  old.energy = 4;
  old.boosts.atk = 1;
  const incoming = s.sides[0].pets[2],
    before = incoming.hp;
  const r = stepTeamBattle(data, s, ["switch:2", move("火苗")]);
  assert.equal(old.hp, old.maxHp - 25);
  assert.equal(old.energy, 4);
  assert.equal(old.boosts.atk, 0);
  assert.ok(incoming.hp < before);
  assert.equal(s.sides[0].switches, 1);
  assert.equal(
    r.events.filter((e) => e.kind === "move" && e.side === 0).length,
    0,
  );
});
test("KO removes one magic and requires an agent-selected replacement without using another round", () => {
  const s = start("balanced", "fire", 0, 0);
  activePet(s, 0).hp = 1;
  stepTeamBattle(data, s, ["focus", move("火苗")]);
  assert.equal(s.sides[0].magic, 3);
  assert.equal(s.phase, "replace");
  assert.deepEqual(teamLegalActions(data, s, 1), ["wait"]);
  const round = s.round;
  stepTeamBattle(data, s, ["switch:2", "wait"]);
  assert.equal(s.round, round);
  assert.equal(s.phase, "battle");
  assert.equal(s.sides[0].forcedSwitches, 1);
});
test("four lost magic ends a game while living bench members remain", () => {
  const s = start();
  s.sides[0].magic = 1;
  activePet(s, 0).hp = 1;
  stepTeamBattle(data, s, ["focus", move("火苗")]);
  assert.equal(s.winner, 1);
  assert.equal(s.sides[0].pets.filter((p) => p.hp > 0).length, 5);
  assert.deepEqual(teamLegalActions(data, s, 0), []);
});
test("grass teammate preheats a benched forest giant, and support has source evidence", () => {
  const s = start("grass", "fire", 0, 0),
    tree = s.sides[0].pets[2],
    before = tree.hp;
  const r = stepTeamBattle(data, s, [move("富养化"), "focus"]);
  assert.equal(tree.hp - before, Math.floor(tree.maxHp * 0.3));
  const e = r.events.find((e) => e.kind === "support" && e.to === tree.id);
  assert.equal(e.from, s.sides[0].pets[0].id);
  assert.equal(e.hp, Math.floor(tree.maxHp * 0.3));
});
test("team energy supply reaches a zero-energy ground teammate but cannot revive a fainted reserve", () => {
  const s = start("relay", "balanced", 0, 0),
    ground = s.sides[0].pets[4],
    dead = s.sides[0].pets[1];
  assert.equal(ground.energy, 0);
  dead.hp = 0;
  dead.koCounted = true;
  stepTeamBattle(data, s, [move("富养化"), "focus"]);
  assert.equal(ground.energy, 3);
  assert.equal(dead.hp, 0);
});
test("Qilihua trait restores only itself; bench energy requires the equipped skill and its cost", () => {
  const s = start("relay", "balanced", 0, 0),
    flower = activePet(s, 0),
    ground = s.sides[0].pets[4];
  flower.energy = 4;
  const plain = stepTeamBattle(data, s, ["focus", "focus"]);
  assert.equal(flower.energy, 10);
  assert.equal(ground.energy, 0);
  assert.equal(
    plain.events.filter((e) => e.kind === "support" && e.energy).length,
    0,
  );
  const self = plain.events.find((e) => e.kind === "end" && e.side === 0);
  assert.equal(self.sourceKind, "trait");
  assert.equal(self.sourceName, "养分重吸收");
  assert.equal(self.target, flower.id);
  const used = stepTeamBattle(data, s, [move("富养化"), "focus"]);
  assert.equal(
    used.events.find((e) => e.kind === "move" && e.side === 0).cost,
    3,
  );
  assert.equal(ground.energy, 3);
  const energy = used.events.find(
    (e) => e.kind === "support" && e.to === ground.id,
  );
  assert.equal(energy.sourceKind, "skill");
  assert.equal(energy.sourceName, "富养化");
  assert.equal(energy.owner, flower.id);
  const tree = s.sides[0].pets[1],
    heal = used.events.find(
      (e) => e.kind === "support" && e.to === tree.id && e.hp,
    );
  assert.equal(heal.sourceKind, "trait");
  assert.equal(heal.sourceName, "盘根木");
  assert.equal(heal.owner, tree.id);
  assert.equal(heal.energy, 0);
  const noSkill = structuredClone(team("relay"));
  noSkill[0].moves[2] = name("棘突");
  const without = createTeamBattle(data, noSkill, team("balanced"));
  stepTeamBattle(data, without, ["switch:0", "switch:0"]);
  assert.ok(!teamLegalActions(data, without, 0).includes(move("富养化")));
  stepTeamBattle(data, without, ["focus", "focus"]);
  assert.equal(without.sides[0].pets[4].energy, 0);
});
test("invalid rule parameters cannot silently change the team environment", () => {
  for (const rules of [{ maxRounds: 0 }, { maxRounds: NaN }, { maxEnergy: 20 }])
    assert.throws(() =>
      createTeamBattle(data, team("grass"), team("fire"), { rules }),
    );
  assert.throws(() =>
    createTeamBattle(data, team("grass"), team("fire"), {
      patch: { side: 0, grassBenchRate: -0.1 },
    }),
  );
});
test("defense responds before an attack, reduces damage, then cools for one round", () => {
  const a = start(),
    b = structuredClone(a);
  const ra = stepTeamBattle(data, a, [move("防御"), move("火苗")]);
  const rb = stepTeamBattle(data, b, ["focus", move("火苗")]);
  assert.equal(ra.events.find((e) => e.kind === "move").side, 0);
  assert.ok(
    ra.events.find((e) => e.kind === "move" && e.side === 1).damage <
      rb.events.find((e) => e.kind === "move" && e.side === 1).damage,
  );
  assert.ok(!teamLegalActions(data, a, 0).includes(move("防御")));
  stepTeamBattle(data, a, ["focus", "focus"]);
  assert.ok(teamLegalActions(data, a, 0).includes(move("防御")));
});
test("same seed learns identical team policies; frozen 6v6 evaluation cannot change weights", () => {
  const a = trainTeams(data, { episodes: 100, seed: 3 }),
    b = trainTeams(data, { episodes: 100, seed: 3 });
  assert.deepEqual(a, b);
  assert.ok(a.updates > 0);
  assert.notDeepEqual(a.agents[0].weights, TEAM_POLICY_PRIOR);
  const before = JSON.stringify(a.agents);
  const run = () =>
    runTeamBattle(data, team("grass"), team("fire"), [
      teamLearnedPolicy(data, a.agents[0], 99),
      teamRulePolicy(data),
    ]);
  const r = run();
  assert.deepEqual(r, run());
  assert.equal(JSON.stringify(a.agents), before);
  assert.equal(r.state.sides[0].pets.length, 6);
  assert.ok(
    r.trace.every((t) => t.before.length === 2 && t.after.length === 2),
  );
});
