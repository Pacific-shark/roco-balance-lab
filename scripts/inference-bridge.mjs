// Frozen-policy research adapter. It shares the exact engine and encoder used
// for training; arbitrary builds and interventions are evaluation-only inputs.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createLearningBridge} from './learning-bridge.mjs';
import {createTeamBattle,stepTeamBattle} from '../src/team-engine.mjs';
import {createPilotMemory,pilotObservation,rememberPilotStep} from '../src/pilot-observation.mjs';
import {createLearningEncoder} from '../src/learning-observation.mjs';
import {candidateTeam,teamKey} from '../src/research.mjs';
import {seededRandom} from '../src/team-rl.mjs';
import {createReviewedProbe,REVIEW_PROBE_VERSION} from '../src/learning-probe-review.mjs';
import {capabilityCases,capabilitySucceeded} from '../src/learning-capabilities.mjs';

export async function createInferenceBridge() {
 const data=JSON.parse(await readFile(new URL('../public/data/team-2026-10-14.json',import.meta.url)));
 const base=await createLearningBridge(),encoder=createLearningEncoder(data);
 const metadata=base.request({op:'init',envs:1,seed:42,trainPool:32,scope:'prototype'});
 const adapterHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).update(await readFile(new URL('../src/learning-probe-review.mjs',import.meta.url))).digest('hex');
 let state=null,memories=null,views=null,previous=[-1,-1],probe=null,probeSteps=0;
 function observe() {
  views=[0,1].map(s=>pilotObservation(data,state,s,memories[s]));
  return {observation:views.map((v,s)=>encoder.encode(v,previous[s])),rules:views.map(v=>({attack:encoder.rule(v),support:encoder.rule(v,'support')}))};
 }
 return {request(message){
  if(message.scope&&message.scope!=='prototype')throw Error('Only prototype research is supported');
  if(message.op==='init')return {...metadata,adapterHash};
  if(message.op==='probes')return {version:REVIEW_PROBE_VERSION,cases:capabilityCases()};
  if(message.op==='probeReset') {
   probe=createReviewedProbe(data,message.case);state=probe.state;probeSteps=0;
   memories=[createPilotMemory(0),createPilotMemory(1)];previous=[-1,-1];
   const next=observe();
   const slot=(side,command)=>Array.from({length:12},(_,i)=>i).find(i=>{try{return encoder.command(views[side],i)===command;}catch{return false;}});
   return {...next,probe:{side:probe.side,horizon:probe.horizon,enemySlot:slot(1-probe.side,probe.enemyAction),expectedSlots:probe.expectedCommands.map(a=>slot(probe.side,a))}};
  }
  if(message.op==='candidates') {
   const count=message.count??6;if(!Number.isInteger(count)||count<2||count>12)throw Error('Use 2..12 candidates');
   if(!data.creatures[message.target])throw Error('Target is outside the executable prototype');
   const rng=seededRandom(message.seed??17026),teams=[];
   const seen=new Set(Object.values(metadata.split).flat().map(t=>teamKey(t.members)));
   for(let n=0;teams.length<count&&n<10000;n++) {
    const team=candidateTeam(data,rng,{target:message.target}),key=teamKey(team.members);
    if(!seen.has(key)){seen.add(key);teams.push({...team,lineup:team.members.map(m=>({...m,name:data.creatures[m.id].name,trait:data.creatures[m.id].trait.name,moveNames:m.moves.map(id=>data.moves[id].name)}))});}
   }
   if(teams.length!==count)throw Error('Not enough unique candidates');
   return teams;
  }
  if(message.op==='reset') {
   probe=null;probeSteps=0;
   state=createTeamBattle(data,message.teamA.members,message.teamB.members,{tieFirst:message.tieFirst??0,patch:message.patch??null});
   memories=[createPilotMemory(0),createPilotMemory(1)];previous=[-1,-1];
   return observe();
  }
  if(message.op==='step') {
   if(!state||state.winner!==null)throw Error('Reset a live match first');
   if(!Array.isArray(message.actions)||message.actions.length!==2)throw Error('Two simultaneous actions required');
   const commands=message.actions.map((a,s)=>encoder.command(views[s],a));
   const result=stepTeamBattle(data,state,commands);
   for(let s=0;s<2;s++)rememberPilotStep(memories[s],result,state);
   previous=[...message.actions];
   const done=state.winner!==null;
   probeSteps++;
   return {done,next:done?null:observe(),terminal:done?{winner:state.winner,rounds:state.round-1,endReason:state.winner==='draw'?'prototype-round-cap':'prototype-victory'}:null,
     ...(probe?{probe:{success:capabilitySucceeded(probe,state),finished:done||probeSteps>=probe.horizon}}:{}),
     ...(message.record?{trace:{round:result.round,phase:result.phase,actions:commands,events:result.events}}:{})};
  }
  throw Error('Unknown operation');
 }};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const bridge=await createInferenceBridge();
 for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  try{if(line.length>1000000)throw Error('Message too large');process.stdout.write(JSON.stringify({ok:true,result:bridge.request(JSON.parse(line))})+'\n');}
  catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');}
 }
}
