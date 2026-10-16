import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {capabilityCases,createCapabilityCase,capabilitySucceeded} from '../src/learning-capabilities.mjs';
import {stepTeamBattle,teamLegalActions} from '../src/team-engine.mjs';
import {createLearningBridge} from '../scripts/learning-bridge.mjs';
const data=JSON.parse(await readFile(new URL('../public/data/team-2026-10-14.json',import.meta.url)));

test('all 72 six-member probes have verified legal solutions in the actual engine',()=> {
  const cases=capabilityCases();assert.equal(cases.length,72);
  for(const spec of cases) {
    const probe=createCapabilityCase(data,spec);
    assert.ok(probe.state.sides.every(s=>s.pets.length===6&&s.pets.filter(p=>p.koCounted).length===3&&s.magic===1));
    for(const plan of probe.plans) {
      const state=structuredClone(probe.state);
      for(const own of plan) {
        assert.ok(teamLegalActions(data,state,spec.side).includes(own));
        const actions=[];actions[spec.side]=own;actions[1-spec.side]=probe.enemyAction;
        stepTeamBattle(data,state,actions);
      }
      assert.ok(capabilitySucceeded(probe,state));
    }
    if(spec.kind==='focus')assert.deepEqual(probe.expectedCommands,['focus']);
    if(spec.kind==='switch')assert.ok(probe.expectedCommands.every(a=>a.startsWith('switch:')));
  }
});

test('probe answers are separate from the policy observation and use explicit evaluation resets',async()=> {
  const bridge=await createLearningBridge();bridge.request({op:'init',envs:1,seed:42});
  assert.equal(bridge.request({op:'capabilities'}).cases.length,72);
  let current=bridge.request({op:'reset',options:{capability:{kind:'finish',side:0,variant:0,tieFirst:0}}});
  assert.deepEqual(Object.keys(current.observation[0]).sort(),['actions','global','mask','pets']);
  const result=bridge.request({op:'step',actions:[[current.probe.expectedSlots[0],current.probe.enemySlot]],autoReset:false})[0];
  assert.ok(result.probe.success);assert.ok(result.done);assert.equal(result.rewards[0],1);
  current=bridge.request({op:'reset'});assert.equal(current.probe,undefined);
});
