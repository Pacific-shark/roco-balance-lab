import { candidateTeam, teamKey } from "./research.mjs";
import { seededRandom } from "./team-rl.mjs";

// A fixed, architecture-independent training population. Held-out configurations
// are generated first and excluded; evaluation never adds examples to this pool.
export function expandTrainingPopulation(data, split, size = 4) {
  if (!Number.isInteger(size) || size < 4 || size > 64)
    throw Error("Training population must contain 4..64 teams");
  const result = structuredClone(split.train);
  const forbidden = new Set(
    [...split.train, ...split.validation, ...split.test].map((t) =>
      teamKey(t.members),
    ),
  );
  const rng = seededRandom(16102026);
  for (let attempts = 0; result.length < size && attempts < 10000; attempts++) {
    const team = candidateTeam(data, rng),
      key = teamKey(team.members);
    if (!forbidden.has(key)) {
      forbidden.add(key);
      result.push(team);
    }
  }
  if (result.length !== size) throw Error("Cannot build training population");
  return result;
}
