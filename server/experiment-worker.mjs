import { parentPort, workerData } from "node:worker_threads";
import {
  candidateTeam,
  makeSplits,
  teamKey,
  evaluateCandidate,
} from "../src/research.mjs";
import { trainTeams, seededRandom } from "../src/team-rl.mjs";
import { makeCandidateReport } from "./evaluation.mjs";

const { config, data, context } = workerData;
let state = workerData.checkpoint;
const emit = (phase, extra = {}) =>
  parentPort.postMessage({
    type: "checkpoint",
    state,
    metric: { phase, completed: state.completed, ...extra },
  });
if (!state) {
  const split = makeSplits(data, config.seed + 700000),
    rng = seededRandom(config.seed);
  const seen = new Set(
    [...split.train, ...split.validation, ...split.test].map((t) =>
      teamKey(t.members),
    ),
  );
  const candidates = [];
  for (let n = 0; candidates.length < config.population && n < 1000; n++) {
    const team = candidateTeam(data, rng, { target: config.target });
    const key = teamKey(team.members);
    if (!seen.has(key)) {
      candidates.push(team);
      seen.add(key);
    }
  }
  if (candidates.length !== config.population)
    throw Error("无法生成足够的独立候选");
  state = {
    phase: "training",
    completed: 0,
    split,
    candidates,
    model: null,
    validation: [],
    selected: [],
    reports: [],
    evaluationBattles: 0,
  };
  emit("准备完成");
}
const trainingData = {
  ...data,
  teams: [...state.candidates, ...state.split.train],
};
while (state.completed < config.episodes) {
  const started = performance.now();
  // Fixed 100-episode batches make each persisted boundary reproducible. Archive
  // and baselines restart per batch, both on uninterrupted runs and resume.
  const model = trainTeams(trainingData, {
    episodes: 100,
    seed: config.seed + state.completed,
    initialAgents: state.model?.agents ?? null,
  });
  state.model = model;
  state.completed += 100;
  emit("自博弈", {
    batchMs: Math.round(performance.now() - started),
    updates: model.updates,
    decisions: model.decisions,
    draws: model.draws,
    switches: model.switches,
  });
}
state.phase = "validation";
for (let i = state.validation.length; i < state.candidates.length; i++) {
  const team = state.candidates[i];
  const validation = evaluateCandidate(
    data,
    team,
    state.model,
    state.split.validation.map((t) => ({ ...t, policy: "tactical" })),
    { seed: config.seed + 800000 },
  );
  state.validation.push({ team, score: validation.score });
  state.evaluationBattles += validation.battles;
  emit("验证筛选", { candidate: i + 1, score: validation.score });
}
if (!state.selected.length) {
  for (const row of [...state.validation].sort(
    (a, b) => b.score - a.score || a.team.id.localeCompare(b.team.id),
  )) {
    if (
      !state.selected.length ||
      state.selected.every(
        (x) =>
          x.team.members.filter((m) =>
            row.team.members.some((y) => y.id === m.id),
          ).length <= 4,
      )
    )
      state.selected.push(row);
    if (state.selected.length === 3) break;
  }
  state.phase = "test";
  emit("冻结配队");
}
for (let i = state.reports.length; i < state.selected.length; i++) {
  const team = state.selected[i].team;
  const opponents = state.split.test.map((t) => ({ ...t, policy: "tactical" }));
  const options = { seed: config.seed + 900000, record: true };
  const base = evaluateCandidate(data, team, state.model, opponents, options);
  const changed = evaluateCandidate(data, team, state.model, opponents, {
    ...options,
    record: false,
    patch: { disableTrait: config.target },
  });
  state.evaluationBattles += base.battles + changed.battles;
  state.reports.push({
    ...makeCandidateReport(team, base.rows, changed.rows),
    lineup: team.members.map((m) => ({
      ...m,
      name: data.creatures[m.id].name,
      trait: data.creatures[m.id].trait.name,
      moveNames: m.moves.map((id) => data.moves[id].name),
    })),
  });
  emit("冻结测试与特性对照", { candidate: i + 1 });
}
const report = {
  schemaVersion: 1,
  scope: "prototype-only",
  title: "受限6v6原型流程报告",
  target: config.target,
  roleHypothesis: config.role,
  config,
  context,
  actualTrainingEpisodes: state.completed,
  evaluationBattles: state.evaluationBattles,
  apiCalls: 0,
  apiTokens: 0,
  canPublishBalanceConclusion: false,
  method: {
    algorithm: state.model.algorithm,
    independentAgents: 2,
    batchSize: 100,
    initialization: "公开启发式权重；非从零学习",
    opponents: "当前策略、批内历史策略、规则策略",
    continuation:
      "每100局保存权重；批内历史池与基线每批重置，不宣称连续大批训练等价",
    selection: "验证池按得分与成员差异保留至多3队；测试池不用于筛选",
    role: "角色只作为研究假设，未用伤害或出场奖励强制精灵承担核心身份",
  },
  splits: state.split,
  validation: state.validation,
  candidates: state.reports,
  limitations: [
    "旧原型仅10形态、42技能，不能代表现行全量合法环境",
    "旧原型技能池与信息可见性尚未迁移到核准规则；不用于当前排位强度判断",
    "仅一个训练种子与两个留出对手配置；不提供全环境置信度",
    "本次仅生成并筛选一代候选，未执行多代联合优化或同定位替换后重训",
    "草魔法、愿力、首领化尚未接入，此报告不评价这些机制",
  ],
};
parentPort.postMessage({ type: "done", report });
