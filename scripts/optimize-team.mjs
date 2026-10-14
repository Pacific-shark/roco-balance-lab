import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  trainTeams,
  evaluateTeams,
  TEAM_POLICY_PRIOR,
} from "../src/team-rl.mjs";
import { optimizeTeamBuilds } from "../src/team-build-search.mjs";
const base = JSON.parse(
  await readFile(
    new URL("../public/data/team-2026-10-14.json", import.meta.url),
    "utf8",
  ),
);
const seed = Number(process.argv[2] ?? 42),
  episodes = Number(process.argv[3] ?? 4000);
const warm = trainTeams(base, { seed, episodes: 1000 });
console.log(JSON.stringify({ phase: "warm-complete", seed }));
const optimized = optimizeTeamBuilds(base, warm, {
  onProgress: (p) => console.log(JSON.stringify(p)),
});
const model = trainTeams(optimized.data, {
  seed,
  episodes,
  onProgress: (p) => console.log(JSON.stringify({ phase: "retrain", ...p })),
});
model.configurationSearch = optimized.report;
const result = evaluateTeams(optimized.data, model);
const initial = evaluateTeams(optimized.data, {
  ...model,
  agents: model.agents.map((a) => ({
    ...a,
    weights: { ...TEAM_POLICY_PRIOR },
  })),
});
Object.assign(result, {
  initialRuleScore: initial.ruleScore,
  initialDrawRate: initial.drawRate,
  learningDelta: result.ruleScore - initial.ruleScore,
  seed,
  episodes,
  algorithm: model.algorithm,
  rules: model.rules,
  dataVersion: model.dataVersion,
  configurationId: model.configurationId,
});
await mkdir(new URL("../public/team-models/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL(`../public/team-models/team-${seed}.json`, import.meta.url),
  JSON.stringify(model),
);
await writeFile(
  new URL(`../public/team-models/evaluation-${seed}.json`, import.meta.url),
  JSON.stringify(result),
);
console.log(
  JSON.stringify({
    seed,
    episodes,
    searchBattles: optimized.report.battles,
    initial: result.initialRuleScore,
    trained: result.ruleScore,
    drawRate: result.drawRate,
    meanSwitches: result.meanSwitches,
  }),
);
