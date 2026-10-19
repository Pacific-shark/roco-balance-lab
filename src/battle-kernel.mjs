// Shared executable effect primitives, isolated from historical PPO checkpoints.
// This kernel is a mechanism test environment until the full-roster gate passes.
import { calculatePanel } from "./team-stats.mjs";
import { reduceIntegerDamage } from "./battle-arithmetic.mjs";
import { typeMultiplier } from "./team-engine.mjs";
import { assertProgram, compileCatalogPrograms } from "./battle-programs.mjs";

export const KERNEL_VERSION = "battle-kernel-2";
const statKeys = ["atk", "spa", "def", "spd", "spe"];
const zeros = () => Object.fromEntries(statKeys.map((k) => [k, 0]));
const active = (state, side) =>
  state.teams[side].pets[state.teams[side].active];
const staticOps = (pet) =>
  pet.program.rules.filter((r) => r.trigger === "static").flatMap((r) => r.ops);
const has = (pet, op) => pet && staticOps(pet).some((e) => e.op === op);
const finite = (n) => Number.isFinite(n);
const scale = (n, ratio) => Math.floor((n * Math.round(ratio * 100)) / 100);
const emit = (state, event) =>
  state.events.push({ round: state.round, ...event });
const list = (x) => (Array.isArray(x) ? x : []);

export function kernelCatalog(snapshot, types) {
  return {
    programs: compileCatalogPrograms(snapshot.modules.Skills),
    creatures: snapshot.modules.Catalog,
    learnsets: snapshot.modules.Learnsets,
    bloodlines: snapshot.modules.Config.build_form.bloodlines,
    types,
  };
}

export function sourceLegalMoves(data, member) {
  const c = data.creatures[member.id];
  if (!c) throw Error("Unknown creature");
  const bloodline = data.bloodlines.find((b) => b.id === member.bloodline);
  if (!bloodline)
    throw Error("An explicit known bloodline is required");
  // Only source-consistent elementary/lord bloodline paths are executable here.
  if (member.bloodline > 19)
    throw Error("Special bloodline acquisition is unresolved");
  const l = data.learnsets[c.learnset_id];
  return new Set([
    ...list(l.native_skills)
      .filter((x) => x.level <= 60 && (x.stage ?? 1) <= c.stage)
      .map((x) => x.skill),
    ...list(l.skill_stones),
    ...list(l.blood_skills)
      .filter(
        (x) =>
          x.blood === bloodline.name &&
          Number.isInteger(x.level) &&
          x.level <= 60,
      )
      .map((x) => x.skill),
  ]);
}

function createPet(data, member) {
  const creature = data.creatures[member.id],
    pool = sourceLegalMoves(data, member);
  if (
    !Array.isArray(member.moves) ||
    member.moves.length !== 4 ||
    new Set(member.moves).size !== 4
  )
    throw Error("Four distinct moves required");
  for (const id of member.moves) {
    if (!pool.has(id))
      throw Error(`Move source inconsistent with bloodline: ${id}`);
    assertProgram(data.programs[id]);
  }
  const program = data.programs[creature.feature_skill_id];
  assertProgram(program);
  const panel = calculatePanel(creature, {
    ...member,
    level: 60,
    growthStars: 5,
  });
  const pet = {
    id: member.id,
    name: creature.name,
    types: creature.types.map((t) => t.replace(/系$/u, "")),
    stats: panel.stats,
    maxHp: panel.stats.hp,
    hp: panel.stats.hp,
    energy: 10,
    program,
    moves: member.moves.map((id) => ({ id, power: 0, cost: 0, hits: 0 })),
    initialMoveTypes: member.moves.map((id) => data.programs[id].type),
    buffs: zeros(),
    permanentBuffs: zeros(),
    flatSpeed: 0,
    permanentSpeed: 0,
    cost: 0,
    permanentCost: 0,
    power: 0,
    permanentPower: 0,
    hits: 0,
    nextPower: { amount: 0, multiply: 1 },
    drain: 0,
    guard: 0,
    defenseCooldown: 0,
    statuses: { 中毒: 0, 灼烧: 0, 冻结: 0, 引电: 0 },
    statusImmunities: [],
    entered: 0,
    enteredRound: null,
    actionsSinceEntry: 0,
    trapUntil: 0,
    scheduled: [],
    koCounted: false,
  };
  for (const rule of program.rules.filter((r) => r.trigger === "initial"))
    for (const op of rule.ops) {
      if (op.op === "setInitialEnergy") pet.energy = op.amount;
      else if (op.op === "setInitialHp") pet.hp = scale(pet.maxHp, op.fraction);
      else throw Error("Unknown initialization rule");
    }
  return pet;
}

export function createKernelBattle(
  data,
  teams,
  { purpose, scope, tieFirst = 0, resonance = null, maxRounds = 100 } = {},
) {
  const experimental = purpose === "experimental-training" &&
    scope === "supported-builds-incomplete-rules";
  if (purpose !== "mechanism-test" && !experimental)
    throw Error("Full-roster training admission has not passed");
  if (resonance !== null) throw Error("Resonance execution not yet complete");
  if (
    ![0, 1].includes(tieFirst) ||
    !Number.isInteger(maxRounds) ||
    maxRounds < 1 ||
    maxRounds > 1000
  )
    throw Error("Invalid kernel settings");
  if (!Array.isArray(teams) || teams.length !== 2)
    throw Error("Two teams required");
  const state = {
    version: KERNEL_VERSION,
    purpose,
    ...(experimental ? { scope, gameVerified: false } : {}),
    round: 1,
    phase: "lead",
    tieFirst,
    maxRounds,
    winner: null,
    events: [],
    weather: null,
    weatherTurns: 0,
    departures: [],
    turn: null,
    roundRecords: [],
    lastRound: [],
    teams: teams.map((members) => {
      if (members.length !== 6 || new Set(members.map((m) => m.id)).size !== 6)
        throw Error("Six distinct forms required");
      return {
        pets: members.map((m) => createPet(data, m)),
        active: -1,
        magic: 4,
        typeUses: {},
        marks: { positive: null, negative: null },
      };
    }),
  };
  return state;
}

function changeEnergy(state, side, pet, amount, source) {
  amount = amount === 0 ? 0 : amount; // JSON checkpoints do not preserve -0.
  const before = pet.energy,
    limit = has(pet, "energyCap") ? Infinity : 10;
  pet.energy = Math.max(0, Math.min(limit, before + amount));
  emit(state, {
    kind: "energy",
    side,
    pet: pet.id,
    requested: amount,
    effective: pet.energy - before,
    source,
  });
  if (pet.energy > before)
    for (const rule of staticOps(pet))
      if (rule.op === "healOnEnergyGain")
        heal(
          state,
          side,
          pet,
          scale(pet.maxHp, rule.fraction * (pet.energy - before)),
          { kind: "trait", id: pet.program.id, trigger: source },
        );
  return pet.energy - before;
}
function heal(state, side, pet, amount, source) {
  if (pet.hp <= 0) return 0;
  const before = pet.hp;
  pet.hp = Math.min(pet.maxHp, pet.hp + Math.floor(amount));
  emit(state, {
    kind: "heal",
    side,
    pet: pet.id,
    requested: Math.floor(amount),
    effective: pet.hp - before,
    source,
  });
  return pet.hp - before;
}
function hurt(state, side, pet, amount, source) {
  const lost = Math.min(pet.hp, Math.max(0, Math.floor(amount)));
  pet.hp -= lost;
  emit(state, { kind: "damage", side, pet: pet.id, amount: lost, source });
  if (pet.hp > 0 && pet.hp * 100 < pet.maxHp * pet.statuses.冻结 * 5) {
    pet.hp = 0;
    emit(state, { kind: "freeze-ko", side, pet: pet.id, source });
  }
  return lost;
}
const positive = new Set([
  "攻击",
  "光合",
  "湿润",
  "蓄电",
  "风起",
  "蓄势",
  "龙噬",
  "萌芽",
]);
export function addKernelMark(state, side, name, amount, source) {
  if (
    ![
      "攻击",
      "中毒",
      "棘刺",
      "光合",
      "湿润",
      "风起",
      "降灵",
      "蓄势",
      "龙噬",
      "减速",
    ].includes(name)
  )
    throw Error(`Unsupported mark ${name}`);
  const marks = state.teams[side].marks,
    key = positive.has(name) ? "positive" : "negative";
  const previous = marks[key];
  marks[key] = {
    name,
    layers: (previous?.name === name ? previous.layers : 0) + amount,
  };
  emit(state, {
    kind: "mark",
    side,
    name,
    layers: marks[key].layers,
    replaced: previous?.name === name ? null : (previous?.name ?? null),
    source,
  });
}
const mark = (state, side, name) =>
  Object.values(state.teams[side].marks).find((m) => m?.name === name)
    ?.layers ?? 0;
export function addKernelStatus(data, state, side, name, amount, source) {
  const pet = active(state, side),
    immune = { 中毒: "毒", 灼烧: "火", 冻结: "冰", 引电: "电" }[name];
  if (!immune) throw Error(`Unknown status ${name}`);
  if (
    pet.hp <= 0 ||
    pet.types.includes(immune) ||
    pet.statusImmunities.includes(name)
  ) {
    emit(state, { kind: "status-rejected", side, pet: pet.id, name, source });
    return;
  }
  pet.statuses[name] += amount;
  emit(state, {
    kind: "status",
    side,
    pet: pet.id,
    name,
    layers: pet.statuses[name],
    source,
  });
  if (name === "引电")
    while (pet.statuses.引电 >= 2) {
      pet.statuses.引电 -= 2;
      hurt(
        state,
        side,
        pet,
        scale(pet.maxHp, 0.25) * typeMultiplier(data, "电", pet.types),
        source,
      );
    }
  if (name === "冻结" && pet.hp * 100 < pet.maxHp * pet.statuses.冻结 * 5)
    hurt(state, side, pet, pet.hp, { ...source, reason: "freeze-threshold" });
}

function quantity(state, side, selector) {
  const s = selector.who === "enemy" ? 1 - side : side;
  const p = active(state, s);
  if (selector.kind === "energy") return p.energy;
  if (selector.kind === "status") return p.statuses[selector.name] ?? 0;
  if (selector.kind === "poisonEffect")
    return p.statuses.中毒 + mark(state, s, "中毒");
  if (selector.kind === "fainted")
    return state.teams[s].pets.filter((p) => p.hp <= 0).length;
  throw Error(`Unknown quantity selector: ${selector.kind}`);
}

function materializeOp(state, side, op) {
  if (!op.scaleBy) return op;
  const multiplier = quantity(state, side, op.scaleBy);
  const result = { ...op, scaleBy: null };
  for (const key of ["amount", "fraction", "percent"])
    if (result[key] !== undefined)
      result[key] = multiplier === 0 ? 0 : result[key] * multiplier;
  if (result.changes)
    result.changes = result.changes.map((c) => ({
      ...c,
      amount: multiplier === 0 ? 0 : c.amount * multiplier,
    }));
  return result;
}

function apply(data, state, side, op, ctx) {
  op = materializeOp(state, side, op);
  const own = ctx.owner ?? active(state, side),
    other = active(state, 1 - side),
    targetSide = op.target === "enemy" ? 1 - side : side;
  const target = targetSide === side ? own : other,
    source = ctx.source;
  if (!target) return;
  if (op.passive) return; // Carried-skill hooks execute independently of use.
  if (op.timing === "end") {
    own.scheduled.push({
      op: { ...op, timing: null },
      context: {
        source: ctx.source,
        cost: ctx.cost ?? null,
        moveId: ctx.move?.id ?? null,
        slotIndex: ctx.slot ? own.moves.indexOf(ctx.slot) : null,
      },
      round: state.round,
    });
    return;
  }
  switch (op.op) {
    case "carriedZeroCostBuff": {
      const carriedCosts = own.moves.map((_, i) =>
        kernelCarriedMoveCost(data, state, side, i),
      );
      const zeroCostCount = carriedCosts.filter((cost) => cost === 0).length;
      emit(state, {
        kind: "carried-cost-snapshot",
        side,
        pet: own.id,
        costs: carriedCosts,
        zeroCostCount,
        source,
      });
      apply(data, state, side, {
        op: "buff",
        target: "self",
        changes: ["atk", "spa"].map((stat) => ({
          stat,
          amount: op.base + op.perMove * zeroCostCount,
          unit: "ratio",
        })),
      }, ctx);
      break;
    }
    case "statusImmunity":
      if (!own.statusImmunities.includes(op.name))
        own.statusImmunities.push(op.name);
      emit(state, {
        kind: "status-immunity",
        side,
        pet: own.id,
        name: op.name,
        source,
      });
      break;
    case "trap":
      if (target.trapUntil < state.round) {
        target.trapUntil = state.round + op.turns - 1;
        emit(state, {
          kind: "trap",
          side: targetSide,
          pet: target.id,
          until: target.trapUntil,
          source,
        });
      }
      break;
    case "departure":
      for (const s of op.target === "both" ? [side, 1 - side] : [targetSide])
        requestDeparture(state, s, op.mode, source);
      break;
    case "heal":
      heal(state, targetSide, target, scale(target.maxHp, op.fraction), source);
      break;
    case "energy":
      if (op.target === "bench")
        for (const p of state.teams[side].pets) {
          if (p !== own && p.hp > 0)
            changeEnergy(state, side, p, op.amount, source);
        }
      else if (op.target === "enemyTeam") {
        for (const p of state.teams[1 - side].pets)
          if (p.hp > 0) changeEnergy(state, 1 - side, p, op.amount, source);
      } else if (op.target === "steal") {
        const lost = -changeEnergy(state, 1 - side, other, -op.amount, source);
        changeEnergy(state, side, own, lost, source);
      } else changeEnergy(state, targetSide, target, op.amount, source);
      break;
    case "allTeamsEnergy":
      for (let s = 0; s < 2; s++)
        for (const p of state.teams[s].pets)
          if (p.hp > 0) changeEnergy(state, s, p, op.amount, source);
      break;
    case "buff":
      for (const c of op.changes) {
        if (c.unit === "flat") {
          if (c.stat !== "spe") throw Error("Unknown flat stat");
          target[c.permanent ? "permanentSpeed" : "flatSpeed"] += c.amount;
        } else
          target[c.permanent ? "permanentBuffs" : "buffs"][c.stat] += c.amount;
        emit(state, {
          kind: "buff",
          side: targetSide,
          pet: target.id,
          ...c,
          source,
        });
      }
      break;
    case "status":
      addKernelStatus(data, state, targetSide, op.status, op.amount, source);
      break;
    case "mark":
      addKernelMark(state, targetSide, op.mark, op.amount, source);
      break;
    case "power":
      target[op.permanent ? "permanentPower" : "power"] += op.amount;
      break;
    case "cost":
      target[op.permanent ? "permanentCost" : "cost"] += op.amount;
      break;
    case "nextPower":
      own.nextPower = { amount: op.amount ?? 0, multiply: op.multiply ?? 1 };
      break;
    case "drain":
      if (op.persistent) own.drain += op.fraction;
      break;
    case "hits":
      if (!op.set) target.hits += op.amount;
      break;
    case "skillPower":
      if (op.multiply !== undefined)
        ctx.slot.power =
          (data.programs[ctx.slot.id].power + ctx.slot.power) * op.multiply -
          data.programs[ctx.slot.id].power;
      else ctx.slot.power += op.amount;
      emit(state, {
        kind: "skill-modifier",
        side,
        pet: own.id,
        move: ctx.slot.id,
        field: "power",
        value: ctx.slot.power,
        source,
      });
      break;
    case "skillCost":
      ctx.slot.cost += op.amount;
      emit(state, {
        kind: "skill-modifier",
        side,
        pet: own.id,
        move: ctx.slot.id,
        field: "cost",
        value: ctx.slot.cost,
        source,
      });
      break;
    case "skillHits":
      ctx.slot.hits += op.amount;
      emit(state, {
        kind: "skill-modifier",
        side,
        pet: own.id,
        move: ctx.slot.id,
        field: "hits",
        value: ctx.slot.hits,
        source,
      });
      break;
    case "guard":
      own.guard = op.fraction;
      break;
    case "interrupt":
      state.interrupted[1 - side] = true;
      emit(state, { kind: "interrupt", side, targetSide: 1 - side, source });
      break;
    case "weather":
      state.weather = op.weather;
      state.weatherTurns = op.turns;
      break;
    case "loseCurrentHp":
      hurt(state, side, own, scale(own.hp, op.fraction), source);
      break;
    case "powerFromTeamTypeUses":
      own.power += (state.teams[side].typeUses[op.type] ?? 0) * op.amount;
      break;
    case "costFromTeamTypeUses":
      own.cost += (state.teams[side].typeUses[op.type] ?? 0) * op.amount;
      break;
    case "attackPower":
    case "attackHits":
    case "priority":
    case "immediateCost":
    case "swift":
      break; // consumed before attack/order
    default:
      throw Error(`Unknown runtime operation: ${op.op}`);
  }
}

function trigger(data, state, side, event, context = {}) {
  const p = active(state, side);
  if (!p || p.hp <= 0) return;
  for (const rule of p.program.rules) {
    if (
      rule.trigger !== event ||
      (rule.type && rule.type !== context.move?.type) ||
      (rule.moveKind && rule.moveKind !== context.move?.kind) ||
      (rule.weather && rule.weather !== state.weather) ||
      (rule.ownMagic !== undefined &&
        rule.ownMagic !== state.teams[side].magic) ||
      (rule.enemyMagic !== undefined &&
        rule.enemyMagic !== state.teams[1 - side].magic) ||
      (rule.cost !== undefined && rule.cost !== context.cost) ||
      (rule.maxCost !== undefined && context.cost > rule.maxCost) ||
      (rule.ownEnergy !== undefined && p.energy !== rule.ownEnergy)
    )
      continue;
    for (const op of rule.ops)
      apply(data, state, side, op, {
        ...context,
        source: { kind: "trait", id: p.program.id },
      });
  }
}

function carriedHooks(data, state, side, event, context = {}) {
  const p = active(state, side);
  if (!p || p.hp <= 0) return;
  for (const slot of p.moves) {
    const program = data.programs[slot.id];
    for (const op of program.ops ?? []) {
      if (
        op.passive !== event ||
        (op.type && op.type !== context.move?.type) ||
        (event === "otherMove" && context.slot === slot)
      )
        continue;
      apply(
        data,
        state,
        side,
        { ...op, passive: null },
        {
          slot,
          move: program,
          source: {
            kind: "skill-passive",
            id: slot.id,
            event,
            trigger: context.move?.id ?? null,
          },
        },
      );
    }
  }
}
function entry(data, state, side, index, deferEffects = false) {
  const prev = active(state, side),
    team = state.teams[side];
  if (prev && prev.hp > 0) {
    trigger(data, state, side, "exit");
    trigger(data, state, 1 - side, "enemyExit");
    prev.buffs = zeros();
    prev.flatSpeed = 0;
    prev.cost = 0;
    prev.power = 0;
    prev.hits = 0;
    prev.nextPower = { amount: 0, multiply: 1 };
    prev.drain = 0;
    prev.statuses = { 中毒: 0, 灼烧: 0, 冻结: 0, 引电: 0 };
    prev.statusImmunities = [];
    prev.scheduled = [];
  }
  team.active = index;
  const p = active(state, side);
  p.entered++;
  p.enteredRound = state.round;
  p.actionsSinceEntry = 0;
  emit(state, { kind: "entry", side, pet: p.id, from: prev?.id ?? null });
  const finish = () => {
    if (p.entered === 1) trigger(data, state, side, "firstEntry");
    trigger(data, state, side, "entry");
    carriedHooks(data, state, side, "entry");
    if (prev && prev.hp > 0) {
      for (const rule of prev.program.rules.filter(
        (r) => r.trigger === "replacement",
      ))
        for (const op of rule.ops)
          apply(data, state, side, op, {
            source: { kind: "trait", id: prev.program.id, actor: prev.id },
          });
      trigger(data, state, 1 - side, "enemyReplacement");
      const thorns = mark(state, side, "棘刺"),
        energy = mark(state, side, "降灵");
      if (thorns)
        hurt(state, side, p, scale(p.maxHp, 0.06 * thorns), {
          kind: "mark",
          name: "棘刺",
        });
      if (energy)
        changeEnergy(state, side, p, -energy, { kind: "mark", name: "降灵" });
    }
  };
  if (deferEffects) return finish;
  finish();
}

function selectedMove(data, pet, index, choice) {
  const program = data.programs[pet.moves[index].id];
  if (program.choices) {
    if (!Number.isInteger(choice) || !program.choices[choice])
      throw Error("Explicit legal choice branch required");
    return program.choices[choice];
  }
  if (choice !== undefined) throw Error("This move has no choice branch");
  return program;
}
const decodeMove = (action) => action.slice(5).split(":").map(Number);
export function kernelMoveCost(data, state, side, index, choice) {
  return modifiedMoveCost(
    data, state, side, index, selectedMove(data, active(state, side), index, choice), true,
  );
}

// Carried costs include current lasting reductions/increases, marks and auras.
// An unchosen action branch's "this use" discount is not a carried discount.
// This distinction remains an explicit game-conformance question for the new
// stockpile fixture; it is not a claim that live-game boundary cases are verified.
export function kernelCarriedMoveCost(data, state, side, index) {
  const p = active(state, side);
  return modifiedMoveCost(data, state, side, index, data.programs[p.moves[index].id], false);
}

function modifiedMoveCost(data, state, side, index, move, includeImmediate) {
  const p = active(state, side),
    slot = p.moves[index];
  let value =
    move.cost +
    slot.cost +
    p.cost +
    p.permanentCost -
    mark(state, side, "湿润");
  value += (includeImmediate ? (move.ops ?? []) : [])
    .filter(
      (op) => op.op === "immediateCost" && whenPasses(state, side, op.when, {}),
    )
    .reduce((n, op) => n + materializeOp(state, side, op).amount, 0);
  if (move.kind === "attack") value += mark(state, side, "蓄势");
  const foe = active(state, 1 - side);
  if (foe)
    for (const op of staticOps(foe))
      if (op.op === "enemyCostAura") value += op.amount;
  for (const op of staticOps(p))
    if (op.op === "moveCost" && (!op.kind || op.kind === move.kind))
      value += op.amount;
  for (const op of staticOps(p))
    if (
      op.op === "burstCost" &&
      p.actionsSinceEntry === 0 &&
      move.type === op.type
    )
      value += op.amount;
  for (const op of staticOps(p))
    if (op.op === "carriedTypeCost" && move.type === op.type)
      value +=
        op.amount *
        p.initialMoveTypes.filter((t) => t === op.carriedType).length;
  value = Math.max(0, value);
  if (state.weather === "沙暴" && move.type === "地")
    value = Math.floor(value / 2);
  return value;
}
export function kernelLegalActions(data, state, side) {
  if (state.winner !== null) return [];
  const t = state.teams[side],
    p = active(state, side),
    switches = t.pets.flatMap((p, i) =>
      p.hp > 0 && i !== t.active ? [`switch:${i}`] : [],
    );
  if (state.phase === "lead") return switches;
  if (state.phase === "swift") {
    const pending = state.swiftPending;
    return pending.side === side
      ? pending.choices.map((c) => `move:${pending.index}:${c}`)
      : ["wait"];
  }
  if (state.phase === "pivot")
    return state.pivotRequests.some((r) => r.side === side)
      ? switches
      : ["wait"];
  if (state.phase === "replace") return !p || p.hp <= 0 ? switches : ["wait"];
  const moves = p.moves.flatMap((slot, i) => {
    const m = data.programs[slot.id];
    if (
      (has(p, "onlyFirstSlot") && i !== 0) ||
      (m.kind === "defense" && p.defenseCooldown > 0)
    )
      return [];
    const variants = m.choices ? m.choices.map((_, j) => j) : [undefined];
    return variants.flatMap((choice) =>
      kernelMoveCost(data, state, side, i, choice) > p.energy
        ? []
        : [`move:${i}${choice === undefined ? "" : ":" + choice}`],
    );
  });
  return [...moves, "focus", ...(p.trapUntil >= state.round ? [] : switches)];
}
function ratio(data, state, side, key) {
  const pet = active(state, side);
  let result = pet.buffs[key] + pet.permanentBuffs[key];
  for (const op of staticOps(pet))
    if (op.stats?.includes(key)) {
      if (op.op === "energyBuff") result += pet.energy * op.amount;
      if (
        op.op === "teamTypeBuff" &&
        state.teams[side].pets.some((p) => p.types.includes(op.type))
      )
        result += op.amount;
      if (
        op.op === "lowTotalCostBuff" &&
        pet.moves.reduce((n, m) => n + data.programs[m.id].cost, 0) <
          op.threshold
      )
        result += op.amount;
      if (op.op === "faintedBuff")
        result +=
          state.teams[side].pets.filter((p) => p.hp <= 0).length * op.amount;
    }
  return result;
}
const speed = (data, state, side) => {
  const p = active(state, side),
    r = ratio(data, state, side, "spe");
  const weather = staticOps(p)
    .filter((e) => e.op === "weatherSpeed" && e.weather === state.weather)
    .reduce((n, e) => n + e.amount, 0);
  return Math.max(
    0,
    p.stats.spe * (r >= 0 ? 1 + r : 1 / (1 - r)) +
      p.flatSpeed +
      p.permanentSpeed +
      weather -
      10 * mark(state, side, "减速"),
  );
};
function whenPasses(state, side, when, context) {
  if (!when) return true;
  const previous = state.lastRound.filter(
    (r) => r.side === side && r.pet === active(state, side).id,
  );
  if (when.kind === "previousKind")
    return previous.some((r) => r.kind === when.value);
  if (when.kind === "previousCounter") return previous.some((r) => r.counter);
  if (when.kind === "previousType")
    return state.lastRound.some((r) => r.type === when.value);
  if (when.kind === "status" || when.kind === "poisonEffect")
    return quantity(state, side, when) > 0;
  if (when.kind === "burst") return active(state, side).actionsSinceEntry === 0;
  if (when.kind === "firstAttack") return context.first;
  if (when.kind === "notFirstAttack") return !context.first;
  if (when.kind === "enemySwitch") return context.enemyKind === "switch";
  if (when.kind === "weather") return state.weather === when.value;
  const p = active(state, when.who === "enemy" ? 1 - side : side);
  const value = when.kind === "hp" ? p.hp / p.maxHp : p.energy;
  return when.comparison === "gt"
    ? value > when.value
    : when.comparison === "lt"
      ? value < when.value
      : when.comparison === "eq"
        ? value === when.value
        : value <= when.value;
}
function resolvedOps(move, counter, state, side, context) {
  return [
    ...(counter && move.replaceOnCounter ? [] : move.ops),
    ...(counter ? move.counterOps : []),
  ]
    .filter((op) => whenPasses(state, side, op.when, context))
    .map((op) => materializeOp(state, side, op));
}
function damage(data, state, side, move, slot, ops, first, cost) {
  const a = active(state, side),
    b = active(state, 1 - side),
    physical = move.category === "物攻";
  const atk = physical ? "atk" : "spa",
    def = physical ? "def" : "spd";
  const ar = ratio(data, state, side, atk),
    br = ratio(data, state, 1 - side, def);
  const level =
    (1 + Math.max(0, ar) + Math.max(0, -br)) /
    (1 + Math.max(0, -ar) + Math.max(0, br));
  let power =
    move.power + slot.power + a.power + a.permanentPower + a.nextPower.amount;
  let multiplier = a.nextPower.multiply;
  let firstAttackBonus = 0;
  for (const op of staticOps(a))
    if (op.op === "movePower") {
      if (op.type && (move.type === op.type) === !!op.exclude) continue;
      if (
        (op.costTest === "gt" && !(move.cost > op.cost)) ||
        (op.costTest === "eq" && move.cost !== op.cost)
      )
        continue;
      if (
        (op.firstAttack && !first) ||
        (op.nonStab && a.types.includes(move.type))
      )
        continue;
      if (op.plainAttack && (move.ops.length || move.counter)) continue;
      if (op.firstAttack) firstAttackBonus += op.multiply - 1;
      else multiplier *= op.multiply;
    }
  for (const op of staticOps(a)) {
    if (op.op === "burstPower" && a.actionsSinceEntry === 0) power += op.amount;
    if (op.op === "namedPower" && move.name === op.name) power += op.amount;
    if (op.op === "enemyCostPower")
      multiplier *=
        1 +
        b.moves.reduce((n, m) => n + data.programs[m.id].cost, 0) * op.amount;
    if (op.op === "carriedTypePower" && move.type === op.type)
      multiplier *=
        1 +
        a.initialMoveTypes.filter((t) => t === op.carriedType).length *
          op.amount;
    if (op.op === "enemyDistinctTypePower")
      power +=
        new Set(b.moves.map((m) => data.programs[m.id].type)).size * op.amount;
    if (
      op.op === "weatherPower" &&
      state.weather === op.weather &&
      move.type === op.type
    )
      multiplier *= op.multiply;
  }
  for (const op of ops)
    if (op.op === "attackPower") {
      if (op.when?.kind === "firstAttack")
        firstAttackBonus += (op.multiply ?? 1) - 1 + (op.percent ?? 0);
      else {
        multiplier *= op.multiply ?? 1;
        multiplier *= Math.max(0, 1 + (op.percent ?? 0));
      }
      power += op.amount ?? 0;
    }
  multiplier *= Math.max(0, 1 + firstAttackBonus);
  multiplier *=
    1 +
    0.1 * mark(state, side, "攻击") +
    0.3 * mark(state, side, "蓄势") +
    (first ? 0.2 * mark(state, side, "风起") : 0);
  if (state.weather === "雨天" && move.type === "水") multiplier *= 1.75;
  const display = Math.round(
    Math.max(0, power) *
      multiplier *
      (a.types.includes(move.type) ? 1.25 : 1) *
      typeMultiplier(data, move.type, b.types) *
      level,
  );
  const baseDamage = Math.max(
    0,
    Math.floor(Math.round((a.stats[atk] * display * 37) / 41) / b.stats[def]),
  );
  let result = reduceIntegerDamage(baseDamage, b.guard);
  for (const op of staticOps(b)) {
    if (op.op === "zeroEnergyImmunity" && a.energy === 0) return 0;
    if (op.op === "cheapAttackImmunity" && cost <= op.maxCost) return 0;
    if (op.op === "nonStabResistance" && !a.types.includes(move.type))
      result = reduceIntegerDamage(result, op.fraction);
    if (
      op.op === "ownMoveTypeResistance" &&
      b.moves.some((m) => data.programs[m.id].type === move.type)
    )
      result = reduceIntegerDamage(result, op.fraction);
  }
  return result;
}
function resolveKOs(state) {
  for (let side = 0; side < 2; side++)
    for (const pet of state.teams[side].pets) {
      if (pet.hp > 0 || pet.koCounted) continue;
      pet.koCounted = true;
      const loss = Math.max(
        0,
        1 +
          staticOps(pet)
            .filter((e) => e.op === "koMagic")
            .reduce((n, e) => n + e.amount, 0),
      );
      state.teams[side].magic = Math.max(0, state.teams[side].magic - loss);
      emit(state, { kind: "ko", side, pet: pet.id, magicLoss: loss });
    }
  const lost = state.teams.map(
    (t) => t.magic === 0 || t.pets.every((p) => p.hp <= 0),
  );
  if (lost[0] && lost[1]) state.winner = "simultaneous-ko";
  else if (lost[0]) state.winner = 1;
  else if (lost[1]) state.winner = 0;
}

function execute(data, state, side, index, choice, enemyKind, first) {
  const p = active(state, side),
    enemy = active(state, 1 - side),
    slot = p.moves[index],
    move = selectedMove(data, p, index, choice);
  const cost = kernelMoveCost(data, state, side, index, choice);
  // A faster energy drain can invalidate a previously legal committed command.
  if (cost > p.energy) {
    emit(state, {
      kind: "action-failed",
      side,
      reason: "energy-changed",
      move: move.id,
    });
    return false;
  }
  changeEnergy(state, side, p, -cost, { kind: "cost", id: move.id });
  trigger(data, state, side, "beforeMove", { move, slot, cost });
  const counter = move.counter === enemyKind,
    ops = resolvedOps(move, counter, state, side, { first, enemyKind }),
    source = { kind: "skill", id: move.id };
  const repeated = ops.find((e) => e.op === "hits" && e.set)?.amount;
  let hits =
    repeated === undefined ? 1 : Math.max(1, repeated + slot.hits + p.hits);
  if (repeated !== undefined)
    for (const op of staticOps(p))
      if (op.op === "poisonHits")
        hits +=
          quantity(state, side, { kind: "poisonEffect", who: "enemy" }) *
          op.amount;
  for (const op of ops)
    if (op.op === "attackHits")
      hits =
        op.set ?? Math.max(1, (hits + (op.amount ?? 0)) * (op.multiply ?? 1));
  if (
    repeated !== undefined &&
    state.teams.some((_, s) => has(active(state, s), "fixedHits"))
  )
    hits = 2;
  // Multi-hit is per hit; after-skill effects occur once unless explicitly per-hit.
  let total = 0;
  if (move.kind === "attack")
    for (let n = 0; n < hits && enemy.hp > 0 && p.hp > 0; n++) {
      total += hurt(
        state,
        1 - side,
        enemy,
        damage(data, state, side, move, slot, ops, first, cost),
        source,
      );
      for (const op of ops.filter((e) => e.perHit))
        apply(data, state, side, op, { source, slot, move, cost });
    }
  const drain =
    p.drain +
    ops
      .filter((e) => e.op === "drain" && !e.persistent)
      .reduce((n, e) => n + e.fraction, 0);
  if (total && drain) heal(state, side, p, scale(total, drain), source);
  if (move.kind === "attack") p.nextPower = { amount: 0, multiply: 1 };
  for (const op of ops.filter((e) => move.kind !== "attack" || !e.perHit))
    for (let repeat = 0; repeat < (move.kind === "status" && op.perHit ? hits : 1); repeat++)
      apply(data, state, side, op, { source, slot, move, cost });
  if (move.kind === "defense") p.defenseCooldown = 2;
  trigger(data, state, side, "afterMove", { move, slot, cost });
  state.teams[side].typeUses[move.type] =
    (state.teams[side].typeUses[move.type] ?? 0) + 1;
  for (const owner of state.teams[side].pets)
    if (owner !== p && owner.hp > 0)
      for (const rule of owner.program.rules) {
        if (
          rule.trigger === "benchAllyMove" &&
          (!rule.type || rule.type === move.type)
        )
          for (const op of rule.ops)
            apply(data, state, side, op, {
              owner,
              move,
              slot,
              cost,
              source: { kind: "trait", id: owner.program.id, actor: p.id },
            });
      }
  if (counter) {
    trigger(data, state, side, "counter", { move, slot, cost });
    carriedHooks(data, state, side, "counter", { move, slot, cost });
  }
  carriedHooks(data, state, side, "otherMove", { move, slot, cost });
  if (enemy.hp <= 0)
    carriedHooks(data, state, side, "kill", { move, slot, cost });
  if (move.kind === "attack" && total)
    trigger(data, state, 1 - side, "afterAttacked", { move, slot, cost });
  if (
    move.kind === "attack" &&
    total &&
    typeMultiplier(data, move.type, enemy.types) > 1
  )
    trigger(data, state, side, "effectiveAttack", { move, slot, cost });
  if (cost === 3 && mark(state, side, "龙噬"))
    apply(
      data,
      state,
      side,
      {
        op: "buff",
        target: "self",
        changes: ["atk", "spa"].map((stat) => ({
          stat,
          amount: 0.4 * mark(state, side, "龙噬"),
          unit: "ratio",
        })),
      },
      { source: { kind: "mark", name: "龙噬" } },
    );
  emit(state, {
    kind: "move",
    side,
    pet: p.id,
    move: move.id,
    choice: choice ?? null,
    cost,
    counter,
    hits,
    damage: total,
  });
  p.actionsSinceEntry++;
  state.roundRecords.push({
    side,
    pet: p.id,
    move: move.id,
    kind: move.kind,
    type: move.type,
    cost,
    counter,
    choice: choice ?? null,
  });
  trigger(data, state, side, "afterAction", { move, slot, cost });
  resolveKOs(state);
  return move.kind === "attack";
}

function requestDeparture(state, side, mode, source) {
  const p = active(state, side);
  const reason =
    p.hp <= 0
      ? "fainted"
      : p.trapUntil >= state.round
        ? "trapped"
        : p.enteredRound === state.round
          ? "entered-this-round"
          : mode === "pivot" &&
              !state.teams[side].pets.some(
                (other) => other !== p && other.hp > 0,
              )
            ? "no-replacement"
            : null;
  if (reason) {
    emit(state, {
      kind: "departure-rejected",
      side,
      pet: p.id,
      reason,
      source,
    });
    return;
  }
  if (!state.departures.some((r) => r.side === side && r.pet === p.id))
    state.departures.push({ side, pet: p.id, mode, source });
}

function movementOrder(data, state, sides) {
  return [...sides].sort(
    (a, b) =>
      speed(data, state, b) - speed(data, state, a) ||
      (a === state.tieFirst ? -1 : 1),
  );
}

// Pause between complete effects; the acting side chooses its replacement.
// Enemy committed commands retain their original actor identity and entry count.
function resolveDepartures(data, state) {
  if (!state.departures.length) return false;
  const requests = state.departures
    .splice(0)
    .filter(
      (r) => active(state, r.side).id === r.pet && active(state, r.side).hp > 0,
    );
  const order = movementOrder(
    data,
    state,
    requests.map((r) => r.side),
  );
  state.pivotRequests = [];
  for (const side of order) {
    const request = requests.find((r) => r.side === side);
    if (request.mode === "reenter") {
      entry(data, state, side, state.teams[side].active);
      emit(state, { kind: "reenter", side, source: request.source });
      resolveKOs(state);
    } else state.pivotRequests.push(request);
  }
  if (state.winner !== null) return false;
  if (state.pivotRequests.length) {
    state.phase = "pivot";
    return true;
  }
  return false;
}

function swiftSlot(data, state, side) {
  const p = active(state, side);
  for (let i = 0; i < p.moves.length; i++) {
    const m = data.programs[p.moves[i].id];
    if (
      (has(p, "onlyFirstSlot") && i !== 0) ||
      (m.kind === "defense" && p.defenseCooldown > 0)
    )
      continue;
    const branches = m.choices ?? [m];
    if (
      !branches.some((b) => b.ops.some((o) => o.op === "swift")) &&
      !staticOps(p).some(
        (o) => o.op === "swiftBelowCost" && m.cost < o.threshold,
      ) &&
      !staticOps(p).some((o) => o.op === "swiftType" && o.type === m.type)
    )
      continue;
    const available = branches.flatMap((_, c) =>
      kernelMoveCost(data, state, side, i, m.choices ? c : undefined) <=
      p.energy
        ? [m.choices ? c : null]
        : [],
    );
    if (available.length)
      return { side, index: i, choices: available, hasChoice: !!m.choices };
  }
  return null;
}

function runSwift(data, state, pending, choice) {
  const turn = state.turn;
  turn.attacked =
    execute(
      data,
      state,
      pending.side,
      pending.index,
      choice,
      turn.kinds[1 - pending.side],
      !turn.attacked,
    ) || turn.attacked;
  emit(state, { kind: "swift", side: pending.side, slot: pending.index });
  state.swiftPending = null;
}

function endPass(data, state) {
  for (let side = 0; side < 2; side++) {
    const p = active(state, side);
    if (p.hp <= 0) continue;
    const poison = p.statuses.中毒;
    if (poison)
      hurt(
        state,
        side,
        p,
        scale(p.maxHp, 0.03 * poison) * typeMultiplier(data, "毒", p.types),
        { kind: "status", name: "中毒" },
      );
    const poisonMark = mark(state, side, "中毒");
    if (poisonMark)
      hurt(
        state,
        side,
        p,
        scale(p.maxHp, 0.03 * poisonMark) * typeMultiplier(data, "毒", p.types),
        { kind: "mark", name: "中毒" },
      );
    const burn = p.statuses.灼烧;
    if (burn) {
      hurt(
        state,
        side,
        p,
        scale(p.maxHp, 0.02 * burn) * typeMultiplier(data, "火", p.types),
        { kind: "status", name: "灼烧" },
      );
      p.statuses.灼烧 = Math.floor(burn / 2);
    }
    if (p.hp > 0) {
      const photo = mark(state, side, "光合");
      if (photo)
        changeEnergy(state, side, p, photo, { kind: "mark", name: "光合" });
      if (state.weather === "暴风雪")
        addKernelStatus(data, state, side, "冻结", 2, { kind: "weather" });
      if (state.weather === "雷鸣")
        addKernelStatus(data, state, side, "引电", 1, { kind: "weather" });
      trigger(data, state, side, "end");
      carriedHooks(data, state, side, "end");
      // Each registered use has its own end effect. Repeat-end traits apply
      // to the same registered effects on the additional pass.
      for (const scheduled of [...p.scheduled])
        if (scheduled.round === state.round)
          apply(data, state, side, scheduled.op, {
            ...scheduled.context,
            move: data.programs[scheduled.context.moveId],
            slot:
              scheduled.context.slotIndex === null
                ? null
                : p.moves[scheduled.context.slotIndex],
          });
    }
  }
  resolveKOs(state);
}

export function stepKernelBattle(data, state, actions) {
  if (!Array.isArray(actions) || actions.length !== 2)
    throw Error("Two simultaneous actions required");
  for (let s = 0; s < 2; s++)
    if (!kernelLegalActions(data, state, s).includes(actions[s]))
      throw Error(`Illegal command ${actions[s]}`);
  const begin = state.events.length;
  if (state.phase === "swift") {
    const pending = state.swiftPending;
    runSwift(data, state, pending, decodeMove(actions[pending.side])[1]);
    state.phase = "battle";
    if (!resolveDepartures(data, state)) resumeTurn(data, state);
    return state.events.slice(begin);
  }
  if (state.phase === "pivot") {
    const requests = state.pivotRequests;
    state.pivotRequests = [];
    for (const r of requests) {
      entry(data, state, r.side, +actions[r.side].slice(7));
      emit(state, { kind: "pivot", side: r.side, source: r.source });
    }
    resolveKOs(state);
    state.phase = "battle";
    if (!resolveDepartures(data, state)) resumeTurn(data, state);
    return state.events.slice(begin);
  }
  state.interrupted = [false, false];
  if (state.phase === "lead" || state.phase === "replace") {
    // Both committed incoming identities exist before any entry passive can
    // inspect its opponent. This avoids a side-zero-only initialization path.
    const incoming = actions.map((a, s) =>
      a.startsWith("switch:") ? entry(data, state, s, +a.slice(7), true) : null,
    );
    for (const side of [0, 1].sort(
      (a, b) =>
        speed(data, state, b) - speed(data, state, a) ||
        (a === state.tieFirst ? -1 : 1),
    ))
      incoming[side]?.();
    resolveKOs(state);
    state.phase = state.teams.some((_, s) => active(state, s)?.hp <= 0)
      ? "replace"
      : "battle";
    return state.events.slice(begin);
  }
  const kind = (s) =>
    actions[s] === "focus"
      ? "status"
      : actions[s].startsWith("move:")
        ? selectedMove(data, active(state, s), ...decodeMove(actions[s])).kind
        : "switch";
  const kinds = [kind(0), kind(1)],
    priority = (s) => {
      if (kinds[s] === "switch") return 10000;
      if (actions[s] === "focus") return 0;
      const m = selectedMove(data, active(state, s), ...decodeMove(actions[s]));
      return (
        (m.counter === kinds[1 - s] ? 1000 : 0) +
        m.ops
          .filter((o) => o.op === "priority")
          .reduce((n, o) => n + o.amount, 0)
      );
    };
  // Fixed tie orientation is a test control, not a claim about live-game ties.
  const order = [0, 1].sort(
    (a, b) =>
      priority(b) - priority(a) ||
      speed(data, state, b) - speed(data, state, a) ||
      (a === state.tieFirst ? -1 : 1),
  );
  state.turn = {
    actions,
    kinds,
    order,
    cursor: 0,
    attacked: false,
    stage: "actions",
    actors: state.teams.map((_, s) => ({
      id: active(state, s).id,
      entered: active(state, s).entered,
    })),
  };
  resumeTurn(data, state);
  return state.events.slice(begin);
}

function resumeTurn(data, state) {
  const turn = state.turn;
  while (turn.stage === "actions" && turn.cursor < turn.order.length) {
    if (state.winner !== null) break;
    const side = turn.order[turn.cursor++];
    const p = active(state, side),
      other = active(state, 1 - side);
    if (!p || p.hp <= 0 || other.hp <= 0 || state.interrupted[side]) continue;
    if (
      p.id !== turn.actors[side].id ||
      p.entered !== turn.actors[side].entered
    ) {
      emit(state, {
        kind: "action-cancelled",
        side,
        reason: "actor-left",
        pet: turn.actors[side].id,
      });
      continue;
    }
    const action = turn.actions[side];
    if (action.startsWith("switch:")) {
      entry(data, state, side, +action.slice(7));
      resolveKOs(state);
      if (active(state, side).hp > 0 && state.winner === null) {
        const pending = swiftSlot(data, state, side);
        if (pending?.hasChoice) {
          state.swiftPending = pending;
          state.phase = "swift";
          return;
        }
        if (pending) runSwift(data, state, pending, undefined);
      }
    } else if (action === "focus") {
      changeEnergy(state, side, p, 5, { kind: "focus" });
      p.actionsSinceEntry++;
      state.roundRecords.push({
        side,
        pet: p.id,
        move: null,
        kind: "focus",
        type: null,
        cost: 0,
        counter: false,
      });
      trigger(data, state, side, "afterAction", {});
    } else {
      const [index, choice] = decodeMove(action);
      turn.attacked =
        execute(
          data,
          state,
          side,
          index,
          choice,
          turn.kinds[1 - side],
          !turn.attacked,
        ) || turn.attacked;
    }
    resolveKOs(state);
    if (state.winner === null && resolveDepartures(data, state)) return;
  }
  if (turn.stage === "actions") {
    turn.stage = "end";
    turn.endPass = 0;
    turn.endPasses = state.teams.some((_, s) =>
      has(active(state, s), "suppressEnd"),
    )
      ? 0
      : state.teams.some((_, s) => has(active(state, s), "repeatEnd"))
        ? 2
        : 1;
  }
  while (state.winner === null && turn.endPass < turn.endPasses) {
    turn.endPass++;
    endPass(data, state);
    if (resolveDepartures(data, state)) return;
  }
  for (const t of state.teams)
    for (const p of t.pets) {
      p.guard = 0;
      p.defenseCooldown = Math.max(0, p.defenseCooldown - 1);
      p.scheduled = [];
    }
  if (state.weatherTurns > 0 && --state.weatherTurns === 0)
    state.weather = null;
  if (state.winner === null) {
    if (state.round >= state.maxRounds) state.winner = "round-cap";
    else if (state.teams.some((_, s) => active(state, s).hp <= 0))
      state.phase = "replace";
  }
  state.round++;
  state.lastRound = state.roundRecords;
  state.roundRecords = [];
  state.turn = null;
  for (const t of state.teams)
    for (const p of t.pets)
      if (![p.hp, p.energy, p.power, p.cost].every(finite))
        throw Error("Non-finite state");
}
