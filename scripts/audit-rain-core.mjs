// Inspect frozen experiment evidence; never train, rank teams, or change the simulator.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { data, CANDIDATES } from "../src/kernel-learning.mjs";

const root = new URL("../", import.meta.url);
const files = {
  manifest: "docs/evidence/kernel-ppo-20261018-v4/manifest.json",
  report: "docs/evidence/kernel-ppo-20261018-v4/report.json",
  snapshot: "data/catalog-s4-20261015.json",
};
const raw = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(new URL(p, root))]));
const manifest = JSON.parse(raw.manifest), report = JSON.parse(raw.report);
const water = "pet_000005", shark = "pet_000106", rain = "skill_000427";
const has = (team, id) => team.some(p => p.id === id);
const pair = team => has(team, water) && has(team, shark);
const build = p => ({id:p.id, name:data.creatures[p.id].title,
  moves:p.moves.map(id => ({id, name:data.programs[id].name}))});
const splits = Object.fromEntries(Object.entries(manifest.teams).map(([split, teams]) => [split, {
  teams: teams.length,
  withWater: teams.filter(t => has(t, water)).length,
  withShark: teams.filter(t => has(t, shark)).length,
  withBoth: teams.filter(pair).length,
  pairs: teams.flatMap((t, index) => pair(t) ? [{index,
    pairMembers:t.filter(p => [water, shark].includes(p.id)).map(build),
    rainCarriers:t.filter(p => p.moves.includes(rain)).map(build)}] : []),
}]));
const selected = report.teams.find(t => t.candidate < 12);
const selectedTeam = manifest.teams.candidates[selected.candidate];
console.log(JSON.stringify({
  reviewDate:"2026-10-18", run:"kernel-ppo-20261018-v4",
  assessment:"needs-revision", permittedUse:"engineering-validation-only",
  teamResearchAccepted:false, newTrainingStarted:false,
  reason:"Random builds and weak rule opponents do not validate team synergy or individual strength.",
  artifacts:Object.fromEntries(Object.entries(files).map(([k,path]) => [k,{path,
    sha256:createHash("sha256").update(raw[k]).digest("hex")}])) ,
  snapshotCertifiedForCurrentGame:JSON.parse(raw.snapshot).provenance.currentGameVersionCertified,
  pairInExecutablePool:[water,shark].map(id => ({id,name:data.creatures[id].name,
    included:CANDIDATES.some(p => p.id===id),trait:data.programs[data.creatures[id].feature_skill_id]})),
  splits,
  waterCandidatePairs:manifest.teams.candidates.slice(0,12).flatMap((t,index) => pair(t) ? [{index,
    selected:selected.candidate===index,
    validation:report.selection.rows.filter(r=>r.candidate===index).reduce((a,r)=>{
      a[r.outcome]=(a[r.outcome]??0)+1;return a;}, {})}] : []),
  selectedWaterTeam:{index:selected.candidate, members:selectedTeam.map(build),
    waterAttackSlots:selectedTeam.flatMap(p=>p.moves.filter(id=>
      data.programs[id].kind==="attack" && data.programs[id].type==="水").map(id=>({pet:p.id,move:id})))},
  relevantUnsupportedMoves:["skill_000441","skill_000440","skill_000442","skill_000643"].map(id=>{
    const p=data.programs[id];return {id,name:p.name,status:p.status,description:p.sourceDescription,pending:p.pending};}),
  meaning:"Counts describe frozen build exposure, not executed cooperation. Compiled programs are not game-conformance evidence. No real-game synergy magnitude is estimated."
},null,2));
