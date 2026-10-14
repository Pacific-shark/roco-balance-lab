// Small factual sample manually transcribed from the linked public entries.
// No third-party code, artwork or full descriptive text is redistributed.
export const DATA_VERSION = "S3 公开图鉴快照 · 2026-09-01";
export const RULE_VERSION = "subset-0.1.0";
export const READ_DATE = "2026-10-14";
const move = (id, name, type, channel, power, cost, extra = {}) => ({
  id,
  name,
  type,
  channel,
  power,
  cost,
  ...extra,
});
export const MOVES = {
  scratch: move("scratch", "抓挠", "普通", "physical", 35, 0, { energy: 1 }),
  thorn: move("thorn", "棘突", "草", "magic", 100, 3),
  vine: move("vine", "藤绞", "草", "physical", 80, 4, { energy: 5 }),
  rest: move("rest", "休息回复", "普通", "status", 0, 2, { heal: 0.3 }),
  spark: move("spark", "火苗", "火", "physical", 30, 0, { energy: 1 }),
  cut: move("cut", "火焰切割", "火", "physical", 100, 3),
  blow: move("blow", "吹火", "火", "physical", 50, 1, { growth: 20 }),
  cart: move("cart", "火云车", "火", "physical", 140, 5),
  splash: move("splash", "甩水", "水", "magic", 30, 0, { energy: 1 }),
  bubble: move("bubble", "气泡", "水", "magic", 100, 3),
  cannon: move("cannon", "水炮", "水", "magic", 110, 5, { costGrowth: 1 }),
  slap: move("slap", "拍击", "普通", "magic", 65, 1),
  peck: move("peck", "啄击", "翼", "physical", 15, 0, { hits: 2 }),
  fan: move("fan", "扇风", "翼", "physical", 75, 3, { firstBonus: 0.5 }),
  dive: move("dive", "俯冲猛击", "翼", "physical", 140, 5),
  first: move("first", "先发制人", "普通", "physical", 55, 2, { priority: 1 }),
  energyball: move("energyball", "能量炮", "普通", "magic", 50, 3, { hits: 2 }),
  sting: move("sting", "刺藤", "草", "physical", 45, 3, { hits: 2 }),
  leaf: move("leaf", "叶绿光束", "草", "magic", 120, 4),
  stomp: move("stomp", "跺地", "地", "physical", 80, 2),
  rock: move("rock", "岩脉崩毁", "地", "physical", 120, 4),
  quake: move("quake", "地震", "地", "physical", 190, 10),
  dust: move("dust", "扬沙", "地", "physical", 60, 1),
  foam: move("foam", "泡沫", "水", "physical", 60, 1),
  focus: move("focus", "聚能（实验规则）", "普通", "status", 0, 0, {
    energy: 4,
  }),
};
const spirit = (
  id,
  name,
  type,
  stats,
  trait,
  traitLabel,
  value,
  unit,
  traitSummary,
  moves,
  extra = {},
) => ({
  id,
  name,
  type,
  stats,
  trait,
  traitLabel,
  traitValue: value,
  traitUnit: unit,
  traitSummary,
  moves,
  source: `https://rocokingdom.gg/zh/spirits/${id}`,
  ...extra,
});
// stats: hp species, physical attack, physical defense, magic attack, magic defense, speed.
export const ROSTER = [
  spirit(
    "004",
    "魔力猫",
    "草",
    [108, 109, 81, 109, 151, 55],
    "heal",
    "草系技能回血",
    10,
    "%",
    "草系行动后恢复生命",
    ["scratch", "thorn", "vine", "rest"],
  ),
  spirit(
    "007",
    "火神",
    "火",
    [117, 139, 94, 61, 72, 130],
    "burn",
    "助燃增益",
    20,
    "%",
    "火系行动后累积双攻增益",
    ["spark", "cut", "blow", "cart"],
  ),
  spirit(
    "010",
    "水灵",
    "水",
    [125, 58, 94, 127, 132, 85],
    "water",
    "浸润减耗",
    1,
    "点",
    "水系行动后降低全技能能耗",
    ["splash", "bubble", "cannon", "slap"],
  ),
  spirit(
    "020",
    "岚鸟",
    "翼",
    [90, 128, 108, 55, 74, 115],
    "wind",
    "顺风加成",
    50,
    "%",
    "先手攻击获得威力加成",
    ["peck", "fan", "dive", "first"],
  ),
  spirit(
    "043",
    "奇丽花",
    "草",
    [112, 115, 121, 115, 95, 80],
    "recycle",
    "回合末回能",
    3,
    "点",
    "回合结束恢复能量",
    ["energyball", "sting", "thorn", "leaf"],
  ),
  spirit(
    "029",
    "布克棱岩",
    "地",
    [120, 135, 159, 49, 150, 70],
    "ground",
    "队友预热次数",
    0,
    "次",
    "初始零能量；队友每次地系行动提供3能量",
    ["stomp", "rock", "quake", "dust"],
    { traitLabelOfficial: "地脉" },
  ),
];
export const TYPE_DEFENSE = {
  草: { 火: 2, 冰: 2, 毒: 2, 虫: 2, 翼: 2, 水: 0.5, 光: 0.5, 地: 0.5 },
  火: { 普通: 2, 水: 2, 地: 2, 毒: 2, 草: 0.5, 冰: 0.5, 虫: 0.5, 机械: 0.5 },
  水: { 草: 2, 电: 2, 火: 0.5, 地: 0.5, 机械: 0.5 },
  翼: { 冰: 2, 电: 2, 草: 0.5, 虫: 0.5, 武: 0.5 },
  地: {
    普通: 2,
    草: 2,
    水: 2,
    冰: 2,
    武: 2,
    机械: 2,
    火: 0.5,
    电: 0.5,
    毒: 0.5,
  },
};
export const DEFAULT_ENV = {
  policy: "both",
  distribution: "uniform",
  hp: 400,
  startEnergy: 10,
  maxTurns: 40,
  loadout: "native",
};
export const loadoutFor = (id, mode = "native") =>
  id === "007" && mode === "coverage"
    ? ["spark", "cut", "cart", "foam"]
    : getSpirit(id).moves;
export const POLICY_LABELS = {
  selfplay: "强化学习 · 冻结策略",
  both: "两种规则策略交叉",
  greedy: "即时伤害优先",
  efficient: "能量效率优先",
};
export const DISTRIBUTION_LABELS = {
  uniform: "均匀对手分布",
  water: "水灵权重 ×3",
  grass: "草系权重 ×3",
};
export const getSpirit = (id) => {
  const s = ROSTER.find((x) => x.id === id);
  if (!s) throw new Error(`未知精灵：${id}`);
  return s;
};
export const defaultPatch = (id) => ({
  id,
  power: 100,
  trait: getSpirit(id).traitValue,
});
