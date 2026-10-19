// Audit all 24 observed slots, including unsupported moves. Never substitute a
// compiled move, train a policy, or infer mode legality from source availability.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { kernelCatalog, sourceLegalMoves, KERNEL_VERSION } from "../src/battle-kernel.mjs";
import { PROGRAM_VERSION } from "../src/battle-programs.mjs";
import { NATURES, STAT_KEYS, calculatePanel } from "../src/team-stats.mjs";
const root = new URL("../", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root)));
export async function auditPvpBaseline() {
  const baseline = await read("data/pvp-baseline-electric-water.json");
  const bytes = await readFile(new URL("data/catalog-s4-20261015.json", root));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== baseline.catalogSha256) throw Error("Baseline needs source-version revalidation");
  const snapshot = JSON.parse(bytes), data = kernelCatalog(snapshot, (await read("public/data/team-2026-10-14.json")).types);
  if (baseline.members.length !== 6 || new Set(baseline.members.map((m) => m.id)).size !== 6)
    throw Error("Six distinct observed members required");
  const members = baseline.members.map((m) => {
    const c = data.creatures[m.id], pool = sourceLegalMoves(data, m), l = data.learnsets[c.learnset_id];
    if (c.name !== m.name || m.moves.length !== 4 || new Set(m.moves).size !== 4)
      throw Error(`Invalid observed member: ${m.id}`);
    if (NATURES[m.nature].up !== m.natureDirection.up || NATURES[m.nature].down !== m.natureDirection.down)
      throw Error(`Nature transcription mismatch: ${m.id}`);
    if (m.aptitudeStats.length !== 3 || new Set(m.aptitudeStats).size !== 3 || m.aptitudeStats.some((k) => !STAT_KEYS.includes(k)))
      throw Error(`Invalid aptitude selection: ${m.id}`);
    const bloodline = data.bloodlines.find((b) => b.id === m.bloodline);
    const moves = m.moves.map((id, slot) => {
      if (!pool.has(id) || data.programs[id].name !== m.moveNames[slot]) throw Error(`Illegal/transcription mismatch: ${m.id}/${id}`);
      const paths = [];
      if (l.native_skills.some((x) => x.skill === id && x.level <= 60 && (x.stage ?? 1) <= c.stage)) paths.push("基础可学");
      if (l.skill_stones.includes(id)) paths.push("技能石");
      if (l.blood_skills.some((x) => x.skill === id && x.blood === bloodline.name && x.level <= 60)) paths.push(`${bloodline.name}血脉`);
      const p = data.programs[id];
      return { slot: slot + 1, id, name: p.name, type: p.type, baseCost: p.cost, basePower: p.power, paths, status: p.status, gameVerified: p.gameVerified, pending: p.pending };
    });
    const ivs = Object.fromEntries(STAT_KEYS.map((k) => [k, m.aptitudeStats.includes(k) ? 10 : 0]));
    return { id: m.id, name: m.name, bloodline: bloodline.name, nature: m.nature, role: m.role,
      analysisIvs: ivs, analysisPanel: calculatePanel(c, { nature: m.nature, ivs }), sourceAptitudeValues: m.sourceAptitudeValues,
      trait: { id: c.feature_skill_id, name: data.programs[c.feature_skill_id].name, status: data.programs[c.feature_skill_id].status }, moves };
  });
  const missingMoves = members.flatMap((m) => m.moves.filter((x) => x.status !== "compiled").map((x) => ({ pet: m.name, ...x })));
  return { kind: "observed-baseline-configuration-audit", createdAt: new Date().toISOString(), catalogSha256: sha,
    kernelVersion: KERNEL_VERSION, programVersion: PROGRAM_VERSION, members,
    counts: { members: members.length, sourceConsistentSlots: members.reduce((n, m) => n + m.moves.length, 0),
      compiledSlots: members.reduce((n, m) => n + m.moves.filter((x) => x.status === "compiled").length, 0),
      compiledTraits: members.filter((m) => m.trait.status === "compiled").length },
    missingMoves, retainedAllObservedSlots: true, missingMovesSubstituted: false,
    blockers: ["晒太阳：增益来源和驱散边界", "彗星：失血分段、生命消耗与终局结算先后", "草魔法完整资源规则及执行", "当前赛季培养、模式合法性核验", "完整六人实战复现与关键机制边界"],
    trainingAllowed: false, modelAllocated: false, trainingSteps: 0, modelApiCalls: 0 };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await auditPvpBaseline();
  await writeFile(new URL("docs/evidence/pvp-baseline-electric-water.json", root), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ counts: report.counts, missingMoves: report.missingMoves.map((m) => `${m.pet}/${m.name}`), trainingAllowed: false }));
}
