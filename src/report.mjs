import {
  ROSTER,
  getSpirit,
  RULE_VERSION,
  DATA_VERSION,
  READ_DATE,
  POLICY_LABELS,
  DISTRIBUTION_LABELS,
} from "./data.mjs";
const pct = (n) => (n * 100).toFixed(1) + "%";
export function makeReport(base, after, patch, hypothesis, note, model = null) {
  const s = getSpirit(patch.id),
    b = base.ranking.find((x) => x.id === s.id),
    a = after?.ranking.find((x) => x.id === s.id);
  return `# 洛克平衡实验室 · 实验记录\n\n生成时间：${new Date().toISOString()}\n\n## 想验证什么\n\n${hypothesis || "未填写假设"}\n\n## 实验设置\n\n- 规则：${RULE_VERSION}\n- 数据：${DATA_VERSION}；读取日期 ${READ_DATE}\n- 策略：${POLICY_LABELS[base.env.policy]}\n- 对手权重：${DISTRIBUTION_LABELS[base.env.distribution]}\n- 统一生命：${base.env.hp}；初始能量：${base.env.startEnergy}（布克棱岩例外）\n- 配招方案：${base.env.loadout === "coverage" ? "火神加入水系泡沫" : "原生配招"}\n- 每局上限：${base.env.maxTurns} 回合\n- ${base.battles} 个确定性枚举对局；不是独立玩家样本，无统计置信区间\n\n## 调整对象：${s.name}\n\n${after ? `全技能威力系数 ${patch.power}%；${s.traitLabel} ${patch.trait}${s.traitUnit}。` : "未运行调整；以下仅有基准数据。"}\n\n| 指标 | 基准 | 调整后 |\n|---|---:|---:|\n| 对局得分 | ${pct(b.score)} | ${a ? pct(a.score) : "—"} |\n| 有效反制数 | ${b.counters} | ${a ? a.counters : "—"} |\n| 全样本平均回合 | ${base.meanTurns.toFixed(2)} | ${after ? after.meanTurns.toFixed(2) : "—"} |\n| 达到回合上限 | ${pct(base.cappedRate)} | ${after ? pct(after.cappedRate) : "—"} |\n\n反制口径：目标精灵面对该对手的得分不超过25%。得分=胜1/平0.5/负0，按设定对手权重加权，排除镜像。\n\n## 基准矩阵\n\n|我方 / 对手|${ROSTER.map((x) => x.name).join("|")}|\n|---|${ROSTER.map(() => "---:").join("|")}|\n${ROSTER.map((x, i) => `|${x.name}|${base.matrix[i].map((v) => (v === null ? "—" : pct(v))).join("|")}|`).join("\n")}\n\n## 我的判断\n\n${note || "尚未形成结论；需要对照回放和补齐样本。"}\n\n## 解释边界\n\n这是六只精灵、固定配招、单挑、统一生命值的规则实验。没有玩家日志或用户访谈。未实现换宠、应对、防御、天气、印记、首领化、性格和随机技能。样本缺冰、电，可能高估岚鸟；地脉队伍价值受单挑限制。伤害公式来自社区计算器，尚未游戏内标定。不得将本结果称为当前赛季胜率、全游戏强度排名或上线调参建议。强化学习仅针对这个有限子集，不代表已学到全游戏最优策略。\n\n## 强化学习模型\n\n${
    model
      ? `算法 ${model.algorithm}；种子 ${model.seed}；${model.episodes} 局；训练参数 ${JSON.stringify(model.patch)}；最终冻结评估对规则策略得分 ${model.history
          .at(-1)
          .bench.map((x) => pct(x.ruleScore))
          .join(" / ")}。训练环境 ${JSON.stringify(model.env)}。`
      : "本次未加载模型。"
  }\n\n## 复现配置\n\n保存以下 JSON，运行 node scripts/experiment.mjs <配置文件路径>：\n\n\`\`\`json\n${JSON.stringify({ env: base.env, patch: after ? patch : null, model: base.env.policy === "selfplay" && model ? { seed: model.seed, episodes: model.episodes, env: model.env, patch: model.patch } : null }, null, 2)}\n\`\`\`\n\n## 数据来源\n\n${ROSTER.map((x) => `- [${x.name}](${x.source})`).join("\n")}\n- [社区伤害公式](https://roco-showdown.com/battle-use-guide)\n\n角色、名称和游戏相关权利归各自权利人所有；本项目为非官方个人学习作品。\n`;
}
