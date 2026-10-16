import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createTeamBattle, stepTeamBattle } from "../src/team-engine.mjs";
import {
  createPilotMemory,
  pilotObservation,
  rememberPilotStep,
} from "../src/pilot-observation.mjs";
import { createLearningEncoder } from "../src/learning-observation.mjs";
import { seededRandom } from "../src/team-rl.mjs";
import { candidateTeam, teamKey } from "../src/research.mjs";

export async function createLearningBridge() {
  const files = [
    "public/data/team-2026-10-14.json",
    "src/team-engine.mjs",
    "src/team-stats.mjs",
    "src/battle-arithmetic.mjs",
    "src/pilot-observation.mjs",
    "src/learning-observation.mjs",
    "src/team-rl.mjs",
    "src/research.mjs",
    "scripts/learning-bridge.mjs",
  ];
  const contents = await Promise.all(
    files.map((f) => readFile(new URL("../" + f, import.meta.url))),
  );
  const data = JSON.parse(contents[0]);
  const hash = createHash("sha256");
  files.forEach((f, i) => hash.update(f).update(contents[i]));
  const executionHash = hash.digest("hex"),
    encoder = createLearningEncoder(data);
  let rng,
    envs = [],
    split;
  function initialize(seed, count) {
    if (
      !Number.isInteger(seed) ||
      seed < 0 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 16
    )
      throw Error("Invalid seed or vector count");
    rng = seededRandom(seed);
    // Fixed across seeds and architectures; never use test configurations to train/select.
    const splitRng = seededRandom(7192026),
      seen = new Set(data.teams.map((t) => teamKey(t.members)));
    const extra = [];
    for (let n = 0; extra.length < 4 && n < 1000; n++) {
      const t = candidateTeam(data, splitRng),
        key = teamKey(t.members);
      if (!seen.has(key)) {
        seen.add(key);
        extra.push(t);
      }
    }
    if (extra.length !== 4) throw Error("Cannot construct held-out splits");
    split = {
      train: structuredClone(data.teams),
      validation: extra.slice(0, 2),
      test: extra.slice(2),
    };
    envs = Array.from({ length: count }, () => null);
  }
  function reset(index, options = {}) {
    if (!Number.isInteger(index) || index < 0 || index >= envs.length)
      throw Error("Invalid environment");
    const pool = split[options.split ?? "train"];
    if (!pool) throw Error("Invalid split");
    const a = options.a ?? Math.floor(rng() * pool.length);
    let b = options.b;
    if (b === undefined) {
      b = Math.floor(rng() * (pool.length - 1));
      if (b >= a) b++;
    }
    if (!pool[a] || !pool[b] || a === b) throw Error("Invalid team pairing");
    const state = createTeamBattle(data, pool[a].members, pool[b].members, {
      tieFirst: options.tieFirst ?? Math.floor(rng() * 2),
    });
    envs[index] = {
      state,
      memories: [createPilotMemory(0), createPilotMemory(1)],
      previous: [-1, -1],
      views: null,
    };
    return observation(envs[index]);
  }
  function observation(env) {
    env.views = [0, 1].map((s) =>
      pilotObservation(data, env.state, s, env.memories[s]),
    );
    return {
      observation: env.views.map((v, s) => encoder.encode(v, env.previous[s])),
      rules: env.views.map((v) => ({
        attack: encoder.rule(v),
        support: encoder.rule(v, "support"),
      })),
    };
  }
  function step(index, slots, autoReset = true) {
    const env = envs[index];
    if (!env || env.state.winner !== null)
      throw Error("Environment needs reset");
    if (!Array.isArray(slots) || slots.length !== 2)
      throw Error("Two simultaneous commands required");
    // Both commands validated against the same pre-action observations.
    const commands = slots.map((a, s) => encoder.command(env.views[s], a));
    const result = stepTeamBattle(data, env.state, commands);
    for (let s = 0; s < 2; s++)
      rememberPilotStep(env.memories[s], result, env.state);
    env.previous = [...slots];
    const winner = env.state.winner,
      done = winner !== null;
    // No hidden-state reward shaping; only completed-game outcome.
    const rewards =
      done && winner !== "draw"
        ? [winner === 0 ? 1 : -1, winner === 1 ? 1 : -1]
        : [0, 0];
    const terminal = done
      ? {
          winner,
          rounds: env.state.round - 1,
          decisions: env.state.decision,
          endReason:
            winner === "draw" ? "prototype-round-cap" : "prototype-victory",
        }
      : null;
    const next = done ? (autoReset ? reset(index) : null) : observation(env);
    return { next, rewards, done, terminal };
  }
  return {
    request(message) {
      if (message.scope && message.scope !== "prototype")
        throw Error("Only restricted prototype experiments are available");
      if (message.op === "init") {
        initialize(message.seed ?? 42, message.envs ?? 4);
        return {
          schema: encoder.schema,
          executionHash,
          dataVersion: data.version,
          split,
          scope: "prototype-only",
          observations: envs.map((_, i) => reset(i)),
          limits: [
            "10 forms / 42 moves",
            "provisional visibility",
            "unverified current-game mechanics",
            "no balance conclusions",
          ],
        };
      }
      if (!split) throw Error("Initialize bridge first");
      if (message.op === "reset")
        return reset(message.index ?? 0, message.options);
      if (message.op === "step") {
        if (
          !Array.isArray(message.actions) ||
          message.actions.length !== envs.length
        )
          throw Error("Batch length mismatch");
        if (envs.some((env) => !env || env.state.winner !== null))
          throw Error("Environment needs reset");
        // Validate entire batch before mutating any environment.
        message.actions.forEach((pair, i) => {
          if (!Array.isArray(pair) || pair.length !== 2)
            throw Error("Invalid joint action");
          pair.forEach((a, s) => encoder.command(envs[i].views[s], a));
        });
        return message.actions.map((a, i) =>
          step(i, a, message.autoReset !== false),
        );
      }
      throw Error("Unknown bridge operation");
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bridge = await createLearningBridge();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    try {
      if (line.length > 1000000) throw Error("Message too large");
      process.stdout.write(
        JSON.stringify({ ok: true, result: bridge.request(JSON.parse(line)) }) +
          "\n",
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: error.message }) + "\n",
      );
    }
  }
}
