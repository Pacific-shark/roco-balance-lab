import {
  STAT_KEYS,
  NATURES,
  teamConfigurationId,
  validateBuild,
} from "./team-stats.mjs";
import {
  runTeamBattle,
  TEAM_RULE_VERSION,
  validateTeam,
} from "./team-engine.mjs";
import { teamLearnedPolicy } from "./team-rl.mjs";

export function buildCandidates() {
  const rows = [];
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 5; j++)
      for (let k = j + 1; k < 6; k++)
        for (const nature of Object.keys(NATURES))
          rows.push({
            nature,
            ivs: Object.fromEntries(
              STAT_KEYS.map((s, n) => [s, [i, j, k].includes(n) ? 10 : 0]),
            ),
          });
  return rows;
}
const buildKey = (b) =>
  JSON.stringify([b.nature, ...STAT_KEYS.map((k) => b.ivs[k])]);
const rank = (a, b) =>
  b.score - a.score || b.margin - a.margin || a.order - b.order;
/** Coordinate search with successive halving; never claims a global optimum.
 * All four templates get the same budget. Reference opponents stay frozen.
 * Default pool: every nature × every allocation of three perfect IVs = 600.
 */
export function optimizeTeamBuilds(
  data,
  model,
  { patch = null, onProgress = () => {}, candidates = buildCandidates() } = {},
) {
  if (model.dataVersion !== data.version || model.rules !== TEAM_RULE_VERSION)
    throw Error("搜索模型与数据或规则版本不一致");
  if (!candidates.length) throw Error("培养候选集不能为空");
  candidates.forEach(validateBuild);
  data.teams.forEach((t) => validateTeam(data, t.members));
  const reference = structuredClone(data.teams),
    next = structuredClone(data),
    log = [];
  let battles = 0;
  for (let ti = 0; ti < next.teams.length; ti++) {
    const team = next.teams[ti],
      opponents = reference.filter((t) => t.id !== team.id);
    if (!opponents.length) throw Error("培养搜索至少需要两个实验阵容");
    const scenarios = opponents.flatMap((opp, i) =>
      [0, 1].map((role) => ({
        opp,
        role,
        seed: 21000 + i * 100 + role,
        tieFirst: role,
      })),
    );
    const scoreMembers = (members, indices) => {
      const rows = indices.map((i) => {
        const sc = scenarios[i],
          r = runTeamBattle(
            data,
            members,
            sc.opp.members,
            [
              teamLearnedPolicy(data, model.agents[sc.role], sc.seed),
              teamLearnedPolicy(data, model.agents[1 - sc.role], sc.seed + 11),
            ],
            { patch, tieFirst: sc.tieFirst, record: false },
          );
        battles++;
        const [a, b] = r.state.sides;
        const health = (s) =>
          s.pets.reduce((n, p) => n + p.hp / p.maxHp, 0) / 6;
        return {
          score: r.score,
          margin: (a.magic - b.magic) / 4 + (health(a) - health(b)) * 0.25,
        };
      });
      return {
        score: rows.reduce((n, r) => n + r.score, 0) / rows.length,
        margin: rows.reduce((n, r) => n + r.margin, 0) / rows.length,
      };
    };
    const full = scenarios.map((_, i) => i),
      baseline = scoreMembers(team.members, full);
    for (let slot = 0; slot < team.members.length; slot++) {
      const current = structuredClone(team.members[slot]),
        start = scoreMembers(team.members, full);
      const pool = [current, ...candidates].filter(
        (b, i, all) => all.findIndex((x) => buildKey(x) === buildKey(b)) === i,
      );
      let rows = pool.map((build, order) => ({ build, order }));
      // Compare the finalist against the incumbent on all scenarios before applying.
      const stages = [
        { indices: [(ti + slot) % scenarios.length], keep: 60 },
        { indices: full.filter((_, i) => i % 2 === 0), keep: 12 },
        { indices: full, keep: 1 },
      ];
      for (const stage of stages) {
        rows = rows
          .map((row) => {
            const members = team.members.map((m, i) =>
              i === slot
                ? { ...m, nature: row.build.nature, ivs: { ...row.build.ivs } }
                : m,
            );
            return { ...row, ...scoreMembers(members, stage.indices) };
          })
          .sort(rank)
          .slice(0, stage.keep);
      }
      const best = rows[0],
        incumbent = { ...start, order: -1 };
      if (rank(best, incumbent) < 0)
        team.members[slot] = {
          ...current,
          nature: best.build.nature,
          ivs: { ...best.build.ivs },
        };
      const changed = buildKey(team.members[slot]) !== buildKey(current);
      const row = {
        team: team.id,
        slot,
        creature: current.id,
        candidates: pool.length,
        changed,
        before: { nature: current.nature, ivs: current.ivs },
        after: {
          nature: team.members[slot].nature,
          ivs: team.members[slot].ivs,
        },
        beforeScore: start.score,
        afterScore: changed ? best.score : start.score,
        battles,
      };
      log.push(row);
      onProgress({
        phase: "search",
        completed: log.length,
        total: data.teams.length * 6,
        battles,
        team: team.name,
        slot: slot + 1,
      });
    }
    const final = scoreMembers(team.members, full);
    for (const row of log.filter((r) => r.team === team.id)) {
      row.teamBeforeScore = baseline.score;
      row.teamAfterScore = final.score;
    }
  }
  return {
    data: next,
    report: {
      algorithm: "coordinate-successive-halving-v1",
      candidateCount: candidates.length,
      scope: "所列候选集内的一轮坐标搜索；固定配招和参考对手；不是全局最优证明",
      candidatePool: structuredClone(candidates),
      stages: [
        { scenarios: 1, keep: 60 },
        { scenarios: "each opponent, agent role 0", keep: 12 },
        { scenarios: "all opponents and both agent roles", keep: 1 },
      ],
      panelRule: "五星60级：六维之一 +20%，另一项 -10%；公测实机样例通过，当前赛季待复验",
      referenceModel: {
        seed: model.seed,
        episodes: model.episodes,
        configurationId: model.configurationId,
        rules: model.rules,
        dataVersion: model.dataVersion,
        agents: structuredClone(model.agents),
      },
      referenceTeams: reference,
      beforeConfigurationId: teamConfigurationId(data),
      afterConfigurationId: teamConfigurationId(next),
      patch,
      battles,
      log,
    },
  };
}
