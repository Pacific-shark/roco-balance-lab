import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {candidateTeam,makeSplits,teamKey,gateReport,scoreRubric,validateObservation,runResearch,evaluateCandidate} from '../src/research.mjs';
import {seededRandom,trainTeams,TEAM_POLICY_PRIOR} from '../src/team-rl.mjs';
import {validateTeam} from '../src/team-engine.mjs';
const data=JSON.parse(await readFile(new URL('../public/data/team-2026-10-14.json',import.meta.url)));
const manifest=JSON.parse(await readFile(new URL('../public/data/research-readiness.json',import.meta.url)));
test('候选始终合法、保持六人，强制保留目标精灵',()=>{
 const rng=seededRandom(42);let parent=null;const keys=new Set();
 for(let i=0;i<100;i++){const t=candidateTeam(data,rng,{target:'pet_000028',parent});validateTeam(data,t.members);assert.equal(t.members.length,6);assert(t.members.some(m=>m.id==='pet_000028'));keys.add(teamKey(t.members));parent=t;}
 assert(keys.size>80);
});
test('训练、验证、测试配置独立且固定种子可复现',()=>{
 const split=makeSplits(data,42);assert.deepEqual(split,makeSplits(data,42));
 const keys=Object.values(split).flat().map(t=>teamKey(t.members));assert.equal(new Set(keys).size,keys.length);
});
test('未核准规则阻止正式强度判断',()=>{assert.equal(gateReport(manifest).level,'E0');assert.throws(()=>runResearch(data,manifest,{mode:'balance'}),/规则未核准/);});
test('个体分数缺项或不存在证据时不合成',()=>{
 const ratings={};for(const id of ['effective','decisions','recognition'])ratings[id]={value:4,reason:'有对应回放',evidenceIds:['e1']};
 assert.equal(scoreRubric('identity',ratings,['e1']).score,100);
 ratings.decisions.evidenceIds=['fake'];assert.equal(scoreRubric('identity',ratings,['e1']).score,null);
 assert.equal(scoreRubric('strength',{},[]).score,null);
});
test('拒绝 3v3、版本不明与缺失未知字段的录像标注',()=>{
 const good={mode:'6v6',patch:'S2',matchId:'m1',sourceUrl:'https://example.com/m1',events:[{turn:1,seconds:1,side:0,action:'聚能',unknown:[]}]};
 assert.equal(validateObservation(good).trainingReady,false);
 for(const patch of [{mode:'3v3'},{patch:''},{events:[{turn:1,seconds:1,side:0,action:'聚能'}]}])assert.throws(()=>validateObservation({...good,...patch}));
});
test('继续训练不修改初始模型，拒绝单支队伍',()=>{
 const initial=[{name:'A',weights:{...TEAM_POLICY_PRIOR}},{name:'B',weights:{...TEAM_POLICY_PRIOR}}],copy=structuredClone(initial);
 trainTeams(data,{episodes:100,seed:1,initialAgents:initial});assert.deepEqual(initial,copy);
 assert.throws(()=>trainTeams({...data,teams:data.teams.slice(0,1)},{episodes:100}));
});
test('完整流程包含留出评估、同预算对照与假想机制标签',()=>{
 const report=runResearch(data,manifest,{target:'pet_000028',seeds:[42],population:2,generations:1,episodes:100,adaptEpisodes:100,keep:1});
 assert.equal(report.mode,'method-validation');assert.equal(report.readiness.canPublishBalanceConclusion,false);
 const r=report.runs[0],row=r.reports[0];assert.equal(row.team.members.length,6);assert(row.test.battles>0);assert(row.traitExperiment.hypothetical);
 assert(row.comparisons.every(c=>c.budget===row.traitExperiment.budget&&c.team.members.length===6));
 const heldout=new Set(r.split.test.map(t=>teamKey(t.members)));assert(r.searchLog.every(g=>g.trainingKeys.every(k=>!heldout.has(k))));
 assert.equal(row.ratings&&Object.keys(row.ratings).length,0);
 const replay=evaluateCandidate(data,row.team,row.adaptedModel,r.background.map(x=>x.team),{referenceModel:row.adaptedModel,seed:94000,roles:[0]});
 assert.equal(replay.score,row.adapted.score);
 assert.equal(row.traitExperiment.model.focusTeamId,row.team.id);
});
