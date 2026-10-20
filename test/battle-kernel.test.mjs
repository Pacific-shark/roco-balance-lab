import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  compileMove,
  compileTrait,
  assertProgram,
} from "../src/battle-programs.mjs";
import {
  kernelCatalog,
  sourceLegalMoves,
  createKernelBattle,
  stepKernelBattle,
  kernelLegalActions,
  kernelMoveCost,
  addKernelStatus,
  addKernelMark,
} from "../src/battle-kernel.mjs";
import { presetBuild } from "../src/team-stats.mjs";
const snapshot = JSON.parse(
  await readFile(new URL("../data/catalog-s4-20261015.json", import.meta.url)),
);
const legacy = JSON.parse(
  await readFile(
    new URL("../public/data/team-2026-10-14.json", import.meta.url),
  ),
);
const data = kernelCatalog(snapshot, legacy.types);
const ids = [
  "pet_000028",
  "pet_000007",
  "pet_000006",
  "pet_000005",
  "pet_000034",
  "pet_000076",
];
const moveId = (name) =>
  Object.entries(snapshot.modules.Skills).find(
    ([, m]) => m.name === name && m.category !== "特性",
  )?.[0];
function member(id, names) {
  const moves = names
    ? names.map(moveId)
    : [...sourceLegalMoves(data, { id, bloodline: 2 })]
        .filter((id) => data.programs[id].status === "compiled")
        .slice(0, 4);
  return { id, bloodline: 2, moves, ...presetBuild(data.creatures[id]) };
}
function battle(first = {}, second = {}) {
  return createKernelBattle(
    data,
    [
      ids.map((id) => member(id, first[id])),
      ids.map((id) => member(id, second[id])),
    ],
    { purpose: "mechanism-test" },
  );
}
function lead(state, a = 0, b = 0) {
  stepKernelBattle(data, state, [`switch:${a}`, `switch:${b}`]);
  return state;
}
test("salt gathering heals per hit but adds only one permanent hit per use",()=>{
  const salt=moveId("聚盐");
  const carrier=Object.keys(data.creatures).find(id=>data.creatures[id].name==="鳗尾兽");
  assert.ok(carrier);
  const m=member(carrier);
  m.moves=[salt,...m.moves.filter(id=>id!==salt).slice(0,3)];
  const first=[m,...ids.filter(id=>id!==carrier).slice(0,5).map(id=>member(id))];
  const s=createKernelBattle(data,[first,ids.map(id=>member(id))],{purpose:"mechanism-test"});
  lead(s);
  const p=s.teams[0].pets[0];
  p.hp=1;
  for(let use=1;use<=3;use++){
    p.energy=10;
    const events=stepKernelBattle(data,s,["move:0","focus"]);
    assert.equal(p.moves[0].hits,use);
    assert.equal(events.find(e=>e.kind==="move"&&e.move===salt).hits,use+1);
    assert.equal(events.filter(e=>e.kind==="heal"&&e.source?.id===salt).length,use+1);
  }
});
const pet = (s, side = 0) => s.teams[side].pets[s.teams[side].active];
const use = (s, side, name) =>
  "move:" + pet(s, side).moves.findIndex((m) => m.id === moveId(name));

test("whole description compilation rejects an unknown suffix and mismatched damage category", () => {
  const raw = snapshot.modules.Skills[moveId("抓挠")];
  assert.equal(compileMove("x", raw).status, "compiled");
  const unsupported = compileMove("x", {
    ...raw,
    desc: raw.desc + "随机交换双方特性。",
  });
  assert.equal(unsupported.status, "unsupported");
  assert.throws(() => assertProgram(unsupported));
  assert.equal(
    compileMove("x", { ...raw, damage_class: "魔攻" }).status,
    "unsupported",
  );
  assert.equal(
    compileTrait("x", { name: "missing", desc: "随意编造的特性" }).status,
    "unsupported",
  );
});

test("bloodline legality and unsupported traits are checked before allocating a battle", () => {
  const s = battle();
  assert.equal(s.teams[0].pets.length, 6);
  const teams = [ids.map((id) => member(id)), ids.map((id) => member(id))];
  assert.throws(
    () => createKernelBattle(data, teams, { purpose: "training" }),
    /admission/,
  );
  assert.throws(
    () =>
      createKernelBattle(data, teams, {
        purpose: "mechanism-test",
        resonance: "wish",
      }),
    /Resonance/,
  );
  const foreign = Object.keys(data.programs).find(
    (id) =>
      data.programs[id].kind &&
      data.programs[id].status === "compiled" &&
      !sourceLegalMoves(data, teams[0][0]).has(id),
  );
  teams[0][0].moves[0] = foreign;
  assert.throws(
    () => createKernelBattle(data, teams, { purpose: "mechanism-test" }),
    /source inconsistent/,
  );
});

test("Qilihua passive restores itself while bench supply consumes its own skill and attributes its source", () => {
  const s = lead(
    battle({ pet_000028: ["富养化", "防御", "能量炮", "氧输送"] }),
  );
  const flower = pet(s),
    ape = s.teams[0].pets[5];
  flower.energy = 4;
  stepKernelBattle(data, s, ["focus", "focus"]);
  assert.equal(flower.energy, 10);
  assert.equal(ape.energy, 0);
  const events = stepKernelBattle(data, s, [use(s, 0, "富养化"), "focus"]);
  assert.equal(flower.energy, 10);
  assert.equal(ape.energy, 3);
  assert.ok(
    events.some(
      (e) =>
        e.pet === ape.id &&
        e.source.kind === "skill" &&
        e.source.id === moveId("富养化") &&
        e.effective === 3,
    ),
  );
  assert.ok(
    events.some(
      (e) =>
        e.pet === flower.id && e.source?.kind === "trait" && e.effective === 3,
    ),
  );
  assert.ok(
    events.some((e) => e.source?.kind === "cost" && e.effective === -3),
  );
});

test("fire move preheats the benched fire ape with its full passive", () => {
  const s = lead(
    battle({ pet_000006: ["火苗", "防御", "吹火", "怒火"] }),
    2,
    0,
  );
  const ape = s.teams[0].pets[5];
  assert.equal(ape.energy, 0);
  const events = stepKernelBattle(data, s, [use(s, 0, "火苗"), "focus"]);
  assert.equal(ape.energy, 3);
  assert.ok(
    events.some(
      (e) =>
        e.pet === ape.id &&
        e.source.kind === "trait" &&
        e.source.actor === "pet_000006",
    ),
  );
});

test("water passive cost reduction clears on exit while water-cannon permanent reduction survives", () => {
  const s = lead(
    battle({ pet_000005: ["甩水", "水炮", "水泡盾", "防御"] }),
    3,
    0,
  );
  const water = pet(s);
  stepKernelBattle(data, s, [use(s, 0, "水炮"), "focus"]);
  assert.equal(kernelMoveCost(data, s, 0, 1), 3);
  stepKernelBattle(data, s, ["switch:1", "focus"]);
  stepKernelBattle(data, s, ["switch:3", "focus"]);
  assert.equal(water.cost, 0);
  assert.equal(kernelMoveCost(data, s, 0, 1), 4);
});

test("status immunity, electrical threshold and strict freeze threshold are distinct", () => {
  const s = lead(battle(), 2, 3),
    fire = pet(s),
    water = pet(s, 1);
  addKernelStatus(data, s, 0, "灼烧", 10, { kind: "test" });
  assert.equal(fire.statuses.灼烧, 0);
  const hp = water.hp;
  addKernelStatus(data, s, 1, "引电", 1, { kind: "test" });
  assert.equal(water.hp, hp);
  addKernelStatus(data, s, 1, "引电", 1, { kind: "test" });
  assert.equal(water.statuses.引电, 0);
  assert.ok(water.hp < hp);
  water.maxHp = 400;
  water.hp = 40;
  addKernelStatus(data, s, 1, "冻结", 2, { kind: "test" });
  assert.equal(water.hp, 40);
  water.hp = 39;
  addKernelStatus(data, s, 1, "冻结", 0, { kind: "test" });
  assert.equal(water.hp, 0);
});

test("same-sign marks replace each other, stack by name and survive voluntary switching", () => {
  const s = lead(battle());
  addKernelMark(s, 0, "攻击", 1, {});
  addKernelMark(s, 0, "攻击", 2, {});
  assert.deepEqual(s.teams[0].marks.positive, { name: "攻击", layers: 3 });
  addKernelMark(s, 0, "光合", 1, {});
  addKernelMark(s, 0, "中毒", 1, {});
  assert.deepEqual(s.teams[0].marks.positive, { name: "光合", layers: 1 });
  stepKernelBattle(data, s, ["switch:1", "focus"]);
  assert.equal(s.teams[0].marks.negative.name, "中毒");
  assert.equal(s.teams[0].marks.positive.name, "光合");
  assert.throws(() => addKernelMark(s, 0, "未定义", 1, {}), /Unsupported/);
});

test("counter interrupts a committed status skill and prevents its resource effect", () => {
  const s = lead(
    battle({ pet_000006: ["阻断", "防御", "火苗", "吹火"] }),
    2,
    3,
  );
  pet(s, 1).energy = 0;
  const events = stepKernelBattle(data, s, [use(s, 0, "阻断"), "focus"]);
  assert.equal(pet(s, 1).energy, 0);
  assert.ok(events.some((e) => e.kind === "interrupt" && e.targetSide === 1));
  assert.equal(events.filter((e) => e.source?.kind === "focus").length, 0);
});

test("speed changes affect ordering rather than remaining unused panel fields", () => {
  const s = lead(
    battle(
      { pet_000028: ["快速移动", "防御", "能量炮", "富养化"] },
      { pet_000028: ["快速移动", "防御", "能量炮", "富养化"] },
    ),
  );
  stepKernelBattle(data, s, ["focus", use(s, 1, "快速移动")]);
  const events = stepKernelBattle(data, s, [
    use(s, 0, "能量炮"),
    use(s, 1, "能量炮"),
  ]);
  assert.equal(events.find((e) => e.kind === "move").side, 1);
});

test("PPO cannot start by changing only the purpose label; unsupported abilities never become noops", () => {
  const teams = [ids.map((id) => member(id)), ids.map((id) => member(id))];
  const unsupported = Object.values(data.creatures).find(
    (c) => data.programs[c.feature_skill_id]?.status === "unsupported",
  );
  const changed = structuredClone(data);
  changed.creatures[ids[0]].feature_skill_id = unsupported.feature_skill_id;
  assert.throws(
    () => createKernelBattle(changed, teams, { purpose: "mechanism-test" }),
    /机制未实现/,
  );
  assert.throws(
    () =>
      createKernelBattle(data, [teams[0].slice(1), teams[1]], {
        purpose: "mechanism-test",
      }),
    /Six/,
  );
});

test("all compiled move programs execute in controlled action-kind cases without unknown opcodes or NaNs", () => {
  // Deliberately injected unit fixtures, not legal team samples or training games.
  const programs = Object.values(data.programs).filter(
    (p) => p.kind && p.status === "compiled",
  );
  let executed = 0;
  for (const m of programs)
    for (const choice of m.choices ? m.choices.map((_, i) => i) : [undefined])
      for (const enemyName of ["能量炮", "防御", null]) {
        const s = lead(
          battle({}, { pet_000028: ["能量炮", "防御", "富养化", "快速移动"] }),
        );
        for (const t of s.teams)
          for (const p of t.pets) {
            p.maxHp = 10000;
            p.hp = 10000;
          }
        // Explicitly lower expensive moves' slot cost in this effect fixture.
        // Actual acquisition of that discount is tested separately (e.g. 抛石).
        pet(s).moves[0] = {
          id: m.id,
          power: 0,
          cost: -Math.max(0, m.cost - 10),
          hits: 0,
        };
        const events = stepKernelBattle(data, s, [
          `move:0${choice === undefined ? "" : ":" + choice}`,
          enemyName ? use(s, 1, enemyName) : "focus",
        ]);
        assert.ok(
          events.some((e) => e.kind === "move" && e.move === m.id),
          m.name,
        );
        for (const t of s.teams)
          for (const p of t.pets) {
            assert.ok(Number.isFinite(p.hp));
            assert.ok(Number.isFinite(p.energy));
          }
        executed++;
      }
  assert.equal(
    executed,
    programs.reduce((n, m) => n + (m.choices?.length ?? 1) * 3, 0),
  );
});

test("per-hit poison runs for each hit and does not run again as an after-skill effect", () => {
  const s = lead(battle());
  pet(s, 1).hp = pet(s, 1).maxHp = 10000;
  pet(s).moves[0] = { id: moveId("连续毒针"), power: 0, cost: 0, hits: 0 };
  const events = stepKernelBattle(data, s, ["move:0", "focus"]);
  assert.equal(pet(s, 1).statuses.中毒, 2);
  assert.equal(
    events.filter((e) => e.kind === "status" && e.name === "中毒").length,
    2,
  );
});

test("counter replacement changes poison amount without adding the ordinary branch", () => {
  const s = lead(battle());
  pet(s, 1).hp = pet(s, 1).maxHp = 10000;
  pet(s).moves[0] = { id: moveId("毒囊"), power: 0, cost: 0, hits: 0 };
  stepKernelBattle(data, s, ["move:0", "focus"]);
  assert.equal(pet(s, 1).statuses.中毒, 6);
});

test("a faster energy drain can invalidate the slower committed move without negative energy", () => {
  const s = lead(battle());
  pet(s).moves[0] = { id: moveId("勾魂"), power: 0, cost: 0, hits: 0 };
  pet(s, 1).moves[0] = { id: moveId("能量炮"), power: 0, cost: 0, hits: 0 };
  pet(s, 1).energy = 3;
  assert.ok(kernelLegalActions(data, s, 1).includes("move:0"));
  const events = stepKernelBattle(data, s, ["move:0", "move:0"]);
  assert.ok(
    events.some(
      (e) =>
        e.kind === "action-failed" &&
        e.side === 1 &&
        e.reason === "energy-changed",
    ),
  );
  assert.equal(
    events.filter((e) => e.kind === "move" && e.side === 1).length,
    0,
  );
  assert.ok(pet(s, 1).energy >= 0);
});

test("simultaneous end damage resolves both KOs before choosing a winner", () => {
  const s = lead(battle());
  for (let side = 0; side < 2; side++) {
    pet(s, side).hp = 1;
    s.teams[side].magic = 1;
    addKernelMark(s, side, "中毒", 1, {});
  }
  stepKernelBattle(data, s, ["focus", "focus"]);
  assert.equal(s.winner, "simultaneous-ko");
  assert.equal(s.teams[0].magic, 0);
  assert.equal(s.teams[1].magic, 0);
});

test("choice moves expose two explicit commands and execute only the chosen effect", () => {
  for (const choice of [0, 1]) {
    const s = lead(battle());
    pet(s).hp = 100;
    pet(s).energy = 8;
    pet(s).moves[0] = { id: moveId("补觉"), power: 0, cost: 0, hits: 0 };
    const legal = kernelLegalActions(data, s, 0);
    assert.ok(legal.includes("move:0:0"));
    assert.ok(legal.includes("move:0:1"));
    assert.ok(!legal.includes("move:0"));
    const events = stepKernelBattle(data, s, [`move:0:${choice}`, "focus"]);
    assert.equal(
      events.filter((e) => e.kind === "heal" && e.side === 0).length,
      choice === 0 ? 1 : 0,
    );
    assert.equal(
      events.find((e) => e.kind === "move" && e.side === 0).choice,
      choice,
    );
  }
});

test("every compiled trait has a real source carrier and executes entry, action, end and exit hooks", () => {
  for (const trait of Object.values(data.programs).filter(
    (p) => p.rules && p.status === "compiled",
  )) {
    const carrier = Object.values(data.creatures).find(
      (c) =>
        c.feature_skill_id === trait.id &&
        [...sourceLegalMoves(data, { id: c.id, bloodline: 2 })].filter(
          (id) => data.programs[id].status === "compiled",
        ).length >= 4,
    );
    assert.ok(carrier, trait.name);
    const team = [
      member(carrier.id),
      ...ids
        .filter((id) => id !== carrier.id)
        .slice(0, 5)
        .map((id) => member(id)),
    ];
    const s = createKernelBattle(data, [team, ids.map((id) => member(id))], {
      purpose: "mechanism-test",
    });
    lead(s);
    stepKernelBattle(data, s, ["focus", "focus"]);
    const action =
      kernelLegalActions(data, s, 0).find((a) => a.startsWith("move:")) ??
      "focus";
    stepKernelBattle(data, s, [action, "focus"]);
    if (s.winner === null && s.phase === "battle")
      stepKernelBattle(data, s, ["switch:1", "focus"]);
    assert.ok(s.events.length > 0);
  }
});

// These mechanics tests inject individual moves to isolate event order; they
// are not source-legal team recommendations or live-game conformance samples.
function inject(s, side, name, index = 0, reserve = null) {
  const p = reserve === null ? pet(s, side) : s.teams[side].pets[reserve];
  p.moves[index] = { id: moveId(name), power: 0, cost: 0, hits: 0 };
  assert.equal(data.programs[moveId(name)].status, "compiled", name);
  return p;
}

test("pivot pauses for a real replacement choice and the remaining attack hits that replacement", () => {
  const s = lead(battle());
  stepKernelBattle(data, s, ["focus", "focus"]);
  inject(s, 0, "闪光弹");
  inject(s, 1, "能量炮");
  pet(s).flatSpeed = 1000;
  const incoming = s.teams[0].pets[2];
  const previous = pet(s);
  stepKernelBattle(data, s, ["move:0", "move:0"]);
  assert.equal(s.phase, "pivot");
  assert.equal(s.round, 2);
  assert.equal(pet(s), previous);
  assert.deepEqual(kernelLegalActions(data, s, 1), ["wait"]);
  assert.throws(() => stepKernelBattle(data, s, ["focus", "wait"]), /Illegal/);
  const events = stepKernelBattle(data, s, ["switch:2", "wait"]);
  assert.equal(s.phase, "battle");
  assert.equal(s.round, 3);
  assert.equal(pet(s), incoming);
  assert.ok(events.some((e) => e.kind === "damage" && e.pet === incoming.id));
  assert.equal(
    s.events.filter((e) => e.round === 2 && e.kind === "move").length,
    2,
  );
});

test("forced enemy departure cancels the outgoing actor's committed command", () => {
  const s = lead(battle());
  stepKernelBattle(data, s, ["focus", "focus"]);
  inject(s, 0, "吓退");
  inject(s, 1, "能量炮");
  const hp = pet(s).hp;
  stepKernelBattle(data, s, ["move:0", "move:0"]);
  assert.equal(s.phase, "pivot");
  const events = stepKernelBattle(data, s, ["wait", "switch:2"]);
  assert.ok(events.some((e) => e.kind === "action-cancelled" && e.side === 1));
  assert.equal(pet(s).hp, hp);
  assert.equal(
    events.filter((e) => e.kind === "move" && e.side === 1).length,
    0,
  );
});

test("an entrant is immune to forced departure during its entry round", () => {
  const s = lead(battle());
  inject(s, 0, "吓退");
  inject(s, 1, "能量炮");
  const events = stepKernelBattle(data, s, ["move:0", "move:0"]);
  assert.equal(s.phase, "battle");
  assert.ok(
    events.some(
      (e) =>
        e.kind === "departure-rejected" && e.reason === "entered-this-round",
    ),
  );
  assert.ok(events.some((e) => e.kind === "move" && e.side === 1));
});

test("re-entry clears transient modifiers and executes the entry hook without offering another ordinary move", () => {
  const s = lead(battle());
  stepKernelBattle(data, s, ["focus", "focus"]);
  inject(s, 0, "远程访问");
  pet(s, 1).buffs.atk = 0.7;
  pet(s, 1).energy = 1;
  const events = stepKernelBattle(data, s, ["move:0", "focus"]);
  assert.equal(pet(s, 1).entered, 2);
  assert.equal(pet(s, 1).buffs.atk, 0);
  assert.ok(events.some((e) => e.kind === "reenter"));
  assert.ok(events.some((e) => e.kind === "action-cancelled" && e.side === 1));
  assert.equal(
    events.filter((e) => e.source?.kind === "focus" && e.side === 1).length,
    0,
  );
});

test("trap blocks voluntary and forced exits, cannot be refreshed and expires after its duration", () => {
  const s = lead(battle());
  inject(s, 0, "石锁");
  stepKernelBattle(data, s, ["move:0", "focus"]);
  assert.equal(pet(s, 1).trapUntil, 3);
  assert.ok(
    !kernelLegalActions(data, s, 1).some((a) => a.startsWith("switch:")),
  );
  inject(s, 1, "闪光弹");
  stepKernelBattle(data, s, ["move:0", "move:0"]);
  assert.equal(pet(s, 1).trapUntil, 3);
  assert.equal(s.phase, "battle");
  assert.ok(
    s.events.some(
      (e) => e.kind === "departure-rejected" && e.reason === "trapped",
    ),
  );
  stepKernelBattle(data, s, ["focus", "focus"]);
  assert.equal(s.round, 4);
  assert.ok(kernelLegalActions(data, s, 1).includes("switch:1"));
});

test("voluntary entry uses the first affordable swift move exactly once", () => {
  const s = lead(battle());
  const reserve = inject(s, 0, "翼击", 0, 2);
  inject(s, 0, "龙卷风", 1, 2);
  reserve.moves[0].cost = 20;
  const events = stepKernelBattle(data, s, ["switch:2", "focus"]);
  const swift = events.filter((e) => e.kind === "swift");
  assert.equal(swift.length, 1);
  assert.equal(swift[0].slot, 1);
  assert.equal(
    events.filter((e) => e.kind === "move" && e.side === 0).length,
    1,
  );
  assert.equal(reserve.actionsSinceEntry, 1);
});

test("swift choice branches remain player decisions and do not expose a second ordinary turn", () => {
  const s = lead(battle());
  const reserve = inject(s, 0, "补觉", 0, 2);
  const trait = Object.values(data.programs).find((p) => p.name === "快锤");
  assert.equal(trait.status, "compiled");
  reserve.program = trait;
  reserve.hp = Math.floor(reserve.maxHp / 2);
  stepKernelBattle(data, s, ["switch:2", "focus"]);
  assert.equal(s.phase, "swift");
  assert.deepEqual(kernelLegalActions(data, s, 0), ["move:0:0", "move:0:1"]);
  assert.deepEqual(kernelLegalActions(data, s, 1), ["wait"]);
  const events = stepKernelBattle(data, s, ["move:0:0", "wait"]);
  assert.equal(s.phase, "battle");
  assert.equal(s.round, 2);
  assert.ok(events.some((e) => e.kind === "heal" && e.side === 0));
  assert.equal(events.filter((e) => e.kind === "swift").length, 1);
});

test("burst is consumed by the first action, including focus, and reset on re-entry", () => {
  const run = (focusFirst) => {
    const s = lead(battle());
    inject(s, 0, "天旋地转");
    if (focusFirst) stepKernelBattle(data, s, ["focus", "focus"]);
    return stepKernelBattle(data, s, ["move:0", "focus"]).find(
      (e) => e.kind === "move" && e.side === 0,
    ).damage;
  };
  assert.ok(run(false) > run(true));
});

test("carried end hooks reduce an initially unaffordable move without using it", () => {
  const s = lead(battle());
  inject(s, 0, "抛石");
  const cost = kernelMoveCost(data, s, 0, 0);
  assert.ok(cost > 10);
  assert.ok(!kernelLegalActions(data, s, 0).includes("move:0"));
  stepKernelBattle(data, s, ["focus", "focus"]);
  assert.equal(kernelMoveCost(data, s, 0, 0), cost - 5);
  assert.equal(pet(s).moves[0].cost, -5);
  assert.ok(
    s.events.some(
      (e) => e.kind === "skill-modifier" && e.source?.id === moveId("抛石"),
    ),
  );
});

test("carried counter growth benefits a different equipped move and survives switching", () => {
  const s = lead(battle());
  inject(s, 0, "能量刃", 0);
  inject(s, 0, "防御", 1);
  inject(s, 1, "能量炮", 0);
  stepKernelBattle(data, s, ["move:1", "move:0"]);
  assert.equal(pet(s).moves[0].power, 90);
  stepKernelBattle(data, s, ["switch:2", "focus"]);
  stepKernelBattle(data, s, ["switch:0", "focus"]);
  assert.equal(pet(s).moves[0].power, 90);
});

test("other-move growth doubles intrinsic skill power without doubling unrelated buffs or triggering on itself", () => {
  const s = lead(battle());
  inject(s, 0, "山火", 0);
  inject(s, 0, "火苗", 1);
  pet(s, 1).hp = pet(s, 1).maxHp = 10000;
  pet(s).power = 100;
  const base = data.programs[moveId("山火")].power;
  stepKernelBattle(data, s, ["move:1", "focus"]);
  assert.equal(pet(s).moves[0].power, base);
  stepKernelBattle(data, s, ["move:1", "focus"]);
  assert.equal(pet(s).moves[0].power, base * 3);
  stepKernelBattle(data, s, ["move:0", "focus"]);
  assert.equal(pet(s).moves[0].power, base * 3);
  assert.equal(pet(s).power, 100);
});

test("poison-effect scaling includes poison marks and actual status layers before move use", () => {
  const s = lead(battle());
  inject(s, 0, "毒液渗透", 0);
  inject(s, 0, "以毒攻毒", 1);
  pet(s, 1).hp = pet(s, 1).maxHp = 10000;
  addKernelStatus(data, s, 1, "中毒", 2, {});
  addKernelMark(s, 1, "中毒", 2, {});
  assert.equal(kernelMoveCost(data, s, 0, 0), 1);
  stepKernelBattle(data, s, ["move:1", "focus"]);
  assert.ok(Math.abs(pet(s).buffs.spa - 1.2) < 1e-12);
  stepKernelBattle(data, s, ["move:0", "focus"]);
  assert.equal(pet(s, 1).statuses.中毒, 3);
  assert.equal(kernelMoveCost(data, s, 0, 0), 0);
});

test("previous-round skill conditions use actual history and expire after an unrelated round", () => {
  const damageAfter = (previous, expire) => {
    const s = lead(battle());
    inject(s, 0, "见招拆招", 0);
    inject(s, 0, "防御", 1);
    inject(s, 0, "氧输送", 2);
    pet(s, 1).hp = pet(s, 1).maxHp = 10000;
    stepKernelBattle(data, s, [previous, "focus"]);
    if (expire) stepKernelBattle(data, s, ["focus", "focus"]);
    return stepKernelBattle(data, s, ["move:0", "focus"]).find(
      (e) => e.kind === "move" && e.side === 0,
    ).damage;
  };
  assert.ok(damageAfter("move:2", false) > damageAfter("move:1", false));
  assert.equal(damageAfter("move:2", true), damageAfter("move:1", false));
});

test("full snapshots resume a mid-turn replacement without repeating actions or end effects", () => {
  const original = lead(battle());
  stepKernelBattle(data, original, ["focus", "focus"]);
  inject(original, 0, "闪光弹");
  inject(original, 1, "抛石");
  pet(original).flatSpeed = 1000;
  stepKernelBattle(data, original, ["move:0", "focus"]);
  assert.equal(original.phase, "pivot");
  const restored = JSON.parse(JSON.stringify(original));
  stepKernelBattle(data, original, ["switch:2", "wait"]);
  stepKernelBattle(data, restored, ["switch:2", "wait"]);
  assert.deepEqual(restored, original);
  assert.equal(pet(restored, 1).moves[0].cost, -5);
});

test("an outgoing support trait buffs the replacement while retaining the replacement's intrinsic passive", () => {
  const s = lead(battle());
  const trait = Object.values(data.programs).find((p) => p.name === "吉利丁片");
  pet(s).program = trait;
  const incoming = s.teams[0].pets[2];
  const intrinsic = incoming.program.id;
  stepKernelBattle(data, s, ["switch:2", "focus"]);
  assert.equal(incoming.program.id, intrinsic);
  assert.equal(incoming.buffs.def, 0.2);
  assert.equal(incoming.buffs.spd, 0.2);
  addKernelStatus(data, s, 0, "冻结", 10, {});
  assert.equal(incoming.statuses.冻结, 0);
  stepKernelBattle(data, s, ["switch:1", "focus"]);
  assert.deepEqual(incoming.statusImmunities, []);
  assert.equal(incoming.program.id, intrinsic);
});

test("enemy-exit resource traits apply on departure and replacement, but not on fainted substitution", () => {
  for (const fainted of [false, true]) {
    const s = lead(battle());
    pet(s).program = Object.values(data.programs).find(
      (p) => p.name === "做噩梦",
    );
    const incoming = s.teams[1].pets[2];
    if (fainted) {
      pet(s, 1).hp = 0;
      s.phase = "replace";
      stepKernelBattle(data, s, ["wait", "switch:2"]);
    } else stepKernelBattle(data, s, ["focus", "switch:2"]);
    assert.equal(incoming.energy, fainted ? 10 : 7);
  }
});

test("the existing first-attack trait and fan bonus share an additive power bucket", () => {
  const s = lead(battle(), 4, 0);
  inject(s, 0, "扇风");
  assert.ok(pet(s).program.rules.some((r) => r.ops.some((o) => o.firstAttack)));
  pet(s).types = [];
  pet(s, 1).types = [];
  pet(s).stats.atk = 100;
  pet(s, 1).stats.def = 100;
  pet(s, 1).hp = pet(s, 1).maxHp = 10000;
  const base = data.programs[moveId("扇风")].power;
  const expected = Math.floor(
    Math.round((100 * Math.round(base * 2) * 37) / 41) / 100,
  );
  const events = stepKernelBattle(data, s, ["move:0", "focus"]);
  assert.equal(
    events.find((e) => e.kind === "move" && e.side === 0).damage,
    expected,
  );
});
