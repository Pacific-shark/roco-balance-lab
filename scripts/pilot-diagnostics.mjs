import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { createTeamBattle, stepTeamBattle, TEAM_RULE_VERSION } from '../src/team-engine.mjs';
import { teamFeatures, seededRandom } from '../src/team-rl.mjs';
import { createPilotMemory, pilotObservation, stepWithPilotObservations, PILOT_OBSERVATION_VERSION } from '../src/pilot-observation.mjs';
import { pilotAdmission } from '../src/pilot-admission.mjs';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const data = await read('../public/data/team-2026-10-14.json');
const manifest = await read('../public/data/pilot-manifest.json');
const admission = pilotAdmission(manifest);
const state = createTeamBattle(data, data.teams[0].members, data.teams[2].members);
stepTeamBattle(data, state, ['switch:0', 'switch:0']);
const altered = structuredClone(state);
altered.sides[1].pets[1].energy = 0;
altered.sides[1].pets[1].hp = 1;
const rawA = teamFeatures(data, state, 0, 'focus'), rawB = teamFeatures(data, altered, 0, 'focus');
const fullStateFeatureLeaks = Object.keys(rawA).filter(k => rawA[k] !== rawB[k]);
const a = pilotObservation(data, state, 0, createPilotMemory(0));
const b = pilotObservation(data, altered, 0, createPilotMemory(0));
if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Hidden-state invariant failed');

// A bounded throughput/integration smoke check, not learning or strength evaluation.
const started = performance.now();
const seeds = [42, 137, 256];
const rows = [];
let steps = 0, peakRss = process.memoryUsage().rss;
for (const seed of seeds) {
  const rngs = [seededRandom(seed), seededRandom(seed + 1000)];
  for (let i = 0; i < 12; i++) {
    const left = i % data.teams.length, right = (left + 1 + Math.floor(i / 4)) % data.teams.length;
    const s = createTeamBattle(data, data.teams[left].members, data.teams[right].members, { tieFirst: i % 2 });
    const memory = [createPilotMemory(0), createPilotMemory(1)];
    const policies = rngs.map(rng => view => view.legalActions[Math.floor(rng() * view.legalActions.length)]);
    let decisions = 0;
    while (s.winner === null) {
      stepWithPilotObservations(data, s, memory, policies);
      steps++; decisions++;
      if (decisions > 1000) throw new Error('Diagnostic decision guard exceeded');
    }
    rows.push({ seed, case: i, decisions, rounds: s.round - 1,
      termination: s.winner === 'draw' ? 'prototype-round-cap' : 'prototype-terminal',
      leftKnown: memory[0].encounters.length, rightKnown: memory[1].encounters.length });
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
}
const elapsedMs = performance.now() - started;
const hashes = {};
for (const file of ['../src/team-engine.mjs','../src/pilot-observation.mjs','../src/pilot-admission.mjs','../public/data/team-2026-10-14.json'])
  hashes[file.slice(3)] = createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex');
const result = {
  version:'pilot-engineering-diagnostics-v1', createdAt:new Date().toISOString(),
  stage:'A-inventory-and-B-engineering-checks; C-training-blocked',
  formalTrainingRuns:0, llmCallsInDiagnosticLoop:0, strengthConclusionsAllowed:false,
  admission, sourceDeclaredVersion:manifest.sourceDeclaredVersion,
  simulatorDataVersion:data.version, simulatorRules:TEAM_RULE_VERSION,
  observationProtocol:PILOT_OBSERVATION_VERSION,
  hiddenStateAudit:{fullStateFeatureLeaks, isolatedViewsEqual:true,
    note:'A synthetic paired-state information-flow test, not validation of live-game visibility.'},
  smoke:{seeds,games:rows.length,decisions:steps,elapsedMs,decisionsPerSecond:steps/(elapsedMs/1000),
    prototypeCapTerminations:rows.filter(r=>r.termination==='prototype-round-cap').length,
    peakRssBytes:peakRss,rows,
    note:'Uniform legal-action policies; no parameter updates, no win-rate ranking, old bounded mechanics only.'},
  machine:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length},
  sourceHashes:hashes,
};
await writeFile(new URL('../docs/evidence/pilot-diagnostics.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({stage:result.stage,trainingAllowed:admission.trainingAllowed,blockers:admission.blockers.length,
  hiddenStateAudit:result.hiddenStateAudit,smoke:{...result.smoke,rows:undefined},formalTrainingRuns:0},null,2));
