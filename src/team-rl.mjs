import {
  TEAM_RULE_VERSION,
  activePet,
  createTeamBattle,
  teamLegalActions,
  teamMoveCost,
  teamDamage,
  stepTeamBattle,
  runTeamBattle,
} from "./team-engine.mjs";
import { teamConfigurationId } from "./team-stats.mjs";

export function seededRandom(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const attackMoves = (data, p) =>
  p.moves
    .map((id) => data.moves[id])
    .filter(
      (m) => m.kind === "attack" && teamMoveCost(data, p, m.id) <= p.energy,
    );
function maxDamage(data, a, b) {
  return Math.max(
    0,
    ...attackMoves(data, a).map(
      (m) =>
        teamDamage(data, a, b, m, { first: a.stats.spe > b.stats.spe }).total,
    ),
  );
}
export function featureNames(data) {
  return [
    "bias",
    "attack",
    "defense",
    "status",
    "focus",
    "switch",
    "replace",
    "lead",
    "hp",
    "energy",
    "enemyHp",
    "enemyEnergy",
    "magicLead",
    "teamHealthLead",
    "teamEnergyLead",
    "damage",
    "lethal",
    "cost",
    "heal",
    "energyGain",
    "benchEnergyGain",
    "benchHealGain",
    "firePreheat",
    "groundPreheat",
    "attackBuff",
    "counterStatus",
    "counterAttack",
    "counterDefense",
    "incomingRisk",
    "riskImprovement",
    "switchOutDamage",
    "switchOutEnergy",
    "targetHealth",
    "targetEnergy",
    "turn",
    "matchupDamage",
    ...Object.keys(data.creatures).map((id) => "actor:" + id),
    ...Object.keys(data.creatures).map((id) => "enemy:" + id),
    ...Object.keys(data.moves).map((id) => "move:" + id),
    ...Object.keys(data.creatures).map((id) => "switch:" + id),
  ];
}
export function teamFeatures(data, state, side, action) {
  const own = state.sides[side],
    enemy = state.sides[1 - side],
    a = activePet(state, side),
    b = activePet(state, 1 - side);
  const total = (s, k, den) =>
    s.pets.reduce((n, p) => n + p[k] / (den || p.maxHp), 0) / 6;
  const f = {
    bias: 1,
    magicLead: (own.magic - enemy.magic) / 4,
    teamHealthLead: total(own, "hp") - total(enemy, "hp"),
    teamEnergyLead: total(own, "energy", 10) - total(enemy, "energy", 10),
    turn: Math.min(state.round / 50, 2),
    hp: a ? a.hp / a.maxHp : 1,
    energy: a ? a.energy / 10 : 1,
    enemyHp: b ? b.hp / b.maxHp : 1,
    enemyEnergy: b ? b.energy / 10 : 1,
  };
  if (a) f["actor:" + a.id] = 1;
  if (b) f["enemy:" + b.id] = 1;
  if (action === "wait") return f;
  if (action.startsWith("switch:")) {
    const p = own.pets[Number(action.slice(7))];
    f[
      state.phase === "lead"
        ? "lead"
        : state.phase === "replace"
          ? "replace"
          : "switch"
    ] = 1;
    f["switch:" + p.id] = 1;
    f.targetHealth = p.hp / p.maxHp;
    f.targetEnergy = p.energy / 10;
    if (b) {
      f.matchupDamage = clamp(maxDamage(data, p, b) / b.maxHp, 0, 2);
      f.incomingRisk = clamp(maxDamage(data, b, p) / Math.max(1, p.hp), 0, 2);
      f.riskImprovement = a
        ? clamp(maxDamage(data, b, a) / Math.max(1, a.hp), 0, 2) -
          f.incomingRisk
        : 0;
    }
    f.switchOutDamage = a ? 1 - a.hp / a.maxHp : 0;
    f.switchOutEnergy = a ? 1 - a.energy / 10 : 0;
    return f;
  }
  if (action === "focus") {
    f.focus = 1;
    f.energyGain = Math.min(5, 10 - a.energy) / 10;
    return f;
  }
  const m = data.moves[action.slice(5)],
    e = m.effect;
  f[m.kind] = 1;
  f["move:" + m.id] = 1;
  f.cost = teamMoveCost(data, a, m.id) / 10;
  const dmg = teamDamage(data, a, b, m, {
    first: (e.priority ?? 0) > 0 || a.stats.spe > b.stats.spe,
  }).total;
  f.damage = clamp(dmg / b.maxHp, 0, 2);
  f.lethal = dmg >= b.hp ? 1 : 0;
  f.heal = Math.min(
    1 - a.hp / a.maxHp,
    (e.heal ?? 0) + (a.trait === "grassHeal" && m.type === "草" ? 0.1 : 0),
  );
  f.energyGain = Math.min(10 - a.energy, e.energy ?? 0) / 10;
  const localPatch = state.patch?.side === side ? state.patch : {};
  f.benchEnergyGain =
    own.pets.reduce(
      (sum, p, i) =>
        sum +
        (i !== own.active && p.hp > 0
          ? Math.min(
              10 - p.energy,
              e.benchEnergy ? (localPatch.benchEnergy ?? e.benchEnergy) : 0,
            )
          : 0),
      0,
    ) / 50;
  f.benchHealGain = own.pets.reduce(
    (sum, p, i) =>
      sum +
      (i !== own.active &&
      p.hp > 0 &&
      p.trait === "grassBenchHeal" &&
      m.type === "草"
        ? Math.min(1 - p.hp / p.maxHp, localPatch.grassBenchRate ?? 0.3)
        : 0),
    0,
  );
  f.firePreheat =
    m.type === "火"
      ? own.pets.filter(
          (p, i) =>
            i !== own.active &&
            p.hp > 0 &&
            ["fireCharge", "fireEntry"].includes(p.trait),
        ).length / 5
      : 0;
  f.groundPreheat =
    m.type === "地"
      ? own.pets.filter(
          (p, i) => i !== own.active && p.hp > 0 && p.trait === "groundCharge",
        ).length / 5
      : 0;
  f.attackBuff = ((e.buff?.atk ?? 0) + (e.buff?.spa ?? 0)) / 2;
  f.counterStatus = e.counter === "status" ? 1 : 0;
  f.counterAttack = e.counter === "attack" ? 1 : 0;
  f.counterDefense = e.counter === "defense" ? 1 : 0;
  f.incomingRisk = clamp(maxDamage(data, b, a) / Math.max(1, a.hp), 0, 2);
  return f;
}
const value = (weights, f) =>
  Object.entries(f).reduce((n, [k, v]) => n + (weights[k] ?? 0) * v, 0);
function candidates(data, state, side, agent) {
  return teamLegalActions(data, state, side).map((action) => {
    const features = teamFeatures(data, state, side, action);
    return { action, features, q: value(agent.weights, features) };
  });
}
function choose(rows, rng, epsilon = 0) {
  if (rng() < epsilon) return rows[Math.floor(rng() * rows.length)];
  const best = Math.max(...rows.map((x) => x.q)),
    ties = rows.filter((x) => Math.abs(x.q - best) < 1e-9);
  return ties[Math.floor(rng() * ties.length)];
}
export function teamLearnedPolicy(data, agent, seed = 1) {
  const rng = seededRandom(seed);
  return (state, side) =>
    choose(candidates(data, state, side, agent), rng).action;
}
export function teamRulePolicy(data, mode = "tactical") {
  return (state, side) => {
    const rows = teamLegalActions(data, state, side).map((action) => ({
      action,
      f: teamFeatures(data, state, side, action),
    }));
    const score = ({ action, f }) => {
      if (action === "wait") return 0;
      if (f.lead || f.replace)
        return (
          2 * (f.matchupDamage ?? 0) -
          (f.incomingRisk ?? 0) +
          (f.targetHealth ?? 0) * 0.3
        );
      if (f.switch)
        return mode === "tactical"
          ? (f.riskImprovement ?? 0) * 1.5 +
              (f.matchupDamage ?? 0) * 0.25 -
              0.85
          : -100;
      return (
        (f.damage ?? 0) * 2 +
        (f.lethal ?? 0) * 1.2 +
        (f.heal ?? 0) * 0.6 +
        (f.energyGain ?? 0) * 0.35 -
        (f.cost ?? 0) * 0.1 +
        (mode === "tactical"
          ? (f.benchHealGain ?? 0) * 0.6 + (f.benchEnergyGain ?? 0) * 0.5
          : 0)
      );
    };
    return rows.sort(
      (a, b) => score(b) - score(a) || a.action.localeCompare(b.action),
    )[0].action;
  };
}
const potential = (s, side) =>
  (0.12 * (s.sides[side].magic - s.sides[1 - side].magic)) / 4 +
  (0.08 *
    (s.sides[side].pets.reduce((n, p) => n + p.hp / p.maxHp, 0) -
      s.sides[1 - side].pets.reduce((n, p) => n + p.hp / p.maxHp, 0))) /
    6;
// Explicit rule-informed initialization. These are not learned results.
export const TEAM_POLICY_PRIOR = Object.freeze({
  damage: 2,
  lethal: 1.2,
  heal: 0.6,
  energyGain: 0.35,
  cost: -0.1,
  benchHealGain: 0.6,
  benchEnergyGain: 0.5,
  switch: -1.1,
  matchupDamage: 0.25,
  riskImprovement: 1.5,
  targetHealth: 0.05,
});
function samplePolicy(rows, rng, temperature) {
  const best = Math.max(...rows.map((x) => x.q));
  const exps = rows.map((x) =>
      Math.exp(clamp((x.q - best) / temperature, -60, 0)),
    ),
    sum = exps.reduce((n, v) => n + v, 0);
  const probs = exps.map((v) => v / sum),
    threshold = rng();
  let index = rows.length - 1,
    cumulative = 0;
  for (let i = 0; i < rows.length; i++) {
    cumulative += probs[i];
    if (threshold < cumulative) {
      index = i;
      break;
    }
  }
  const gradient = {};
  for (let i = 0; i < rows.length; i++)
    for (const [key, v] of Object.entries(rows[i].features))
      gradient[key] =
        (gradient[key] ?? 0) +
        (((i === index ? 1 : 0) - probs[i]) * v) / temperature;
  return { action: rows[index].action, gradient };
}
export function trainTeams(
  data,
  { episodes = 4000, seed = 42, patch = null, onProgress = () => {}, initialAgents = null, focusTeamId = null } = {},
) {
  if (!Number.isInteger(episodes) || episodes < 100 || episodes > 50000)
    throw Error("团队训练局数须在 100—50000 之间");
  if (!Number.isInteger(seed) || seed < 0) throw Error("随机种子无效");
  if (!Array.isArray(data.teams) || data.teams.length < 2)
    throw Error("自博弈至少需要两支完整队伍");
  if (focusTeamId && !data.teams.some(t=>t.id===focusTeamId))
    throw Error("指定的适应训练队伍不存在");
  if (initialAgents && (initialAgents.length !== 2 || initialAgents.some(a => !a.weights || Object.values(a.weights).some(w => !Number.isFinite(w)))))
    throw Error("初始策略无效");
  const rng = seededRandom(seed),
    agents = initialAgents ? structuredClone(initialAgents) : [
      { name: "AI A", weights: { ...TEAM_POLICY_PRIOR } },
      { name: "AI B", weights: { ...TEAM_POLICY_PRIOR } },
    ],
    archive = initialAgents ? structuredClone(initialAgents) : [],
    history = [];
  const returnBaselines = [{}, {}];
  let decisions = 0,
    switches = 0,
    draws = 0,
    aWins = 0,
    bWins = 0,
    updates = 0;
  const checkpoint = Math.max(100, Math.floor(episodes / 8));
  for (let ep = 0; ep < episodes; ep++) {
    const ai = focusTeamId ? data.teams.findIndex(t=>t.id===focusTeamId) : Math.floor(rng() * data.teams.length);
    let bi = Math.floor(rng() * (data.teams.length - 1));
    if (bi >= ai) bi++;
    const state = createTeamBattle(
      data,
      data.teams[ai].members,
      data.teams[bi].members,
      { tieFirst: ep % 2, patch },
    );
    const historical =
      archive.length && ep % 5 === 0
        ? archive[Math.floor(rng() * archive.length)]
        : null;
    // Each learner also faces fixed rules, preventing two co-adapting agents from
    // treating mutually harmless switching as successful play. No rule overrides
    // are applied when a learned policy acts at evaluation time.
    const fixed =
      ep % 5 === 1
        ? teamRulePolicy(data, ep % 2 ? "tactical" : "aggressive")
        : null;
    const opponentSide = ep % 2,
      temperature = 0.45 - (0.2 * ep) / episodes;
    const trajectories = [[], []];
    while (state.winner === null) {
      const phase = state.phase;
      const chosen = agents.map((agent, side) => {
        if (side === opponentSide && fixed)
          return { action: fixed(state, side) };
        if (side === opponentSide && historical)
          return samplePolicy(
            candidates(data, state, side, historical),
            rng,
            0.25,
          );
        return samplePolicy(
          candidates(data, state, side, agent),
          rng,
          temperature,
        );
      });
      const phi = [potential(state, 0), potential(state, 1)];
      stepTeamBattle(
        data,
        state,
        chosen.map((x) => x.action),
        { record: false },
      );
      decisions++;
      for (let side = 0; side < 2; side++) {
        const terminal = state.winner !== null;
        const reward = terminal
          ? state.winner === "draw"
            ? 0
            : state.winner === side
              ? 1
              : -1
          : 0;
        trajectories[side].push({
          gradient: chosen[side].gradient,
          phase,
          reward:
            reward + 0.99 * (terminal ? 0 : potential(state, side)) - phi[side],
        });
      }
    }
    for (let side = 0; side < 2; side++) {
      if (side === opponentSide && (historical || fixed)) continue;
      let totalReturn = 0;
      const gradients = {};
      for (let i = trajectories[side].length - 1; i >= 0; i--) {
        const t = trajectories[side][i];
        totalReturn = t.reward + 0.99 * totalReturn;
        const baseline = returnBaselines[side][t.phase] ?? 0;
        const advantage = clamp(totalReturn - baseline, -2, 2);
        returnBaselines[side][t.phase] =
          baseline + 0.005 * (totalReturn - baseline);
        for (const [key, v] of Object.entries(t.gradient))
          gradients[key] = (gradients[key] ?? 0) + advantage * v;
        updates++;
      }
      const scale = 0.025 / Math.sqrt(Math.max(1, trajectories[side].length));
      for (const [key, v] of Object.entries(gradients)) {
        const old = agents[side].weights[key] ?? 0,
          prior = TEAM_POLICY_PRIOR[key] ?? 0;
        agents[side].weights[key] = clamp(
          old + scale * clamp(v, -10, 10) - 0.0001 * (old - prior),
          -12,
          12,
        );
      }
    }
    switches += state.sides.reduce((n, s) => n + s.switches, 0);
    if (state.winner === "draw") draws++;
    else if (state.winner === 0) aWins++;
    else bWins++;
    if ((ep + 1) % checkpoint === 0 || ep === episodes - 1) {
      const row = { episode: ep + 1, aWins, bWins, draws, decisions, switches };
      history.push(row);
      onProgress(row);
      archive.push(
        structuredClone(agents[((ep + 1) / checkpoint) % 2 === 0 ? 0 : 1]),
      );
      if (archive.length > 8) archive.shift();
    }
  }
  return {
    schemaVersion: 2,
    algorithm: "independent-policy-gradient-team-v2",
    rules: TEAM_RULE_VERSION,
    dataVersion: data.version,
    configurationId: teamConfigurationId(data),
    trainingTeams: structuredClone(data.teams),
    seed,
    episodes,
    patch,
    focusTeamId,
    agents,
    history,
    decisions,
    updates,
    switches,
    draws,
    hyperparameters: {
      alpha: 0.025,
      gamma: 0.99,
      temperatureStart: 0.45,
      temperatureEnd: 0.25,
      historicalFrequency: 5,
      fixedRuleFrequency: 5,
      initialization: initialAgents ? "从指定策略继续训练；历史池含训练前快照" : "公开的启发式权重；非从零学习，不计作训练收益",
      prior: TEAM_POLICY_PRIOR,
      reward: "整场胜负；魔力差与总生命差的势函数塑形",
      information: "双方完整实验阵容可见；不读取对手当前指令",
    },
  };
}
export function evaluateTeams(
  data,
  model,
  { patch = model.patch, includeReplay = false } = {},
) {
  if (model.rules !== TEAM_RULE_VERSION || model.dataVersion !== data.version)
    throw Error("团队模型与规则版本不一致");
  const rows = [],
    ruleRows = [];
  for (let a = 0; a < data.teams.length; a++)
    for (let b = a + 1; b < data.teams.length; b++)
      for (const role of [0, 1])
        for (const tieFirst of [0, 1]) {
          const left = data.teams[a],
            right = data.teams[b];
          // Replay seeds are fixed and distinct from the trainer's RNG stream.
          const seed = 9100 + a * 100 + b * 10 + role * 2 + tieFirst;
          const r = runTeamBattle(
            data,
            left.members,
            right.members,
            [
              teamLearnedPolicy(data, model.agents[role], seed),
              teamLearnedPolicy(data, model.agents[1 - role], seed + 1),
            ],
            { tieFirst, patch, record: includeReplay },
          );
          rows.push({
            a: left.id,
            b: right.id,
            role,
            tieFirst,
            seed,
            score: r.score,
            rounds: r.state.round - 1,
            magic: r.state.sides.map((s) => s.magic),
            switches: r.state.sides.map((s) => s.switches),
            benchEnergy: r.state.sides.map((s) => s.benchEnergy),
            benchHealing: r.state.sides.map((s) => s.benchHealing),
            ...(includeReplay ? { trace: r.trace } : {}),
          });
        }
  for (const mode of ["aggressive", "tactical"])
    for (let a = 0; a < data.teams.length; a++)
      for (let b = 0; b < data.teams.length; b++)
        if (a !== b)
          for (const agent of [0, 1]) {
            const r = runTeamBattle(
              data,
              data.teams[a].members,
              data.teams[b].members,
              [
                teamLearnedPolicy(
                  data,
                  model.agents[agent],
                  15000 + a * 100 + b * 10 + agent,
                ),
                teamRulePolicy(data, mode),
              ],
              { tieFirst: agent, patch, record: false },
            );
            ruleRows.push({
              mode,
              agent,
              a: data.teams[a].id,
              b: data.teams[b].id,
              score: r.score,
              rounds: r.state.round - 1,
            });
          }
  return {
    rows,
    ruleRows,
    ruleScore: ruleRows.reduce((n, r) => n + r.score, 0) / ruleRows.length,
    drawRate: rows.filter((r) => r.score === 0.5).length / rows.length,
    meanSwitches:
      rows.reduce((n, r) => n + r.switches[0] + r.switches[1], 0) / rows.length,
  };
}
