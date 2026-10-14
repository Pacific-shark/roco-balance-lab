import test from "node:test";
import assert from "node:assert/strict";
import { ROSTER, MOVES, DEFAULT_ENV, defaultPatch } from "../src/data.mjs";
import {
  panel,
  createFighter,
  damage,
  takeAction,
  resolveRound,
  moveCost,
  battle,
  evaluate,
} from "../src/engine.mjs";
test("community worked example: attack234, defense226, display356 gives332", () => {
  assert.equal(panel(128), 234);
  assert.equal(panel(121), 226);
  const a = createFighter("020"),
    b = createFighter("043");
  a.trait = "none";
  const hit = damage(a, b, { ...MOVES.fan, power: 95 }, true);
  assert.equal(hit.display, 356);
  assert.equal(hit.total, 332);
});
test("fan and wind bonuses add in the same power bucket", () => {
  const hit = damage(
    createFighter("020"),
    createFighter("043"),
    MOVES.fan,
    true,
  );
  assert.equal(hit.power, 150);
  assert.equal(hit.stab, 1.25);
  assert.equal(hit.type, 2);
});
test("fire trait grows only after the action; water costs cannot go negative", () => {
  const a = createFighter("007"),
    b = createFighter("010");
  const first = takeAction(a, b, MOVES.spark, true),
    second = takeAction(a, b, MOVES.spark, true);
  assert.equal(first.formula.boost, 1);
  assert.equal(second.formula.boost, 1.2);
  const w = createFighter("010");
  w.costReduction = 99;
  assert.equal(moveCost(w, MOVES.bubble), 0);
});
test("resource cap, actual healing and no overkill", () => {
  const a = createFighter("004"),
    b = createFighter("010");
  a.energy = 9;
  a.hp = 390;
  const e = takeAction(a, b, MOVES.vine, true);
  assert.equal(a.energy, 10);
  assert.equal(a.hp, 400);
  assert.equal(e.healed, 10);
  b.hp = 1;
  const hit = takeAction(a, b, MOVES.thorn, true);
  assert.equal(hit.damage, 1);
  assert.equal(b.hp, 0);
});
test("skill priority beats speed; defeated actor cannot act", () => {
  const a = createFighter("007"),
    b = createFighter("020");
  a.hp = 1;
  const t = resolveRound(a, b, MOVES.cut, MOVES.first);
  assert.equal(t.events[0].actor, "020");
  assert.equal(t.events.length, 1);
});
test("ground trait initial energy and removal are explicit", () => {
  assert.equal(createFighter("029").energy, 0);
  assert.equal(
    createFighter("029", DEFAULT_ENV, { ...defaultPatch("029"), trait: 2 })
      .energy,
    6,
  );
  assert.equal(createFighter("029", DEFAULT_ENV, null, true).energy, 10);
});
test("fixed battle replay, mirror tie order and truncation", () => {
  assert.deepEqual(battle("007", "020"), battle("007", "020"));
  assert.equal(battle("007", "007", { tieFirst: "a" }).winner, "a");
  assert.equal(battle("007", "007", { tieFirst: "b" }).winner, "b");
  assert.equal(battle("007", "010", { env: { maxTurns: 1 } }).winner, "draw");
});
test("matrix excludes mirrors, is reciprocal and counts exactly120 configurations", () => {
  const r = evaluate();
  assert.equal(r.battles, 120);
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++)
      if (i === j) assert.equal(r.matrix[i][j], null);
      else assert.equal(r.matrix[i][j] + r.matrix[j][i], 1);
  assert.ok(r.ranking.every((x) => x.score >= 0 && x.score <= 1));
});
test("weighted distribution changes scores but does not manufacture new outcomes", () => {
  const a = evaluate(),
    b = evaluate({ distribution: "water" });
  assert.deepEqual(a.matrix, b.matrix);
  assert.notEqual(
    a.ranking.find((x) => x.id === "007").score,
    b.ranking.find((x) => x.id === "007").score,
  );
});
test("baseline and readonly data survive counterfactual evaluation", () => {
  const before = JSON.stringify({ ROSTER, MOVES }),
    base = evaluate();
  evaluate({}, { id: "020", power: 70, trait: 20 });
  assert.deepEqual(base, evaluate());
  assert.equal(JSON.stringify({ ROSTER, MOVES }), before);
});
test("invalid parameters and missing learned policies fail explicitly", () => {
  assert.throws(() => evaluate({ hp: NaN }));
  assert.throws(() => evaluate({}, { id: "xxx", power: 100, trait: 1 }));
  assert.throws(() => evaluate({ policy: "selfplay" }), /模型/);
  const a = createFighter("029");
  assert.throws(
    () => takeAction(a, createFighter("004"), MOVES.quake, true),
    /能量不足/,
  );
});
