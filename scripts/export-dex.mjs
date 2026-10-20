import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));
const [snapshot, previous, imageManifest, baseline, cases] = await Promise.all([
  read("data/catalog-s4-20261016-review.json"),
  read("data/catalog-s4-20261015.json"),
  read("data/dex-image-manifest.json"),
  read("data/pvp-baseline-electric-water.json"),
  read("data/pvp-study-cases-2026-10-18.json"),
]);
const m = snapshot.modules;
const skillsByGameId = new Map(
  Object.entries(m.Skills).map(([id, s]) => [s.game_id, id]),
);
if (skillsByGameId.size !== Object.keys(m.Skills).length)
  throw Error("Ambiguous skill game_id");
const remap = (id, name) => {
  const mapped = skillsByGameId.get(previous.modules.Skills[id]?.game_id);
  if (!mapped || m.Skills[mapped].name !== name)
    throw Error(`Cannot remap ${id}: ${name}`);
  return mapped;
};
const image = (filename) => imageManifest.files[filename]?.url ?? null;
const url = (title) =>
  `https://wiki.biligame.com/nrc/${encodeURIComponent(title)}`;
const bloodlines = Object.fromEntries(
  m.Config.build_form.bloodlines.map((b) => [b.id, b.name]),
);
const list = (value) => (Array.isArray(value) ? value : []);
const evolutions = Object.fromEntries(
  Object.entries(m.Evolutions).map(([id, groups]) => [
    id,
    groups.map((g) => ({
      ...g,
      chain: list(g.chain),
      lord_branches: list(g.lord_branches),
    })),
  ]),
);
const lordIds = new Set();
const highestIds = new Set();
for (const groups of Object.values(evolutions)) {
  for (const group of groups) {
    for (const member of group.lord_branches ?? []) lordIds.add(member.id);
    // Chain order, not a hardcoded numeric stage, defines the terminal form.
    if (group.chain?.length) highestIds.add(group.chain.at(-1).id);
  }
}
const creatures = Object.values(m.Catalog)
  .map((c) => ({
    id: c.id,
    gameId: c.game_id,
    number: c.number,
    name: c.name,
    title: c.title,
    types: c.types,
    stage: c.stage,
    stats: c.stats,
    description: c.description,
    height: c.height,
    weight: c.weight,
    release: c.release,
    trait: c.feature_skill_id,
    learnset: c.learnset_id,
    evolution: c.evolution_id,
    head: image(c.image.head),
    illustration: image(c.image.illustration),
    form: lordIds.has(c.id)
      ? "lord"
      : highestIds.has(c.id)
        ? "final"
        : "evolving",
    source: url(c.title ?? c.name),
  }))
  .sort(
    (a, b) =>
      Number(a.number) - Number(b.number) ||
      a.stage - b.stage ||
      a.id.localeCompare(b.id),
  );
const creatureById = new Map(creatures.map((c) => [c.id, c]));
const learnsets = Object.fromEntries(
  Object.entries(m.Learnsets).map(([id, ls]) => [
    id,
    [
      ...(ls.native_skills ?? []).map((x) => ({ ...x, method: "native" })),
      ...(ls.skill_stones ?? []).map((skill) => ({ skill, method: "stone" })),
      ...(ls.blood_skills ?? []).map((x) => ({ ...x, method: "blood" })),
      ...(ls.legendary ? [{ ...ls.legendary, method: "special" }] : []),
    ],
  ]),
);
const skills = Object.fromEntries(
  Object.entries(m.Skills).map(([id, s]) => [
    id,
    {
      name: s.name,
      type: s.element,
      category: s.category,
      damageClass: s.damage_class,
      cost: s.energy,
      power: s.power ?? null,
      description: s.desc,
      notes: (s.desc_notes ?? [])
        .map((id) => m.Terms[String(id)])
        .filter(Boolean),
      source: url(s.name),
    },
  ]),
);
const teams = [
  {
    id: baseline.id,
    name: "电环水队",
    author: "云云云",
    status: "build-recorded",
    sourceLabel: "洛克时报 51 · 公开配队",
    source: baseline.sources[0].url + "?t=50",
    date: baseline.sources[0].publishedDate,
    description:
      "水灵铺垫水系行动，彩蝶鲨进场兑现减费；电环负责速度干预，其余成员补足轮转和收尾。",
    resonance: {
      name: "草魔法",
      subtitle: "光合治愈",
      note: "整队共用，与愿力、首领化互斥。当前赛季使用次数仍待核对。",
    },
    members: baseline.members.map((member) => ({
      ...member,
      bloodline: bloodlines[member.bloodline],
      moves: member.moves.map((id, index) =>
        remap(id, member.moveNames[index]),
      ),
    })),
  },
  ...cases.cases
    .filter(
      (c) =>
        c.sixMembersVisuallyIdentified && c.id !== "weekly51-electric-water",
    )
    .map((c) => ({
      id: c.id,
      name: c.title,
      author: null,
      status: "roster-recorded",
      sourceLabel:
        c.authorCategory === "科研阵容"
          ? "洛克时报 51 · 科研案例"
          : "洛克时报 51 · 公开配队",
      source: c.sourceUrl + `?t=${c.frameSeconds[0]}`,
      date: c.publishedDateCst,
      description: c.lesson,
      resonance: null,
      members: c.members.map(({ id, name }) => ({
        id,
        name,
        nature: null,
        natureDirection: null,
        bloodline: null,
        aptitudeStats: [],
        sourceAptitudeValues: null,
        moves: [],
        role: null,
        slotReasons: [],
      })),
    })),
];
for (const team of teams) {
  if (
    team.members.length !== 6 ||
    new Set(team.members.map((x) => x.id)).size !== 6
  )
    throw Error(`Invalid roster ${team.id}`);
  for (const member of team.members) {
    const c = creatureById.get(member.id);
    if (!c || c.name !== member.name)
      throw Error(`Unknown member ${member.name}`);
    for (const id of member.moves) {
      const valid = learnsets[c.learnset].some(
        (entry) =>
          entry.skill === id &&
          (entry.method !== "blood" || entry.blood === member.bloodline),
      );
      if (!valid) throw Error(`Invalid learning source ${member.name}: ${id}`);
    }
  }
}
const data = {
  meta: {
    version: m.Config.current_version,
    capturedAt: snapshot.provenance.capturedAt,
    source: "洛克王国：世界 BWIKI 玩家社区",
    sourceUrl: "https://wiki.biligame.com/nrc/首页",
    modules: snapshot.provenance.modules,
    license: snapshot.provenance.license,
    licenseUrl: snapshot.provenance.licenseUrl,
    totalForms: creatures.length,
    catalogSha256: createHash("sha256")
      .update(
        await readFile(new URL("data/catalog-s4-20261016-review.json", root)),
      )
      .digest("hex"),
    currentGameVersionCertified: false,
  },
  creatures,
  skills,
  learnsets,
  evolutions,
  teams,
};
await mkdir(new URL("public/data/", root), { recursive: true });
await writeFile(
  new URL("public/data/dex.json", root),
  JSON.stringify(data) + "\n",
);
console.log(
  JSON.stringify({
    creatures: creatures.length,
    teams: teams.length,
    recordedBuilds: teams.filter((t) => t.status === "build-recorded").length,
    missingHeads: creatures.filter((c) => !c.head).length,
    missingIllustrations: creatures.filter((c) => !c.illustration).length,
  }),
);
