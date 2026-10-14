import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NATURES,
  STAT_KEYS,
  validateBuild,
  calculatePanel,
  statPanel,
  teamConfigurationId,
} from "../src/team-stats.mjs";
import { createTeamBattle, stepTeamBattle } from "../src/team-engine.mjs";
import { trainTeams } from "../src/team-rl.mjs";
import {
  buildCandidates,
  optimizeTeamBuilds,
} from "../src/team-build-search.mjs";
const data = JSON.parse(
  await readFile(
    new URL("../public/data/team-2026-10-14.json", import.meta.url),
    "utf8",
  ),
);
test("World natures cover all 30 distinct up/down pairs including HP, at +10%/-10%", () => {
  const member = data.teams[0].members[0],
    creature = data.creatures[member.id];
  assert.equal(Object.keys(NATURES).length, 30);
  assert.equal(
    new Set(Object.values(NATURES).map((n) => n.up + ":" + n.down)).size,
    30,
  );
  for (const nature of Object.keys(NATURES)) {
    const rows = calculatePanel(creature, { ...member, nature }).breakdown;
    assert.equal(rows.filter((r) => r.modifier === 1.1).length, 1);
    assert.equal(rows.filter((r) => r.modifier === 0.9).length, 1);
    assert.equal(rows.filter((r) => r.modifier === 1).length, 4);
  }
  assert.equal(statPanel(128, 10), 234);
  assert.equal(statPanel(128, 10, false, 1.1), 252);
  assert.equal(statPanel(121, 10, false, 0.9), 208);
  assert.ok(
    calculatePanel(creature, { ...member, nature: "踏实" }).stats.hp >
      calculatePanel(creature, { ...member, nature: "固执" }).stats.hp,
  );
  assert.throws(() => statPanel(128, 10, false, 1.2), /无效/);
});
test("cultivation rejects six perfect stats and incomplete or impossible IV fields", () => {
  const m = structuredClone(data.teams[0].members[0]);
  assert.throws(
    () =>
      validateBuild({
        ...m,
        ivs: Object.fromEntries(STAT_KEYS.map((k) => [k, 10])),
      }),
    /1—3/,
  );
  assert.throws(
    () => validateBuild({ ...m, ivs: { ...m.ivs, atk: 6 } }),
    /0、7/,
  );
  assert.throws(() => validateBuild({ ...m, nature: "中性" }), /性格/);
});
test("cultivation changes real damage and flips speed order in an otherwise identical 6v6 battle", () => {
  const left = structuredClone(data.teams[0].members),
    right = structuredClone(left);
  function round(nature) {
    left[0].nature = nature;
    right[0].nature = "固执";
    const s = createTeamBattle(data, left, right, { tieFirst: 1 });
    stepTeamBattle(data, s, ["switch:0", "switch:0"]);
    const before = s.sides[1].pets[0].hp;
    const r = stepTeamBattle(data, s, [
      "move:skill_000246",
      "move:skill_000246",
    ]);
    return {
      first: r.events.find((e) => e.kind === "move").side,
      damage: before - s.sides[1].pets[0].hp,
    };
  }
  const offensive = round("固执"),
    quick = round("开朗");
  assert.equal(offensive.first, 1);
  assert.equal(quick.first, 0);
  assert.ok(offensive.damage > quick.damage);
  left[0].ivs.atk = 0;
  assert.ok(round("固执").damage < offensive.damage);
});
test("default search contains every three-perfect-IV allocation paired with every nature", () => {
  const candidates = buildCandidates();
  assert.equal(candidates.length, 600);
  assert.equal(new Set(candidates.map((c) => JSON.stringify(c))).size, 600);
  for (const c of candidates) {
    validateBuild(c);
    assert.equal(Object.values(c.ivs).filter((v) => v === 10).length, 3);
  }
});

test("published models restore the exact searched cultivation and reproduce their reported scores", async () => {
  const { evaluateTeams } = await import("../src/team-rl.mjs");
  for (const seed of [42, 137]) {
    const model = JSON.parse(
      await readFile(
        new URL(`../public/team-models/team-${seed}.json`, import.meta.url),
        "utf8",
      ),
    );
    const stored = JSON.parse(
      await readFile(
        new URL(
          `../public/team-models/evaluation-${seed}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const configured = { ...data, teams: model.trainingTeams };
    assert.equal(teamConfigurationId(configured), model.configurationId);
    assert.equal(
      model.configurationSearch.afterConfigurationId,
      model.configurationId,
    );
    assert.equal(model.configurationSearch.candidateCount, 600);
    assert.equal(model.configurationSearch.battles, 20640);
    assert.equal(model.configurationSearch.log.length, 24);
    assert.ok(
      model.configurationSearch.log.every(
        (r) => r.candidates === 600 && r.afterScore >= r.beforeScore,
      ),
    );
    const actual = evaluateTeams(configured, model);
    for (const key of ["ruleScore", "drawRate", "meanSwitches"])
      assert.equal(actual[key], stored[key]);
  }
});
test("search freezes reference policies and opponents, preserves valid teams, and rejects worse full-scenario results", () => {
  const model = trainTeams(data, { seed: 7, episodes: 100 }),
    input = structuredClone(data),
    frozen = structuredClone(model);
  const candidates = [
    {
      nature: "踏实",
      ivs: { hp: 10, atk: 0, def: 10, spa: 0, spd: 10, spe: 0 },
    },
  ];
  const { data: out, report } = optimizeTeamBuilds(data, model, { candidates });
  assert.deepEqual(data, input);
  assert.deepEqual(model, frozen);
  assert.equal(report.log.length, 24);
  assert.deepEqual(report.referenceTeams, input.teams);
  assert.equal(report.beforeConfigurationId, teamConfigurationId(input));
  assert.equal(report.afterConfigurationId, teamConfigurationId(out));
  assert.equal(
    report.log.every((r) => r.afterScore >= r.beforeScore),
    true,
  );
  assert.equal(
    report.log.every((r) => r.teamAfterScore >= r.teamBeforeScore),
    true,
  );
  out.teams.forEach((t) => {
    assert.equal(t.members.length, 6);
    t.members.forEach(validateBuild);
  });
  assert.throws(
    () => optimizeTeamBuilds(data, { ...model, rules: "old" }, { candidates }),
    /版本/,
  );
  assert.throws(
    () => optimizeTeamBuilds(data, model, { candidates: [] }),
    /不能为空/,
  );
});
