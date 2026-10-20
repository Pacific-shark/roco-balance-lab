import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NATURES } from "../src/team-stats.mjs";

const read = async (path) =>
  JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
const [dex, source, baseline] = await Promise.all([
  read("public/data/dex.json"),
  read("data/catalog-s4-20261016-review.json"),
  read("data/pvp-baseline-electric-water.json"),
]);
const byId = new Map(dex.creatures.map((c) => [c.id, c]));

test("图鉴覆盖原快照所有形态，数值、特性与图片关系可追溯", () => {
  assert.equal(byId.size, Object.keys(source.modules.Catalog).length);
  for (const c of dex.creatures) {
    const original = source.modules.Catalog[c.id];
    assert.deepEqual(c.stats, original.stats);
    assert.equal(c.trait, original.feature_skill_id);
    assert.ok(dex.skills[c.trait]);
    assert.ok(dex.learnsets[c.learnset]);
    for (const url of [c.head, c.illustration]) {
      assert.equal(new URL(url).hostname, "patchwiki.biligame.com");
    }
    for (const e of dex.learnsets[c.learnset]) assert.ok(dex.skills[e.skill]);
  }
});
test("跨版本技能按稳定编号对齐，24 招不得因内部 ID 重排而串招", () => {
  const team = dex.teams.find((t) => t.id === baseline.id);
  assert.equal(team.members.length, 6);
  for (let i = 0; i < 6; i++) {
    const member = team.members[i];
    assert.deepEqual(
      member.moves.map((id) => dex.skills[id].name),
      baseline.members[i].moveNames,
    );
    assert.deepEqual(member.natureDirection, {
      up: NATURES[member.nature].up,
      down: NATURES[member.nature].down,
    });
    const pool = dex.learnsets[byId.get(member.id).learnset];
    for (const move of member.moves)
      assert.ok(
        pool.some(
          (e) =>
            e.skill === move &&
            (e.method !== "blood" || e.blood === member.bloodline),
        ),
      );
  }
  assert.equal(dex.skills[team.members[0].moves[0]].cost, 7);
});
test("多套配队各自存配置，未转录的成员不得继承另一套性格或四招", () => {
  assert.equal(
    dex.teams.filter((t) => t.members.some((m) => m.id === "pet_000005"))
      .length,
    3,
  );
  for (const t of dex.teams) {
    assert.equal(t.members.length, 6);
    assert.equal(new Set(t.members.map((m) => m.id)).size, 6);
    for (const m of t.members) assert.ok(byId.has(m.id));
    if (t.status === "roster-recorded") {
      assert.equal(t.resonance, null);
      for (const m of t.members) {
        assert.equal(m.nature, null);
        assert.deepEqual(m.moves, []);
      }
    }
  }
});
test("首领与普通进化链保留独立身份", () => {
  assert.equal(byId.get("pet_000005").form, "final");
  assert.equal(byId.get("pet_000002").form, "evolving");
  assert.equal(byId.get("pet_000543").form, "lord");
  const chain = dex.evolutions[byId.get("pet_000005").evolution][0];
  assert.deepEqual(
    chain.chain.map((c) => c.name),
    ["水蓝蓝", "波波拉", "水灵"],
  );
  assert.ok(chain.lord_branches.some((c) => c.name === "圣水守护"));
});
