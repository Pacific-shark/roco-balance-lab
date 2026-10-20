import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export class ResearchStore {
  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;",
    );
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (version > 1) throw Error("数据库版本高于当前应用，拒绝降级读取");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, version TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities(snapshot_id TEXT REFERENCES snapshots(id), kind TEXT, entity_id TEXT, name TEXT, payload TEXT NOT NULL, PRIMARY KEY(snapshot_id,kind,entity_id));
      CREATE TABLE IF NOT EXISTS roster(snapshot_id TEXT REFERENCES snapshots(id), entity_id TEXT, dex TEXT, name TEXT, classification TEXT, prototype_supported INTEGER, payload TEXT NOT NULL, PRIMARY KEY(snapshot_id,entity_id));
      CREATE INDEX IF NOT EXISTS roster_order ON roster(snapshot_id,dex,entity_id);
      CREATE TABLE IF NOT EXISTS mechanics(snapshot_id TEXT REFERENCES snapshots(id), rule_id TEXT, status TEXT, payload TEXT NOT NULL, PRIMARY KEY(snapshot_id,rule_id));
      CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, snapshot_id TEXT REFERENCES snapshots(id), engine_hash TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL, completed INTEGER DEFAULT 0, spent_ms INTEGER DEFAULT 0, checkpoint TEXT, report TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics(run_id TEXT REFERENCES experiments(id), sequence INTEGER, payload TEXT NOT NULL, PRIMARY KEY(run_id,sequence));
      PRAGMA user_version=1;
    `);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  importSnapshot(bundle, manifest, prototypeData, rules) {
    const id = digest({
      bundle,
      roster: manifest.roster,
      rules,
      prototypeSupport: Object.keys(prototypeData.creatures).sort(),
    });
    if (this.db.prepare("SELECT id FROM snapshots WHERE id=?").get(id))
      return id;
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO snapshots VALUES(?,?,?,?)")
        .run(
          id,
          manifest.sourceDeclaredVersion,
          JSON.stringify(bundle.provenance),
          new Date().toISOString(),
        );
      const entity = this.db.prepare("INSERT INTO entities VALUES(?,?,?,?,?)");
      for (const [kind, field] of [
        ["creature", "Catalog"],
        ["skill", "Skills"],
        ["learnset", "Learnsets"],
        ["term", "Terms"],
        ["evolution", "Evolutions"],
      ])
        for (const [key, value] of Object.entries(bundle.modules[field]))
          entity.run(
            id,
            kind,
            key,
            value.name ?? value.note ?? key,
            JSON.stringify(value),
          );
      const row = this.db.prepare("INSERT INTO roster VALUES(?,?,?,?,?,?,?)");
      for (const value of manifest.roster)
        row.run(
          id,
          value.id,
          value.dex,
          value.name,
          value.classification,
          Number(Object.hasOwn(prototypeData.creatures, value.id)),
          JSON.stringify(value),
        );
      const rule = this.db.prepare("INSERT INTO mechanics VALUES(?,?,?,?)");
      for (const value of rules)
        rule.run(id, value.id, value.status, JSON.stringify(value));
    });
    return id;
  }
  listRoster(
    snapshot,
    { query = "", classification = "highest-normal-candidate", page = 1 } = {},
  ) {
    const pattern = `%${query.replace(/[\\%_]/g, (s) => "\\" + s)}%`;
    const where =
      "snapshot_id=? AND (?='' OR classification=?) AND (name LIKE ? ESCAPE '\\' OR dex LIKE ? ESCAPE '\\')";
    const args = [snapshot, classification, classification, pattern, pattern];
    const total = this.db
      .prepare(`SELECT COUNT(*) AS n FROM roster WHERE ${where}`)
      .get(...args).n;
    const rows = this.db
      .prepare(
        `SELECT * FROM roster WHERE ${where} ORDER BY CAST(dex AS INTEGER),entity_id LIMIT 6 OFFSET ?`,
      )
      .all(...args, (page - 1) * 6);
    return {
      total,
      page,
      rows: rows.map((r) => ({
        ...JSON.parse(r.payload),
        prototypeSupported: Boolean(r.prototype_supported),
      })),
    };
  }
  createExperiment(snapshot, engineHash, config) {
    const id = randomUUID(),
      now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO experiments(id,snapshot_id,engine_hash,config,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        snapshot,
        engineHash,
        JSON.stringify(config),
        "queued",
        now,
        now,
      );
    return this.getExperiment(id);
  }
  getExperiment(id, checkpoint = false) {
    const r = this.db.prepare("SELECT * FROM experiments WHERE id=?").get(id);
    if (!r) return null;
    return {
      id: r.id,
      snapshotId: r.snapshot_id,
      engineHash: r.engine_hash,
      config: JSON.parse(r.config),
      status: r.status,
      completed: r.completed,
      spentMs: r.spent_ms,
      report: r.report ? JSON.parse(r.report) : null,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...(checkpoint
        ? { checkpoint: r.checkpoint ? JSON.parse(r.checkpoint) : null }
        : {}),
      metrics: this.db
        .prepare("SELECT payload FROM metrics WHERE run_id=? ORDER BY sequence")
        .all(id)
        .map((x) => JSON.parse(x.payload)),
    };
  }
  listExperiments() {
    return this.db
      .prepare(
        `SELECT id,snapshot_id,engine_hash,config,status,completed,spent_ms,error,created_at,updated_at,
      report IS NOT NULL AS has_report,
      (SELECT payload FROM metrics WHERE run_id=experiments.id ORDER BY sequence DESC LIMIT 1) AS latest_metric
      FROM experiments ORDER BY created_at DESC LIMIT 100`,
      )
      .all()
      .map((r) => ({
        id: r.id,
        snapshotId: r.snapshot_id,
        engineHash: r.engine_hash,
        config: JSON.parse(r.config),
        status: r.status,
        completed: r.completed,
        spentMs: r.spent_ms,
        error: r.error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        hasReport: Boolean(r.has_report),
        phase: r.latest_metric ? JSON.parse(r.latest_metric).phase : r.status,
      }));
  }
  update(id, values) {
    const fields = {
      status: "status",
      completed: "completed",
      spentMs: "spent_ms",
      checkpoint: "checkpoint",
      report: "report",
      error: "error",
    };
    const entries = Object.entries(values);
    if (!entries.length || entries.some(([k]) => !fields[k]))
      throw Error("无效实验更新字段");
    this.db
      .prepare(
        `UPDATE experiments SET ${entries.map(([k]) => fields[k] + "=?").join(",")},updated_at=? WHERE id=?`,
      )
      .run(
        ...entries.map(([k, v]) =>
          ["checkpoint", "report"].includes(k) ? JSON.stringify(v) : v,
        ),
        new Date().toISOString(),
        id,
      );
  }
  saveCheckpoint(id, checkpoint, metric, spentMs) {
    this.transaction(() => {
      this.update(id, { checkpoint, completed: checkpoint.completed, spentMs });
      const seq = this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence),0)+1 AS n FROM metrics WHERE run_id=?",
        )
        .get(id).n;
      this.db
        .prepare("INSERT INTO metrics VALUES(?,?,?)")
        .run(id, seq, JSON.stringify(metric));
    });
  }
  close() {
    this.db.close();
  }
}
