import React, { useState, useMemo, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  ROSTER,
  MOVES,
  DEFAULT_ENV,
  DATA_VERSION,
  READ_DATE,
  RULE_VERSION,
  POLICY_LABELS,
  DISTRIBUTION_LABELS,
  getSpirit,
  defaultPatch,
  loadoutFor,
} from "./data.mjs";
import {
  evaluate,
  diagnose,
  battle,
  validateEnv,
  validatePatch,
} from "./engine.mjs";
import { makeReport } from "./report.mjs";
import Training from "./Training.jsx";
import Catalog from "./Catalog.jsx";
import { trainedPolicies, learnedPolicy } from "./rl.mjs";
import "./style.css";

const percent = (n) => (n * 100).toFixed((n * 100) % 1 ? 1 : 0) + "%";
const pp = (n) => (n > 0 ? "+" : "") + (n * 100).toFixed(1) + " pp";
const defaultIdea =
  "岚鸟在当前样本里优势较大。降低部分输出，是否能增加反制选择，同时保留先手收益？";
function readDraft() {
  try {
    const v = JSON.parse(localStorage.getItem("roco-lab.v1"));
    if (v?.version === 1) {
      v.env = { ...DEFAULT_ENV, ...v.env };
      validateEnv(v.env);
      validatePatch(v.patch);
      if (typeof v.idea === "string" && typeof v.note === "string") return v;
    }
  } catch {}
  return {
    version: 1,
    env: DEFAULT_ENV,
    patch: defaultPatch("020"),
    idea: defaultIdea,
    note: "",
  };
}
function Icon({ name }) {
  const shapes = {
    matrix: (
      <>
        <path d="M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16" />
      </>
    ),
    replay: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="m10 8 6 4-6 4z" />
      </>
    ),
    doc: (
      <>
        <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
function Select({ label, value, onChange, children }) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
function Metric({ label, value, help }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
      {help ? <small>{help}</small> : null}
    </div>
  );
}
function App() {
  const [initial] = useState(readDraft),
    [env, setEnv] = useState(initial.env),
    [patch, setPatch] = useState(initial.patch),
    [idea, setIdea] = useState(initial.idea),
    [note, setNote] = useState(initial.note);
  const [tab, setTab] = useState("training"),
    [result, setResult] = useState(null),
    [notice, setNotice] = useState(""),
    [matrixMode, setMatrixMode] = useState("base");
  const [pair, setPair] = useState(["020", "007"]),
    [replayPolicy, setReplayPolicy] = useState("greedy"),
    [turn, setTurn] = useState(1),
    [replayVersion, setReplayVersion] = useState("base");
  const [model, setModel] = useState(null);
  const overrides = useMemo(
    () =>
      env.policy === "selfplay" && model
        ? { policies: trainedPolicies(model) }
        : {},
    [env.policy, model],
  );
  const baseline = useMemo(
    () =>
      evaluate(
        {
          ...env,
          policy: env.policy === "selfplay" && !model ? "both" : env.policy,
        },
        null,
        overrides,
      ),
    [env, overrides],
  );
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}models/selfplay-42.json`)
      .then((r) => {
        if (!r.ok) throw new Error("模型加载失败");
        return r.json();
      })
      .then((m) => {
        if (live) {
          setModel(m);
          setEnv((e) => ({ ...e, policy: "selfplay" }));
        }
      })
      .catch(() => {
        if (live) setNotice("已训练模型未加载，请在自博弈页面重新训练或读取。");
      });
    return () => {
      live = false;
    };
  }, []);
  const acceptModel = (m) => {
    setModel(m);
    setEnv({ ...m.env, policy: "selfplay" });
    setResult(null);
    setMatrixMode("base");
    setReplayVersion("base");
  };
  const target = getSpirit(patch.id),
    baseRow = baseline.ranking.find((x) => x.id === patch.id);
  const diagnosis = useMemo(
    () => diagnose(patch.id, baseline, overrides),
    [patch.id, baseline, overrides],
  );
  const after = result?.data,
    afterRow = after?.ranking.find((x) => x.id === patch.id);
  const dirty =
    result && JSON.stringify(result.patch) !== JSON.stringify(patch);
  const matrix = matrixMode === "after" && after ? after : baseline;
  const replay = useMemo(
    () =>
      battle(pair[0], pair[1], {
        env,
        patch: replayVersion === "after" ? result?.patch : null,
        policyA:
          replayPolicy === "selfplay" && model
            ? learnedPolicy(model.agents[0])
            : replayPolicy,
        policyB:
          replayPolicy === "selfplay" && model
            ? learnedPolicy(model.agents[1])
            : replayPolicy,
      }),
    [pair, env, replayPolicy, replayVersion, result, model],
  );
  const current = replay.trace[Math.min(turn, replay.turns) - 1];
  useEffect(() => {
    try {
      localStorage.setItem(
        "roco-lab.v1",
        JSON.stringify({ version: 1, env, patch, idea, note }),
      );
    } catch {
      setNotice("当前浏览器无法保存草稿，仍可导出报告。");
    }
  }, [env, patch, idea, note]);
  const environment = (key, value) => {
    setEnv({ ...env, [key]: value });
    setResult(null);
    setMatrixMode("base");
    setReplayVersion("base");
    setTurn(1);
    setNotice("环境已更新，调整方案需要重新运行。");
  };
  const selectSpirit = (id) => {
    setPatch(defaultPatch(id));
    setResult(null);
    setMatrixMode("base");
    setReplayVersion("base");
    setIdea(
      `${getSpirit(id).name}的机制是否带来难以反制的优势？比较参数调整前后的得分、反制数和回合长度。`,
    );
    setNotice("");
  };
  const run = () => {
    setResult({ patch: { ...patch }, data: evaluate(env, patch, overrides) });
    setNotice("对照实验已完成，可点击矩阵查看具体对局。");
  };
  const exportReport = () => {
    const text = makeReport(
      baseline,
      after,
      result?.patch ?? patch,
      idea,
      note,
      model,
    );
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `洛克平衡实验_${target.name}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("实验报告已导出，包含参数、结果与来源。");
  };
  function openReplay(i, j) {
    setReplayPolicy(env.policy === "selfplay" && model ? "selfplay" : "greedy");
    setPair([ROSTER[i].id, ROSTER[j].id]);
    setReplayVersion(matrixMode === "after" && after ? "after" : "base");
    setTurn(1);
    setTab("replay");
  }
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          洛克平衡实验室<small>Roco Balance Lab</small>
        </div>
        <nav aria-label="主导航">
          {[
            ["catalog", "doc", "图鉴与机制"],
            ["training", "matrix", "自博弈训练"],
            ["lab", "matrix", "实验工作台"],
            ["replay", "replay", "对局回放"],
            ["product", "doc", "产品说明"],
          ].map(([id, icon, title]) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon name={icon} />
              {title}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          个人策划作品 · v0.1<small>郝宝焜 / 2026</small>
          <a
            href="https://github.com/Pacific-shark/roco-balance-lab"
            target="_blank"
            rel="noreferrer"
          >
            查看源码 ↗
          </a>
        </div>
      </aside>
      <main>
        <header className="top">
          <div>
            <h1>
              {tab === "catalog"
                ? "图鉴与机制"
                : tab === "training"
                  ? "自博弈与设计分析"
                  : tab === "lab"
                    ? "平衡实验台"
                    : tab === "replay"
                      ? "对局回放"
                      : "这个项目想解决什么"}
            </h1>
            <p>
              {tab === "catalog"
                ? "先核对数据与学习条件，再确定模拟哪些机制。"
                : tab === "training"
                  ? "从两个 AI 的对战中，寻找值得检查的设计问题。"
                  : tab === "lab"
                    ? "先看优势从哪来，再讨论怎么改。"
                    : tab === "replay"
                      ? "逐回合核对伤害、能量与行动顺序。"
                      : "一次小范围的策划验证，保留过程，也保留疑问。"}
            </p>
          </div>
          <button
            className="primary export"
            onClick={exportReport}
            disabled={tab === "catalog"}
            title={tab === "catalog" ? "在实验工作台运行后导出" : undefined}
          >
            <Icon name="download" />
            导出实验报告
          </button>
        </header>
        {tab !== "catalog" ? (
          <p className="data-readiness">
            训练流程原型 · 六精灵实验子集。全量 BWIKI
            资料已整理，尚未接入完整战斗规则。
            <button onClick={() => setTab("catalog")}>查看数据范围 ↗</button>
          </p>
        ) : null}
        {tab === "catalog" ? <Catalog /> : null}
        {tab === "training" ? (
          <Training
            model={model}
            onModel={acceptModel}
            env={env}
            patch={patch}
            onReplay={(a, b) => {
              setPair([a, b]);
              setReplayPolicy("selfplay");
              setReplayVersion("base");
              setTurn(1);
              setTab("replay");
            }}
          />
        ) : null}
        {tab === "lab" ? (
          <>
            <ol className="steps">
              <li>
                <b>01</b>发现风险
              </li>
              <li>
                <b>02</b>解释原因
              </li>
              <li>
                <b>03</b>调整验证
              </li>
            </ol>
            <section className="environment" aria-label="实验环境">
              <strong>实验环境</strong>
              <Select
                label="对手分布"
                value={env.distribution}
                onChange={(v) => environment("distribution", v)}
              >
                {Object.entries(DISTRIBUTION_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              <Select
                label="行动策略"
                value={env.policy}
                onChange={(v) => environment("policy", v)}
              >
                {Object.entries(POLICY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              <span className="scope">6 只精灵 · 固定配招 · 单挑</span>
              <details className="advanced">
                <summary>规则设置</summary>
                <div>
                  <Select
                    label="配招方案"
                    value={env.loadout ?? "native"}
                    onChange={(v) => environment("loadout", v)}
                  >
                    <option value="native">原生配招</option>
                    <option value="coverage">火神加入水系泡沫</option>
                  </Select>
                  <Select
                    label="统一生命值"
                    value={env.hp}
                    onChange={(v) => environment("hp", Number(v))}
                  >
                    {[300, 400, 600, 800].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                  <Select
                    label="初始能量"
                    value={env.startEnergy}
                    onChange={(v) => environment("startEnergy", Number(v))}
                  >
                    {[5, 10].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                  <p>
                    实验统一生命，避免混入未校准的生命公式；聚能暂设回复
                    4。布克棱岩初始能量由地脉决定。同速分别枚举两方先手。最多 40
                    回合，未分胜负计平局。
                  </p>
                </div>
              </details>
            </section>
            <div className="workspace">
              <div className="analysis-column">
                <section className="panel matrix-panel">
                  <div className="section-head">
                    <div>
                      <h2>
                        {matrixMode === "after" && after
                          ? "调整后对局矩阵"
                          : "基准对局矩阵"}
                      </h2>
                      <p>行对列的模拟得分，点击格子看回放。</p>
                    </div>
                    <div className="legend">
                      <i />
                      优势 <i />
                      劣势
                    </div>
                  </div>
                  {after ? (
                    <div className="segmented">
                      <button
                        className={matrixMode === "base" ? "active" : ""}
                        onClick={() => setMatrixMode("base")}
                      >
                        基准
                      </button>
                      <button
                        className={matrixMode === "after" ? "active" : ""}
                        onClick={() => setMatrixMode("after")}
                      >
                        调整后{dirty ? "（上次运行）" : ""}
                      </button>
                    </div>
                  ) : null}
                  <div className="table-scroll">
                    <table className="heatmap">
                      <thead>
                        <tr>
                          <th scope="col">我方 / 对手</th>
                          {ROSTER.map((s) => (
                            <th scope="col" key={s.id}>
                              {s.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ROSTER.map((s, i) => (
                          <tr key={s.id}>
                            <th scope="row">
                              <button
                                className={
                                  patch.id === s.id ? "target-name" : ""
                                }
                                onClick={() => selectSpirit(s.id)}
                              >
                                {s.name}
                              </button>
                            </th>
                            {ROSTER.map((e, j) => {
                              const val = matrix.matrix[i][j];
                              return (
                                <td
                                  key={e.id}
                                  className={
                                    val === null
                                      ? "mirror"
                                      : val > 0.5
                                        ? "win"
                                        : val < 0.5
                                          ? "loss"
                                          : "draw"
                                  }
                                >
                                  {val === null ? (
                                    "—"
                                  ) : (
                                    <button
                                      aria-label={`${s.name}对${e.name}，得分${percent(val)}，查看回放`}
                                      onClick={() => openReplay(i, j)}
                                    >
                                      {percent(val)}
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="metrics">
                    <Metric
                      label="最高对局得分"
                      value={percent(matrix.ranking[0].score)}
                      help={getSpirit(matrix.ranking[0].id).name}
                    />
                    <Metric
                      label={`${target.name}的反制对手`}
                      value={`${matrix.ranking.find((x) => x.id === patch.id).counters} / 5`}
                      help="目标得分 ≤25% 的对手"
                    />
                    <Metric
                      label="达到回合上限"
                      value={percent(matrix.cappedRate)}
                      help={`${matrix.battles} 个枚举对局`}
                    />
                  </div>
                  <p className="footnote">
                    胜 1 / 平 0.5 / 负
                    0。对局组合枚举，不是玩家胜率或独立统计样本。
                  </p>
                </section>
                <section className="panel reasons">
                  <div className="section-head">
                    <div>
                      <h2>{target.name}：优势从哪来</h2>
                      <p>固定其他设置，分别改动一个条件，观察得分差。</p>
                    </div>
                    <a href={target.source} target="_blank" rel="noreferrer">
                      图鉴来源 ↗
                    </a>
                  </div>
                  <div className="reason-row">
                    <b>01</b>
                    <div>
                      <strong>对手构成</strong>
                      <span>当前权重相对均匀分布的得分差</span>
                    </div>
                    <em>{pp(diagnosis.distributionDelta)}</em>
                  </div>
                  <div className="reason-row">
                    <b>02</b>
                    <div>
                      <strong>属性关系</strong>
                      <span>当前结果减去“全体取消属性克制”的结果</span>
                    </div>
                    <em>{pp(diagnosis.typeDelta)}</em>
                  </div>
                  <div className="reason-row">
                    <b>03</b>
                    <div>
                      <strong>特性收益</strong>
                      <span>当前结果减去“只移除{target.name}特性”的结果</span>
                    </div>
                    <em>{pp(diagnosis.traitDelta)}</em>
                  </div>
                  <p className="caution">
                    {target.id === "020"
                      ? "样本里没有冰、电系反制，可能抬高岚鸟得分。先补样本，再判断是否需要削弱。"
                      : target.id === "029"
                        ? "单挑无法完整体现地脉的队伍价值。可修改队友预热次数，但这只是入场条件实验。"
                        : "得分差只解释这套规则和策略。小数值改动没有改变胜负，也不代表机制没有作用。"}
                  </p>
                </section>
              </div>
              <div className="adjust-column">
                <section className="panel adjust">
                  <h2>验证一个假设</h2>
                  <p>保留玩法特色，看看代价是什么。</p>
                  <Select
                    label="选择精灵"
                    value={patch.id}
                    onChange={selectSpirit}
                  >
                    {ROSTER.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                  <label className="slider-label">
                    <span>
                      全技能威力系数 <b>{patch.power}%</b>
                    </span>
                    <input
                      aria-label="全技能威力系数"
                      type="range"
                      min="50"
                      max="150"
                      step="5"
                      value={patch.power}
                      onChange={(e) =>
                        setPatch({ ...patch, power: Number(e.target.value) })
                      }
                    />
                    <small>
                      <span>50%</span>
                      <span>150%</span>
                    </small>
                  </label>
                  <label className="slider-label">
                    <span>
                      {target.traitLabel}{" "}
                      <b>
                        {patch.trait}
                        {target.traitUnit}
                      </b>
                    </span>
                    <input
                      aria-label={target.traitLabel}
                      type="range"
                      min="0"
                      max={
                        target.traitUnit === "%"
                          ? 100
                          : target.trait === "ground"
                            ? 3
                            : 5
                      }
                      step={target.traitUnit === "%" ? 5 : 1}
                      value={patch.trait}
                      onChange={(e) =>
                        setPatch({ ...patch, trait: Number(e.target.value) })
                      }
                    />
                    <small>{target.traitSummary}</small>
                  </label>
                  <div className="adjust-actions">
                    <button
                      onClick={() => {
                        setPatch(defaultPatch(patch.id));
                        setNotice("参数已重置；运行后更新对照结果。");
                      }}
                    >
                      重置
                    </button>
                    <button className="primary" onClick={run}>
                      运行对照实验
                    </button>
                  </div>
                  {dirty ? (
                    <p className="pending">
                      参数已修改，下面仍是上次运行的结果。
                    </p>
                  ) : null}
                </section>
                <section className="panel comparison">
                  <h2>对照结果</h2>
                  <p>{target.name}在同一实验环境下的变化。</p>
                  <div className="bar-row">
                    <span>基准</span>
                    <div>
                      <i style={{ width: percent(baseRow.score) }} />
                    </div>
                    <b>{percent(baseRow.score)}</b>
                  </div>
                  <div className="bar-row">
                    <span>调整后</span>
                    <div>
                      <i
                        className="new"
                        style={{
                          width: afterRow ? percent(afterRow.score) : "0%",
                        }}
                      />
                    </div>
                    <b>{afterRow ? percent(afterRow.score) : "—"}</b>
                  </div>
                  {afterRow ? (
                    <>
                      <dl>
                        <div>
                          <dt>得分变化</dt>
                          <dd>{pp(afterRow.score - baseRow.score)}</dd>
                        </div>
                        <div>
                          <dt>反制对手</dt>
                          <dd>
                            {baseRow.counters} → {afterRow.counters}
                          </dd>
                        </div>
                        <div>
                          <dt>全样本平均回合</dt>
                          <dd>
                            {baseline.meanTurns.toFixed(2)} →{" "}
                            {after.meanTurns.toFixed(2)}
                          </dd>
                        </div>
                        <div>
                          <dt>回合上限占比</dt>
                          <dd>
                            {percent(baseline.cappedRate)} →{" "}
                            {percent(after.cappedRate)}
                          </dd>
                        </div>
                      </dl>
                      <p className="footnote">
                        {afterRow.score < baseRow.score
                          ? "优势减少后，还要检查是否伤及特色、是否拖长对局。"
                          : "当前结果未必支持调整。检查具体回合，比只看总分更有用。"}
                      </p>
                    </>
                  ) : (
                    <div className="empty">
                      修改参数并运行，结果会在这里出现。
                    </div>
                  )}
                </section>
                <p className="under-note">
                  统一生命值、聚能数值为实验假设。规则尚未经过游戏内对照校准。
                </p>
              </div>
            </div>
            <section className="notebook">
              <div>
                <h2>留下一段策划判断</h2>
                <p>数据辅助判断，结论由你来写。草稿保存在本机。</p>
              </div>
              <label>
                我想验证什么
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  maxLength={800}
                />
              </label>
              <label>
                结果与下一步
                <textarea
                  placeholder="例如：得分下降了，但样本缺少主要反制类型。先补冰、电对手和真实配招，再判断是否保留这次调整。"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1600}
                />
              </label>
            </section>
          </>
        ) : null}
        {tab === "replay" ? (
          <section className="replay">
            <div className="environment">
              <Select
                label="我方精灵"
                value={pair[0]}
                onChange={(v) => {
                  setPair([v, pair[1]]);
                  setTurn(1);
                }}
              >
                {ROSTER.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select
                label="对手精灵"
                value={pair[1]}
                onChange={(v) => {
                  setPair([pair[0], v]);
                  setTurn(1);
                }}
              >
                {ROSTER.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select
                label="双方策略"
                value={replayPolicy}
                onChange={(v) => {
                  setReplayPolicy(v);
                  setTurn(1);
                }}
              >
                <option value="greedy">即时伤害优先</option>
                {model ? <option value="selfplay">AI A 对 AI B</option> : null}
                <option value="efficient">能量效率优先</option>
              </Select>
              <Select
                label="参数版本"
                value={replayVersion}
                onChange={(v) => {
                  setReplayVersion(v);
                  setTurn(1);
                }}
              >
                <option value="base">基准</option>
                {after ? <option value="after">上次调整</option> : null}
              </Select>
            </div>
            <p className="footnote">
              这里回放一组确定性对局；矩阵是多组策略与同速先手条件的平均。此处同速默认我方先手。
            </p>
            <div className="duel">
              <Fighter
                id={pair[0]}
                hp={current.aHp}
                energy={current.aEnergy}
                maxHp={env.hp}
              />
              <div className="versus">
                VS<small>第 {current.turn} 回合后</small>
              </div>
              <Fighter
                id={pair[1]}
                hp={current.bHp}
                energy={current.bEnergy}
                maxHp={env.hp}
              />
            </div>
            <div className="playback">
              <button
                disabled={turn <= 1}
                onClick={() => setTurn(Math.max(1, turn - 1))}
              >
                ← 上一回合
              </button>
              <input
                aria-label="回放回合"
                type="range"
                min="1"
                max={replay.turns}
                value={Math.min(turn, replay.turns)}
                onChange={(e) => setTurn(Number(e.target.value))}
              />
              <span>
                {Math.min(turn, replay.turns)} / {replay.turns}
              </span>
              <button
                disabled={turn >= replay.turns}
                onClick={() => setTurn(Math.min(replay.turns, turn + 1))}
              >
                下一回合 →
              </button>
            </div>
            <div className="event-list">
              {current.events.map((e, i) => (
                <article key={`${e.actor}-${i}`}>
                  <div className="event-order">{i + 1}</div>
                  <div>
                    <h3>
                      {getSpirit(e.actor).name} · {e.move}
                    </h3>
                    <p>
                      消耗 {e.cost} 能量，造成 {e.damage} 伤害
                      {e.gained ? `，回复 ${e.gained} 能量` : ""}
                      {e.healed ? `，恢复 ${e.healed} 生命` : ""}。
                    </p>
                    {e.formula.total > 0 ? (
                      <details>
                        <summary>查看伤害计算</summary>
                        <p>
                          攻击 {e.formula.attack} / 防御 {e.formula.defense}
                          ；有效威力 {e.formula.power.toFixed(1)}；本系 ×
                          {e.formula.stab}；属性 ×{e.formula.type}；攻防增益 ×
                          {e.formula.boost.toFixed(2)}。
                        </p>
                        <code>
                          显示威力 = round(有效威力 × 本系 × 属性 × 增益) ={" "}
                          {e.formula.display}
                          <br />
                          单次伤害 = floor(round(攻击 × 显示威力 × 37/41) /
                          防御) = {e.formula.perHit}
                          <br />
                          总理论伤害 = {e.formula.perHit} × {e.formula.hits} ={" "}
                          {e.formula.total}，实际扣血上限为目标剩余生命。
                        </code>
                      </details>
                    ) : null}
                    <p className="footnote">
                      行动后能量 {e.after.energy} / 10，生命 {e.after.hp} /{" "}
                      {env.hp}
                      {e.attackBoost > 0
                        ? `；双攻累计 +${(e.attackBoost * 100).toFixed(0)}%`
                        : ""}
                      {e.costReduction > 0
                        ? `；全技能能耗 -${e.costReduction}`
                        : ""}
                    </p>
                  </div>
                </article>
              ))}
              {current.endEnergy.map((e) => (
                <p className="end-event" key={e.id}>
                  回合结束：{getSpirit(e.id).name}回复 {e.gained} 能量。
                </p>
              ))}
            </div>
            <p className="result-line">
              本局结束：
              {replay.winner === "draw"
                ? "达到回合上限，按实验规则记为平局"
                : `${getSpirit(replay.winner === "a" ? pair[0] : pair[1]).name}获胜`}{" "}
              · 共 {replay.turns} 回合
            </p>
            <div className="loadouts">
              {pair.map((id, i) => (
                <section key={i}>
                  <h3>{getSpirit(id).name}的固定配招</h3>
                  {loadoutFor(id, env.loadout).map((m) => (
                    <p key={m}>
                      <b>{MOVES[m].name}</b>
                      <span>
                        {MOVES[m].type} · 威力 {MOVES[m].power || "—"} ·
                        初始耗能 {MOVES[m].cost}
                      </span>
                    </p>
                  ))}
                </section>
              ))}
            </div>
          </section>
        ) : null}
        {tab === "product" ? <Product /> : null}
        <div className="notice" role="status">
          {notice}
        </div>
        <footer>
          非官方个人作品。
          {tab === "catalog" ? "BWIKI 资料快照 · 2026-10-14" : DATA_VERSION} ·{" "}
          <button onClick={() => setTab("product")}>查看数据与规则边界</button>
        </footer>
      </main>
    </div>
  );
}
function Fighter({ id, hp, energy, maxHp }) {
  const s = getSpirit(id);
  return (
    <div className="fighter">
      <span className="type">{s.type}</span>
      <h2>{s.name}</h2>
      <div className="hp-track">
        <i style={{ width: percent(hp / maxHp) }} />
      </div>
      <p>
        生命 {hp} / {maxHp}
        <strong>能量 {energy} / 10</strong>
      </p>
    </div>
  );
}
function Product() {
  return (
    <article className="product">
      <section>
        <div className="chapter">01</div>
        <div>
          <h2>帮助策划决定：该不该改、先改哪里</h2>
          <p>
            玩家说一只精灵“太强”时，可能是数值问题，也可能是常见对手、配招或操作习惯造成的。这个工具面向战斗策划和对战研究者，把一次判断拆成可以检查的小步骤：定位优势对局，查看触发机制，改一个参数，再比较收益和副作用。
          </p>
          <p>
            需求来自个人游戏体验和案头研究，尚未访谈真实策划。它是待验证的需求假设。
          </p>
        </div>
      </section>
      <section>
        <div className="chapter">02</div>
        <div>
          <h2>为什么第一版只做六只</h2>
          <p>
            选择这六只，是为了覆盖回血、增伤、减耗、先手、回能和队伍预热六类机制。先把解释链做通，避免大量精灵和复杂规则把错误藏起来。已有图鉴和伤害计算器解决了查数值的问题；这里多做的一步，是记录假设、运行对照和检查调整代价。
          </p>
          <p>
            取舍很明显：样本缺冰、电，会偏向岚鸟；单挑会压低依赖队友的地脉价值。这是接下来要补的证据，不能靠一张得分表掩盖。
          </p>
        </div>
      </section>
      <section>
        <div className="chapter">03</div>
        <div>
          <h2>不只追求胜负接近</h2>
          <dl className="definition">
            <div>
              <dt>对局得分</dt>
              <dd>
                胜 1 / 平 0.5 / 负
                0。先平均同一对手下的策略组合，再按对手权重加权。镜像局不进入矩阵和排名。
              </dd>
            </div>
            <div>
              <dt>反制空间</dt>
              <dd>
                目标精灵面对某对手得分 ≤25%，将其计为一个反制选择。25%
                是本项目筛查阈值，不是官方标准。
              </dd>
            </div>
            <div>
              <dt>节奏护栏</dt>
              <dd>
                同时观察平均回合和达到上限的占比。不能只让优势下降，却让多数对局变成拖延。
              </dd>
            </div>
            <div>
              <dt>机制保留</dt>
              <dd>
                回放检查先手、回能等特性是否仍在发挥作用。不会用一个加权总分自动替代策划选择。
              </dd>
            </div>
          </dl>
        </div>
      </section>
      <section>
        <div className="chapter">04</div>
        <div>
          <h2>已实现的规则与有意保留的空白</h2>
          <p>
            版本 {RULE_VERSION}
            。固定四技能、物攻/魔攻通道、单系克制、本系加成、速度与技能优先级、能量消耗和回复、连击、六类特性、吹火威力成长、水炮递减能耗。同回合双方从相同初始状态选招。
          </p>
          <p>
            统一生命 400（可改），个体
            10、无性格，非生命面板按社区公式换算；等级系数按 60 级。能量上限
            10、聚能回复 4、同速分别固定两种先手、40
            回合截断均作为显式实验规则。布克棱岩初始 0
            能量，可设置队友预热次数。
          </p>
          <p>
            提供火神原生配招与携带水系泡沫的对照；没有换宠、应对、防御、天气、印记、首领化、随机技能或配招搜索；没有游戏内录像校准。图鉴使用旧快照，不声称代表当前赛季。确定性只针对本项目子集，不是对整个游戏的断言。
          </p>
          <p>
            对照组是两种手写规则：即时伤害最大化；或按“伤害 ÷（1 + 能耗 ×
            0.65）”选择，并在低生命时尝试回复。实验组是两个通过独立 Q-learning
            自博弈训练的
            AI，使用同一个引擎。冻结评估、不同种子对照、特性移除、单招禁用和补盲消融已经实现；它们仍然不能证明最优玩法或真实赛季强度。
          </p>
        </div>
      </section>
      <section>
        <div className="chapter">05</div>
        <div>
          <h2>下一轮怎么验证</h2>
          <ol>
            <li>
              先请熟悉对战的玩家提供 10
              段逐回合记录，核对伤害、能量和顺序。记录不一致原因，关键结算未对齐前不输出平衡结论。
            </li>
            <li>
              补充冰、电对手和常见配招，检查岚鸟的优势是否仍存在；加入换宠后重新评估地脉。
            </li>
            <li>
              邀请 3—5 位目标使用者完成“发现风险 → 找到证据 →
              导出方案”的任务。观察是否理解口径、能否找到反例、是否把模拟结果误当实战胜率。
            </li>
            <li>
              以上是后续验证计划，目前未执行。在当前自博弈原型上补充配招搜索、换宠与对手池，再评估策略泛化。不能直接把小规模
              Q-learning 称为 AlphaGo。
            </li>
          </ol>
        </div>
      </section>
      <section>
        <div className="chapter">06</div>
        <div>
          <h2>数据出处</h2>
          <p>
            人工核对日期：{READ_DATE}
            。训练子集保留下面的旧版数据来源；图鉴页另行收录 2026-10-14 的 BWIKI
            快照：625 形态、579 技能、242
            个特性名称及全部学习来源，附页面修订号。全量资料尚未接入模拟。没有复制第三方引擎或美术资源。微信“洛克广场”尚未读取。
          </p>
          <div className="source-list">
            {ROSTER.map((s) => (
              <a key={s.id} href={s.source} target="_blank" rel="noreferrer">
                {s.name} · {s.stats.join(" / ")} ↗
              </a>
            ))}
          </div>
          <p>
            种族顺序：精力 / 物攻 / 物防 / 魔攻 / 魔防 /
            速度。精力种族值保留溯源，但当前实验统一生命，不用于换算。
          </p>
          <p>
            <a
              href="https://roco-showdown.com/battle-use-guide"
              target="_blank"
              rel="noreferrer"
            >
              Roco Showdown：伤害公式与计算说明 ↗
            </a>
          </p>
          <p>
            <a
              href="https://wiki.biligame.com/nrc/公告/S2赛季平衡性调整说明"
              target="_blank"
              rel="noreferrer"
            >
              S2 平衡性调整说明（官方公告的 WIKI 收录）↗
            </a>
          </p>
        </div>
      </section>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
