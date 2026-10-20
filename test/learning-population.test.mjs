import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {expandTrainingPopulation} from '../src/learning-population.mjs';
import {createLearningBridge} from '../scripts/learning-bridge.mjs';
import {teamKey} from '../src/research.mjs';
import {validateTeam} from '../src/team-engine.mjs';
import {combatFeatures,combatFeatureNames} from '../src/learning-features.mjs';
import {createTeamBattle,stepTeamBattle} from '../src/team-engine.mjs';
import {createPilotMemory,pilotObservation} from '../src/pilot-observation.mjs';
const data=JSON.parse(await readFile(new URL('../public/data/team-2026-10-14.json',import.meta.url)));

test('expanded training population is fixed, legal and excludes both held-out splits',async()=> {
 const bridge=await createLearningBridge();const {split}=bridge.request({op:'init',seed:42,envs:1});
 const expanded=expandTrainingPopulation(data,split,32);
 assert.equal(expanded.length,32);assert.equal(new Set(expanded.map(t=>teamKey(t.members))).size,32);
 assert.deepEqual(expanded,expandTrainingPopulation(data,split,32));
 const held=new Set([...split.validation,...split.test].map(t=>teamKey(t.members)));
 for(const t of expanded){validateTeam(data,t.members);assert.ok(!held.has(teamKey(t.members)));}
 assert.equal(split.train.length,4);
 assert.throws(()=>expandTrainingPopulation(data,split,1000));
});

test('combat descriptors expose known rule interactions without private opponent panels',()=> {
 const state=createTeamBattle(data,data.teams[0].members,data.teams[1].members);
 stepTeamBattle(data,state,['switch:1','switch:1']);
 const view=pilotObservation(data,state,0,createPilotMemory(0));
 const move=view.own.pets[1].moves[1];
 const f=combatFeatures(data,view,move,1);
 assert.equal(f.length,combatFeatureNames.length);
 assert.ok(f.every(Number.isFinite));
 const power=f[combatFeatureNames.indexOf('attackPressure')];
 assert.ok(power>0);
 const unknown=structuredClone(view);unknown.opponent.known=[];unknown.opponent.activeEncounter=null;
 assert.equal(combatFeatures(data,unknown,move,1)[5],0);
 const changed=structuredClone(view);changed.own.pets[1].stats.atk*=2;
 assert.equal(combatFeatures(data,changed,move,1)[7],power*2);
 assert.equal(combatFeatures(data,view,null,4).at(-1),0);
 view.own.pets[1].energy=0;
 assert.equal(combatFeatures(data,view,null,4).at(-1),1);
});
