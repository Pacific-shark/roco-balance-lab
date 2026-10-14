import { readFile, writeFile } from "node:fs/promises";
import { presetBuild, BUILD_RULE_VERSION } from "../src/team-stats.mjs";
const wiki = JSON.parse(
  await readFile(
    new URL("../public/data/bwiki-2026-10-14.json", import.meta.url),
    "utf8",
  ),
);
const evidence = JSON.parse(
  await readFile(
    new URL("../docs/evidence/bwiki-types-2026-10-14.json", import.meta.url),
    "utf8",
  ),
);
const types = {};
const between = (text, start, end) =>
  text
    .split(start)[1]
    .split(end)[0]
    .trim()
    .split("\n")
    .filter((x) => x && x !== "无");
for (const { type, text } of evidence.rows) {
  types[type] = {};
  for (const t of between(text, "\n弱点\n×2\n", "\n抗性\n")) types[type][t] = 2;
  for (const t of between(text, "\n抗性\n×0.5\n", "\n双重抗性\n"))
    types[type][t] = 0.5;
}
// Each observed offensive relation must agree with the separately observed defensive relation.
for (const { type, text } of evidence.rows) {
  const attack = text.split("OFFENSE")[1];
  const weak = between(attack, "\n克制\n×2\n", "\n被抵抗\n");
  const resist = attack
    .split("\n被抵抗\n×0.5\n")[1]
    .trim()
    .split("\n")
    .filter((x) => x && x !== "无");
  for (const other of Object.keys(types)) {
    const expected = weak.includes(other)
      ? 2
      : resist.includes(other)
        ? 0.5
        : 1;
    if ((types[other][type] ?? 1) !== expected) throw Error("攻防属性表不一致");
  }
}
// Explicit effect registrations, not a best-effort description parser.
const effects = {
  抓挠: { energy: 1 },
  休息回复: { heal: 0.3 },
  棘突: {},
  藤绞: { energy: 5 },
  叶绿光束: {},
  防御: { guard: 0.7, counter: "attack" },
  徒长: { energy: 10 },
  酶浓度调整: { guard: 0.8, counter: "attack", counterHeal: 0.2 },
  火苗: { energy: 1 },
  火焰切割: {},
  吹火: { growth: 20 },
  火云车: {},
  闪燃: { counter: "status", counterMultiplier: 4 },
  热身: { nextAttack: 2, counter: "defense", counterNext: 4 },
  力量增效: { buff: { atk: 1 } },
  怒火: { buff: { atk: 1.2, spa: 1.2, def: -0.4, spd: -0.4 } },
  甩水: { energy: 1 },
  气泡: {},
  水炮: { costGrowth: 1 },
  拍击: {},
  水泡盾: { guard: 0.8, counter: "attack", counterBuff: { spa: 0.7 } },
  啄击: { hits: 2 },
  扇风: { firstBonus: 0.5 },
  俯冲猛击: {},
  先发制人: { priority: 1 },
  能量炮: { hits: 2 },
  刺藤: { hits: 2 },
  富养化: { benchEnergy: 3 },
  氧输送: { energy: 4, buff: { spa: 0.7 } },
  岩脉崩毁: { fixedCost: 4 },
  跺地: {},
  壁垒: { guard: 0.9, counter: "attack", counterCooldown: 0 },
  地震: {},
  火焰冲锋: {},
  双响炮: { hits: 2 },
  炎息: {},
  根吸收: { heal: 0.15, energy: 4 },
  飞叶: {},
  顶端优势: {},
  丰收: { heal: 0.2 },
  丰饶: { buff: { atk: 1.4, spa: 1.4 } },
  泡沫: {},
};
const moveByName = {},
  moves = {};
for (const [name, effect] of Object.entries(effects)) {
  const m = Object.values(wiki.skills).find(
    (s) => s.name === name && s.category !== "特性",
  );
  if (!m) throw Error("技能缺失：" + name);
  moveByName[name] = m.id;
  moves[m.id] = {
    ...m,
    kind:
      m.category === "防御"
        ? "defense"
        : m.category === "状态"
          ? "status"
          : "attack",
    effect,
  };
}
const specs = [
  [
    "魔力猫",
    "主形态",
    "grassHeal",
    ["抓挠", "棘突", "藤绞", "防御"],
    ["叶绿光束", "休息回复", "徒长", "酶浓度调整"],
  ],
  [
    "火神",
    "主形态",
    "fireBoost",
    ["火苗", "吹火", "闪燃", "防御"],
    ["火云车", "热身", "火焰切割", "力量增效", "怒火"],
  ],
  [
    "水灵",
    "主形态",
    "waterDiscount",
    ["甩水", "气泡", "水炮", "水泡盾"],
    ["拍击", "防御"],
  ],
  [
    "岚鸟",
    "本来的样子",
    "firstPower",
    ["啄击", "扇风", "俯冲猛击", "防御"],
    ["先发制人"],
  ],
  [
    "奇丽花",
    "主形态",
    "endEnergy",
    ["刺藤", "氧输送", "富养化", "防御"],
    ["叶绿光束", "能量炮", "棘突"],
  ],
  [
    "布克棱岩",
    "主形态",
    "groundCharge",
    ["跺地", "岩脉崩毁", "壁垒", "力量增效"],
    ["地震", "防御"],
  ],
  [
    "烈火守护",
    "主形态",
    "fireEntry",
    ["火焰冲锋", "双响炮", "火云车", "防御"],
    ["闪燃", "热身", "怒火"],
  ],
  [
    "火焰猿",
    "主形态",
    "fireCharge",
    ["炎息", "吹火", "火云车", "防御"],
    ["闪燃", "先发制人", "怒火"],
  ],
  ["格兰球", "主形态", "endHeal", ["藤绞", "棘突", "根吸收", "叶绿光束"], []],
  [
    "森巨人",
    "主形态",
    "grassBenchHeal",
    ["飞叶", "丰收", "酶浓度调整", "丰饶"],
    ["根吸收", "顶端优势", "先发制人"],
  ],
];
const creatures = {};
for (const [name, form, handler, defaults, extra] of specs) {
  const c = wiki.creatures.find((x) => x.name === name && x.form === form);
  if (!c) throw Error("形态缺失：" + name);
  const pool = [...new Set([...defaults, ...extra])].map((n) => moveByName[n]);
  const legal = new Set(
    c.skills
      .filter((s) => s.method === "自学" || s.method === "技能石")
      .map((s) => s.skill),
  );
  if (pool.some((id) => !legal.has(id))) throw Error("非法配招：" + name);
  creatures[c.id] = {
    id: c.id,
    name,
    form,
    dex: c.dex,
    types: c.types,
    stats: c.stats,
    trait: { ...wiki.skills[c.trait], handler },
    defaultMoves: defaults.map((n) => moveByName[n]),
    pool,
    source: c.source,
  };
}
const id = (name) => Object.values(creatures).find((x) => x.name === name).id;
const teams = [
  [
    "balanced",
    "混合队",
    ["魔力猫", "火神", "水灵", "岚鸟", "奇丽花", "布克棱岩"],
  ],
  [
    "grass",
    "草系预热队",
    ["奇丽花", "魔力猫", "森巨人", "格兰球", "水灵", "岚鸟"],
  ],
  [
    "fire",
    "火系预热队",
    ["火神", "烈火守护", "火焰猿", "水灵", "岚鸟", "布克棱岩"],
  ],
  [
    "relay",
    "资源接力队",
    ["奇丽花", "森巨人", "烈火守护", "火神", "布克棱岩", "水灵"],
  ],
].map(([key, name, names]) => ({
  id: key,
  name,
  members: names.map((n) => ({
    id: id(n),
    moves: creatures[id(n)].defaultMoves,
    ...presetBuild(creatures[id(n)]),
  })),
}));
const data = {
  version: "bwiki-team-2026-10-14-build1",
  buildRules: BUILD_RULE_VERSION,
  source: wiki.meta,
  types,
  creatures,
  moves,
  teams,
  scope:
    "10 种形态的明确注册机制；不支持的技能拒绝运行。模板为实验阵容，不是天梯队伍。",
};
await writeFile(
  new URL("../public/data/team-2026-10-14.json", import.meta.url),
  JSON.stringify(data),
);
console.log(
  JSON.stringify({
    creatures: Object.keys(creatures).length,
    moves: Object.keys(moves).length,
    types: Object.keys(types).length,
    teams: teams.length,
  }),
);
