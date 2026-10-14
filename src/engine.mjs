import {
  ROSTER,
  MOVES,
  TYPE_DEFENSE,
  DEFAULT_ENV,
  getSpirit,
  loadoutFor,
} from "./data.mjs";
const cap = (n, min, max) => Math.max(min, Math.min(max, n));
export const panel = (base) => Math.round(1.1 * (base + 30)) + 60;
export function validateEnv(env) {
  if (
    !["both", "greedy", "efficient", "selfplay"].includes(env.policy) ||
    !["uniform", "water", "grass"].includes(env.distribution)
  )
    throw new Error("无效实验策略或分布");
  if (!["native", "coverage"].includes(env.loadout ?? "native"))
    throw new Error("未知配招方案");
  for (const [k, min, max] of [
    ["hp", 100, 1000],
    ["startEnergy", 0, 10],
    ["maxTurns", 1, 100],
  ])
    if (!Number.isInteger(env[k]) || env[k] < min || env[k] > max)
      throw new Error(`无效实验参数：${k}`);
}
export function validatePatch(patch) {
  if (!patch) return;
  const s = getSpirit(patch.id),
    max = s.traitUnit === "%" ? 100 : s.trait === "ground" ? 3 : 5;
  if (
    !Number.isFinite(patch.power) ||
    patch.power < 50 ||
    patch.power > 150 ||
    !Number.isFinite(patch.trait) ||
    patch.trait < 0 ||
    patch.trait > max
  )
    throw new Error("调整参数超出范围");
}
export function createFighter(
  id,
  env = DEFAULT_ENV,
  patch = null,
  disableTrait = false,
) {
  const s = getSpirit(id),
    active = patch?.id === id ? patch : null;
  const value = disableTrait ? 0 : (active?.trait ?? s.traitValue);
  return {
    id,
    name: s.name,
    type: s.type,
    moves: loadoutFor(id, env.loadout),
    maxHp: env.hp,
    hp: env.hp,
    stats: s.stats.map(panel),
    energy:
      s.trait === "ground" && !disableTrait
        ? cap(value * 3, 0, 10)
        : env.startEnergy,
    trait: disableTrait ? "none" : s.trait,
    traitValue: value,
    power: (active?.power ?? 100) / 100,
    attackBoost: 0,
    costReduction: 0,
    uses: {},
    spent: 0,
    gained: 0,
    healed: 0,
  };
}
export function moveCost(f, move) {
  return Math.max(
    0,
    move.cost -
      f.costReduction -
      (move.costGrowth ?? 0) * (f.uses[move.id] ?? 0),
  );
}
export function damage(a, b, move, first = true, neutral = false) {
  if (move.channel === "status")
    return {
      total: 0,
      perHit: 0,
      hits: 0,
      power: 0,
      display: 0,
      stab: 1,
      type: 1,
      boost: 1,
    };
  const hits = move.hits ?? 1;
  const base =
    (move.power + (move.growth ?? 0) * (a.uses[move.id] ?? 0)) * a.power;
  const bonus =
    (first ? (move.firstBonus ?? 0) : 0) +
    (first && a.trait === "wind" ? a.traitValue / 100 : 0);
  const stab = a.type === move.type ? 1.25 : 1,
    type =
      neutral || (a.noCoverage && a.type !== move.type)
        ? 1
        : (TYPE_DEFENSE[b.type]?.[move.type] ?? 1),
    boost = 1 + a.attackBoost;
  const power = base * (1 + bonus),
    display = Math.round(power * stab * type * boost);
  const attack = a.stats[move.channel === "physical" ? 1 : 3],
    defense = b.stats[move.channel === "physical" ? 2 : 4];
  const perHit = Math.max(
    0,
    Math.floor(Math.round((attack * display * 37) / 41) / defense),
  );
  return {
    total: perHit * hits,
    perHit,
    hits,
    power,
    display,
    stab,
    type,
    boost,
    attack,
    defense,
  };
}
export function choose(f, enemy, policy = "greedy", neutral = false) {
  const moves = f.moves
    .map((id) => MOVES[id])
    .filter((m) => moveCost(f, m) <= f.energy && m.id !== f.bannedMove);
  const attacks = moves.filter((m) => m.channel !== "status");
  if (policy === "efficient" && f.hp < f.maxHp * 0.4) {
    const heal = moves.find((m) => m.heal);
    if (heal) return heal;
  }
  if (!attacks.length) return MOVES.focus;
  const score = (m) => {
    const d = damage(
      f,
      enemy,
      m,
      f.stats[5] > enemy.stats[5] || (m.priority ?? 0) > 0,
      neutral,
    ).total;
    return policy === "efficient" ? d / (1 + moveCost(f, m) * 0.65) : d;
  };
  return [...attacks].sort(
    (a, b) =>
      score(b) - score(a) ||
      moveCost(f, a) - moveCost(f, b) ||
      a.id.localeCompare(b.id, "en"),
  )[0];
}
function restore(f, n) {
  const gain = Math.min(10 - f.energy, n);
  f.energy += gain;
  f.gained += gain;
  return gain;
}
function heal(f, n) {
  const gain = Math.min(f.maxHp - f.hp, Math.floor(n));
  f.hp += gain;
  f.healed += gain;
  return gain;
}
export function takeAction(a, b, move, first, neutral = false) {
  const cost = moveCost(a, move);
  if (cost > a.energy) throw new Error("非法行动：能量不足");
  const before = { hp: a.hp, energy: a.energy, enemyHp: b.hp };
  a.energy -= cost;
  a.spent += cost;
  const formula = damage(a, b, move, first, neutral);
  const dealt = Math.min(b.hp, formula.total);
  b.hp -= dealt;
  let healed = move.heal ? heal(a, a.maxHp * move.heal) : 0;
  let gained = move.energy ? restore(a, move.energy) : 0;
  if (a.trait === "heal" && move.type === "草")
    healed += heal(a, (a.maxHp * a.traitValue) / 100);
  if (a.trait === "burn" && move.type === "火")
    a.attackBoost += a.traitValue / 100;
  if (a.trait === "water" && move.type === "水")
    a.costReduction += a.traitValue;
  a.uses[move.id] = (a.uses[move.id] ?? 0) + 1;
  return {
    actor: a.id,
    target: b.id,
    move: move.name,
    cost,
    damage: dealt,
    healed,
    gained,
    formula,
    before,
    after: { hp: a.hp, energy: a.energy, enemyHp: b.hp },
    attackBoost: a.attackBoost,
    costReduction: a.costReduction,
  };
}
export function resolveRound(a, b, am, bm, tieFirst = "a", neutral = false) {
  const diff =
    (am.priority ?? 0) - (bm.priority ?? 0) || a.stats[5] - b.stats[5];
  const aFirst = diff > 0 || (diff === 0 && tieFirst === "a");
  const events = [],
    order = aFirst
      ? [
          [a, b, am],
          [b, a, bm],
        ]
      : [
          [b, a, bm],
          [a, b, am],
        ];
  for (const [i, [self, enemy, move]] of order.entries()) {
    if (self.hp <= 0 || enemy.hp <= 0) break;
    events.push(takeAction(self, enemy, move, i === 0, neutral));
  }
  const endEnergy = [];
  if (a.hp > 0 && b.hp > 0)
    for (const f of [a, b])
      if (f.trait === "recycle")
        endEnergy.push({ id: f.id, gained: restore(f, f.traitValue) });
  return {
    events,
    endEnergy,
    aHp: a.hp,
    bHp: b.hp,
    aEnergy: a.energy,
    bEnergy: b.energy,
  };
}
export function battle(left, right, options = {}) {
  const env = { ...DEFAULT_ENV, ...options.env };
  validateEnv(env);
  validatePatch(options.patch);
  const a = createFighter(
      left,
      env,
      options.patch,
      options.disableTrait === left,
    ),
    b = createFighter(
      right,
      env,
      options.patch,
      options.disableTrait === right,
    );
  for (const f of [a, b]) {
    if (options.ban?.id === f.id) f.bannedMove = options.ban.move;
    f.noCoverage = options.noCoverage === f.id;
  }
  const trace = [];
  let turns = 0;
  for (let turn = 1; turn <= env.maxTurns; turn++) {
    turns = turn;
    // Both policies commit from the same start-of-turn state. Neither sees its rival's new action.
    const am =
      typeof options.policyA === "function"
        ? options.policyA(a, b, turn)
        : choose(a, b, options.policyA ?? "greedy", options.neutral);
    const bm =
      typeof options.policyB === "function"
        ? options.policyB(b, a, turn)
        : choose(b, a, options.policyB ?? "greedy", options.neutral);
    trace.push({
      turn,
      ...resolveRound(a, b, am, bm, options.tieFirst ?? "a", options.neutral),
    });
    if (a.hp <= 0 || b.hp <= 0) break;
  }
  const winner = a.hp <= 0 ? "b" : b.hp <= 0 ? "a" : "draw";
  return {
    left,
    right,
    winner,
    score: winner === "a" ? 1 : winner === "b" ? 0 : 0.5,
    capped: winner === "draw",
    turns,
    a,
    b,
    trace,
  };
}
export function evaluate(envInput = {}, patch = null, overrides = {}) {
  const env = { ...DEFAULT_ENV, ...envInput };
  validateEnv(env);
  validatePatch(patch);
  const { policies: customPolicies, ...battleOverrides } = overrides;
  if (env.policy === "selfplay" && !customPolicies)
    throw new Error("强化学习评估需要已训练模型");
  const policies =
    customPolicies ??
    (env.policy === "both" ? ["greedy", "efficient"] : [env.policy]);
  const matrix = ROSTER.map(() => ROSTER.map(() => null)),
    cells = ROSTER.map(() => ROSTER.map(() => null));
  let battles = 0,
    capped = 0,
    turns = 0;
  for (let i = 0; i < ROSTER.length; i++)
    for (let j = i + 1; j < ROSTER.length; j++) {
      const list = [];
      for (const pa of policies)
        for (const pb of policies)
          for (const tie of ["a", "b"]) {
            const r = battle(ROSTER[i].id, ROSTER[j].id, {
              env,
              patch,
              policyA: pa,
              policyB: pb,
              tieFirst: tie,
              ...battleOverrides,
            });
            list.push(r);
            battles++;
            capped += r.capped ? 1 : 0;
            turns += r.turns;
          }
      const score = list.reduce((s, r) => s + r.score, 0) / list.length;
      matrix[i][j] = score;
      matrix[j][i] = 1 - score;
      cells[i][j] = {
        games: list.length,
        turns: list.reduce((s, r) => s + r.turns, 0) / list.length,
        capped: list.filter((r) => r.capped).length,
      };
      cells[j][i] = cells[i][j];
    }
  const weight = (s) =>
    env.distribution === "water" && s.type === "水"
      ? 3
      : env.distribution === "grass" && s.type === "草"
        ? 3
        : 1;
  const ranking = ROSTER.map((s, i) => {
    let total = 0,
      weights = 0;
    ROSTER.forEach((enemy, j) => {
      if (j !== i) {
        total += matrix[i][j] * weight(enemy);
        weights += weight(enemy);
      }
    });
    return {
      id: s.id,
      score: total / weights,
      counters: matrix[i].filter((v) => v !== null && v <= 0.25).length,
    };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    env,
    patch,
    matrix,
    cells,
    ranking,
    battles,
    capped,
    cappedRate: capped / battles,
    meanTurns: turns / battles,
  };
}
export function diagnose(id, baseline, overrides = {}) {
  const uniform = evaluate(
    { ...baseline.env, distribution: "uniform" },
    null,
    overrides,
  );
  const noTrait = evaluate(baseline.env, null, {
    ...overrides,
    disableTrait: id,
  });
  const neutral = evaluate(baseline.env, null, { ...overrides, neutral: true });
  const score = (r) => r.ranking.find((x) => x.id === id).score;
  return {
    score: score(baseline),
    traitDelta: score(baseline) - score(noTrait),
    distributionDelta: score(baseline) - score(uniform),
    typeDelta: score(baseline) - score(neutral),
  };
}
