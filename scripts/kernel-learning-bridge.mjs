import readline from "node:readline";
import {makePools,random,newEnvironment,observations,advance,ruleAction,legalMap,metadata} from "../src/kernel-learning.mjs";
let envs=[],pools,rand,meta,seenForms,usedMoves,activeForms;
function fresh(){const teams=[pools.train[Math.floor(rand()*pools.train.length)],pools.train[Math.floor(rand()*pools.train.length)]];for(const t of teams)for(const p of t)seenForms.add(p.id);return newEnvironment(teams,{tieFirst:rand()<0.5?0:1});}
function view(env){const observation=observations(env);return {observation,ruleActions:observation.map(ruleAction)};}
async function request(p){
  if(p.op==="init"){
    if(!Number.isInteger(p.envs)||p.envs<1||p.envs>32) throw Error("Invalid environment count");
    pools=makePools(p.poolSeed??20261018);rand=random(p.seed??42);meta=metadata(pools);
    seenForms=new Set();usedMoves=new Set();activeForms=new Set();
    envs=Array.from({length:p.envs},fresh);return {...meta,current:envs.map(view)};
  }
  if(!pools)throw Error("Initialize first");
  if(p.op==="reset"){
    envs=p.cases.map((c)=>newEnvironment([pools[c.a[0]][c.a[1]],pools[c.b[0]][c.b[1]]],{tieFirst:c.tieFirst??0,maxRounds:c.maxRounds??80}));
    return envs.map(view);
  }
  if(p.op==="step"){
    if(p.actions.length!==envs.length)throw Error("Batch size mismatch");
    // Validate the whole batch before mutating any environment.
    p.actions.forEach((row,i)=>{if(row===null && envs[i].state.winner!==null)return;if(!Array.isArray(row)||row.length!==2 || row.some((a,s)=>!Number.isInteger(a)||!Object.hasOwn(legalMap(envs[i].state,s),a)))throw Error("Illegal batch action");});
    return envs.map((env,i)=>{const cursor=env.state.events.length;const result=p.actions[i]===null?{done:true,winner:env.state.winner,rewards:[0,0],rounds:env.state.round}:advance(env,p.actions[i]);
      for(const e of env.state.events.slice(cursor)){if(e.kind==="entry")activeForms.add(e.pet);if(e.kind==="move")usedMoves.add(e.move);}
      if(result.done && p.autoReset)envs[i]=fresh();
      return {...result,...view(envs[i])};});
  }
  if(p.op==="stats")return {formsInTrainingTeams:[...seenForms].sort(),formsActuallyEntered:[...activeForms].sort(),movesActuallyUsed:[...usedMoves].sort()};
  if(p.op==="activity")return envs.map((env,i)=>{
    const target=p.targets[i],result={id:target.id,entries:0,moves:0,directDamage:0,energySpent:0,executedMoves:{},eventCount:env.state.events.length,maxHits:0};
    for(const e of env.state.events){
      if(e.kind==="move")result.maxHits=Math.max(result.maxHits,e.hits??0);
      if(e.side!==target.side||e.pet!==target.id)continue;
      if(e.kind==="entry")result.entries++;
      if(e.kind==="move"){result.moves++;result.directDamage+=e.damage??0;result.energySpent+=e.cost??0;result.executedMoves[e.move]=(result.executedMoves[e.move]??0)+1;}
    }
    return result;
  });
  // Event provenance may share nested ancestor objects. Expanding all ancestors
  // as JSON grows exponentially; replays need flat events plus committed actions.
  if(p.op==="replay")return envs.map((e)=>({state:{
    version:e.state.version,purpose:e.state.purpose,scope:e.state.scope,
    winner:e.state.winner,round:e.state.round,phase:e.state.phase,
    teams:e.state.teams.map((t)=>({active:t.active,magic:t.magic,pets:t.pets.map((p)=>({id:p.id,name:p.name,hp:p.hp,maxHp:p.maxHp,energy:p.energy,traitId:p.program.id}))})),
    eventCount:e.state.events.length,eventsTruncated:e.state.events.length>5000,
    events:e.state.events.slice(0,5000).map((event)=>({
      ...Object.fromEntries(Object.entries(event).filter(([,v])=>v===null||["string","number","boolean"].includes(typeof v))),
      ...(event.source&&typeof event.source==="object"?{source:Object.fromEntries(Object.entries(event.source).filter(([,v])=>v===null||["string","number","boolean"].includes(typeof v)))}:{})
    }))},commands:e.commands}));
  throw Error("Unknown operation");
}
for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
  try{console.log(JSON.stringify({ok:true,result:await request(JSON.parse(line))}));}
  catch(e){console.log(JSON.stringify({ok:false,error:e.stack??e.message}));}
}
