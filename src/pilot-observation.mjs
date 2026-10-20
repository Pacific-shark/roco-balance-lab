import { activePet, teamLegalActions, stepTeamBattle } from './team-engine.mjs';

// This is a conservative engineering protocol, not a certified current-PVP UI map.
export const PILOT_OBSERVATION_VERSION = 'pilot-visible-v1-provisional';
export const PILOT_OBSERVATION_LIMITATIONS = Object.freeze([
  'Opponent reserve identities and unused moves stay hidden.',
  'Only the active opponent HP ratio and energy are refreshed; bench values are last seen.',
  'Exact player-visible gauges and reveal effects still require current-PVP footage.',
  'Opponent support/trait log details are omitted until their visibility is verified.',
]);

function checkSide(side) {
  if (side !== 0 && side !== 1) throw new Error('Invalid observer side');
}

export function createPilotMemory(side) {
  checkSide(side);
  return { version: PILOT_OBSERVATION_VERSION, side, encounters: [], history: [] };
}

function encounter(memory, id) {
  let item = memory.encounters.find(x => x.id === id);
  if (!item) {
    item = { encounter: memory.encounters.length, id, revealedMoves: [], lastSeen: null };
    memory.encounters.push(item);
  }
  return item;
}

function visiblePet(p, round) {
  return { id: p.id, name: p.name, types: [...p.types],
    hpRatio: p.maxHp > 0 ? p.hp / p.maxHp : 0, energy: p.energy,
    fainted: p.hp <= 0, round };
}

// Only completed, visible actions are projected. Never copy events, free-form text,
// formula traces or `actions` from the internal replay into the policy input.
export function rememberPilotStep(memory, step, state) {
  checkSide(memory.side);
  const opponent = 1 - memory.side;
  for (const e of step?.events ?? []) {
    if (e.side !== opponent) continue;
    if (e.kind === 'switch') {
      const item = encounter(memory, e.to);
      memory.history.push({ kind: 'appearance', encounter: item.encounter, id: item.id, round: step.round });
    } else if (['move', 'focus', 'ko'].includes(e.kind)) {
      const id = e.actor ?? e.id;
      const item = memory.encounters.find(x => x.id === id);
      if (!item) throw new Error('Action without a public appearance');
      if (e.kind === 'move' && !item.revealedMoves.includes(e.move)) item.revealedMoves.push(e.move);
      memory.history.push({ kind: e.kind, encounter: item.encounter, round: step.round,
        ...(e.kind === 'move' ? { move: e.move } : {}) });
    }
  }
  const p = activePet(state, opponent);
  if (p) encounter(memory, p.id).lastSeen = visiblePet(p, state.round);
  return memory;
}

export function pilotObservation(data, state, side, memory) {
  checkSide(side);
  if (memory.side !== side || memory.version !== PILOT_OBSERVATION_VERSION)
    throw new Error('Observation memory mismatch');
  const own = state.sides[side];
  const enemy = activePet(state, 1 - side);
  // Newly visible appearances are synced before a decision. Hidden reserves are never traversed.
  if (enemy) encounter(memory, enemy.id).lastSeen = visiblePet(enemy, state.round);
  return structuredClone({
    version: PILOT_OBSERVATION_VERSION, round: state.round, phase: state.phase,
    own: {
      active: own.active, magic: own.magic,
      pets: own.pets.map(p => ({ id: p.id, name: p.name, types: [...p.types], hp: p.hp, maxHp: p.maxHp,
        energy: p.energy, stats: { ...p.stats }, build: structuredClone(p.build), trait: p.trait,
        boosts: { ...p.boosts }, uses: { ...p.uses }, nextAttack: p.nextAttack,
        guard: p.guard, defenseCooldown: p.defenseCooldown, costReduction: p.costReduction,
        powerBonus: p.powerBonus, everEntered: p.everEntered,
        moves: p.moves.map(id => ({ ...data.moves[id] })) })),
    },
    opponent: {
      magic: state.sides[1 - side].magic,
      activeEncounter: enemy ? memory.encounters.find(x => x.id === enemy.id).encounter : null,
      unknownMembers: 6 - memory.encounters.length,
      known: memory.encounters.map(x => ({ ...x, revealedMoves: [...x.revealedMoves] })),
    },
    history: memory.history.map(x => ({ ...x })),
    legalActions: teamLegalActions(data, state, side),
  });
}

// Future strategies must implement policy(observation), not policy(data, fullState, side).
// Both observations are constructed before either policy is called or the engine advances.
export function stepWithPilotObservations(data, state, memories, policies) {
  if (policies.length !== 2 || memories.length !== 2) throw new Error('Two observers and policies required');
  const views = [0, 1].map(side => pilotObservation(data, state, side, memories[side]));
  const actions = policies.map((policy, side) => policy(structuredClone(views[side])));
  for (let side = 0; side < 2; side++)
    if (!views[side].legalActions.includes(actions[side])) throw new Error('Policy returned an illegal action');
  const step = stepTeamBattle(data, state, actions);
  for (let side = 0; side < 2; side++) rememberPilotStep(memories[side], step, state);
  return { views, actions, step };
}
