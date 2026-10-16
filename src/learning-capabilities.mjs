// Controlled 6-member positions for engineering probes, not sampled real matches.
import {createTeamBattle, stepTeamBattle, teamLegalActions, activePet} from './team-engine.mjs';

export const CAPABILITY_VERSION = 'six-member-probes-1';
export const CAPABILITY_KINDS = ['finish', 'focus', 'switch'];
export const capabilityCases = () => CAPABILITY_KINDS.flatMap(kind =>
  Array.from({length: 6}, (_,variant) => variant).flatMap(variant => [0,1].flatMap(side => [0,1].map(tieFirst => ({kind,variant,side,tieFirst})))));

function prepareTeam(data, offset) {
  const members=structuredClone(data.teams[0].members);
  const team=members.slice(offset).concat(members.slice(0,offset));
  for (const member of team) member.moves=member.moves.slice(offset%4).concat(member.moves.slice(0,offset%4));
  return team;
}
function lateSide(side, keepIds, activeId) {
  side.magic=1;
  side.pets.forEach(p => {if (!keepIds.includes(p.id)) {p.hp=0;p.koCounted=true;}});
  side.active=side.pets.findIndex(p=>p.id===activeId);
  side.pets[side.active].everEntered=true;
}
function apply(data,state,side,own,enemy) {
  const copy=structuredClone(state), commands=[];
  commands[side]=own;commands[1-side]=enemy;
  stepTeamBattle(data,copy,commands);
  return copy;
}
function winningPlans(data,state,side,enemy,horizon) {
  const plans=[];
  for (const action of teamLegalActions(data,state,side)) {
    const next=apply(data,state,side,action,enemy);
    if(next.winner===side) plans.push([action]);
    else if(next.winner===null && horizon>1 && next.phase==='battle') {
      for(const second of teamLegalActions(data,next,side)) {
        const end=apply(data,next,side,second,enemy);
        if(end.winner===side) plans.push([action,second]);
      }
    }
  }
  return plans;
}

export function createCapabilityCase(data,{kind,variant=0,side=0,tieFirst=0}) {
  if(!CAPABILITY_KINDS.includes(kind)||!Number.isInteger(variant)||variant<0||variant>5||![0,1].includes(side)||![0,1].includes(tieFirst)) throw Error('Invalid capability case');
  const state=createTeamBattle(data,prepareTeam(data,variant),prepareTeam(data,(variant+3)%6),{tieFirst});
  state.phase='battle';state.round=10;
  const own=state.sides[side], enemy=state.sides[1-side];
  const ownId=kind==='finish'?(variant%2?'pet_000034':'pet_000005'):'pet_000094';
  lateSide(own,[ownId,'pet_000007',ownId==='pet_000005'?'pet_000034':'pet_000005'],ownId);
  lateSide(enemy,['pet_000006','pet_000007','pet_000034'],'pet_000006');
  const a=activePet(state,side),b=activePet(state,1-side);
  let enemyAction='focus',horizon=1,plans;
  if(kind==='finish') {
    a.energy=10;b.hp=1+variant*3;b.energy=0;
    plans=winningPlans(data,state,side,enemyAction,horizon);
  } else if(kind==='focus') {
    own.pets.forEach(p=>p.energy=0);b.energy=0;horizon=2;
    // Find a health threshold where recovering energy is the only winning first
    // action within two decisions. Labels are verified by the actual engine.
    for(let hp=b.maxHp;hp>=20;hp-=3) {
      b.hp=hp;
      const found=winningPlans(data,state,side,enemyAction,horizon);
      if(found.length&&found.every(p=>p[0]==='focus')) {plans=found;break;}
    }
    if(!plans) throw Error('Cannot construct a focus-only winning probe');
  } else {
    a.hp=1;a.energy=0;b.energy=10;
    enemyAction='move:skill_000378'; // Known scripted attack, not a human decision.
    plans=teamLegalActions(data,state,side).filter(action=> {
      const next=apply(data,state,side,action,enemyAction);
      return next.winner===null && next.sides[side].magic===1 && next.sides[side].active!==own.active;
    }).map(a=>[a]);
  }
  if(!plans?.length) throw Error('Probe has no solution');
  return {state,side,kind,variant,tieFirst,horizon,enemyAction,plans,
    expectedCommands:[...new Set(plans.map(p=>p[0]))],
    label:'Artificial late-game six-member position; no claim of real-match frequency or optimal full-game play'};
}

export function capabilitySucceeded(probe,state) {
  return probe.kind==='switch'
    ? state.winner===null && state.sides[probe.side].magic===1 && activePet(state,probe.side).hp>0 && activePet(state,probe.side).id!=='pet_000094'
    : state.winner===probe.side;
}
