import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ResearchStore } from "../server/store.mjs";
import { validateExperiment } from "../server/experiment-config.mjs";
import { clusteredEstimate, pairedImpact } from "../server/evaluation.mjs";
import { createResearchServer } from "../server/research-server.mjs";

const load = async (path) =>
  JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
const [bundle, manifest, data, rules] = await Promise.all([
  load("data/catalog-s4-20261015.json"),
  load("public/data/pilot-manifest.json"),
  load("public/data/team-2026-10-14.json"),
  load("data/mechanic-assumptions.json"),
]);
const good = {
  target: "pet_000028",
  episodes: 100,
  maxSeconds: 60,
  population: 2,
};

test("预算、未知字段与未实现对象不能绕过服务端校验", () => {
  for (const patch of [
    { episodes: 99 },
    { episodes: 101 },
    { episodes: 2100 },
    { maxSeconds: 601 },
    { seed: -1 },
    { population: 7 },
    { command: "anything" },
    { role: "核心" },
    { target: "unknown" },
  ])
    assert.throws(() =>
      validateExperiment({ ...good, ...patch }, manifest, data),
    );
  assert.equal(validateExperiment(good, manifest, data).mode, "prototype");
});
test("正式研究不因原型可运行而开放", () => {
  assert.throws(
    () => validateExperiment({ ...good, mode: "formal" }, manifest, data),
    /核验/,
  );
  const passed = {
    ...manifest,
    checks: manifest.checks.map((c) => ({
      ...c,
      status: "passed",
      evidence: ["fixture"],
    })),
    targets: manifest.targets.map((t) => ({
      ...t,
      classification: "highest-normal-candidate",
      missingMoveIds: [],
      legalPvpStatus: "verified",
      dynamicClosureStatus: "verified",
      jointBuildLegality: "verified",
    })),
  };
  assert.throws(
    () => validateExperiment({ ...good, mode: "formal" }, passed, data),
    /正式规则适配器尚未实现/,
  );
});
test("数据库导入幂等；新版本保留旧资料；图鉴按编号排列", () => {
  const store = new ResearchStore(":memory:");
  try {
    const id = store.importSnapshot(bundle, manifest, data, rules);
    assert.equal(store.importSnapshot(bundle, manifest, data, rules), id);
    assert.equal(store.listRoster(id).total, 259);
    assert.equal(store.listRoster(id).rows.length, 6);
    assert.equal(store.listRoster(id, { query: "' OR 1=1 --" }).total, 0);
    assert.equal(
      store.listRoster(id, { query: "奇丽花" }).rows[0].id,
      good.target,
    );
    const changed = store.importSnapshot(bundle, manifest, data, [
      ...rules,
      { id: "new-rule", status: "pending" },
    ]);
    assert.notEqual(changed, id);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM snapshots").get().n,
      2,
    );
    const row = store.db
      .prepare(
        "SELECT status FROM mechanics WHERE snapshot_id=? AND rule_id='grass-bench-healing'",
      )
      .get(id);
    assert.equal(row.status, "hypothesis");
  } finally {
    store.close();
  }
});
test("检查点与指标事务一致，失败事务不会半写入", () => {
  const store = new ResearchStore(":memory:");
  try {
    const id = store.importSnapshot(bundle, manifest, data, rules);
    const run = store.createExperiment(id, "engine-fixture", good);
    store.saveCheckpoint(
      run.id,
      { completed: 100, model: { marker: "saved" } },
      { phase: "自博弈" },
      20,
    );
    assert.equal(
      store.getExperiment(run.id, true).checkpoint.model.marker,
      "saved",
    );
    assert.throws(() =>
      store.transaction(() => {
        store.update(run.id, { completed: 200 });
        throw Error("abort");
      }),
    );
    assert.equal(store.getExperiment(run.id).completed, 100);
    assert.equal(store.getExperiment(run.id).metrics.length, 1);
  } finally {
    store.close();
  }
});
test("重复座位不增加独立样本量，样本不足不展示置信区间", () => {
  const rows = Array.from({ length: 80 }, (_, n) => ({
    opponent: `o${n % 2}`,
    score: n % 2,
  }));
  const estimate = clusteredEstimate(rows);
  assert.equal(estimate.mean, 0.5);
  assert.equal(estimate.opponentClusters, 2);
  assert.equal(estimate.interval95, null);
  const ten = clusteredEstimate(
    Array.from({ length: 10 }, (_, n) => ({ opponent: `o${n}`, score: 1 })),
  );
  assert.deepEqual(ten.interval95, [1, 1]);
  assert.equal(clusteredEstimate([]).mean, null);
});
test("特性对照按相同对局条件配对，不接受缺失或重复样本", () => {
  const base = [
    { opponent: "o", role: 0, seat: 0, tieFirst: 0, seed: 42, score: 1 },
  ];
  assert.equal(pairedImpact(base, [{ ...base[0], score: 0 }]).mean, 1);
  assert.throws(() => pairedImpact(base, [{ ...base[0], seed: 43 }]));
  assert.throws(() => pairedImpact([base[0], base[0]], [base[0], base[0]]));
});
test(
  "本地API、真实100局训练、独立留出与报告导出",
  { timeout: 90000 },
  async () => {
    const app = await createResearchServer({ database: ":memory:", port: 0 });
    const call = async (path, method = "GET", value, headers = {}) => {
      const r = await fetch(app.url + "/api/" + path, {
        method,
        headers: {
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: value ? JSON.stringify(value) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
    try {
      assert.equal((await call("overview")).body.apiTokens, 0);
      assert.equal(
        (await call("roster?query=%E5%A5%87%E4%B8%BD%E8%8A%B1")).body.total,
        1,
      );
      assert.equal(
        (await call("experiments", "POST", { ...good, mode: "formal" })).status,
        400,
      );
      assert.equal(
        (
          await call("experiments", "POST", good, {
            Origin: "https://untrusted.example",
          })
        ).status,
        403,
      );
      const created = await call("experiments", "POST", good);
      assert.equal(created.status, 201);
      const id = created.body.id;
      await call(`experiments/${id}/pause`, "POST", {});
      assert.equal((await call(`experiments/${id}`)).body.status, "paused");
      assert.equal(
        (await call(`experiments/${id}/resume`, "POST", {})).status,
        200,
      );
      let run;
      const deadline = Date.now() + 70000;
      do {
        await new Promise((resolve) => setTimeout(resolve, 200));
        run = (await call(`experiments/${id}`)).body;
      } while (
        ["queued", "running"].includes(run.status) &&
        Date.now() < deadline
      );
      assert.equal(run.status, "completed", run.error);
      assert.equal(run.completed, 100);
      assert(run.metrics.some((m) => m.updates > 0));
      assert.equal(run.report.apiTokens, 0);
      assert.equal(run.report.canPublishBalanceConclusion, false);
      assert(run.report.candidates.length >= 1);
      assert(run.report.evaluationBattles > 0);
      assert.equal(run.report.candidates[0].team.members.length, 6);
      assert(
        run.report.candidates[0].team.members.some((m) => m.id === good.target),
      );
      assert.equal(run.report.candidates[0].performance.interval95, null);
      const keys = Object.values(run.report.splits)
        .flat()
        .map((t) => JSON.stringify(t.members));
      assert.equal(new Set(keys).size, keys.length);
      assert.equal(
        (await call(`experiments/${id}/report`)).body.scope,
        "prototype-only",
      );
    } finally {
      await app.close();
    }
  },
);
