// Review the prerequisites of observed teams without substituting invented builds.
// This creates an audit only: no policy/model is allocated and no battle is run.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { compileCatalogPrograms, PROGRAM_VERSION } from "../src/battle-programs.mjs";
import { KERNEL_VERSION } from "../src/battle-kernel.mjs";
import { auditPvpBaseline } from "./audit-pvp-baseline.mjs";

const root = new URL("../", import.meta.url);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function auditPvpStudy() {
  const bytes = await readFile(new URL("data/catalog-s4-20261015.json", root));
  const snapshot = JSON.parse(bytes);
  const notes = JSON.parse(await readFile(new URL("data/pvp-study-cases-2026-10-18.json", root)));
  if (sha(bytes) !== notes.sourceSha256) throw Error("Study notes and catalog versions differ");
  const programs = compileCatalogPrograms(snapshot.modules.Skills);
  const detailedBaseline = await auditPvpBaseline();
  const definition = (id) => {
    const p = programs[id];
    if (!p) throw Error(`Missing source definition: ${id}`);
    return { id, name: p.name, status: p.status, gameVerified: p.gameVerified };
  };
  const cases = notes.cases.map((c) => {
    const members = c.members.map((member) => {
      const creature = snapshot.modules.Catalog[member.id];
      if (creature?.feature_skill_id !== member.traitId || creature.name !== member.name)
        throw Error(`Study identity mismatch: ${member.id}`);
      return { id: member.id, name: member.name, trait: definition(member.traitId) };
    });
    let knownMoves = notes.checkedSourceConnections
      .filter((link) => c.members.some((member) => member.id === link.petId))
      .map((link) => {
        const creature = snapshot.modules.Catalog[link.petId];
        const sources = snapshot.modules.Learnsets[creature.learnset_id][link.learningSource];
        if (!sources.some((item) => (typeof item === "string" ? item : item.skill) === link.skillId))
          throw Error(`Study skill connection mismatch: ${link.petId}/${link.skillId}`);
        return { petId: link.petId, learningSource: link.learningSource, ...definition(link.skillId) };
      });
    const hasDetailedRecord = c.id === "weekly51-electric-water";
    if (hasDetailedRecord)
      knownMoves = detailedBaseline.members.flatMap((m) => m.moves.map((move) => ({
        petId: m.id, learningSource: move.paths, slot: move.slot,
        ...definition(move.id),
      })));
    // Text/visual observation does not certify the complete battle build.
    // A future exactBuild must pass separate mode, replay and execution checks.
    return {
      id: c.id, title: c.title, sourceUrl: c.sourceUrl,
      identifiedMembers: members.length, members, knownMoves,
      fullBuildRecorded: c.exactBuild !== null,
      recordedOrderedMoveSlots: hasDetailedRecord ? 24 : null,
      detailedConfigurationRecord: hasDetailedRecord ? "data/pvp-baseline-electric-water.json" : null,
      missingTraitIds: members.filter((m) => m.trait.status !== "compiled").map((m) => m.trait.id),
      missingKnownMoveIds: knownMoves.filter((m) => m.status !== "compiled").map((m) => m.id),
      unrecordedConfigurationFields: hasDetailedRecord
        ? ["exact-source-aptitude-values", "resonance-execution-boundaries", "current-mode-legality", "full-game-conformance"]
        : c.missingBeforeTraining,
      trainingAllowed: false,
    };
  });
  return {
    kind: "pvp-study-prerequisite-audit",
    createdAt: new Date().toISOString(),
    sourceSha256: sha(bytes),
    kernelVersion: KERNEL_VERSION, programVersion: PROGRAM_VERSION,
    cases,
    meaning: "Known dependencies of visually identified teams only; incomplete move slots, cultivation, bloodlines, resonance and game validation remain blockers. Not a training-admission implementation.",
    trainingRunsStarted: 0, modelApiCalls: 0,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await auditPvpStudy();
  await writeFile(new URL("docs/evidence/pvp-study-prerequisites.json", root), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.cases.map(({ title, identifiedMembers, missingTraitIds, missingKnownMoveIds, trainingAllowed }) =>
    ({ title, identifiedMembers, missingTraitIds, missingKnownMoveIds, trainingAllowed })), null, 2));
}
