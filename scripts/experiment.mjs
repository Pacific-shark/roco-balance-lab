import { readFile } from "node:fs/promises";
import { evaluate } from "../src/engine.mjs";
import { train, trainedPolicies } from "../src/rl.mjs";
const config = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], "utf8"))
  : { env: { policy: "selfplay" }, model: { seed: 42, episodes: 24000 } };
let overrides = {};
if (config.env?.policy === "selfplay") {
  const spec = config.model;
  if (!spec) throw new Error("selfplay 需要 model 配置");
  // Retraining is deterministic and also works for models trained in the browser.
  const model = train(spec);
  overrides = { policies: trainedPolicies(model) };
}
console.log(
  JSON.stringify(evaluate(config.env, config.patch, overrides), null, 2),
);
