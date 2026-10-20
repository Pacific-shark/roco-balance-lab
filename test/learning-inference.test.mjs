import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningBridge} from '../scripts/learning-bridge.mjs';
import {createInferenceBridge} from '../scripts/inference-bridge.mjs';
import {teamKey} from '../src/research.mjs';
import {readFile} from 'node:fs/promises';
import {createReviewedProbe} from '../src/learning-probe-review.mjs';
import {stepTeamBattle,teamLegalActions} from '../src/team-engine.mjs';

test('frozen inference adapter exactly matches training observations and outcomes',async()=> {
 const training=await createLearningBridge(),research=await createInferenceBridge();
 const meta=training.request({op:'init',seed:42,envs:1,trainPool:32});
 assert.equal(meta.executionHash,research.request({op:'init'}).executionHash);
 let a=training.request({op:'reset',options:{split:'validation',a:0,b:1,tieFirst:0}});
 let b=research.request({op:'reset',teamA:meta.split.validation[0],teamB:meta.split.validation[1],tieFirst:0});
 for(let i=0;i<220;i++) {
  assert.deepEqual(a,b);
  const actions=a.rules.map(x=>x.attack);
  const x=training.request({op:'step',actions:[actions],autoReset:false})[0];
  const y=research.request({op:'step',actions});
  assert.equal(x.done,y.done);
  if(x.done){assert.equal(x.terminal.winner,y.terminal.winner);return;}
  a=x.next;b=y.next;
 }
 assert.fail('No terminal result');
});

test('reviewed focus probes make every switch an actual loss instead of a timeout penalty',async()=> {
 const data=JSON.parse(await readFile(new URL('../public/data/team-2026-10-14.json',import.meta.url)));
 for(let variant=0;variant<6;variant++)for(const side of [0,1])for(const tieFirst of [0,1]) {
  const probe=createReviewedProbe(data,{kind:'focus',variant,side,tieFirst});
  for(const action of teamLegalActions(data,probe.state,side).filter(a=>a!=='focus')) {
   const state=structuredClone(probe.state),pair=[];pair[side]=action;pair[1-side]=probe.enemyAction;
   stepTeamBattle(data,state,pair);assert.equal(state.winner,1-side);
  }
  for(const plan of probe.plans) {
   const state=structuredClone(probe.state);
   for(const action of plan){const pair=[];pair[side]=action;pair[1-side]=probe.enemyAction;stepTeamBattle(data,state,pair);}
   assert.equal(state.winner,side);
  }
 }
});

test('candidate generation retains target and excludes train, validation and test builds',async()=> {
 const bridge=await createInferenceBridge(),meta=bridge.request({op:'init'});
 const seen=new Set(Object.values(meta.split).flat().map(t=>teamKey(t.members)));
 const teams=bridge.request({op:'candidates',target:'pet_000028',count:6,seed:17026});
 for(const t of teams){assert.ok(t.members.some(m=>m.id==='pet_000028'));assert.ok(!seen.has(teamKey(t.members)));seen.add(teamKey(t.members));}
 assert.throws(()=>bridge.request({op:'candidates',target:'unknown'}));
 assert.throws(()=>bridge.request({op:'init',scope:'formal'}));
});
