import {createCapabilityCase} from './learning-capabilities.mjs';
import {stepTeamBattle,teamLegalActions} from './team-engine.mjs';
export const REVIEW_PROBE_VERSION='resource-under-threat-2';

export function createReviewedProbe(data,spec) {
 const probe=createCapabilityCase(data,spec);
 if(probe.kind!=='focus')return probe;
 const side=probe.side,own=probe.state.sides[side];
 // The original probe allowed safe switches and only penalized them through an
 // evaluator-imposed two-turn deadline. Here every reserve is actually vulnerable
 // to the scripted attack; the need to focus is grounded in the engine outcome.
 own.pets.forEach((p,i)=>{if(p.hp>0&&i!==own.active)p.hp=1;});
 probe.enemyAction='move:skill_000378';
 const apply=(state,action)=>{
  const next=structuredClone(state),pair=[];pair[side]=action;pair[1-side]=probe.enemyAction;
  stepTeamBattle(data,next,pair);return next;
 };
 const plans=[];
 for(const first of teamLegalActions(data,probe.state,side)) {
  const next=apply(probe.state,first);
  if(first!=='focus' && next.winner!==1-side)throw Error('A safe alternative invalidates the resource probe');
  if(next.winner===null)for(const second of teamLegalActions(data,next,side)) {
   if(apply(next,second).winner===side)plans.push([first,second]);
  }
 }
 if(!plans.length||plans.some(p=>p[0]!=='focus'))throw Error('Invalid forced-resource fixture');
 return {...probe,plans,expectedCommands:['focus']};
}
