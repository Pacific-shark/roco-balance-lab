// Compile all source definitions and retain every unsupported dependency.
// --check-training exits 2 before allocating any model when the full pool is incomplete.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  compileCatalogPrograms,
  PROGRAM_VERSION,
} from "../src/battle-programs.mjs";
import { KERNEL_VERSION } from "../src/battle-kernel.mjs";
const root = new URL("../", import.meta.url);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function fullRosterReadiness(scope, programs) {
  if (
    scope.policy?.teammates !== "all-currently-legal-highest-normal-forms" ||
    scope.policy?.opponents !== "same-full-legal-universe"
  )
    throw Error("The full teammate and opponent universe is mandatory");
  const rows = scope.candidates;
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    throw Error("Invalid full roster");
  const requiredMoves = [
    ...new Set(rows.flatMap((r) => r.sourceMoveIds)),
  ].sort();
  const requiredTraits = [...new Set(rows.map((r) => r.trait.id))].sort();
  const missingMoves = requiredMoves.filter(
    (id) => programs[id]?.status !== "compiled",
  );
  const missingTraits = requiredTraits.filter(
    (id) => programs[id]?.status !== "compiled",
  );
  const forms = rows.map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title,
    researchTarget: scope.targetIds.includes(r.id),
    traitCompiled: programs[r.trait.id]?.status === "compiled",
    sourceMoves: r.sourceMoveIds.length,
    compiledSourceMoves: r.sourceMoveIds.filter(
      (id) => programs[id]?.status === "compiled",
    ).length,
    legalPvpStatus: r.legalPvpStatus,
    unsupportedMoveIds: r.sourceMoveIds.filter(
      (id) => programs[id]?.status !== "compiled",
    ),
  }));
  // Code-owned gaps: descriptive flags or dropping report rows cannot authorize
  // the new neural run before its execution and observation adapters exist.
  const globalGaps = [
    "current-mode-legality-and-rule-calibration",
    "resonance-and-lord-transformation",
    "dynamic-skills-and-transmission",
    "complete-trait-interactions",
    "full-observation-action-adapter",
    "joint-build-search-and-adaptation-runner",
  ];
  return {
    trainingAllowed: false,
    modelAllocated: false,
    trainingSteps: 0,
    counts: {
      sourceCandidates: rows.length,
      researchTargets: scope.targetIds.length,
      requiredMoves: requiredMoves.length,
      compiledMoves: requiredMoves.length - missingMoves.length,
      requiredTraits: requiredTraits.length,
      compiledTraits: requiredTraits.length - missingTraits.length,
      fullyCompiledSourceForms: forms.filter(
        (f) => f.traitCompiled && !f.unsupportedMoveIds.length,
      ).length,
    },
    unsupportedMoveIds: missingMoves,
    unsupportedTraitIds: missingTraits,
    globalGaps,
    forms,
  };
}

export async function compileAll() {
  const [snapshotBytes, scopeBytes] = await Promise.all([
    readFile(new URL("data/catalog-s4-20261015.json", root)),
    readFile(new URL("docs/evidence/open-roster-pilot.json", root)),
  ]);
  const snapshot = JSON.parse(snapshotBytes),
    scope = JSON.parse(scopeBytes);
  if (scope.snapshotSha256 !== sha(snapshotBytes))
    throw Error("Scope inventory and source snapshot differ");
  const programs = compileCatalogPrograms(snapshot.modules.Skills),
    readiness = fullRosterReadiness(scope, programs);
  const files = [
    "src/battle-programs.mjs",
    "src/battle-kernel.mjs",
    "src/team-stats.mjs",
    "src/battle-arithmetic.mjs",
    "src/team-engine.mjs",
    "scripts/compile-battle-catalog.mjs",
    "scripts/kernel-regression.mjs",
    "test/battle-kernel.test.mjs",
    "test/pvp-baseline.test.mjs",
  ];
  const sources = Object.fromEntries(
    await Promise.all(
      files.map(async (path) => [
        path,
        sha(await readFile(new URL(path, root))),
      ]),
    ),
  );
  const definitions = Object.values(programs),
    moves = definitions.filter((p) => p.kind && p.status === "compiled");
  const report = {
    version: "full-roster-mechanism-build-1",
    createdAt: new Date().toISOString(),
    sourceSnapshotHash: sha(snapshotBytes),
    sourceManifest: snapshot.provenance,
    sourceRevisionCheck: scope.sourceRevisionCheck,
    kernelVersion: KERNEL_VERSION,
    programVersion: PROGRAM_VERSION,
    sources,
    ...readiness,
    controlledMoveTestCases: moves.reduce(
      (n, m) => n + 3 * (m.choices?.length ?? 1),
      0,
    ),
    compiledTraitDefinitions: definitions.filter(
      (p) => p.rules && p.status === "compiled",
    ).length,
    gameReplayConformanceCases: 0,
    apiTokens: 0,
    compilationMeans:
      "Fully parsed into supported kernel operations; not live-game certification.",
    controlledTestsMean:
      "Injected effect fixtures and source-legal carriers; not self-play training or win-rate evidence.",
    provisionalSemantics: [
      "Fixed same-speed orientation is only a test control.",
      "End-event order, percentage rounding, status retention and re-entry preheat need current-game traces.",
      "Passive/mark multiplication and counter timing need interaction conformance fixtures.",
      "Pivot/re-entry action cancellation, first-entry immunity, trap expiry, carried passive timing and replacement-effect interleaving are implementation fixtures awaiting current-game calibration.",
      "Five-star panels reuse the launch-game fixture; current season conformance is not certified.",
      "Stockpile counts current carried costs including its own slot; exclusion of one-use conditional discounts remains provisional until checked against game traces.",
    ],
    unsupported: definitions
      .filter((p) => p.status !== "compiled")
      .map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind ?? "trait",
        description: p.sourceDescription,
        unparsed: p.pending,
      })),
  };
  await mkdir(new URL(".local/kernel-build/", root), { recursive: true });
  await writeFile(
    new URL(".local/kernel-build/programs.json", root),
    JSON.stringify(programs, null, 2) + "\n",
  );
  await writeFile(
    new URL("docs/evidence/full-roster-mechanism-build.json", root),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await compileAll();
  console.log(
    JSON.stringify(
      {
        counts: report.counts,
        controlledMoveTestCases: report.controlledMoveTestCases,
        compiledTraitDefinitions: report.compiledTraitDefinitions,
        trainingAllowed: report.trainingAllowed,
        trainingSteps: report.trainingSteps,
        globalGaps: report.globalGaps,
      },
      null,
      2,
    ),
  );
  if (process.argv.includes("--check-training") && !report.trainingAllowed)
    process.exitCode = 2;
}
