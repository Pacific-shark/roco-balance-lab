import test from "node:test";
import assert from "node:assert/strict";
import {makePools,metadata,newEnvironment,observations,observe,advance,legalMap,ruleAction,SCHEMA,data,CANDIDATES} from "../src/kernel-learning.mjs";
import {createKernelBattle,addKernelMark} from "../src/battle-kernel.mjs";
const pools=makePools();
test("experimental admission is explicit and formal training stays blocked",()=>{
  const teams=[pools.train[0],pools.train[1]];
  assert.throws(()=>createKernelBattle(data,teams,{purpose:"experimental-training"}),/admission/);
  assert.throws(()=>createKernelBattle(data,teams,{purpose:"training"}),/admission/);
  const env=newEnvironment(teams);
  assert.equal(env.state.gameVerified,false);
  for(const t of env.state.teams)for(const p of t.pets)assert.equal(p.program.status,"compiled");
});
test("train, candidates, selection opponents and test builds are disjoint",()=>{
  const meta=metadata(pools), hashes=Object.values(meta.splitHashes).flat();
  assert.equal(new Set(hashes).size,hashes.length);
  assert.equal(meta.executableForms,CANDIDATES.length);
  assert.equal(meta.fullRosterAdmission,false);
  assert.deepEqual([...new Set(pools.train.flat().map((p)=>p.id))].sort(),CANDIDATES.map((r)=>r.id).sort());
  assert.ok(CANDIDATES.some((r)=>r.id==="pet_000071")); // 不死鸟 is now executable.
  for(const team of Object.values(pools).flat())assert.equal(new Set(team.map(p=>data.creatures[p.id].handbook_id)).size,6);
  assert.deepEqual(makePools(),pools);
});
test("different seasonal forms of one handbook entry cannot fill multiple team slots",()=>{
  const team=structuredClone(pools.train[0]);
  team[1]=structuredClone(team[0]);
  assert.throws(()=>newEnvironment([team,pools.train[1]]),/handbook/);
});
test("observation dimensions and legal indices remain consistent through a whole game",()=>{
  const env=newEnvironment([pools.train[0],pools.train[1]]);
  while(env.state.winner===null){
    const obs=observations(env);
    for(let s=0;s<2;s++){
      assert.equal(obs[s].pets.length,12);
      assert.ok(obs[s].pets.every((p)=>p.length===SCHEMA.petDim));
      assert.ok(obs[s].actions.every((p)=>p.length===SCHEMA.actionDim));
      assert.equal(obs[s].global.length,SCHEMA.globalDim);
      assert.equal(obs[s].mask.length,16);
      assert.equal(obs[s].mask.filter(Boolean).length,Object.keys(legalMap(env.state,s)).length);
      assert.ok([...obs[s].pets.flat(),...obs[s].actions.flat(),...obs[s].global].every(Number.isFinite));
    }
    advance(env,obs.map(ruleAction));
  }
  assert.ok(env.decisions<1000);
});
test("unseen opponents and private cultivation/move choices do not leak",()=>{
  const env=newEnvironment([pools.train[0],pools.train[1]]);
  const before=observations(env)[0];
  assert.ok(before.pets.slice(6).flat().every((x)=>x===0));
  const hidden=env.state.teams[1].pets[0];
  hidden.stats.atk+=999; hidden.moves.reverse();
  assert.deepEqual(observe(env,0),before);
  advance(env,[9,9]);
  const activeBefore=observations(env)[0];
  env.state.teams[1].pets[0].stats.atk+=999;
  env.state.teams[1].pets[0].moves.reverse();
  assert.deepEqual(observations(env)[0],activeBefore);
});
test("last-seen bench HP does not update from hidden bench changes",()=>{
  const env=newEnvironment([pools.train[0],pools.train[1]]);
  advance(env,[9,9]);advance(env,[8,10]);
  const before=observations(env)[0].pets[6];
  env.state.teams[1].pets[0].hp=1;
  assert.deepEqual(observations(env)[0].pets[6],before);
});
test("invalid actions cannot partially mutate a battle",()=>{
  const env=newEnvironment([pools.train[0],pools.train[1]]),saved=JSON.stringify(env.state);
  assert.throws(()=>advance(env,[9,0]),/Illegal/);
  assert.equal(JSON.stringify(env.state),saved);
});
test("public mark identity and layers reach the observation, and weather remains distinct",()=>{
  const env=newEnvironment([pools.train[0],pools.train[1]]);
  const before=observations(env)[0];
  addKernelMark(env.state,0,"湿润",2,{kind:"test"});
  const wet=observations(env)[0];
  assert.equal(wet.global[15],0.4);
  assert.notDeepEqual(wet.global,before.global);
  addKernelMark(env.state,0,"光合",2,{kind:"test"});
  const photosynthesis=observations(env)[0];
  assert.equal(photosynthesis.global[15],0.4);
  assert.notDeepEqual(photosynthesis.global,wet.global);
  env.state.weather="暴风雪";
  assert.equal(observations(env)[0].global[11],1);
});
