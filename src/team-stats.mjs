export const STAT_LABELS = Object.freeze({
  hp: "生命",
  atk: "物攻",
  def: "物防",
  spa: "魔攻",
  spd: "魔防",
  spe: "速度",
});
export const STAT_KEYS = Object.keys(STAT_LABELS);
export const IV_VALUES = Object.freeze([0, 7, 8, 9, 10]);
export const BUILD_RULE_VERSION = "pvp-build-2-l60-g5-nature20";
export const PANEL_SCOPE = Object.freeze({level: 60, growthStars: 5, evidence: "launch-game-panel-6-of-6", currentSeasonVerified: false});
// Factual mappings from the current World BWIKI cultivation reference, not the
// older browser game's 25-nature table. All 30 natures have distinct up/down stats.
const pairs = {
  hp: { atk: "沉默", def: "忧郁", spa: "平和", spd: "粗心", spe: "踏实" },
  atk: { hp: "逞强", def: "大胆", spa: "固执", spd: "调皮", spe: "勇敢" },
  def: { hp: "坦率", atk: "稳重", spa: "天真", spd: "懒散", spe: "悠闲" },
  spa: { hp: "理性", atk: "聪明", def: "专注", spd: "偏执", spe: "冷静" },
  spd: { hp: "焦虑", atk: "警惕", def: "温顺", spa: "害羞", spe: "慎重" },
  spe: { hp: "热情", atk: "胆小", def: "急躁", spa: "开朗", spd: "莽撞" },
};
export const NATURES = Object.freeze(
  Object.fromEntries(
    Object.entries(pairs).flatMap(([up, downs]) =>
      Object.entries(downs).map(([down, name]) => [
        name,
        Object.freeze({ name, up, down }),
      ]),
    ),
  ),
);
export const natureLabel = (name) =>
  `${name}（${STAT_LABELS[NATURES[name].up]}↑ / ${STAT_LABELS[NATURES[name].down]}↓）`;
export function presetBuild(creature, style = "offense", value = 10) {
  const physical = creature.stats.atk >= creature.stats.spa,
    offense = physical ? "atk" : "spa";
  const keys =
    style === "durable" ? ["hp", "def", "spd"] : ["hp", offense, "spe"];
  const nature =
    style === "durable"
      ? "踏实"
      : style === "speed"
        ? physical
          ? "开朗"
          : "胆小"
        : physical
          ? "固执"
          : "聪明";
  return {
    nature,
    ivs: Object.fromEntries(
      STAT_KEYS.map((k) => [k, keys.includes(k) ? value : 0]),
    ),
  };
}
export function validateBuild(build) {
  if (build && ((build.level !== undefined && build.level !== 60) || (build.growthStars !== undefined && build.growthStars !== 5)))
    throw Error("当前面板仅支持60级、五星成长的PVP基准");
  if (!build || !Object.hasOwn(NATURES, build.nature))
    throw Error("请选择《世界》的有效性格");
  if (
    !build.ivs ||
    Object.keys(build.ivs).length !== 6 ||
    STAT_KEYS.some(
      (k) => !Object.hasOwn(build.ivs, k) || !IV_VALUES.includes(build.ivs[k]),
    )
  )
    throw Error("六项资质须明确填写 0、7、8、9 或 10");
  const count = STAT_KEYS.filter((k) => build.ivs[k] > 0).length;
  if (count < 1 || count > 3) throw Error("资质加成须有 1—3 项，不能六项全满");
}
/** Fixed level-60/five-star PVP panel; iv is the INITIAL aptitude (0/7/8/9/10).
 * 3 * iv = 0.5 * (6 * initialIV); do not multiply it by six again.
 * Two-stage rounding reproduces the six launch-version game-panel observations
 * in docs/evidence/stat-panel-game-fixture.json. Current-season revalidation is pending.
 */
export function statPanel(base, iv = 0, hp = false, nature = 1) {
  if (
    !Number.isSafeInteger(base) ||
    base < 0 ||
    !IV_VALUES.includes(iv) ||
    ![0.9, 1, 1.2].includes(nature)
  )
    throw Error("面板参数无效");
  const core = Math.floor(((hp ? 17 : 11) * (base + 3 * iv) + 5) / 10) + (hp ? 70 : 10);
  return Math.floor((core * Math.round(nature * 10) + 5) / 10) + (hp ? 100 : 50);
}
export function calculatePanel(creature, build) {
  validateBuild(build);
  const nature = NATURES[build.nature];
  const breakdown = STAT_KEYS.map((key) => {
    const modifier = key === nature.up ? 1.2 : key === nature.down ? 0.9 : 1;
    return {
      key,
      label: STAT_LABELS[key],
      base: creature.stats[key],
      iv: build.ivs[key],
      modifier,
      neutral: statPanel(creature.stats[key], build.ivs[key], key === "hp"),
      actual: statPanel(
        creature.stats[key],
        build.ivs[key],
        key === "hp",
        modifier,
      ),
    };
  });
  return {
    scope: PANEL_SCOPE,
    stats: Object.fromEntries(breakdown.map((r) => [r.key, r.actual])),
    breakdown,
  };
}
// Stable identity of the exact training configuration, not a security hash.
export function teamConfigurationId(data) {
  const text = JSON.stringify(
    data.teams.map((t) => ({
      id: t.id,
      members: t.members.map((m) => ({
        id: m.id,
        moves: m.moves,
        nature: m.nature,
        ivs: STAT_KEYS.map((k) => m.ivs[k]),
      })),
    })),
  );
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return BUILD_RULE_VERSION + "-" + (h >>> 0).toString(16);
}
