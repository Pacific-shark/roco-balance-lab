import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTeamBattle, stepTeamBattle, activePet } from '../src/team-engine.mjs';
import { createPilotMemory, pilotObservation, rememberPilotStep, stepWithPilotObservations } from '../src/pilot-observation.mjs';
import { pilotAdmission, assertPilotAdmission } from '../src/pilot-admission.mjs';

const data = JSON.parse(await readFile(new URL('../public/data/team-2026-10-14.json', import.meta.url), 'utf8'));
const team = id => data.teams.find(t => t.id === id).members;
function battle() { return createTeamBattle(data, team('balanced'), team('fire')); }
function started() {
  const state = battle(), memory = createPilotMemory(0);
  rememberPilotStep(memory, stepTeamBattle(data, state, ['switch:0', 'switch:0']), state);
  return { state, memory };
}

test('unseen reserve species, exact stats, moves and latent resources do not affect observations', () => {
  const { state, memory } = started();
  const changed = structuredClone(state);
  const hidden = changed.sides[1].pets[1];
  hidden.id = 'not-yet-seen'; hidden.name = 'HIDDEN'; hidden.energy = 0; hidden.hp = 1;
  hidden.stats.atk = 9999; hidden.moves.reverse();
  const active = activePet(changed, 1);
  active.stats.atk = 9999; active.build.nature = 'HIDDEN'; active.moves.reverse();
  const a = pilotObservation(data, state, 0, structuredClone(memory));
  const b = pilotObservation(data, changed, 0, structuredClone(memory));
  assert.deepEqual(a, b);
  assert.equal(a.opponent.known.length, 1);
  assert.deepEqual(a.opponent.known[0].revealedMoves, []);
  assert.ok(!JSON.stringify(b).includes('HIDDEN'));
});

test('initial choice does not reveal either opposing lineup or active slot', () => {
  const state = battle(), view = pilotObservation(data, state, 0, createPilotMemory(0));
  assert.equal(view.opponent.activeEncounter, null);
  assert.equal(view.opponent.unknownMembers, 6);
  assert.deepEqual(view.opponent.known, []);
  assert.equal(view.legalActions.length, 6);
});

test('only executed moves are revealed; submitted but cancelled instructions remain hidden', () => {
  const { state, memory } = started();
  const p = activePet(state, 1), id = p.moves[0];
  // Explicit replay fixture: actions are internal commitments, not public executed events.
  rememberPilotStep(memory, { round: 1, actions: ['focus', `move:${id}`], events: [] }, state);
  assert.deepEqual(memory.encounters[0].revealedMoves, []);
  rememberPilotStep(memory, { round: 1, events: [{ kind: 'move', side: 1, actor: p.id, move: id,
    formula: { secret: true }, text: 'SECRET', before: { secret: 9 } }] }, state);
  const view = pilotObservation(data, state, 0, memory);
  assert.deepEqual(view.opponent.known[0].revealedMoves, [id]);
  assert.ok(!JSON.stringify(view).includes('SECRET'));
  assert.ok(!JSON.stringify(view).includes('formula'));
});

test('revealed moves retain discovery order without exposing private skill slot order', () => {
  const { state, memory } = started(), p = activePet(state, 1);
  const ids = [p.moves[2], p.moves[0]];
  rememberPilotStep(memory, { round: 1, events: ids.map(move => ({kind:'move',side:1,actor:p.id,move})) }, state);
  assert.deepEqual(pilotObservation(data, state, 0, memory).opponent.known[0].revealedMoves, ids);
});

test('an already seen benched opponent retains last observation, not omniscient updates', () => {
  const { state, memory } = started();
  rememberPilotStep(memory, stepTeamBattle(data, state, ['focus','switch:1']), state);
  const a = pilotObservation(data, state, 0, structuredClone(memory));
  state.sides[1].pets[0].hp = 1; state.sides[1].pets[0].energy = 0;
  const b = pilotObservation(data, state, 0, structuredClone(memory));
  assert.deepEqual(a,b);
  assert.equal(a.opponent.known.length,2);
});

test('policy input is detached; commands are chosen from simultaneous pre-action views', () => {
  const state = battle(), memories = [createPilotMemory(0),createPilotMemory(1)];
  const observed = [];
  stepWithPilotObservations(data,state,memories,[
    v=> { observed.push(v.opponent.known.length); v.own.pets[0].hp=0; return 'switch:0'; },
    v=> { observed.push(v.opponent.known.length); return 'switch:0'; },
  ]);
  assert.deepEqual(observed,[0,0]); assert.ok(activePet(state,0).hp>0);
});

test('secret current action and future random fields cannot reach policy input', () => {
  const { state,memory }=started(), a=pilotObservation(data,state,0,structuredClone(memory));
  state.pendingCommands=['focus','SECRET']; state.futureRandom=[0.999]; state.tieFirst=1;
  assert.deepEqual(a,pilotObservation(data,state,0,structuredClone(memory)));
});

test('admission fails closed on missing checks, forged flag, and unsupported targets', () => {
  assert.equal(pilotAdmission({trainingAllowed:true,checks:[],targets:[]}).trainingAllowed,false);
  assert.throws(()=>assertPilotAdmission({trainingAllowed:true}), {code:'PILOT_NOT_READY'});
});

test('passing check labels without evidence cannot authorize training', () => {
  const ids=['current-version','legal-roster-and-builds','panel-and-damage','mechanism-closure','observations','policy-capability','evaluation-protocol'];
  const manifest={checks:ids.map(id=>({id,status:'passed'})),targets:[{id:'target',classification:'highest-normal-candidate',legalPvpStatus:'verified',missingMoveIds:[],dynamicClosureStatus:'verified',jointBuildLegality:'verified'}]};
  assert.equal(pilotAdmission(manifest).blockers.filter(x=>x.reason==='passed-without-evidence').length,7);
  for(const row of manifest.checks)row.evidence=['test-fixture'];
  assert.equal(pilotAdmission(manifest).trainingAllowed,true);
  manifest.checks.push(manifest.checks[0]);
  assert.equal(pilotAdmission(manifest).trainingAllowed,false);
});
