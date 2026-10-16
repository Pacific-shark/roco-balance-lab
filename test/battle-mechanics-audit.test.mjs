import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reduceIntegerDamage } from "../src/battle-arithmetic.mjs";
import { simultaneousExitCandidates, resolveSimultaneousExit } from "../src/battle-event-order.mjs";
import {
  TEAM_RULE_VERSION, createTeamBattle, stepTeamBattle,
  activePet, teamLegalActions, teamDamage,
} from "../src/team-engine.mjs";
import { evaluateTeams } from "../src/team-rl.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/team-2026-10-14.json", import.meta.url), "utf8"));
const team = id => data.teams.find(t => t.id === id).members;
const moveId = name => Object.values(data.moves).find(m => m.name === name).id;
function start() {
  const state = createTeamBattle(data, team("balanced"), team("fire"));
  stepTeamBattle(data, state, ["switch:0", "switch:0"]);
  return state;
}

test("decimal reductions preserve integer boundaries missed by binary subtraction", () => {
  for (const [damage, rate, legacy, expected] of [
    [100, 0.8, 19, 20], [100, 0.9, 9, 10], [200, 0.8, 39, 40],
  ]) {
    assert.equal(Math.floor(damage * (1 - rate)), legacy);
    assert.equal(reduceIntegerDamage(damage, rate), expected);
  }
});

test("all registered defense percentages match independent integer-percent arithmetic", () => {
  const percents = [...new Set(Object.values(data.moves)
    .filter(m => m.effect.guard !== undefined).map(m => Math.round(m.effect.guard * 100)))];
  assert.deepEqual(percents.sort((a,b) => a-b), [70, 80, 90]);
  for (const percent of percents)
    for (let damage = 0; damage <= 10000; damage++)
      assert.equal(reduceIntegerDamage(damage, percent / 100), Math.floor(damage * (100-percent) / 100));
});

test("reduction arithmetic handles endpoints, fractional results and scientific notation", () => {
  assert.equal(reduceIntegerDamage(103, 0.8), 20);
  assert.equal(reduceIntegerDamage(1, 0.01), 0);
  assert.equal(reduceIntegerDamage(10, 0), 10);
  assert.equal(reduceIntegerDamage(10, 1), 0);
  assert.equal(reduceIntegerDamage(0, 0.9), 0);
  assert.equal(reduceIntegerDamage(10000000, 1e-7), 9999999);
  assert.equal(reduceIntegerDamage(Number.MAX_SAFE_INTEGER, 0.9999999999999999), 0);
});

test("invalid damage and reduction values fail explicitly", () => {
  for (const damage of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => reduceIntegerDamage(damage, 0.8), RangeError);
  for (const rate of [-0.1, 1.1, NaN, Infinity, null, "0.8"])
    assert.throws(() => reduceIntegerDamage(100, rate), RangeError);
});

test("engine uses exact reduction and preserves its existing per-hit rounding location", () => {
  // Synthetic arithmetic fixture, not an observed game matchup.
  const a = {types:["水"],stats:{atk:41},boosts:{atk:0},uses:{},powerBonus:0,nextAttack:1,trait:"none"};
  const b = {types:["火"],stats:{def:37},boosts:{def:0},guard:0.8};
  const move = {id:"synthetic",kind:"attack",category:"物攻",type:"普通",power:103,effect:{hits:2}};
  const result = teamDamage(data, a, b, move);
  assert.equal(result.perHit, 20);
  assert.equal(result.total, 40);
  assert.equal(teamDamage(data, a, {...b,guard:0}, move).perHit, 103);
});

test("newly acquired registered defense cannot bypass an existing public cooldown", () => {
  const state = start();
  const defense = moveId("防御"), acquired = moveId("水泡盾");
  stepTeamBattle(data, state, [`move:${defense}`, "focus"]);
  const pet = activePet(state, 0);
  assert.equal(pet.defenseCooldown, 1);
  // Inject the result of acquisition, not a fabricated implementation of
  // Borrow/Thought/Change's random draw or blocked-draw handling.
  pet.moves[0] = acquired;
  assert.ok(pet.energy >= data.moves[acquired].cost);
  assert.ok(!teamLegalActions(data, state, 0).includes(`move:${acquired}`));
  const before = structuredClone(state);
  assert.throws(() => stepTeamBattle(data, state, [`move:${acquired}`, "focus"]), /行动非法/);
  assert.deepEqual(state, before);
  stepTeamBattle(data, state, ["focus", "focus"]);
  assert.ok(teamLegalActions(data, state, 0).includes(`move:${acquired}`));
});

test("illegal defense on the second side cannot partially commit the first side", () => {
  const state = start(), defense = moveId("防御");
  const pet = activePet(state, 1);
  pet.moves[0] = defense;
  pet.defenseCooldown = 1;
  const before = structuredClone(state);
  assert.throws(() => stepTeamBattle(data, state, ["focus", `move:${defense}`]), /行动非法/);
  assert.deepEqual(state, before);
});

test("models from before the damage correction are rejected without evaluation or training", () => {
  assert.notEqual(TEAM_RULE_VERSION, "team-0.2.2-panel20");
  assert.throws(() => evaluateTeams(data, {
    rules:"team-0.2.2-panel20",dataVersion:data.version,patch:null,
  }), /版本/);
});

test("damage matches the external calculator's documented arithmetic example, not game certification", () => {
  // https://roco-showdown.com/battle-use-guide: an independent calculator's
  // published example, not a recorded in-game HP observation.
  const a = {types:["翼"],stats:{atk:234},boosts:{atk:0},uses:{},powerBonus:20,nextAttack:1,trait:"none"};
  const b = {types:["草"],stats:{def:226},boosts:{def:0},guard:0};
  const move = {id:"external-example",kind:"attack",category:"物攻",type:"翼",power:75,effect:{firstBonus:0.5}};
  const result = teamDamage(data, a, b, move, {first:true});
  assert.equal(result.display, 356);
  assert.equal(result.total, 332);
});

test("simultaneous-exit resolver follows outgoing speed in both orientations", () => {
  for (const speeds of [[250,100],[100,250]]) {
    const fast = speeds[0]>speeds[1] ? 0 : 1;
    const result = resolveSimultaneousExit(speeds);
    assert.deepEqual(result.departureOrder, [fast,1-fast]);
    assert.deepEqual(result.replacementOrder, [fast,1-fast]);
    assert.equal(result.fullEventInterleavingVerified, false);
    assert.equal(result.resolution,"speed");
    assert.throws(() => resolveSimultaneousExit(speeds,{firstSide:1-fast}), /contradicts/);
  }
});

test("equal-speed exits expose both branches and require an explicit replay outcome", () => {
  assert.deepEqual(simultaneousExitCandidates([100,100]), [[0,1],[1,0]]);
  assert.throws(() => resolveSimultaneousExit([100,100]), {code:"EXIT_CHANCE_OUTCOME_REQUIRED"});
  for (const firstSide of [0,1]) {
    const result = resolveSimultaneousExit([100,100],{firstSide});
    assert.deepEqual(result.order,[firstSide,1-firstSide]);
    assert.equal(result.samplingDistribution,null);
    assert.deepEqual(resolveSimultaneousExit(result.outgoingSpeeds,{firstSide}),result);
  }
});

test("exit resolver rejects missing speeds and invalid recorded outcomes", () => {
  for (const speeds of [null,[],[1],[1,2,3],[NaN,2],[-1,2],[1,Infinity],["100",100]])
    assert.throws(() => resolveSimultaneousExit(speeds), RangeError);
  for (const firstSide of [null,true,2,"0"])
    assert.throws(() => resolveSimultaneousExit([100,100],{firstSide}), RangeError);
});
