import { trainTeams, evaluateTeams, TEAM_POLICY_PRIOR } from "./team-rl.mjs";
import { optimizeTeamBuilds } from "./team-build-search.mjs";
self.onmessage = ({ data: message }) => {
  try {
    const progress = (p) => self.postMessage({ type: "progress", progress: p });
    let data = message.data,
      search = null;
    if (message.options.optimize) {
      const warm = trainTeams(data, {
        seed: message.options.seed,
        episodes: 1000,
        patch: message.options.patch,
        onProgress: (p) => progress({ ...p, phase: "warm", total: 1000 }),
      });
      const optimized = optimizeTeamBuilds(data, warm, {
        patch: message.options.patch,
        onProgress: progress,
      });
      data = optimized.data;
      search = optimized.report;
    }
    const model = trainTeams(data, {
      ...message.options,
      onProgress: (p) => progress({ ...p, phase: "train" }),
    });
    if (search) model.configurationSearch = search;
    const evaluation = evaluateTeams(data, model);
    const initial = evaluateTeams(data, {
      ...model,
      agents: model.agents.map((a) => ({
        ...a,
        weights: { ...TEAM_POLICY_PRIOR },
      })),
    });
    evaluation.initialRuleScore = initial.ruleScore;
    evaluation.learningDelta = evaluation.ruleScore - initial.ruleScore;
    evaluation.configurationId = model.configurationId;
    self.postMessage({ type: "complete", data, model, evaluation });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
