import { mkdir, writeFile } from "node:fs/promises";
import { train, assess } from "../src/rl.mjs";
const seed = Number(process.argv[2] ?? 42),
  episodes = Number(process.argv[3] ?? 24000);
const start = Date.now();
const model = train({
  seed,
  episodes,
  env: { loadout: process.argv[4] ?? "native" },
  onProgress: (r) =>
    console.log(
      `episode=${r.episode} score=${r.bench.map((b) => b.ruleScore.toFixed(3)).join("/")} unseen=${r.bench.map((b) => b.fallbackRate.toFixed(3)).join("/")}`,
    ),
});
await mkdir("public/models", { recursive: true });
await writeFile(`public/models/selfplay-${seed}.json`, JSON.stringify(model));
const { agents, ...metadata } = model;
await writeFile(
  `public/models/summary-${seed}.json`,
  JSON.stringify(
    {
      ...metadata,
      elapsedMs: Date.now() - start,
      analysis: assess(model, "020"),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    seed,
    episodes,
    states: model.states,
    elapsedMs: Date.now() - start,
    final: model.history.at(-1).bench,
  }),
);
