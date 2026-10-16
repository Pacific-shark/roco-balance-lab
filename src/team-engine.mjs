import { calculatePanel, validateBuild, statPanel } from "./team-stats.mjs";
import { reduceIntegerDamage } from "./battle-arithmetic.mjs";
export { statPanel } from "./team-stats.mjs";
export const TEAM_RULE_VERSION = "team-0.2.3-exact-guard";
export const TEAM_RULES = Object.freeze({
  teamSize: 6,
  magic: 4,
  focusEnergy: 5,
  maxEnergy: 10,
  maxRounds: 100,
});
const cap = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const clone = (x) => structuredClone(x);
export const activePet = (state, side) =>
  state.sides[side].pets[state.sides[side].active];

export function validateTeam(data, team) {
  if (!Array.isArray(team) || team.length !== 6)
    throw Error("每支队伍必须恰好六只精灵");
  if (new Set(team.map((x) => x.id)).size !== 6)
    throw Error("实验队伍不允许重复形态");
  for (const member of team) {
    const c = data.creatures[member.id];
    if (!c) throw Error("这只精灵的机制尚未接入团队引擎");
    validateBuild(member);
    if (
      !Array.isArray(member.moves) ||
      member.moves.length !== 4 ||
      new Set(member.moves).size !== 4
    )
      throw Error("每只精灵必须携带四个不同技能");
    for (const m of member.moves)
      if (!c.pool.includes(m) || !data.moves[m])
        throw Error("技能未实现或不在已核准学习来源中");
  }
}
function createPet(data, member, patch, side) {
  const c = data.creatures[member.id];
  const { stats } = calculatePanel(c, member);
  const trait =
    patch?.side === side && patch?.disableTrait === c.id
      ? "none"
      : c.trait.handler;
  return {
    id: c.id,
    name: c.name,
    types: c.types,
    moves: [...member.moves],
    stats,
    build: { nature: member.nature, ivs: { ...member.ivs } },
    hp: trait === "grassBenchHeal" ? Math.floor(stats.hp * 0.1) : stats.hp,
    maxHp: stats.hp,
    energy: ["groundCharge", "fireCharge"].includes(trait) ? 0 : 10,
    trait,
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    costReduction: 0,
    powerBonus: 0,
    uses: {},
    nextAttack: 1,
    guard: 0,
    defenseCooldown: 0,
    everEntered: false,
    koCounted: false,
  };
}
export function createTeamBattle(data, teamA, teamB, options = {}) {
  validateTeam(data, teamA);
  validateTeam(data, teamB);
  const rules = { ...TEAM_RULES, ...options.rules };
  if (rules.teamSize !== 6 || rules.magic !== 4 || rules.focusEnergy !== 5)
    throw Error("本规则版本固定六只精灵、四点魔力与聚能五点");
  if (
    rules.maxEnergy !== 10 ||
    !Number.isInteger(rules.maxRounds) ||
    rules.maxRounds < 1 ||
    rules.maxRounds > 1000
  )
    throw Error("能量上限固定为十；回合上限须为 1—1000 的整数");
  if (options.tieFirst !== undefined && ![0, 1].includes(options.tieFirst))
    throw Error("同速优先方须为 0 或 1");
  if (options.patch) {
    const p = options.patch;
    if (
      ![0, 1].includes(p.side) ||
      Object.keys(p).some(
        (k) =>
          !["side", "disableTrait", "grassBenchRate", "benchEnergy"].includes(
            k,
          ),
      )
    )
      throw Error("机制调整范围无效");
    if (p.disableTrait !== undefined && !data.creatures[p.disableTrait])
      throw Error("特性调整目标无效");
    if (
      p.grassBenchRate !== undefined &&
      (!Number.isFinite(p.grassBenchRate) ||
        p.grassBenchRate < 0 ||
        p.grassBenchRate > 1)
    )
      throw Error("回复比例无效");
    if (
      p.benchEnergy !== undefined &&
      (!Number.isInteger(p.benchEnergy) ||
        p.benchEnergy < 0 ||
        p.benchEnergy > 10)
    )
      throw Error("回能调整无效");
  }
  const state = {
    version: TEAM_RULE_VERSION,
    dataVersion: data.version,
    rules,
    patch: options.patch ?? null,
    round: 1,
    decision: 0,
    phase: "lead",
    winner: null,
    tieFirst: options.tieFirst ?? 0,
    sides: [teamA, teamB].map((members, i) => ({
      pets: members.map((m) => createPet(data, m, options.patch, i)),
      active: -1,
      magic: 4,
      typeUses: {},
      switches: 0,
      forcedSwitches: 0,
      benchEnergy: 0,
      benchHealing: 0,
    })),
  };
  return state;
}
export function teamMoveCost(data, pet, id) {
  const m = data.moves[id];
  if (!m) throw Error("未注册技能");
  return (
    m.effect.fixedCost ??
    Math.max(
      0,
      m.cost -
        pet.costReduction -
        (m.effect.costGrowth ?? 0) * (pet.uses[id] ?? 0),
    )
  );
}
export function teamLegalActions(data, state, side) {
  if (state.winner !== null) return [];
  const s = state.sides[side],
    p = activePet(state, side);
  const switches = s.pets.flatMap((x, i) =>
    x.hp > 0 && i !== s.active ? [`switch:${i}`] : [],
  );
  if (state.phase === "lead") return switches;
  if (state.phase === "replace") return !p || p.hp <= 0 ? switches : ["wait"];
  return [
    ...p.moves
      .filter(
        (id) =>
          teamMoveCost(data, p, id) <= p.energy &&
          !(data.moves[id].kind === "defense" && p.defenseCooldown > 0),
      )
      .map((id) => `move:${id}`),
    "focus",
    ...switches,
  ];
}
export function typeMultiplier(data, attack, types) {
  const factors = types.map((t) => data.types[t]?.[attack] ?? 1);
  return factors.length === 2 && factors.every((x) => x === 2)
    ? 3
    : factors.reduce((p, x) => p * x, 1);
}
export function teamDamage(
  data,
  a,
  b,
  move,
  { first = false, counter = false } = {},
) {
  if (move.kind !== "attack") return { total: 0, perHit: 0, hits: 0 };
  const e = move.effect,
    physical = move.category === "物攻";
  const atk = physical ? "atk" : "spa",
    def = physical ? "def" : "spd";
  const level =
    (1 + Math.max(0, a.boosts[atk]) + Math.max(0, -b.boosts[def])) /
    (1 + Math.max(0, -a.boosts[atk]) + Math.max(0, b.boosts[def]));
  const power =
    move.power + (e.growth ?? 0) * (a.uses[move.id] ?? 0) + a.powerBonus;
  const firstBonus = first
    ? (a.trait === "firstPower" ? 0.5 : 0) + (e.firstBonus ?? 0)
    : 0;
  const stab = a.types.includes(move.type) ? 1.25 : 1;
  const effectiveness = typeMultiplier(data, move.type, b.types);
  const counterBonus = counter ? (e.counterMultiplier ?? 1) : 1;
  const display = Math.round(
    power *
      (1 + firstBonus) *
      stab *
      effectiveness *
      level *
      counterBonus *
      a.nextAttack,
  );
  const baseDamage = Math.max(
    0,
    Math.floor(
      Math.round((a.stats[atk] * display * 37) / 41) / b.stats[def],
    ),
  );
  const perHit = reduceIntegerDamage(baseDamage, b.guard);
  return {
    total: perHit * (e.hits ?? 1),
    perHit,
    hits: e.hits ?? 1,
    power,
    display,
    stab,
    effectiveness,
    level,
    firstBonus,
    counterBonus,
  };
}
function resetTransient(p) {
  p.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  p.costReduction = 0;
  p.powerBonus = 0;
  p.nextAttack = 1;
  p.guard = 0;
}
function restore(p, amount, field) {
  const before = p[field];
  p[field] = cap(
    p[field] + Math.floor(amount),
    0,
    field === "hp" ? p.maxHp : 10,
  );
  return p[field] - before;
}
function changeActive(state, side, index, events, forced = false) {
  const s = state.sides[side],
    old = activePet(state, side);
  if (old && old.hp > 0) resetTransient(old);
  s.active = index;
  const p = activePet(state, side);
  p.everEntered = true;
  if (p.trait === "fireEntry") p.powerBonus = (s.typeUses["火"] ?? 0) * 10;
  if (state.phase !== "lead") {
    if (forced) s.forcedSwitches++;
    else s.switches++;
  }
  events.push({
    kind: "switch",
    side,
    from: old?.id ?? null,
    to: p.id,
    forced,
    text: `${p.name}${forced ? "补位" : "入场"}${p.powerBonus ? `，蒸汽膨胀赋予技能威力 +${p.powerBonus}` : ""}`,
  });
}
function addBuff(p, buff) {
  for (const [key, value] of Object.entries(buff ?? {})) p.boosts[key] += value;
}
function benchTriggers(data, state, side, move, events) {
  const s = state.sides[side],
    actor = activePet(state, side);
  s.typeUses[move.type] = (s.typeUses[move.type] ?? 0) + 1;
  for (let i = 0; i < s.pets.length; i++) {
    const p = s.pets[i];
    if (i === s.active || p.hp <= 0) continue;
    const emit = (sourceKind, source, energy, hp) => {
      if (!energy && !hp) return;
      s.benchEnergy += energy;
      s.benchHealing += hp;
      const owner = sourceKind === "trait" ? p : actor;
      events.push({
        kind: "support",
        side,
        from: actor.id,
        to: p.id,
        move: move.id,
        energy,
        hp,
        sourceKind,
        sourceId: source.id,
        sourceName: source.name,
        owner: owner.id,
        text:
          sourceKind === "trait"
            ? `${actor.name}使用${move.name}，触发${p.name}的特性「${source.name}」：${hp ? `生命 +${hp}` : `能量 +${energy}`}`
            : `${actor.name}的技能「${source.name}」 → ${p.name}：能量 +${energy}`,
      });
    };
    if (
      (p.trait === "groundCharge" && move.type === "地") ||
      (p.trait === "fireCharge" && move.type === "火")
    ) {
      emit("trait", data.creatures[p.id].trait, restore(p, 3, "energy"), 0);
    }
    if (p.trait === "grassBenchHeal" && move.type === "草") {
      const rate =
        state.patch?.side === side ? (state.patch.grassBenchRate ?? 0.3) : 0.3;
      emit(
        "trait",
        data.creatures[p.id].trait,
        0,
        restore(p, p.maxHp * rate, "hp"),
      );
    }
    if (move.effect.benchEnergy) {
      const gain =
        state.patch?.side === side
          ? (state.patch.benchEnergy ?? move.effect.benchEnergy)
          : move.effect.benchEnergy;
      emit("skill", move, restore(p, gain, "energy"), 0);
    }
  }
}
function knockOut(state, side, events) {
  const s = state.sides[side],
    p = activePet(state, side);
  if (p.hp > 0 || p.koCounted) return;
  p.koCounted = true;
  s.magic = Math.max(0, s.magic - 1);
  events.push({
    kind: "ko",
    side,
    id: p.id,
    text: `${p.name}力竭，${side === 0 ? "A" : "B"} 队魔力 -1`,
  });
  if (s.magic === 0 || s.pets.every((x) => x.hp <= 0)) state.winner = 1 - side;
}
function executeMove(data, state, side, move, enemyKind, first, events) {
  const a = activePet(state, side),
    b = activePet(state, 1 - side),
    e = move.effect;
  const counter = e.counter === enemyKind;
  const cost = teamMoveCost(data, a, move.id);
  a.energy -= cost;
  const before = { aHp: a.hp, bHp: b.hp, energy: a.energy + cost };
  const formula = teamDamage(data, a, b, move, { first, counter });
  const dealt = Math.min(b.hp, formula.total);
  b.hp -= dealt;
  if (move.kind === "attack") a.nextAttack = 1;
  let healed = e.heal ? restore(a, a.maxHp * e.heal, "hp") : 0;
  const gained = e.energy ? restore(a, e.energy, "energy") : 0;
  addBuff(a, e.buff);
  if (e.guard) {
    a.guard = e.guard;
    a.defenseCooldown = counter && e.counterCooldown === 0 ? 0 : 2;
  }
  if (e.nextAttack)
    a.nextAttack = counter ? (e.counterNext ?? e.nextAttack) : e.nextAttack;
  if (counter) {
    if (e.counterHeal) healed += restore(a, a.maxHp * e.counterHeal, "hp");
    addBuff(a, e.counterBuff);
  }
  if (a.trait === "grassHeal" && move.type === "草")
    healed += restore(a, a.maxHp * 0.1, "hp");
  if (a.trait === "fireBoost" && move.type === "火")
    addBuff(a, { atk: 0.2, spa: 0.2 });
  if (a.trait === "waterDiscount" && move.type === "水") a.costReduction++;
  a.uses[move.id] = (a.uses[move.id] ?? 0) + 1;
  events.push({
    kind: "move",
    side,
    actor: a.id,
    target: b.id,
    move: move.id,
    cost,
    damage: dealt,
    healed,
    gained,
    counter,
    formula,
    before,
    text: `${a.name}使用${move.name}${counter ? "（应对成功）" : ""}${dealt ? `，造成 ${dealt} 伤害` : ""}${healed ? `，回复 ${healed} 生命` : ""}${gained ? `，回复 ${gained} 能量` : ""}`,
  });
  benchTriggers(data, state, side, move, events);
  knockOut(state, 1 - side, events);
}
/** Both commands are committed before any mutation. Forced replacements use a separate decision phase. */
export function stepTeamBattle(data, state, actions, { record = true } = {}) {
  if (state.winner !== null) throw Error("对局已经结束");
  for (let side = 0; side < 2; side++)
    if (!teamLegalActions(data, state, side).includes(actions[side]))
      throw Error(`队伍 ${side} 行动非法：${actions[side]}`);
  const before = record ? clone(state.sides) : null,
    events = [],
    phase = state.phase;
  state.decision++;
  if (phase === "lead" || phase === "replace") {
    actions.forEach((a, side) => {
      if (a.startsWith("switch:"))
        changeActive(
          state,
          side,
          Number(a.split(":")[1]),
          events,
          phase === "replace",
        );
    });
    state.phase = "battle";
    return record
      ? {
          round: state.round,
          phase,
          actions: [...actions],
          events,
          before,
          after: clone(state.sides),
        }
      : null;
  }
  const original = state.sides.map((s) => s.active);
  const kind = (a) =>
    a === "focus"
      ? "status"
      : a.startsWith("move:")
        ? data.moves[a.slice(5)].kind
        : "switch";
  const priority = (a, side) => {
    if (a.startsWith("switch:")) return 10000;
    if (a === "focus") return 0;
    const m = data.moves[a.slice(5)];
    return (
      (m.effect.counter === kind(actions[1 - side]) ? 1000 : 0) +
      (m.effect.priority ?? 0)
    );
  };
  const order = [0, 1].sort(
    (x, y) =>
      priority(actions[y], y) - priority(actions[x], x) ||
      activePet(state, y).stats.spe - activePet(state, x).stats.spe ||
      (x === state.tieFirst ? -1 : 1),
  );
  let attacked = false;
  for (const side of order) {
    if (state.winner !== null) break;
    const a = actions[side],
      p = activePet(state, side),
      other = activePet(state, 1 - side);
    if (p.hp <= 0 || other.hp <= 0) continue;
    if (a.startsWith("switch:")) {
      changeActive(state, side, Number(a.split(":")[1]), events);
      continue;
    }
    if (state.sides[side].active !== original[side]) continue;
    if (a === "focus") {
      const gained = restore(p, state.rules.focusEnergy, "energy");
      events.push({
        kind: "focus",
        side,
        actor: p.id,
        gained,
        text: `${p.name}聚能，回复 ${gained} 能量`,
      });
    } else {
      const m = data.moves[a.slice(5)];
      executeMove(
        data,
        state,
        side,
        m,
        kind(actions[1 - side]),
        !attacked,
        events,
      );
      if (m.kind === "attack") attacked = true;
    }
  }
  if (state.winner === null)
    for (let side = 0; side < 2; side++) {
      const p = activePet(state, side);
      if (p.hp <= 0) continue;
      const amount =
        p.trait === "endEnergy"
          ? restore(p, 3, "energy")
          : p.trait === "endHeal"
            ? restore(p, p.maxHp * 0.12, "hp")
            : 0;
      if (amount) {
        const trait = data.creatures[p.id].trait;
        events.push({
          kind: "end",
          side,
          actor: p.id,
          target: p.id,
          sourceKind: "trait",
          sourceId: trait.id,
          sourceName: trait.name,
          energy: p.trait === "endEnergy" ? amount : 0,
          hp: p.trait === "endHeal" ? amount : 0,
          text: `${p.name}的特性「${trait.name}」：自身回合末回复 ${amount}${p.trait === "endEnergy" ? " 能量" : " 生命"}`,
        });
      }
    }
  for (const s of state.sides)
    for (const p of s.pets) {
      p.guard = 0;
      p.defenseCooldown = Math.max(0, p.defenseCooldown - 1);
    }
  const completedRound = state.round;
  state.round++;
  if (state.winner === null) {
    if (completedRound >= state.rules.maxRounds) state.winner = "draw";
    else if (state.sides.some((s, i) => activePet(state, i).hp <= 0))
      state.phase = "replace";
  }
  return record
    ? {
        round: completedRound,
        phase,
        actions: [...actions],
        events,
        before,
        after: clone(state.sides),
      }
    : null;
}

export function runTeamBattle(data, teamA, teamB, policies, options = {}) {
  const state = createTeamBattle(data, teamA, teamB, options),
    trace = [];
  while (state.winner === null) {
    const actions = policies.map((p, side) => p(state, side));
    const r = stepTeamBattle(data, state, actions, {
      record: options.record !== false,
    });
    if (r) trace.push(r);
  }
  return {
    state,
    trace,
    score: state.winner === "draw" ? 0.5 : state.winner === 0 ? 1 : 0,
  };
}
