import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const data = JSON.parse(
  readFileSync(
    new URL("../public/data/bwiki-2026-10-14.json", import.meta.url),
    "utf8",
  ),
);

test("all forms have usable stats and resolvable trait, skill and term references", () => {
  assert.equal(
    new Set(data.creatures.map((c) => c.id)).size,
    data.creatures.length,
  );
  for (const c of data.creatures) {
    assert.equal(Object.keys(c.stats).length, 6, c.title);
    assert.ok(
      Object.values(c.stats).every((v) => Number.isInteger(v) && v > 0),
      c.title,
    );
    assert.equal(
      Object.values(c.stats).reduce((a, b) => a + b, 0),
      c.total,
      c.title,
    );
    assert.equal(data.skills[c.trait]?.category, "特性", c.title);
    assert.ok(c.types.length >= 1 && c.types.length <= 2, c.title);
    for (const learned of c.skills)
      assert.ok(data.skills[learned.skill], c.title + " " + learned.skill);
  }
  for (const s of Object.values(data.skills))
    for (const id of s.terms)
      assert.ok(
        data.terms.some((t) => t.id === String(id)),
        s.name,
      );
});

test("fire learnset agrees with visible wiki: 13 native, 14 stones and 18 conditional blood skills", () => {
  const fire = data.creatures.find((c) => c.title === "火神");
  assert.equal(fire.skills.filter((s) => s.method === "自学").length, 13);
  assert.equal(fire.skills.filter((s) => s.method === "技能石").length, 14);
  assert.equal(fire.skills.filter((s) => s.method === "血脉").length, 18);
  const foam = fire.skills.find((s) => data.skills[s.skill].name === "泡沫");
  assert.equal(foam.method, "血脉");
  assert.equal(foam.blood, "水");
  assert.equal(data.skills[foam.skill].cost, 1);
  assert.equal(data.skills[foam.skill].power, 60);
});

test("identical trait names retain source IDs and special learning conditions are preserved", () => {
  assert.equal(
    Object.values(data.skills).filter((s) => s.category === "特性").length,
    245,
  );
  assert.equal(
    new Set(
      Object.values(data.skills)
        .filter((s) => s.category === "特性")
        .map((s) => s.name),
    ).size,
    242,
  );
  const specials = data.creatures.flatMap((c) =>
    c.skills.filter((s) => s.method === "传说"),
  );
  assert.ok(specials.length > 0);
  assert.ok(specials.every((s) => s.requires));
  assert.ok(
    data.creatures
      .flatMap((c) => c.skills)
      .filter((s) => s.method === "血脉")
      .every((s) => s.blood),
  );
});
