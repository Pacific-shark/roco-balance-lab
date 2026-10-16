import { seededRandom } from "../src/team-rl.mjs";

const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const key = (r) =>
  JSON.stringify([r.opponent, r.role, r.seat, r.tieFirst, r.seed]);

// Opponent configurations, rather than repeated seats, are the resampling unit.
export function clusteredEstimate(rows, field = "score") {
  if (!rows.length)
    return { mean: null, interval95: null, opponentClusters: 0 };
  const groups = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r[field]) || !r.opponent)
      throw Error("评价样本缺少有效数值或对手编号");
    const xs = groups.get(r.opponent) ?? [];
    xs.push(r[field]);
    groups.set(r.opponent, xs);
  }
  const values = [...groups.values()].map(mean);
  if (values.length < 10)
    return {
      mean: mean(values),
      interval95: null,
      opponentClusters: values.length,
      reason: "独立对手配置少于10组，暂不展示置信区间；不能外推全环境",
    };
  const rng = seededRandom(71016),
    samples = [];
  for (let n = 0; n < 1000; n++)
    samples.push(
      mean(values.map(() => values[Math.floor(rng() * values.length)])),
    );
  samples.sort((a, b) => a - b);
  return {
    mean: mean(values),
    interval95: [samples[24], samples[974]],
    opponentClusters: values.length,
    reason: "按对手配置聚类的bootstrap区间；不包含训练种子间差异",
  };
}

export function pairedImpact(base, changed) {
  const index = new Map(changed.map((r) => [key(r), r]));
  if (
    index.size !== changed.length ||
    base.length !== changed.length ||
    new Set(base.map(key)).size !== base.length
  )
    throw Error("对照样本必须一一对应且无重复");
  return clusteredEstimate(
    base.map((r) => {
      const other = index.get(key(r));
      if (!other) throw Error("对照的对手、座位、策略和随机种子必须一致");
      return { opponent: r.opponent, delta: r.score - other.score };
    }),
    "delta",
  );
}

export const DIMENSIONS = [
  {
    id: "strength",
    name: "竞技表现",
    question: "在哪些队伍和对位中有效？",
    evidence: "冻结测试得分、对手分布、跨种子稳定性",
  },
  {
    id: "contribution",
    name: "个体贡献",
    question: "把它换掉，队伍会失去什么？",
    evidence: "同定位替换；固定策略与等预算重新适应分别比较",
  },
  {
    id: "identity",
    name: "玩法特色",
    question: "特性是否改变了实际决策？",
    evidence: "机制移除对照、关键回放、资源与决策变化",
  },
  {
    id: "health",
    name: "反制与代价",
    question: "优势是否有可获得的反制？",
    evidence: "对位下限、补盲覆盖、共鸣与技能槽机会成本",
  },
  {
    id: "alignment",
    name: "设计一致性",
    question: "发现的玩法符合哪一条设计假设？",
    evidence: "官方设计说明或明确标注的研究假设，加人工复核",
  },
];

export function makeCandidateReport(team, base, ablated) {
  return {
    team,
    battles: base.length,
    wins: base.filter((r) => r.score === 1).length,
    draws: base.filter((r) => r.score === 0.5).length,
    performance: clusteredEstimate(base),
    traitSensitivity: pairedImpact(base, ablated),
    rows: base,
    ablatedRows: ablated,
    dimensions: DIMENSIONS.map((d) => ({
      ...d,
      status: ["strength", "identity"].includes(d.id)
        ? "prototype-evidence"
        : "needs-evidence",
      score: null,
    })),
    interpretation:
      "特性敏感度是冻结策略下的机制移除差值，不等于个体边际贡献或最优反制后的强度。未以人工权重合成总分。",
  };
}
