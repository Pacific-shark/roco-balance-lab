import {
  ROSTER,
  MOVES,
  DEFAULT_ENV,
  RULE_VERSION,
  DATA_VERSION,
  getSpirit,
  loadoutFor,
} from "./data.mjs";
import {
  createFighter,
  moveCost,
  resolveRound,
  battle,
  evaluate,
  validateEnv,
  validatePatch,
} from "./engine.mjs";
export const RL_VERSION = "independent-q-v1";
export function random(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const bounded = (v, n) => Math.min(n, Math.floor(v));
const features = (f) =>
  [
    bounded((f.hp / f.maxHp) * 5, 5),
    f.energy,
    bounded(f.attackBoost * 5, 10),
    bounded(f.costReduction, 7),
    ...f.moves.map((id) => bounded(f.uses[id] ?? 0, 8)),
  ].join(",");
// Binned observations deliberately trade full Markov state for a small interpretable table.
export const stateKey = (a, b, turn) =>
  `${a.id}/${b.id}|${a.moves.join(",")}/${b.moves.join(",")}|${features(a)}|${features(b)}|${Math.min(turn, 12)}`;
export const legalMoves = (f) =>
  [...f.moves, "focus"].filter(
    (id) => id !== f.bannedMove && moveCost(f, MOVES[id]) <= f.energy,
  );
export function qUpdate(
  table,
  key,
  action,
  reward,
  nextKey,
  nextActions,
  terminal,
  alpha = 0.18,
  gamma = 0.98,
) {
  const row = table[key] ?? (table[key] = {});
  const bootstrap = terminal
    ? 0
    : Math.max(...nextActions.map((a) => table[nextKey]?.[a] ?? 0));
  row[action] =
    (row[action] ?? 0) +
    alpha * (reward + gamma * bootstrap - (row[action] ?? 0));
}
function bestAction(table, key, actions, rng) {
  const best = Math.max(...actions.map((a) => table[key]?.[a] ?? 0));
  const ties = actions.filter((a) => (table[key]?.[a] ?? 0) === best);
  return ties[Math.floor(rng() * ties.length)];
}
function keyRandom(key, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i++)
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000003) / 1000003;
}
export function learnedPolicy(agent, stats = { seen: 0, fallback: 0 }) {
  return (a, b, turn) => {
    const key = stateKey(a, b, turn),
      actions = legalMoves(a);
    stats.seen++;
    if (!agent.q[key]) stats.fallback++;
    return MOVES[
      bestAction(agent.q, key, actions, () => keyRandom(key, agent.seed))
    ];
  };
}
export function trainedPolicies(model) {
  return model.agents.map((agent) => learnedPolicy(agent));
}
function bench(agents, env, patch) {
  return agents.map((agent) => {
    const stats = { seen: 0, fallback: 0 };
    const policy = learnedPolicy(agent, stats);
    let sum = 0,
      n = 0,
      randomSum = 0;
    for (const left of ROSTER)
      for (const right of ROSTER)
        if (left.id !== right.id)
          for (const tie of ["a", "b"]) {
            for (const baseline of ["greedy", "efficient"]) {
              sum += battle(left.id, right.id, {
                env,
                patch,
                policyA: policy,
                policyB: baseline,
                tieFirst: tie,
              }).score;
              n++;
            }
            const rng = random(
              90421 + Number(left.id) * 100 + Number(right.id),
            );
            randomSum += battle(left.id, right.id, {
              env,
              patch,
              policyA: policy,
              policyB: (f) => {
                const acts = legalMoves(f);
                return MOVES[acts[Math.floor(rng() * acts.length)]];
              },
              tieFirst: tie,
            }).score;
          }
    return {
      agent: agent.name,
      ruleScore: sum / n,
      randomScore: randomSum / 60,
      games: n + 60,
      fallbackRate: stats.seen ? stats.fallback / stats.seen : 0,
    };
  });
}
export function train({
  episodes = 24000,
  seed = 42,
  env: input = {},
  patch = null,
  onProgress = () => {},
} = {}) {
  if (!Number.isInteger(episodes) || episodes < 100 || episodes > 100000)
    throw new Error("训练局数须为 100—100000 的整数");
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error("种子须为非负整数");
  const env = { ...DEFAULT_ENV, ...input };
  validateEnv(env);
  validatePatch(patch);
  const rng = random(seed),
    agents = [
      { name: "AI A", seed: seed + 11, q: {} },
      { name: "AI B", seed: seed + 29, q: {} },
    ];
  const history = [
    {
      episode: 0,
      bench: bench(agents, env, patch),
      aWins: 0,
      bWins: 0,
      draws: 0,
    },
  ];
  let aWins = 0,
    bWins = 0,
    draws = 0,
    transitions = 0;
  const pairs = ROSTER.flatMap((a) =>
    ROSTER.filter((b) => b.id !== a.id).map((b) => [a.id, b.id]),
  );
  const checkpoint = Math.max(100, Math.floor(episodes / 12));
  for (let ep = 0; ep < episodes; ep++) {
    const [left, right] = pairs[ep % pairs.length];
    const a = createFighter(left, env, patch),
      b = createFighter(right, env, patch);
    const tie = rng() < 0.5 ? "a" : "b",
      epsilon = 0.08 + 0.72 * (1 - ep / episodes);
    let outcome = "draw";
    for (let turn = 1; turn <= env.maxTurns; turn++) {
      const ka = stateKey(a, b, turn),
        kb = stateKey(b, a, turn),
        aa = legalMoves(a),
        bb = legalMoves(b);
      const pick = (agent, key, acts) =>
        rng() < epsilon
          ? acts[Math.floor(rng() * acts.length)]
          : bestAction(agent.q, key, acts, rng);
      const ma = pick(agents[0], ka, aa),
        mb = pick(agents[1], kb, bb);
      const phi = 0.1 * (a.hp / a.maxHp - b.hp / b.maxHp);
      resolveRound(a, b, MOVES[ma], MOVES[mb], tie);
      transitions++;
      const terminal = a.hp <= 0 || b.hp <= 0 || turn === env.maxTurns;
      const reward = a.hp <= 0 ? -1 : b.hp <= 0 ? 1 : 0;
      // Potential-based shaping telescopes (terminal potential = 0); no reward for endless healing.
      const shaped =
        reward +
        0.98 * (terminal ? 0 : 0.1 * (a.hp / a.maxHp - b.hp / b.maxHp)) -
        phi;
      qUpdate(
        agents[0].q,
        ka,
        ma,
        shaped,
        stateKey(a, b, turn + 1),
        legalMoves(a),
        terminal,
      );
      qUpdate(
        agents[1].q,
        kb,
        mb,
        -shaped,
        stateKey(b, a, turn + 1),
        legalMoves(b),
        terminal,
      );
      if (terminal) {
        outcome = reward === 1 ? "a" : reward === -1 ? "b" : "draw";
        break;
      }
    }
    if (outcome === "a") aWins++;
    else if (outcome === "b") bWins++;
    else draws++;
    if ((ep + 1) % checkpoint === 0 || ep === episodes - 1) {
      const row = {
        episode: ep + 1,
        epsilon,
        aWins,
        bWins,
        draws,
        bench: bench(agents, env, patch),
      };
      history.push(row);
      onProgress(row);
    }
  }
  return {
    schemaVersion: 1,
    algorithm: RL_VERSION,
    rules: RULE_VERSION,
    dataVersion: DATA_VERSION,
    seed,
    episodes,
    env,
    patch,
    hyperparameters: {
      alpha: 0.18,
      gamma: 0.98,
      epsilonStart: 0.8,
      epsilonEnd: 0.08,
      shaping: 0.1,
    },
    transitions,
    agents,
    history,
    states: agents.map((a) => Object.keys(a.q).length),
  };
}
export function assess(model, id, envInput = {}) {
  const env = { ...DEFAULT_ENV, ...envInput, policy: "selfplay" },
    policies = trainedPolicies(model),
    overrides = { policies };
  const base = evaluate(env, null, overrides),
    score = (r) => r.ranking.find((x) => x.id === id).score;
  const trait = evaluate(env, null, { ...overrides, disableTrait: id });
  const coverage = evaluate(env, null, { ...overrides, noCoverage: id });
  const skills = loadoutFor(id, env.loadout)
    .map((move) => ({
      move,
      delta:
        score(base) -
        score(evaluate(env, null, { ...overrides, ban: { id, move } })),
    }))
    .sort((a, b) => b.delta - a.delta);
  const stats = { seen: 0, fallback: 0 },
    moves = {},
    openers = {},
    vs = [];
  for (const opponent of ROSTER)
    if (opponent.id !== id) {
      const r = battle(id, opponent.id, {
        env,
        policyA: learnedPolicy(model.agents[0], stats),
        policyB: learnedPolicy(model.agents[1]),
      });
      const mine = r.trace
        .flatMap((t) => t.events)
        .filter((e) => e.actor === id);
      for (const m of mine) moves[m.move] = (moves[m.move] ?? 0) + 1;
      const opening =
        mine
          .slice(0, 3)
          .map((e) => e.move)
          .join(" → ") || "未能行动";
      openers[opening] = (openers[opening] ?? 0) + 1;
      vs.push({
        opponent: opponent.id,
        opening,
        score: r.score,
        turns: r.turns,
      });
    }
  return {
    base,
    traitDelta: score(base) - score(trait),
    coverageDelta: score(base) - score(coverage),
    skills,
    moves,
    openers,
    vs,
    fallbackRate: stats.seen ? stats.fallback / stats.seen : 0,
  };
}
