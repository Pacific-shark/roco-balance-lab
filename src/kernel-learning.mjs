// A partial-rule experiment, separate from the full-roster admission gate.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { kernelCatalog, sourceLegalMoves, createKernelBattle, kernelLegalActions,
  kernelMoveCost, stepKernelBattle } from "./battle-kernel.mjs";
import { presetBuild } from "./team-stats.mjs";
import { typeMultiplier } from "./team-engine.mjs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const snapshot = JSON.parse(read("data/catalog-s4-20261015.json"));
const scope = JSON.parse(read("docs/evidence/open-roster-pilot.json"));
const legacy = JSON.parse(read("public/data/team-2026-10-14.json"));
export const data = kernelCatalog(snapshot, legacy.types);
export const TARGETS = ["pet_000005", "pet_000028", "pet_000076"];
export const TYPES = Object.keys(data.types);
const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];
const STATUS = ["中毒", "灼烧", "冻结", "引电"];
const PHASES = ["lead", "battle", "replace", "pivot", "swift"];
const MARKS = ["攻击","中毒","棘刺","光合","湿润","风起","降灵","蓄势","龙噬","减速"];
const EFFECTS = ["heal", "energy", "buff", "status", "mark", "guard", "weather", "departure", "skillPower", "skillCost", "interrupt", "priority"];
export const CANDIDATES = scope.candidates.flatMap((r) => {
  if (data.programs[r.trait.id].status !== "compiled") return [];
  const moves = [...sourceLegalMoves(data, {id:r.id, bloodline:2})]
    .filter((id) => data.programs[id].status === "compiled");
  return moves.length >= 4 ? [{id:r.id, moves}] : [];
});
const TRAITS = [...new Set(CANDIDATES.map((r) => data.creatures[r.id].feature_skill_id))].sort();
const hash = (x) => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
export function teamHash(team) { return hash([...team].sort((a,b) => a.id.localeCompare(b.id))); }
export function random(seed) {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 2**32; };
}
function shuffle(a, rand) {
  a = [...a];
  for (let i=a.length-1; i>0; i--) { const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
export function makeTeam(rand, target) {
  const handbook=(id)=>data.creatures[id].handbook_id;
  const selected=new Set(target?[handbook(target)]:[]),rows=[];
  for(const r of shuffle(CANDIDATES,rand)){
    if(selected.has(handbook(r.id)))continue;
    selected.add(handbook(r.id));rows.push(r);
    if(rows.length===(target?5:6))break;
  }
  if (target) rows.push(CANDIDATES.find((r) => r.id === target));
  return shuffle(rows, rand).map((r) => {
    const moves = shuffle(r.moves, rand);
    const attacks = moves.filter((id) => data.programs[id].kind === "attack");
    // Seed a usable attack; the other three slots are sampled, not claimed optimal.
    const first = attacks.length ? attacks[0] : moves[0];
    return {id:r.id, bloodline:2, moves:[first, ...moves.filter((x) => x!==first).slice(0,3)],
      ...presetBuild(data.creatures[r.id], ["offense","speed","durable"][Math.floor(rand()*3)])};
  });
}
export function makePools(seed=20261018) {
  const rand = random(seed), seen = new Set();
  const unique = (target) => { for (;;) { const team=makeTeam(rand,target), h=teamHash(team);
    if (!seen.has(h)) { seen.add(h); return team; } } };
  const train=Array.from({length:96}, (_,i) => unique(TARGETS[i%3]));
  // Every executable form must be reachable as a teammate in the training pool.
  for(const row of CANDIDATES) if(!train.some((t)=>t.some((p)=>p.id===row.id))) {
    let team;
    const target=TARGETS.find((id)=>data.creatures[id].handbook_id!==data.creatures[row.id].handbook_id);
    do {team=unique(target);} while(!team.some((p)=>p.id===row.id));
    train.push(team);
  }
  return {
    train,
    candidates: TARGETS.flatMap((id) => Array.from({length:12}, () => unique(id))),
    validation: Array.from({length:4}, () => unique()),
    test: Array.from({length:8}, () => unique()),
  };
}
export function actionIndex(s) {
  if(s==="wait") return 15;
  if(s==="focus") return 8;
  const [kind, n, choice]=s.split(":");
  if(kind==="switch") return 9+Number(n);
  if(kind==="move") return 2*Number(n)+Number(choice??0);
  throw Error("Unknown action");
}
export function legalMap(state, side) {
  const map = Object.fromEntries(kernelLegalActions(data,state,side).map((s) => [actionIndex(s),s]));
  if (Object.keys(map).length !== kernelLegalActions(data,state,side).length) throw Error("Action mapping collision");
  return map;
}
const onehot = (keys, value) => keys.map((k) => +(k===value));
const clamp = (v) => Math.max(-10, Math.min(10, Number(v)||0));
function moveVector(m) {
  return [...onehot(["attack","defense","status"],m?.kind), (m?.power??0)/200,
    (m?.cost??0)/10, ...onehot(TYPES,m?.type),
    ...EFFECTS.map((op) => +[...(m?.ops??[]),...(m?.counterOps??[])].some((x) => x.op===op))];
}
function petVector(p, own, isActive, knownMoves=new Set()) {
  if (!p) return Array(PET_DIM).fill(0);
  const stats = own ? p.stats : data.creatures[p.id].stats;
  return [1,+own,+isActive,p.hp/p.maxHp,p.energy/10,...STATS.map((k) => stats[k]/600),
    ...["atk","def","spa","spd","spe"].map((k) => (p.buffs[k]??0)+(p.permanentBuffs[k]??0)),
    ...STATUS.map((k) => p.statuses[k]/5), ...TYPES.map((k) => +p.types.includes(k)),
    ...onehot(TRAITS,p.program.id),
    ...Array.from({length:4}, (_,i) => moveVector(data.programs[own ? p.moves[i].id : [...knownMoves].sort()[i]])).flat(),
    +own]; // foe stats are species base stats, never hidden cultivated panels
}
const MOVE_DIM = 5+TYPES.length+EFFECTS.length;
const PET_DIM = 5+6+5+4+TYPES.length+TRAITS.length+4*MOVE_DIM+1;
const ACTION_DIM = 6+MOVE_DIM+5;
export const SCHEMA = {version:"kernel-observation-2",petDim:PET_DIM,actionDim:ACTION_DIM,
  globalDim:22+4*MARKS.length,actions:16,traitIds:TRAITS,types:TYPES,marks:MARKS,
  visibility:"Own full build; opponent active last-seen public HP/energy/status, species base stats and only executed moves. Unseen slots masked. Provisional game visibility."};

export function newEnvironment(teams, {tieFirst=0,maxRounds=80}={}) {
  if(teams.some((t)=>new Set(t.map((p)=>data.creatures[p.id].handbook_id)).size!==6))
    throw Error("Experimental teams require six distinct handbook entries");
  return {state:createKernelBattle(data,teams,{purpose:"experimental-training",scope:"supported-builds-incomplete-rules",tieFirst,maxRounds}),
    seen:[Array(6).fill(null),Array(6).fill(null)], known:[Array.from({length:6},()=>new Set()),Array.from({length:6},()=>new Set())],
    eventCursor:0, decisions:0, commands:[]};
}
function updateMemory(env) {
  const s=env.state;
  for(const e of s.events.slice(env.eventCursor)) if(e.kind==="move") {
    const side=e.side, i=s.teams[side].pets.findIndex((p) => p.id===e.pet);
    if(i>=0) env.known[1-side][i].add(e.move);
  }
  env.eventCursor=s.events.length;
  for(let viewer=0;viewer<2;viewer++) {
    const foe=s.teams[1-viewer], i=foe.active;
    if(i>=0) env.seen[viewer][i]=structuredClone(foe.pets[i]);
  }
}
export function observe(env,side) {
  const s=env.state, own=s.teams[side], foe=s.teams[1-side];
  const p=own.pets[own.active], enemy=env.seen[side][foe.active];
  const map=s.winner===null?legalMap(s,side):{15:"wait"};
  const pets=[...own.pets.map((p,i)=>petVector(p,true,i===own.active)),
    ...env.seen[side].map((p,i)=>petVector(p,false,i===foe.active,env.known[side][i]))];
  const actions=Array.from({length:16},(_,a)=>{
    let m=null,cost=0,power=0,mult=1,hp=0,energy=0;
    const kind=a<8?"move":a===8?"focus":a===15?"wait":"switch";
    if(kind==="move" && p) {
      const base=data.programs[p.moves[Math.floor(a/2)].id];
      const variant=base.choices?.[a%2]; m=variant?{...base,...variant}:base;
      cost=kernelMoveCost(data,s,side,Math.floor(a/2),base.choices?a%2:undefined);
      power=(m.power+p.moves[Math.floor(a/2)].power+p.power+p.permanentPower)/200;
      mult=enemy?typeMultiplier(data,m.type,enemy.types):1;
    } else if(kind==="switch") { const q=own.pets[a-9]; hp=q.hp/q.maxHp; energy=q.energy/10; }
    return [...onehot(["move","focus","switch","wait"],kind),a<8?a%2:0,+!!map[a],...moveVector(m),cost/10,power,mult/3,hp,energy];
  });
  const global=[s.round/s.maxRounds,...onehot(PHASES,s.phase),own.magic/4,foe.magic/4,
    ...onehot(["雨天","晴天","沙暴","暴风雪"],s.weather),s.weatherTurns/10,
    own.active<0?0:own.active/5,foe.active<0?0:foe.active/5,
    ...[own,foe].flatMap((t)=>[(t.marks.positive?.layers??0)/5,(t.marks.negative?.layers??0)/5]),
    +(s.tieFirst===side),+(s.phase==="battle"),+(s.winner!==null),
    ...[own,foe].flatMap((t)=>[...onehot(MARKS,t.marks.positive?.name),...onehot(MARKS,t.marks.negative?.name)])];
  return {pets:pets.map((r)=>r.map(clamp)),actions:actions.map((r)=>r.map(clamp)),global:global.map(clamp),mask:Array.from({length:16},(_,a)=>Object.hasOwn(map,a))};
}
export function observations(env) {updateMemory(env);return [observe(env,0),observe(env,1)];}
export function advance(env,indices) {
  const maps=[legalMap(env.state,0),legalMap(env.state,1)];
  if(indices.length!==2 || indices.some((a,s)=>!Number.isInteger(a)||!Object.hasOwn(maps[s],a))) throw Error("Illegal batched action");
  const actions=indices.map((a,s)=>maps[s][a]);
  env.commands.push({round:env.state.round,phase:env.state.phase,actions});
  stepKernelBattle(data,env.state,actions); env.decisions++;
  if(env.decisions>1000) throw Error("Decision budget exceeded");
  updateMemory(env);
  const winner=env.state.winner;
  return {done:winner!==null,winner,rewards:winner===0?[1,-1]:winner===1?[-1,1]:[0,0],rounds:env.state.round};
}
// Baseline consumes exactly the same observation as the learner.
export function ruleAction(obs) {
  const active=obs.pets.slice(0,6).find((p)=>p[2]) ?? [];
  let best=-Infinity, result=15;
  for(let i=0;i<16;i++) if(obs.mask[i]) {
    const a=obs.actions[i]; let score=0;
    if(i<8) {
      const isAttack=a[6], isDefense=a[7], isStatus=a[8];
      const cost=a[6+MOVE_DIM],power=a[7+MOVE_DIM],mult=a[8+MOVE_DIM]*3;
      score=isAttack?(0.25+power*mult)/(1+cost):isDefense?0.03:0.02;
      const heal=a[6+5+TYPES.length];
      if(isStatus && heal && active[3]<0.6) score=0.8;
    } else if(i===8) score=(active[4]??1)<0.3?0.7:-0.1;
    else if(i<15) score=obs.global[2]===1?-0.05:obs.pets[i-9][3]+obs.pets[i-9][4]*0.1;
    if(score>best){best=score;result=i;}
  }
  return result;
}
export function describeTeam(team) {return team.map((p)=>({...p,name:data.creatures[p.id].name,
  title:data.creatures[p.id].title,handbookId:data.creatures[p.id].handbook_id,form:data.creatures[p.id].form??null,
  trait:data.programs[data.creatures[p.id].feature_skill_id].name,
  moveNames:p.moves.map((id)=>data.programs[id].name)}));}
export function metadata(pools) {
  const files=["src/battle-kernel.mjs","src/battle-programs.mjs","src/kernel-learning.mjs","scripts/kernel-learning-bridge.mjs","src/team-stats.mjs","src/team-engine.mjs","src/battle-arithmetic.mjs","data/catalog-s4-20261015.json","public/data/team-2026-10-14.json"];
  return {schema:SCHEMA,executionHash:hash(files.map((p)=>[p,hash(read(p).toString())])),
    experimentScope:"supported-builds-incomplete-rules",fullRosterAdmission:false,gameVerified:false,
    sourceCandidates:scope.candidates.length,executableForms:CANDIDATES.length,candidateIds:CANDIDATES.map((r)=>r.id),
    traitsIntact:true,resonance:false,bloodline:2,level:60,growthStars:5,oneFormPerHandbookInTeam:true,
    cultivation:"Three sampled presets; not an exhaustive nature/aptitude optimum",
    splitHashes:Object.fromEntries(Object.entries(pools).map(([k,v])=>[k,v.map(teamHash)])),
    teams:Object.fromEntries(Object.entries(pools).map(([k,v])=>[k,v.map(describeTeam)]))};
}
