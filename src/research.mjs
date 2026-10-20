import {seededRandom,trainTeams,teamLearnedPolicy,teamRulePolicy,TEAM_POLICY_PRIOR} from './team-rl.mjs';
import {validateTeam,runTeamBattle,TEAM_RULE_VERSION} from './team-engine.mjs';
import {NATURES,STAT_KEYS,IV_VALUES,presetBuild} from './team-stats.mjs';

export const RESEARCH_VERSION='individual-in-team-1';
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const pick=(xs,rng)=>xs[Math.floor(rng()*xs.length)];
function shuffle(xs,rng){const a=[...xs];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export const teamKey=members=>JSON.stringify(members.map(m=>({id:m.id,moves:[...m.moves],nature:m.nature,ivs:STAT_KEYS.map(k=>m.ivs[k])})).sort((a,b)=>a.id.localeCompare(b.id)));
const shortId=value=>{let h=2166136261;for(const x of value)h=Math.imul(h^x.charCodeAt(0),16777619);return (h>>>0).toString(16);};
const int=(n,min,max,name)=>{if(!Number.isInteger(n)||n<min||n>max)throw Error(name+' 超出允许范围');return n;};

export function randomMember(data,id,rng){
 const c=data.creatures[id];if(!c||c.pool.length<4)throw Error('机制或合法技能不足');
 const boosted=new Set(shuffle(STAT_KEYS,rng).slice(0,1+Math.floor(rng()*3)));
 return {id,moves:shuffle(c.pool.filter(m=>data.moves[m]),rng).slice(0,4),nature:pick(Object.keys(NATURES),rng),ivs:Object.fromEntries(STAT_KEYS.map(k=>[k,boosted.has(k)?pick(IV_VALUES.filter(x=>x>0),rng):0]))};
}
export function candidateTeam(data,rng,{target=null,parent=null}={}){
 const ids=Object.keys(data.creatures).filter(id=>data.creatures[id].pool.filter(m=>data.moves[m]).length>=4);
 if(ids.length<6||target&&!ids.includes(target))throw Error('当前机制子集无法组成研究队伍');
 let members;
 if(parent){
  members=structuredClone(parent.members);const slots=members.map((_,i)=>i).filter(i=>members[i].id!==target);
  const slot=pick(slots,rng),unused=ids.filter(id=>!members.some(m=>m.id===id));
  if(unused.length&&rng()<0.5)members[slot]=randomMember(data,pick(unused,rng),rng);
  else {const change=pick(members.map((_,i)=>i),rng);members[change]=randomMember(data,members[change].id,rng);}
 }else{
  const chosen=target?[target,...shuffle(ids.filter(id=>id!==target),rng).slice(0,5)]:shuffle(ids,rng).slice(0,6);
  members=chosen.map(id=>randomMember(data,id,rng));
 }
 validateTeam(data,members);const key=teamKey(members);
 return {id:'search-'+shortId(key),name:target?'目标精灵配队':'自由配队',members};
}
function uniqueTeams(data,rng,count,{target=null,parents=[],excluded=new Set()}={}){
 const out=[],seen=new Set(excluded);let tries=0;
 while(out.length<count&&tries++<count*100){const t=candidateTeam(data,rng,{target,parent:parents.length&&rng()<.7?pick(parents,rng):null});const k=teamKey(t.members);if(!seen.has(k)){seen.add(k);out.push(t);}}
 if(out.length<count)throw Error('无法生成足够的独立队伍配置');return out;
}
export function makeSplits(data,seed){
 const rng=seededRandom(seed),train=structuredClone(data.teams),excluded=new Set(train.map(t=>teamKey(t.members)));
 const validation=uniqueTeams(data,rng,2,{excluded});validation.forEach(t=>excluded.add(teamKey(t.members)));
 const test=uniqueTeams(data,rng,2,{excluded});
 const sets=[train,validation,test].map(ts=>new Set(ts.map(t=>teamKey(t.members))));
 if(sets.some((s,i)=>sets.some((t,j)=>i<j&&[...s].some(k=>t.has(k)))))throw Error('训练与评估配置重叠');
 return {train,validation,test};
}
export function gateReport(manifest){
 const blockers=(manifest?.rules||[]).filter(r=>r.critical&&r.status!=='verified').map(r=>r.label);
 if(!manifest?.rules?.length)blockers.push('缺少规则清单');
 if(manifest?.information!=='player-visible-verified')blockers.push('当前策略可见完整实验阵容，尚未校准实战信息边界');
 return {level:blockers.length?'E0':'E1',blockers,canPublishBalanceConclusion:false};
}

export function evaluateCandidate(data,team,model,opponents,{referenceModel=model,seed=90000,patch=null,record=false,roles=[0,1]}={}){
 const rows=[];
 for(let oi=0;oi<opponents.length;oi++)for(const role of roles)for(const seat of [0,1])for(const tieFirst of [0,1]){
  const opponent=opponents[oi],s=seed+oi*100+role*20+seat*4+tieFirst;
  const own=teamLearnedPolicy(data,model.agents[role],s),enemy=opponent.policy==='tactical'?teamRulePolicy(data,'tactical'):teamLearnedPolicy(data,referenceModel.agents[1-role],s+1);
  const left=seat===0?team:opponent,right=seat===0?opponent:team;
  const r=runTeamBattle(data,left.members,right.members,seat===0?[own,enemy]:[enemy,own],{tieFirst,patch:patch?{...patch,side:seat}:null,record:record&&oi===0&&role===0&&seat===0&&tieFirst===0});
  rows.push({opponent:opponent.id,policy:opponent.policy||'frozen-learned',role,seat,tieFirst,seed:s,score:seat===0?r.score:1-r.score,rounds:r.state.round-1,...(r.trace?.length?{trace:r.trace}:{})});
 }
 const byOpponent=opponents.map(o=>({id:o.id,score:mean(rows.filter(r=>r.opponent===o.id).map(r=>r.score))}));
 return {score:mean(byOpponent.map(o=>o.score)),wins:rows.filter(r=>r.score===1).length,draws:rows.filter(r=>r.score===.5).length,battles:rows.length,byOpponent,rows};
}
function diverse(rows,count){
 const selected=[];
 for(const row of [...rows].sort((a,b)=>b.validation.score-a.validation.score)){
  const ids=new Set(row.team.members.map(m=>m.id));
  if(!selected.length||selected.every(s=>s.team.members.filter(m=>ids.has(m.id)).length<=4))selected.push(row);
  if(selected.length===count)break;
 }
 return selected;
}
export const RUBRIC={
 strength:{label:'竞技强度',items:[['ceiling','有效队伍上限',.3],['contribution','个体边际贡献',.45],['robustness','优势稳健性',.25]]},
 fit:{label:'配队适应',items:[['coverage','体系覆盖',.4],['partners','搭档替代能力',.35],['matchups','对位覆盖',.25]]},
 identity:{label:'玩法特色',items:[['effective','机制有效作用',.3],['decisions','决策改变',.4],['recognition','玩家可辨识',.3]]},
 alignment:{label:'定位一致性',items:[['behavior','目标行为',.4],['tradeoff','收益代价',.35],['role','队伍角色',.25]]},
 health:{label:'对战健康度',items:[['counters','反制可获得性',.4],['cost','收益代价相称',.35],['choice','选择空间',.25]]}
};
export function scoreRubric(dimension,ratings,evidenceIds){
 const rubric=RUBRIC[dimension];if(!rubric)throw Error('评价维度无效');
 if(['strength','fit'].includes(dimension))return {score:null,reason:'需要同版本、同角色参考样本，当前只展示原始值'};
 const missing=rubric.items.filter(([id])=>!ratings?.[id]||!Number.isInteger(ratings[id].value)||ratings[id].value<0||ratings[id].value>4||!ratings[id].reason?.trim()||!ratings[id].evidenceIds?.length||!ratings[id].evidenceIds.every(e=>evidenceIds.includes(e)));
 return missing.length?{score:null,missing:missing.map(x=>x[0])}:{score:25*rubric.items.reduce((n,[id,,w])=>n+ratings[id].value*w,0),status:'human-review',ratings};
}
export function validateObservation(row){
 if(!row||row.mode!=='6v6'||!row.patch||!row.sourceUrl||!/^https:\/\//.test(row.sourceUrl)||!row.matchId||!Array.isArray(row.events))throw Error('录像需要 6v6、版本、场次编号、HTTPS 来源及事件列表');
 for(const e of row.events)if(!Number.isInteger(e.turn)||e.turn<1||!Number.isFinite(e.seconds)||e.seconds<0||![0,1].includes(e.side)||typeof e.action!=='string'||!Array.isArray(e.unknown))throw Error('事件需有回合、时间戳、行动方、动作与未知字段列表');
 return {...row,status:'annotation-unverified',trainingReady:false};
}

export function runResearch(data,manifest,options={},onProgress=()=>{}){
 const cfg={target:Object.keys(data.creatures)[0],seeds:[42,137,256],population:4,generations:2,episodes:100,adaptEpisodes:100,keep:2,...options};
 int(cfg.population,2,12,'每方候选数');int(cfg.generations,1,6,'搜索轮数');int(cfg.episodes,100,5000,'训练局数');int(cfg.adaptEpisodes,100,2000,'适应局数');int(cfg.keep,1,3,'保留队伍');
 if(!Array.isArray(cfg.seeds)||!cfg.seeds.length||cfg.seeds.length>5||new Set(cfg.seeds).size!==cfg.seeds.length||cfg.seeds.some(s=>!Number.isInteger(s)||s<0))throw Error('需要 1—5 个不同非负训练种子');
 if(!data.creatures[cfg.target])throw Error('目标精灵尚未接入机制');
 const readiness=gateReport(manifest);if(cfg.mode==='balance'&&readiness.blockers.length)throw Error('规则未核准，不能运行正式强度判断');
 const started=Date.now(),runs=[];
 for(const seed of cfg.seeds){
  const rng=seededRandom(seed),split=makeSplits(data,seed+700000),excluded=new Set([...split.validation,...split.test].map(t=>teamKey(t.members)));
  let targetTeams=uniqueTeams(data,rng,cfg.population,{target:cfg.target,excluded}),freeTeams=uniqueTeams(data,rng,cfg.population,{excluded}),model=null,selected=[],background=[],searchLog=[];
  const referenceModel=trainTeams({...data,teams:split.train},{seed:seed+10000,episodes:cfg.episodes});
  const validationOpponents=split.validation.map(t=>({...t,policy:'tactical'}));
  const baseline=mean(data.teams.filter(t=>t.members.some(m=>m.id===cfg.target)).map(team=>evaluateCandidate(data,team,referenceModel,validationOpponents,{referenceModel}).score));
  for(let generation=0;generation<cfg.generations;generation++){
   const trainingTeams=[...targetTeams,...freeTeams];
   for(const t of trainingTeams)if(excluded.has(teamKey(t.members)))throw Error('留出配置进入了训练');
   model=trainTeams({...data,teams:trainingTeams},{seed:seed+generation*101,episodes:cfg.episodes,initialAgents:model?.agents,onProgress:p=>onProgress({phase:'train',seed,generation:generation+1,episode:p.episode,total:cfg.episodes})});
   const rank=teams=>teams.map(team=>({team,validation:evaluateCandidate(data,team,model,validationOpponents,{referenceModel,seed:81000})}));
   const targetRank=rank(targetTeams),freeRank=rank(freeTeams);
   selected=diverse(targetRank,cfg.keep);background=diverse(freeRank,cfg.keep);
   searchLog.push({generation:generation+1,trainingKeys:trainingTeams.map(t=>teamKey(t.members)),target:targetRank.map(r=>({id:r.team.id,score:r.validation.score})),free:freeRank.map(r=>({id:r.team.id,score:r.validation.score})),episodes:cfg.episodes});
   onProgress({phase:'search',seed,generation:generation+1,best:selected[0].validation.score});
   if(generation+1<cfg.generations){
    targetTeams=[...selected.map(x=>x.team),...uniqueTeams(data,rng,cfg.population-selected.length,{target:cfg.target,parents:selected.map(x=>x.team),excluded:new Set([...excluded,...selected.map(x=>teamKey(x.team.members))])})];
    freeTeams=[...background.map(x=>x.team),...uniqueTeams(data,rng,cfg.population-background.length,{parents:background.map(x=>x.team),excluded:new Set([...excluded,...background.map(x=>teamKey(x.team.members))])})];
   }
  }
  const heldout=split.test.map(t=>({...t,policy:'tactical'})),optimizedOpponents=background.map(x=>x.team);
  const reports=[];
  for(const [index,row] of selected.entries()){
   onProgress({phase:'individual',seed,index:index+1,total:selected.length});
   const test=evaluateCandidate(data,row.team,model,heldout,{referenceModel,seed:92000,record:index===0});
   const competitive=evaluateCandidate(data,row.team,model,optimizedOpponents,{referenceModel:model,seed:93000});
   const initial={agents:[{weights:{...TEAM_POLICY_PRIOR}},{weights:{...TEAM_POLICY_PRIOR}}]};
   const initialTest=evaluateCandidate(data,row.team,initial,heldout,{referenceModel,seed:92000});
   const adaptationData=team=>({...data,teams:[team,...optimizedOpponents]});
   const adapt=(team,patch=null)=>trainTeams(adaptationData(team),{initialAgents:model.agents,focusTeamId:team.id,episodes:cfg.adaptEpisodes,seed:seed+44000+index,patch});
   const baseModel=adapt(row.team),adapted=evaluateCandidate(data,row.team,baseModel,optimizedOpponents,{referenceModel:baseModel,seed:94000,roles:[0]});
   const slot=row.team.members.findIndex(m=>m.id===cfg.target);
   const replacements=Object.keys(data.creatures).filter(id=>!row.team.members.some(m=>m.id===id)).slice(0,2);
   const comparisons=[];
   for(const replacement of replacements){
    const member={id:replacement,moves:data.creatures[replacement].pool.slice(0,4),...presetBuild(data.creatures[replacement])};
    const changed={...row.team,id:row.team.id+'-replace-'+replacement,members:row.team.members.map((m,i)=>i===slot?member:m)};validateTeam(data,changed.members);
    const replacementModel=adapt(changed),evaluation=evaluateCandidate(data,changed,replacementModel,optimizedOpponents,{referenceModel:replacementModel,seed:94000,roles:[0]});
    comparisons.push({kind:'replacement',replacement,roleReviewed:false,team:changed,model:replacementModel,score:evaluation.score,delta:adapted.score-evaluation.score,evaluation,budget:cfg.adaptEpisodes,label:'候选替换，角色与配置尚需审核；其余五位固定'});
   }
   const patch={side:0,disableTrait:cfg.target};
   const frozen=evaluateCandidate(data,row.team,model,optimizedOpponents,{referenceModel:model,seed:93000,patch});
   const patchedModel=adapt(row.team,patch),retrained=evaluateCandidate(data,row.team,patchedModel,optimizedOpponents,{referenceModel:patchedModel,seed:94000,patch,roles:[0]});
   reports.push({id:`${seed}:${row.team.id}`,team:row.team,validation:row.validation,qualifiedOnValidation:baseline!==null&&row.validation.score>baseline,baselineValidation:baseline,test,competitive,initialTest,learningDelta:test.score-initialTest.score,adapted,adaptedModel:baseModel,comparisons,traitExperiment:{hypothetical:true,patch,frozenDelta:competitive.score-frozen.score,adaptedDelta:adapted.score-retrained.score,frozen,retrained,model:patchedModel,budget:cfg.adaptEpisodes},ratings:{},evidenceIds:['test:'+seed+':'+index,'replacement:'+seed+':'+index,'trait:'+seed+':'+index]});
  }
  runs.push({seed,split,searchLog,model,referenceModel,background:background.map(x=>({team:x.team,validationScore:x.validation.score})),reports});
 }
 const reports=runs.flatMap(r=>r.reports),deltas=reports.flatMap(r=>r.comparisons.map(c=>c.delta));
 return {version:RESEARCH_VERSION,createdAt:new Date().toISOString(),private:true,mode:'method-validation',dataVersion:data.version,rules:TEAM_RULE_VERSION,config:cfg,readiness,scope:'机制子集、完整信息实验；不构成游戏精灵强度结论。培养配招为有限搜索，替换对照尚未全队重优化。',algorithm:'outer-population-search + independent-policy-gradient-team-v2',summary:{seedCount:runs.length,teams:reports.length,qualifiedTeams:reports.filter(r=>r.qualifiedOnValidation).length,meanHeldoutScore:mean(reports.map(r=>r.test.score)),meanLearningDelta:mean(reports.map(r=>r.learningDelta)),replacementDeltaRange:deltas.length?[Math.min(...deltas),Math.max(...deltas)]:null,elapsedMs:Date.now()-started},runs};
}
