import React, { useEffect, useRef, useState } from "react";
import "./workbench.css";
import LearningEvidence from "./LearningEvidence.jsx";

const api = async (path, options) => {
  const response = await fetch(`api/${path}`, options);
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? "请求失败");
  return result;
};
const post = (path, value = {}) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
const labels = {
  queued: "等待运行",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  "budget-exhausted": "预算已用完",
  failed: "运行失败",
};
const pct = (n) => (n == null ? "证据不足" : `${(n * 100).toFixed(1)}%`);

function Report({ run }) {
  const report = run.report;
  return (
    <div className="wb-report">
      <p>
        {report.title} · {report.actualTrainingEpisodes} 局训练 /{" "}
        {report.evaluationBattles} 局评估
      </p>
      <p className="wb-muted">
        来源 {report.context.catalogVersion}；执行环境{" "}
        {report.context.dataVersion}。两者分别固定，原型结果不代表当前排位。
      </p>
      {report.candidates.map((candidate, i) => (
        <section key={candidate.team.id}>
          <h3>
            配队 {i + 1} · 冻结测试得分 {pct(candidate.performance.mean)}
          </h3>
          <p>
            特性敏感度（保留−移除）：
            {candidate.traitSensitivity.mean == null
              ? "未计算"
              : `${(candidate.traitSensitivity.mean * 100).toFixed(1)} 个百分点`}
            。这是冻结策略对照，不是最优反制后的结论。
          </p>
          <p className="wb-muted">{candidate.performance.reason}</p>
          <table>
            <thead>
              <tr>
                <th>评价维度</th>
                <th>要回答的问题</th>
                <th>证据状态</th>
              </tr>
            </thead>
            <tbody>
              {candidate.dimensions.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.question}</td>
                  <td>
                    {d.status === "prototype-evidence"
                      ? "原型证据"
                      : "待补证据"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>查看六人配队、培养与技能</summary>
            {candidate.lineup ? (
              <table>
                <thead>
                  <tr>
                    <th>精灵 / 特性</th>
                    <th>性格</th>
                    <th>四技能（按槽位）</th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.lineup.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {m.name}
                        <small>{m.trait}</small>
                      </td>
                      <td>{m.nature}</td>
                      <td>{m.moveNames.join(" / ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <pre>{JSON.stringify(candidate.team.members, null, 2)}</pre>
          </details>
          <details>
            <summary>查看一局逐回合证据</summary>
            <pre>
              {JSON.stringify(
                candidate.rows.find((r) => r.trace?.length)?.trace ?? [],
                null,
                2,
              )}
            </pre>
          </details>
        </section>
      ))}
      <details>
        <summary>方法与适用范围</summary>
        <ul>
          {report.limitations.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
      <a
        className="wb-button"
        href={`api/experiments/${run.id}/report`}
        download
      >
        下载完整报告 JSON
      </a>
    </div>
  );
}

function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="wb-dialog"
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button autoFocus onClick={onClose}>
          关闭
        </button>
      </header>
      {children}
    </dialog>
  );
}

export default function ResearchWorkbench({ onNavigate }) {
  const [overview, setOverview] = useState(null),
    [roster, setRoster] = useState({ rows: [], total: 0 });
  const [query, setQuery] = useState(""),
    [classification, setClassification] = useState("highest-normal-candidate"),
    [page, setPage] = useState(1);
  const [runs, setRuns] = useState([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState(null),
    [selected, setSelected] = useState(null);
  const [config, setConfig] = useState({
    target: "pet_000028",
    role: "不预设角色",
    mode: "prototype",
    episodes: 100,
    maxSeconds: 60,
    seed: 42,
    population: 3,
  });
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api("overview", { signal: controller.signal }),
      api("experiments", { signal: controller.signal }),
    ])
      .then(([info, records]) => {
        setOverview(info);
        setRuns(records);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError("本地服务未连接。请运行 pnpm start 后打开本页。");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        api(`roster?${new URLSearchParams({ query, classification, page })}`, {
          signal: controller.signal,
        })
          .then(setRoster)
          .catch((e) => {
            if (e.name !== "AbortError") setError(e.message);
          }),
      180,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, classification, page]);
  const hasActive = runs.some((r) => ["running", "queued"].includes(r.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(
      () =>
        api("experiments")
          .then(setRuns)
          .catch((e) => setError(e.message)),
      4000,
    );
    return () => clearInterval(timer);
  }, [hasActive]);
  const update = (key, value) => setConfig((old) => ({ ...old, [key]: value }));
  const choose = (row) => {
    setSelected(row);
    update("target", row.id);
    setNotice(`已选择${row.name}`);
  };
  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("experiments", config);
      setRuns(await api("experiments"));
      setNotice("实验已创建，将按预算在本地运行。");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const action = async (id, verb) => {
    try {
      await post(`experiments/${id}/${verb}`);
      setRuns(await api("experiments"));
      setNotice(
        verb === "pause" ? "已暂停，保留完整检查点。" : "已加入继续队列。",
      );
    } catch (e) {
      setError(e.message);
    }
  };
  const viewRun = async (id) => {
    try {
      setDialog({ type: "run", data: await api(`experiments/${id}`) });
    } catch (e) {
      setError(e.message);
    }
  };
  const viewPlan = async () => {
    try {
      setDialog({ type: "plan", data: await api("project-plan") });
    } catch (e) {
      setError(e.message);
    }
  };
  const supported = overview?.prototypeTargets.some(
    (t) => t.id === config.target,
  );
  const name = (id) =>
    overview?.prototypeTargets.find((c) => c.id === id)?.name ??
    selected?.name ??
    id;
  return (
    <div className="workbench">
      <aside className="wb-rail">
        <div className="wb-brand">洛克研究室</div>
        <nav aria-label="研究导航">
          <button aria-current="page">研究工作台</button>
          <button onClick={() => window.location.assign(import.meta.env.BASE_URL)}>← 精灵图鉴</button>
          <button onClick={() => onNavigate("catalog")}>精灵资料</button>
          <button onClick={() => onNavigate("team")}>6v6 原型</button>
          <button onClick={viewPlan}>方法与边界</button>
          <button
            onClick={async () => {
              try {
                setDialog({ type: "learning", data: await api("learning") });
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            学习验证
          </button>
        </nav>
        <div className="wb-rail-foot">
          私人项目{" "}
          <a
            href="https://github.com/Pacific-shark/roco-balance-lab"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </aside>
      <main className="wb-main">
        <header className="wb-top">
          <div>
            <h1>逐精灵研究</h1>
            <p>从六人配队与对局证据，解释精灵的价值。</p>
          </div>
          <button onClick={viewPlan}>项目方案</button>
        </header>
        {error ? (
          <div className="wb-alert" role="alert">
            {error}
          </div>
        ) : null}
        <section className="wb-metrics" aria-label="研究范围">
          <div>
            <strong>
              {overview?.counts.roster["highest-normal-candidate"] ?? "—"}
            </strong>
            <span>最高常规形态候选</span>
          </div>
          <div>
            <strong>{overview?.counts.pilotTargets ?? "—"}</strong>
            <span>当前核验对象</span>
          </div>
          <div>
            <strong>{overview?.approvedReports ?? "—"}</strong>
            <span>已核准强度报告</span>
          </div>
          <div>
            <strong>{overview?.apiTokens ?? "—"}</strong>
            <span>训练 API token</span>
          </div>
        </section>
        <div className="wb-columns">
          <section className="wb-panel wb-queue">
            <h2>研究队列</h2>
            <div className="wb-search">
              <input
                aria-label="搜索精灵或图鉴编号"
                placeholder="搜索精灵或图鉴编号"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
              <select
                aria-label="形态筛选"
                value={classification}
                onChange={(e) => {
                  setClassification(e.target.value);
                  setPage(1);
                }}
              >
                <option value="highest-normal-candidate">最高常规形态</option>
                <option value="lord-special-mechanism">首领特殊机制</option>
                <option value="excluded-lower-form">低阶形态</option>
              </select>
            </div>
            <div className="wb-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>精灵</th>
                    <th>当前状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.rows.map((row) => (
                    <tr
                      key={row.id}
                      className={row.id === config.target ? "wb-selected" : ""}
                    >
                      <td>{row.dex}</td>
                      <td>
                        {row.name}
                        {row.form && row.form !== "主形态" ? (
                          <small>{row.form}</small>
                        ) : null}
                      </td>
                      <td>
                        {row.legalPvpStatus === "verified"
                          ? "已核验"
                          : "待核验"}
                      </td>
                      <td>
                        <button className="wb-link" onClick={() => choose(row)}>
                          {row.prototypeSupported ? "建立研究" : "查看资料"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!roster.rows.length ? (
                <p className="wb-empty">没有匹配的精灵</p>
              ) : null}
            </div>
            <div className="wb-pagination">
              <span>
                共 {roster.total} 个候选 · 第 {page} 页
              </span>
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                上一页
              </button>
              <button
                disabled={page * 6 >= roster.total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          </section>
          <section className="wb-panel">
            <h2>新建实验</h2>
            <form onSubmit={create}>
              <label>
                研究对象
                <select
                  value={config.target}
                  onChange={(e) => {
                    update("target", e.target.value);
                    setSelected(null);
                  }}
                >
                  {!supported && selected ? (
                    <option value={selected.id}>
                      {selected.name}（机制待接入）
                    </option>
                  ) : null}
                  {overview?.prototypeTargets.map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                角色假设
                <select
                  value={config.role}
                  onChange={(e) => update("role", e.target.value)}
                >
                  {(overview?.roles ?? ["不预设角色"]).map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label>
                模式
                <select
                  value={config.mode}
                  onChange={(e) => update("mode", e.target.value)}
                >
                  <option value="prototype">流程验证（受限原型）</option>
                  <option value="formal">正式强度研究（待核验）</option>
                </select>
              </label>
              <div className="wb-budget">
                <label>
                  训练局数
                  <input
                    type="number"
                    min="100"
                    max="2000"
                    step="100"
                    value={config.episodes}
                    onChange={(e) => update("episodes", Number(e.target.value))}
                    required
                  />
                </label>
                <label>
                  最长运行 / 秒
                  <input
                    type="number"
                    min="10"
                    max="600"
                    value={config.maxSeconds}
                    onChange={(e) =>
                      update("maxSeconds", Number(e.target.value))
                    }
                    required
                  />
                </label>
                <label>
                  随机种子
                  <input
                    type="number"
                    min="0"
                    max="1000000000"
                    value={config.seed}
                    onChange={(e) => update("seed", Number(e.target.value))}
                    required
                  />
                </label>
              </div>
              <p className="wb-muted">
                {config.mode === "formal"
                  ? `仍有 ${overview?.gate.blockers.length ?? "—"} 项核验未完成，正式研究暂不开放。`
                  : supported
                    ? "原型结果仅用于验证研究流程。每100局保存一次，单任务运行，不调用大模型。"
                    : "该精灵已有资料，战斗机制尚未接入；可以查阅，暂不能训练。"}
              </p>
              <button
                className="wb-primary"
                disabled={
                  busy || !overview || !supported || config.mode === "formal"
                }
              >
                {busy ? "正在创建…" : "创建实验"}
              </button>
            </form>
          </section>
        </div>
        {selected ? (
          <section className="wb-panel wb-detail">
            <h2>{selected.name} · 资料摘录</h2>
            <p>
              图鉴 {selected.dex} · 特性编号 {selected.traitId} ·
              模式准入：待核验
            </p>
            <dl>
              {Object.entries(selected.stats).map(([k, v]) => (
                <div key={k}>
                  <dt>
                    {
                      {
                        hp: "生命",
                        atk: "物攻",
                        def: "物防",
                        spa: "魔攻",
                        spd: "魔防",
                        spe: "速度",
                      }[k]
                    }
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="wb-muted">
              这里是种族值，不是60级五星实战面板。最新资料快照不代表旧原型已同步实现。
            </p>
          </section>
        ) : null}
        <section className="wb-panel wb-runs">
          <h2>实验记录</h2>
          {!runs.length ? (
            <p className="wb-empty">
              尚无实验记录，创建后可查看进度、证据和评价。
            </p>
          ) : (
            <div className="wb-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>研究对象</th>
                    <th>状态 / 阶段</th>
                    <th>训练进度</th>
                    <th>累计用时</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        {name(run.config.target)}
                        <small>{run.id.slice(0, 8)}</small>
                      </td>
                      <td>
                        {labels[run.status]}
                        <small>{run.phase}</small>
                      </td>
                      <td>
                        {run.completed} / {run.config.episodes}
                      </td>
                      <td>{(run.spentMs / 1000).toFixed(1)}秒</td>
                      <td>
                        {["running", "queued"].includes(run.status) ? (
                          <button
                            className="wb-link"
                            onClick={() => action(run.id, "pause")}
                          >
                            暂停
                          </button>
                        ) : null}
                        {run.status === "paused" ? (
                          <button
                            className="wb-link"
                            onClick={() => action(run.id, "resume")}
                          >
                            继续
                          </button>
                        ) : null}
                        <button
                          className="wb-link"
                          onClick={() => viewRun(run.id)}
                        >
                          {run.hasReport ? "查看报告" : "查看进度"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <footer className="wb-footer">
          <span>数据快照与机制核验独立记录。{overview?.catalogVersion}</span>
          <span aria-live="polite">{notice}</span>
        </footer>
        {dialog ? (
          <Dialog
            title={
              dialog.type === "plan"
                ? "项目方案"
                : dialog.type === "learning"
                  ? "学习验证"
                  : name(dialog.data.config.target) + " · 实验详情"
            }
            onClose={() => setDialog(null)}
          >
            {dialog.type === "plan" ? (
              <pre className="wb-plan">{dialog.data.text}</pre>
            ) : dialog.type === "learning" ? (
              <LearningEvidence data={dialog.data} />
            ) : dialog.data.report ? (
              <Report run={dialog.data} />
            ) : (
              <div>
                <p>
                  {labels[dialog.data.status]} · 已完成 {dialog.data.completed}{" "}
                  局
                </p>
                {dialog.data.error ? <p>{dialog.data.error}</p> : null}
                <pre>{JSON.stringify(dialog.data.metrics, null, 2)}</pre>
              </div>
            )}
          </Dialog>
        ) : null}
      </main>
    </div>
  );
}
