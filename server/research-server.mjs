import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { ResearchStore, digest } from "./store.mjs";
import { validateExperiment, ROLES } from "./experiment-config.mjs";
import { DIMENSIONS } from "./evaluation.mjs";
import { pilotAdmission } from "../src/pilot-admission.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const readJson = async (name) =>
  JSON.parse(await readFile(resolve(ROOT, name), "utf8"));
export async function createResearchServer({
  database = resolve(ROOT, ".local/research.sqlite"),
  port = 4198,
} = {}) {
  const [bundle, manifest, data, rules] = await Promise.all([
    readJson("data/catalog-s4-20261015.json"),
    readJson("public/data/pilot-manifest.json"),
    readJson("public/data/team-2026-10-14.json"),
    readJson("data/mechanic-assumptions.json"),
  ]);
  const sourceFiles = [
    "src/team-engine.mjs",
    "src/team-stats.mjs",
    "src/battle-arithmetic.mjs",
    "src/team-rl.mjs",
    "src/research.mjs",
    "server/experiment-worker.mjs",
    "server/evaluation.mjs",
    "server/experiment-config.mjs",
  ];
  const engineHash = digest({
    data,
    files: await Promise.all(
      sourceFiles.map((f) => readFile(resolve(ROOT, f), "utf8")),
    ),
  });
  const store = new ResearchStore(database),
    snapshot = store.importSnapshot(bundle, manifest, data, rules);
  for (const run of store.listExperiments())
    if (run.status === "running")
      store.update(run.id, {
        status: "paused",
        error: "服务曾中断；保留最近完整检查点，可手动继续",
      });
  let active = null,
    closing = false;
  const elapsed = (a) => a.priorMs + Math.round(performance.now() - a.started);
  async function finish(a, status, error = null, report = undefined) {
    if (a.finished) return;
    a.finished = true;
    clearTimeout(a.timer);
    clearInterval(a.heartbeat);
    store.update(a.id, {
      status,
      error,
      spentMs: Math.min(a.budgetMs, elapsed(a)),
      ...(report ? { report } : {}),
    });
    await a.worker.terminate();
    if (active === a) active = null;
    if (!closing) queueMicrotask(pump);
  }
  function pump() {
    if (closing || active) return;
    const pending = store
      .listExperiments()
      .filter((r) => r.status === "queued")
      .reverse()[0];
    if (!pending) return;
    const run = store.getExperiment(pending.id, true);
    try {
      validateExperiment(run.config, manifest, data);
    } catch (e) {
      store.update(run.id, { status: "failed", error: e.message });
      queueMicrotask(pump);
      return;
    }
    if (run.snapshotId !== snapshot || run.engineHash !== engineHash) {
      store.update(run.id, {
        status: "failed",
        error: "数据或执行代码版本已变化，请新建实验",
      });
      queueMicrotask(pump);
      return;
    }
    const budgetMs = run.config.maxSeconds * 1000;
    if (run.spentMs >= budgetMs) {
      store.update(run.id, { status: "budget-exhausted" });
      queueMicrotask(pump);
      return;
    }
    const worker = new Worker(
      new URL("./experiment-worker.mjs", import.meta.url),
      {
        workerData: {
          config: run.config,
          data,
          checkpoint: run.checkpoint,
          context: {
            snapshotId: snapshot,
            engineHash,
            dataVersion: data.version,
            catalogVersion: manifest.sourceDeclaredVersion,
          },
        },
        resourceLimits: { maxOldGenerationSizeMb: 384 },
      },
    );
    const a = {
      id: run.id,
      worker,
      priorMs: run.spentMs,
      started: performance.now(),
      budgetMs,
      finished: false,
    };
    active = a;
    store.update(run.id, { status: "running", error: null });
    a.timer = setTimeout(
      () =>
        void finish(
          a,
          "budget-exhausted",
          "已达到累计运行时限，保留最近完整检查点",
        ),
      budgetMs - run.spentMs,
    );
    a.heartbeat = setInterval(() => {
      if (!a.finished)
        store.update(run.id, { spentMs: Math.min(budgetMs, elapsed(a)) });
    }, 1000);
    worker.on("message", (message) => {
      if (a.finished) return;
      if (elapsed(a) >= budgetMs) {
        void finish(
          a,
          "budget-exhausted",
          "已达到累计运行时限，保留最近完整检查点",
        );
        return;
      }
      try {
        if (message.type === "checkpoint")
          store.saveCheckpoint(
            a.id,
            message.state,
            message.metric,
            Math.min(budgetMs, elapsed(a)),
          );
        else if (message.type === "done")
          void finish(a, "completed", null, message.report);
      } catch (e) {
        void finish(a, "failed", e.message);
      }
    });
    worker.on("error", (e) => void finish(a, "failed", e.message));
    worker.on("exit", (code) => {
      if (!a.finished) void finish(a, "failed", `工作线程提前退出：${code}`);
    });
  }
  const json = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    try {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? ""))
        return json(res, 403, { error: "仅接受本机请求" });
      const origin = req.headers.origin;
      const address = server.address();
      const allowedOrigins = [
        `http://127.0.0.1:${address.port}`,
        `http://localhost:${address.port}`,
        "http://127.0.0.1:4197",
        "http://localhost:4197",
      ];
      if (origin && !allowedOrigins.includes(origin))
        return json(res, 403, { error: "请求来源不受信任" });
      const url = new URL(req.url, "http://127.0.0.1");
      const path = url.pathname;
      if (req.method === "GET" && path === "/api/learning") {
        try {
          return json(
            res,
            200,
            await readJson("docs/evidence/learning-progress-v2.json"),
          );
        } catch (e) {
          if (e.code === "ENOENT")
            return json(res, 200, { runs: [], limitations: [] });
          throw e;
        }
      }
      if (req.method === "GET" && path === "/api/overview")
        return json(res, 200, {
          snapshotId: snapshot,
          engineHash,
          catalogVersion: manifest.sourceDeclaredVersion,
          counts: manifest.counts,
          gate: pilotAdmission(manifest),
          apiTokens: 0,
          approvedReports: 0,
          prototypeTargets: Object.values(data.creatures).filter((c) =>
            manifest.roster.some(
              (r) =>
                r.id === c.id &&
                r.classification === "highest-normal-candidate",
            ),
          ),
          roles: ROLES,
          dimensions: DIMENSIONS,
          rules,
        });
      if (req.method === "GET" && path === "/api/roster") {
        const page = Number(url.searchParams.get("page") ?? 1),
          query = url.searchParams.get("query") ?? "";
        const classification =
          url.searchParams.get("classification") ?? "highest-normal-candidate";
        if (
          !Number.isInteger(page) ||
          page < 1 ||
          page > 10000 ||
          query.length > 100 ||
          ![
            "",
            "highest-normal-candidate",
            "lord-special-mechanism",
            "excluded-lower-form",
          ].includes(classification)
        )
          throw Error("目录筛选条件无效");
        return json(
          res,
          200,
          store.listRoster(snapshot, { query, classification, page }),
        );
      }
      if (req.method === "GET" && path === "/api/experiments")
        return json(res, 200, store.listExperiments());
      if (req.method === "GET" && path === "/api/project-plan")
        return json(res, 200, {
          text: await readFile(
            resolve(ROOT, "docs/project-plan-v4.md"),
            "utf8",
          ),
        });
      const match = path.match(
        /^\/api\/experiments\/([a-f0-9-]{36})(?:\/(report|pause|resume))?$/,
      );
      if (req.method === "GET" && match) {
        const run = store.getExperiment(match[1]);
        if (!run) return json(res, 404, { error: "实验不存在" });
        if (match[2] && match[2] !== "report")
          return json(res, 405, { error: "该操作需POST" });
        if (match[2] === "report" && !run.report)
          return json(res, 409, { error: "尚无完整报告" });
        if (match[2] === "report")
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="research-${run.id}.json"`,
          );
        return json(res, 200, match[2] === "report" ? run.report : run);
      }
      if (req.method === "POST") {
        if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
          return json(res, 415, { error: "需要JSON请求" });
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 32768) throw Error("请求过大");
        }
        const input = JSON.parse(body || "{}");
        if (path === "/api/experiments") {
          if (
            store
              .listExperiments()
              .filter((r) => ["queued", "running"].includes(r.status)).length >=
            5
          )
            throw Error("最多允许5个待执行实验");
          const config = validateExperiment(input, manifest, data);
          const run = store.createExperiment(snapshot, engineHash, config);
          queueMicrotask(pump);
          return json(res, 201, run);
        }
        if (match && ["pause", "resume"].includes(match[2])) {
          const run = store.getExperiment(match[1]);
          if (!run) return json(res, 404, { error: "实验不存在" });
          if (match[2] === "pause") {
            if (!["queued", "running"].includes(run.status))
              throw Error("当前状态不能暂停");
            if (active?.id === run.id) await finish(active, "paused");
            else store.update(run.id, { status: "paused" });
          } else {
            if (
              run.status !== "paused" ||
              run.spentMs >= run.config.maxSeconds * 1000
            )
              throw Error("仅可继续仍有预算的暂停实验");
            store.update(run.id, { status: "queued", error: null });
            queueMicrotask(pump);
          }
          return json(res, 200, store.getExperiment(run.id));
        }
        return json(res, 404, { error: "接口不存在" });
      }
      if (path.startsWith("/api/"))
        return json(res, 404, { error: "接口不存在" });
      if (req.method !== "GET")
        return json(res, 405, { error: "不支持的请求方法" });
      const root = resolve(ROOT, "dist"),
        candidate = resolve(root, "." + decodeURIComponent(path));
      if (candidate !== root && !candidate.startsWith(root + sep))
        return json(res, 403, { error: "路径无效" });
      let file = candidate;
      try {
        if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
      } catch {
        file = resolve(root, "index.html");
      }
      const bytes = await readFile(file);
      res.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".png": "image/png",
            ".svg": "image/svg+xml",
          }[extname(file)] ?? "application/octet-stream",
      });
      res.end(bytes);
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });
  await new Promise((resolveListen) =>
    server.listen(port, "127.0.0.1", resolveListen),
  );
  queueMicrotask(pump);
  return {
    server,
    store,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      closing = true;
      if (active) await finish(active, "paused", "服务关闭，保留检查点");
      await new Promise((done) => server.close(done));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createResearchServer();
  console.log(
    `Research workbench: ${app.url}; one local worker; no model API calls.`,
  );
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (!stopping) {
        stopping = true;
        await app.close();
      }
    });
}
