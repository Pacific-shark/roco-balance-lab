import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  trainTeams,
  evaluateTeams,
  TEAM_POLICY_PRIOR,
} from "../src/team-rl.mjs";
const data = JSON.parse(
  await readFile(
    new URL("../public/data/team-2026-10-14.json", import.meta.url),
    "utf8",
  ),
);
const seed = Number(process.argv[2] ?? 42),
  episodes = Number(process.argv[3] ?? 4000);
const model = trainTeams(data, {
  seed,
  episodes,
  onProgress: (p) => console.log(JSON.stringify(p)),
});
const result = evaluateTeams(data, model, { includeReplay: false });
const initial = evaluateTeams(data, {
  ...model,
  agents: model.agents.map((a) => ({
    ...a,
    weights: { ...TEAM_POLICY_PRIOR },
  })),
});
result.initialRuleScore = initial.ruleScore;
result.initialDrawRate = initial.drawRate;
result.learningDelta = result.ruleScore - initial.ruleScore;
result.seed = seed;
result.episodes = episodes;
result.algorithm = model.algorithm;
result.rules = model.rules;
result.dataVersion = model.dataVersion;
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
    ruleScore: result.ruleScore,
    drawRate: result.drawRate,
    meanSwitches: result.meanSwitches,
  }),
);
