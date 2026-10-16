// The encoder accepts ONLY the projected observation, never the battle state.
// All species/move dictionaries are public prototype metadata, not opponent builds.
import {combatFeatures,combatFeatureNames} from './learning-features.mjs';
export const LEARNING_OBSERVATION_VERSION = "visible-vector-2-provisional";
export const ACTION_COUNT = 12;
const one = (keys, values) => keys.map((k) => (values.includes(k) ? 1 : 0));
const bounded = (x, scale = 1) => Math.max(-5, Math.min(5, (x ?? 0) / scale));
const stats = ["hp", "atk", "def", "spa", "spd", "spe"];
const boosts = ["atk", "def", "spa", "spd", "spe"];
const events = ["appearance", "move", "focus", "ko"];
const kinds = ["attack", "defense", "status", "focus", "switch", "wait"];

export function createLearningEncoder(data) {
  const species = Object.keys(data.creatures).sort();
  const moves = Object.keys(data.moves).sort();
  const types = Object.keys(data.types).sort();
  const traits = [
    ...new Set(Object.values(data.creatures).map((c) => c.trait.handler)),
  ].sort();
  const petNames = [
    "present",
    "own",
    "active",
    "hp",
    "energy",
    "fainted",
    "age",
    "statsKnown",
    ...species.map((x) => "species:" + x),
    ...types.map((x) => "type:" + x),
    ...stats.map((x) => "stat:" + x),
    ...traits.map((x) => "trait:" + x),
    ...boosts.map((x) => "boost:" + x),
    "defenseCooldown",
    "costReduction",
    "powerBonus",
    "nextAttack",
    "everEntered",
    ...moves.map((x) => "knownMove:" + x),
  ];
  const globalNames = [
    "lead",
    "battle",
    "replace",
    "round",
    "ownMagic",
    "enemyMagic",
    "unknown",
    "historyLength",
    ...events.map((x) => "last:" + x),
    ...Array.from({ length: 12 }, (_, i) => "previousAction:" + i),
  ];
  const actionNames = [
    ...kinds,
    ...moves.map((x) => "move:" + x),
    ...types.map((x) => "type:" + x),
    "power",
    "cost",
    "heal",
    "energy",
    "benchEnergy",
    "guard",
    "nextAttack",
    "priority",
    ...combatFeatureNames,
    ...petNames.map((x) => "actorOrSwitchTarget:" + x),
  ];
  const schema = {
    version: LEARNING_OBSERVATION_VERSION,
    actionCount: ACTION_COUNT,
    petCount: 12,
    petDim: petNames.length,
    globalDim: globalNames.length,
    actionDim: actionNames.length,
    petNames,
    globalNames,
    actionNames,
    information:
      "provisional player-view only; full-state policies are not comparable",
    actionSlots: [
      "move:0",
      "move:1",
      "move:2",
      "move:3",
      "focus",
      ...Array.from({ length: 6 }, (_, i) => "switch:" + i),
      "wait",
    ],
  };
  const emptyPet = () => Array(petNames.length).fill(0);
  function ownPet(p, active) {
    return [
      1,
      1,
      +active,
      bounded(p.hp / p.maxHp),
      bounded(p.energy, 10),
      +(p.hp <= 0),
      0,
      1,
      ...one(species, [p.id]),
      ...one(types, p.types),
      ...stats.map((k) => bounded(p.stats[k], 500)),
      ...one(traits, [p.trait]),
      ...boosts.map((k) => bounded(p.boosts[k], 5)),
      bounded(p.defenseCooldown, 2),
      bounded(p.costReduction, 10),
      bounded(p.powerBonus, 100),
      bounded(p.nextAttack, 3),
      +p.everEntered,
      ...one(
        moves,
        p.moves.map((m) => m.id),
      ),
    ];
  }
  function enemyPet(p, active, round) {
    if (!p?.lastSeen) return emptyPet();
    const s = p.lastSeen;
    return [
      1,
      0,
      +active,
      bounded(s.hpRatio),
      bounded(s.energy, 10),
      +s.fainted,
      bounded(round - s.round, 100),
      0,
      ...one(species, [p.id]),
      ...one(types, s.types),
      ...Array(stats.length + traits.length + boosts.length + 5).fill(0),
      ...one(moves, p.revealedMoves),
    ];
  }
  function encode(view, previousAction = -1) {
    const pets = view.own.pets.map((p, i) => ownPet(p, i === view.own.active));
    for (let i = 0; i < 6; i++)
      pets.push(
        enemyPet(
          view.opponent.known[i],
          i === view.opponent.activeEncounter,
          view.round,
        ),
      );
    const global = [
      ...one(["lead", "battle", "replace"], [view.phase]),
      bounded(view.round, 100),
      view.own.magic / 4,
      view.opponent.magic / 4,
      view.opponent.unknownMembers / 6,
      bounded(view.history.length, 100),
      ...one(events, [view.history.at(-1)?.kind]),
      ...Array.from({ length: 12 }, (_, i) => +(i === previousAction)),
    ];
    const active = view.own.pets[view.own.active];
    const commands = Array.from({ length: 12 }, (_, i) =>
      i < 4
        ? active
          ? "move:" + active.moves[i].id
          : null
        : i === 4
          ? "focus"
          : i === 11
            ? "wait"
            : "switch:" + (i - 5),
    );
    const mask = commands.map(
      (x) => +(x !== null && view.legalActions.includes(x)),
    );
    const actions = commands.map((command, i) => {
      const m = i < 4 ? active?.moves[i] : null;
      const kind =
        m?.kind ?? (i === 4 ? "focus" : i === 11 ? "wait" : "switch");
      const e = m?.effect ?? {};
      const actor =
        i >= 5 && i <= 10 ? pets[i - 5] : (pets[view.own.active] ?? emptyPet());
      const cost = m
        ? (e.fixedCost ??
          Math.max(
            0,
            m.cost -
              active.costReduction -
              (e.costGrowth ?? 0) * (active.uses[m.id] ?? 0),
          ))
        : 0;
      return [
        ...one(kinds, [kind]),
        ...one(moves, m ? [m.id] : []),
        ...one(types, m ? [m.type] : []),
        bounded(m?.power, 150),
        bounded(cost, 10),
        bounded(e.heal),
        bounded(e.energy, 10),
        bounded(e.benchEnergy, 10),
        bounded(e.guard),
        bounded(e.nextAttack, 3),
        bounded(e.priority, 1000),
        ...combatFeatures(data,view,m,i),
        ...actor,
      ];
    });
    if (!mask.some(Boolean))
      throw Error("Live observation has no legal action");
    if (
      pets.some((p) => p.length !== schema.petDim) ||
      global.length !== schema.globalDim ||
      actions.some((a) => a.length !== schema.actionDim)
    )
      throw Error("Observation schema mismatch");
    return { pets, global, actions, mask };
  }
  function command(view, slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= ACTION_COUNT)
      throw Error("Invalid action slot");
    const value = slot < 4
      ? (view.own.pets[view.own.active] ? "move:" + view.own.pets[view.own.active].moves[slot].id : null)
      : slot === 4
        ? "focus"
        : slot === 11
          ? "wait"
          : "switch:" + (slot - 5);
    if (!view.legalActions.includes(value))
      throw Error("Masked action rejected before battle mutation");
    return value;
  }
  // Deliberately modest visible-only opponent. No exact damage or hidden stats.
  function rule(view, style = "attack") {
    const active = view.own.pets[view.own.active];
    const scores = Array.from({length: 12}, (_,i) => {
      const candidate = i<4 ? (active ? 'move:'+active.moves[i].id : null) : i===4 ? 'focus' : i===11 ? 'wait' : 'switch:'+(i-5);
      const valid=view.legalActions.includes(candidate);
      if (!valid) return -Infinity;
      if (i === 11) return 0;
      if (i >= 5) {
        const p = view.own.pets[i - 5];
        return view.phase === "battle"
          ? -1
          : p.hp / p.maxHp + Math.max(p.stats.atk, p.stats.spa) / 500;
      }
      if (i === 4) return ((10 - active.energy) / 10) * 0.6;
      const m = active.moves[i],
        effect = m.effect;
      return (
        (m.power ?? 0) / 150 -
        (m.cost ?? 0) / 100 +
        Math.min(1 - active.hp / active.maxHp, effect.heal ?? 0) +
        (style === "support"
          ? (effect.benchEnergy ?? 0) / 10 + (effect.energy ?? 0) / 20
          : 0)
      );
    });
    return scores.indexOf(Math.max(...scores));
  }
  return { schema, encode, command, rule };
}
