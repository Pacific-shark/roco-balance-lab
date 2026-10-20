// Deterministic integration checks, NOT RL or evidence of team strength.
// Unsupported source definitions remain in the main inventory; this script
// selects supported builds solely to exercise the implemented runtime.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  kernelCatalog,
  sourceLegalMoves,
  createKernelBattle,
  kernelLegalActions,
  stepKernelBattle,
} from "../src/battle-kernel.mjs";
import { presetBuild } from "../src/team-stats.mjs";
const root = new URL("../", import.meta.url);

export async function runKernelRegression({
  games = 80,
  seed = 20261018,
} = {}) {
  assert.ok(Number.isInteger(games) && games > 0 && games <= 1000);
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  const bytes = await readFile(new URL("data/catalog-s4-20261015.json", root));
  const snapshot = JSON.parse(bytes);
  const scope = JSON.parse(
    await readFile(new URL("docs/evidence/open-roster-pilot.json", root)),
  );
  assert.equal(
    scope.snapshotSha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  const legacy = JSON.parse(
    await readFile(new URL("public/data/team-2026-10-14.json", root)),
  );
  const data = kernelCatalog(snapshot, legacy.types);
  let rngState = seed || 1;
  const rand = () => {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return (rngState >>> 0) / 2 ** 32;
  };
  const shuffle = (items) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const candidates = scope.candidates.flatMap((r) => {
    if (data.programs[r.trait.id].status !== "compiled") return [];
    const moves = [
      ...sourceLegalMoves(data, { id: r.id, bloodline: 2 }),
    ].filter((id) => data.programs[id].status === "compiled");
    return moves.length >= 4 ? [{ id: r.id, moves }] : [];
  });
  assert.ok(candidates.length >= 6);
  const makeTeam = () =>
    shuffle(candidates)
      .slice(0, 6)
      .map((r) => ({
        id: r.id,
        bloodline: 2,
        moves: shuffle(r.moves).slice(0, 4),
        ...presetBuild(data.creatures[r.id]),
      }));
  const report = {
    kind: "partial-kernel-integration-regression",
    seed,
    requestedGames: games,
    fullSourceCandidates: scope.candidates.length,
    eligibleFixtureForms: candidates.length,
    completedGames: 0,
    decisionCalls: 0,
    snapshotRoundTrips: 0,
    phaseVisits: {},
    traitIdsPresent: [],
    traitIdsOnField: [],
    moveIdsExecuted: [],
    gameReplayConformanceCases: 0,
    trainingSteps: 0,
    apiTokens: 0,
    result: "running",
    failures: [],
    meaning:
      "Supported source-consistent six-member fixtures with random test commands. Not full-roster admission, current-mode certification, learned policies or comparative win rates.",
  };
  const traits = new Set(),
    onField = new Set(),
    moves = new Set();
  for (let game = 0; game < games; game++) {
    const teams = [makeTeam(), makeTeam()],
      commands = [];
    let state;
    try {
      state = createKernelBattle(data, teams, {
        purpose: "mechanism-test",
        tieFirst: game % 2,
        maxRounds: 60,
      });
      for (const t of state.teams)
        for (const p of t.pets) traits.add(p.program.id);
      while (state.winner === null) {
        assert.ok(commands.length < 600, "Decision loop did not terminate");
        const phase = state.phase;
        const actions = [0, 1].map((side) => {
          const legal = kernelLegalActions(data, state, side);
          assert.ok(legal.length, `No legal command at ${phase}, side ${side}`);
          return legal[Math.floor(rand() * legal.length)];
        });
        const restored =
          phase !== "battle" || commands.length % 10 === 0
            ? JSON.parse(JSON.stringify(state))
            : null;
        commands.push({ round: state.round, phase, actions });
        const events = stepKernelBattle(data, state, actions);
        if (restored) {
          stepKernelBattle(data, restored, actions);
          assert.deepEqual(restored, state, "Snapshot replay diverged");
          report.snapshotRoundTrips++;
          state = restored;
        }
        report.decisionCalls++;
        report.phaseVisits[phase] = (report.phaseVisits[phase] ?? 0) + 1;
        for (const e of events) {
          if (e.kind === "move") moves.add(e.move);
          if (e.kind === "entry")
            onField.add(data.creatures[e.pet].feature_skill_id);
        }
        for (const t of state.teams) {
          assert.ok(t.magic >= 0 && t.magic <= 4);
          for (const p of t.pets) {
            assert.ok(Number.isFinite(p.hp) && p.hp >= 0 && p.hp <= p.maxHp);
            assert.ok(Number.isFinite(p.energy) && p.energy >= 0);
            for (const slot of p.moves)
              for (const k of ["power", "cost", "hits"])
                assert.ok(Number.isFinite(slot[k]));
          }
        }
      }
      report.completedGames++;
    } catch (error) {
      report.failures.push({
        game,
        message: error.message,
        stack: error.stack,
        teams,
        commands,
      });
      break; // preserve the first reproducible failure; never relabel it a draw
    }
  }
  report.traitIdsPresent = [...traits].sort();
  report.traitIdsOnField = [...onField].sort();
  report.moveIdsExecuted = [...moves].sort();
  report.result = report.failures.length ? "failed" : "passed";
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await runKernelRegression();
  await mkdir(new URL(".local/kernel-build/", root), { recursive: true });
  await writeFile(
    new URL(".local/kernel-build/regression.json", root),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        traitIdsPresent: report.traitIdsPresent.length,
        traitIdsOnField: report.traitIdsOnField.length,
        moveIdsExecuted: report.moveIdsExecuted.length,
        failures: report.failures.map(({ game, message }) => ({
          game,
          message,
        })),
      },
      null,
      2,
    ),
  );
  if (report.result !== "passed") process.exitCode = 1;
}
