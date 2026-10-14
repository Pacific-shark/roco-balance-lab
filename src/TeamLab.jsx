import React, { useEffect, useMemo, useRef, useState } from "react";
import { runTeamBattle, TEAM_RULE_VERSION } from "./team-engine.mjs";
import { teamLearnedPolicy, teamRulePolicy } from "./team-rl.mjs";
import {
  calculatePanel,
  STAT_LABELS,
  natureLabel,
  teamConfigurationId,
} from "./team-stats.mjs";
import BuildEditor from "./BuildEditor.jsx";
import "./team.css";
const BASE = import.meta.env.BASE_URL;
const pct = (x) => (x * 100).toFixed(0) + "%";
const PATCHES = {
  baseline: { name: "保持原规则", patch: null },
  grass20: {
    name: "盘根木：后台回复 30% → 20%",
    patch: { side: 0, grassBenchRate: 0.2 },
  },
  grass0: {
    name: "盘根木：关闭后台回复（诊断用）",
    patch: { side: 0, grassBenchRate: 0 },
  },
  energy2: {
    name: "富养化：场下回能 3 → 2",
    patch: { side: 0, benchEnergy: 2 },
  },
  flowerTrait: {
    name: "养分重吸收：关闭自身回能（诊断用）",
    patch: { side: 0, disableTrait: "pet_000028" },
  },
};
function download(name, value) {
  const url = URL.createObjectURL(
    new Blob(
      [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
      { type: "application/json;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Squad({ side, data, label }) {
  return (
    <section className="squad" aria-label={label}>
      <header>
        <strong>{label}</strong>
        <span>
          魔力 <b>{side.magic}</b> / 4
        </span>
      </header>
      <div className="squad-slots">
        {side.pets.map((p, i) => (
          <div
            key={p.id}
            className={`squad-slot ${i === side.active ? "on-field" : ""} ${p.hp <= 0 ? "fainted" : ""}`}
          >
            <div>
              <strong>{p.name}</strong>
              <small>
                {p.hp <= 0 ? "力竭" : i === side.active ? "在场" : "后备"}
              </small>
            </div>
            <div className="hp-track">
              <i style={{ width: pct(p.hp / p.maxHp) }} />
            </div>
            <span>
              生命 {p.hp} / {p.maxHp} · 能量 {p.energy}
            </span>
            <small>特性 · {data.creatures[p.id].trait.name}</small>
            <small>培养 · {p.build.nature}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
function TeamPreview({ team, data }) {
  return (
    <div className="team-preview">
      {team.members.map((p) => (
        <details key={p.id}>
          <summary>{data.creatures[p.id].name}</summary>
          <p>
            <b>培养：</b>
            {natureLabel(p.nature)}
            <br />
            {calculatePanel(data.creatures[p.id], p)
              .breakdown.map((r) => `${STAT_LABELS[r.key]} ${r.actual}`)
              .join(" · ")}
          </p>
          <p>
            <b>特性：</b>
            {data.creatures[p.id].trait.name} ·{" "}
            {data.creatures[p.id].trait.description}
          </p>
          {p.moves.map((id) => (
            <p key={id}>
              <b>技能：</b>
              {data.moves[id].name} · {data.moves[id].cost} 能量
              <br />
              {data.moves[id].description}
            </p>
          ))}
        </details>
      ))}
    </div>
  );
}
export default function TeamLab() {
  const [data, setData] = useState(null),
    [model, setModel] = useState(null),
    [evaluation, setEvaluation] = useState(null),
    [error, setError] = useState("");
  const [a, setA] = useState("relay"),
    [b, setB] = useState("fire"),
    [variant, setVariant] = useState("baseline"),
    [mode, setMode] = useState("learned");
  const [index, setIndex] = useState(0),
    [seed, setSeed] = useState(42),
    [episodes, setEpisodes] = useState(4000),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null);
  const [resultVersion, setResultVersion] = useState("baseline"),
    [batch, setBatch] = useState(null);
  const worker = useRef(null);
  useEffect(() => {
    let live = true;
    Promise.all(
      [
        "data/team-2026-10-14.json",
        "team-models/team-42.json",
        "team-models/evaluation-42.json",
      ].map(async (p) => {
        const r = await fetch(BASE + p);
        if (!r.ok) throw Error("团队数据或模型加载失败");
        return r.json();
      }),
    )
      .then(([d, m, e]) => {
        if (live) {
          if (m.dataVersion !== d.version || m.rules !== TEAM_RULE_VERSION)
            throw Error("模型与引擎版本不一致，请刷新后重试");
          setData({ ...d, teams: m.trainingTeams ?? d.teams });
          setModel(m);
          setEvaluation(e);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      worker.current?.terminate();
    };
  }, []);
  const teams = useMemo(
    () =>
      data
        ? {
            a: data.teams.find((t) => t.id === a),
            b: data.teams.find((t) => t.id === b),
          }
        : null,
    [data, a, b],
  );
  const results = useMemo(() => {
    if (!data || !model || !teams) return null;
    const run = (patch, seedOffset = 0) =>
      runTeamBattle(
        data,
        teams.a.members,
        teams.b.members,
        mode === "learned"
          ? [
              teamLearnedPolicy(data, model.agents[0], 42001 + seedOffset),
              teamLearnedPolicy(data, model.agents[1], 42002 + seedOffset),
            ]
          : [teamRulePolicy(data, mode), teamRulePolicy(data, mode)],
        { patch, tieFirst: seedOffset % 2 },
      );
    return {
      baseline: run(null),
      changed: variant === "baseline" ? null : run(PATCHES[variant].patch),
    };
  }, [data, model, teams, variant, mode]);
  const match = results?.[resultVersion] ?? results?.baseline;
  const step = match?.trace[Math.min(index, match.trace.length - 1)];
  const change = (fn, value) => {
    fn(value);
    setIndex(0);
    setBatch(null);
  };
  async function loadModel(which) {
    try {
      setError("");
      const [m, e] = await Promise.all(
        [
          `team-models/team-${which}.json`,
          `team-models/evaluation-${which}.json`,
        ].map(async (p) => {
          const r = await fetch(BASE + p);
          if (!r.ok) throw Error("模型加载失败");
          return r.json();
        }),
      );
      if (m.dataVersion !== data.version || m.rules !== TEAM_RULE_VERSION)
        throw Error("模型与当前引擎版本不一致，请刷新后重试");
      setModel(m);
      setData((d) => ({ ...d, teams: m.trainingTeams ?? d.teams }));
      setEvaluation(e);
      setSeed(which);
      setIndex(0);
      setBatch(null);
    } catch (e) {
      setError(e.message);
    }
  }
  function train(optimize = false) {
    worker.current?.terminate();
    const w = new Worker(new URL("./team.worker.mjs", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    setBusy(true);
    setError("");
    setProgress(null);
    w.onmessage = ({ data: m }) => {
      if (m.type === "progress") setProgress(m.progress);
      else if (m.type === "complete") {
        setData(m.data);
        setModel(m.model);
        setEvaluation(m.evaluation);
        setBusy(false);
        setIndex(0);
        setBatch(null);
        w.terminate();
      } else {
        setError(m.message);
        setBusy(false);
        w.terminate();
      }
    };
    w.onerror = () => {
      setError("团队训练进程失败");
      setBusy(false);
      w.terminate();
    };
    w.postMessage({
      data,
      options: {
        episodes,
        seed,
        optimize,
        patch: variant === "baseline" ? null : PATCHES[variant].patch,
      },
    });
  }
  function compare() {
    const rows = [];
    for (const opponent of data.teams)
      if (opponent.id !== a)
        for (const role of [0, 1])
          for (const tieFirst of [0, 1]) {
            const run = (patch) =>
              runTeamBattle(
                data,
                teams.a.members,
                opponent.members,
                [
                  teamLearnedPolicy(
                    data,
                    model.agents[role],
                    771 + role * 2 + tieFirst,
                  ),
                  teamLearnedPolicy(
                    data,
                    model.agents[1 - role],
                    881 + role * 2 + tieFirst,
                  ),
                ],
                { patch, tieFirst, record: false },
              );
            const base = run(null),
              after = run(PATCHES[variant].patch);
            rows.push({
              opponent: opponent.name,
              role,
              tieFirst,
              base: base.score,
              after: after.score,
              baseRounds: base.state.round - 1,
              afterRounds: after.state.round - 1,
              baseMagic: base.state.sides[0].magic,
              afterMagic: after.state.sides[0].magic,
            });
          }
    setBatch(rows);
  }
  if (error && !data) return <p role="alert">{error}</p>;
  if (!data || !model || !step)
    return (
      <p role="status" className="catalog-loading">
        正在加载 6v6 团队引擎与独立训练模型…
      </p>
    );
  const support = match.trace.flatMap((t, i) =>
    t.events
      .filter((e) => e.kind === "support")
      .map((e) => ({ ...e, index: i, round: t.round })),
  );
  const summary = (s) =>
    s.winner === "draw"
      ? "回合上限 · 未分胜负"
      : `${s.winner === 0 ? "A" : "B"} 队获胜`;
  const mean = (rows, key) =>
    rows.reduce((n, r) => n + r[key], 0) / rows.length;
  const configurationMatches =
    model.configurationId === teamConfigurationId(data);
  return (
    <div className="team-lab">
      <section className="team-purpose">
        <small>研究案例 01 · 队伍预热的收益与代价</small>
        <h2>一只精灵的强，多少来自队友？</h2>
        <p>
          让两名 AI
          控制完整六人队伍，学习首发、出招、主动换人与力竭补位。沿回放追踪后台回复，再用同一套对手比较机制调整。
        </p>
        <div className="team-facts">
          <span>6 只精灵 / 队</span>
          <span>4 点魔力</span>
          <span>聚能 +5</span>
          <span>独立血量与能量</span>
          <span>同时提交行动</span>
          <span>性格 +10% / −10%</span>
        </div>
      </section>
      <div className="team-quality">
        <b>当前阶段：机制验证，暂不输出精灵强弱结论</b>
        <p>
          先检查 AI
          是否具备有效对战能力，再讨论平衡。下方公开规则对手得分、回合上限平局与初始化对照；这四组实验阵容不代表天梯环境。
        </p>
      </div>
      <div className="mechanism-distinction">
        <div>
          <b>技能 · 富养化</b>
          <p>
            占一个技能槽与一个行动回合；耗能 3，为场下每只精灵回复 3 能量。
            <a
              href="https://wiki.biligame.com/nrc/富养化"
              target="_blank"
              rel="noreferrer"
            >
              原始资料 ↗
            </a>
          </p>
        </div>
        <div>
          <b>特性 · 养分重吸收</b>
          <p>
            奇丽花自身回合末回复 3 能量。该回复不会直接发给队友。
            <a
              href="https://wiki.biligame.com/nrc/养分重吸收"
              target="_blank"
              rel="noreferrer"
            >
              原始资料 ↗
            </a>
          </p>
        </div>
        <div>
          <b>特性 · 盘根木</b>
          <p>
            森巨人初始只有 10% 生命；在场下时，队友每用一次草系技能，为它回复
            30% 生命。
          </p>
        </div>
      </div>
      <section className="team-setup" aria-label="团队实验设置">
        <label>
          A 队
          <select
            aria-label="A 队阵容"
            value={a}
            onChange={(e) => change(setA, e.target.value)}
          >
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          B 队
          <select
            aria-label="B 队阵容"
            value={b}
            onChange={(e) => change(setB, e.target.value)}
          >
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          回放策略
          <select
            aria-label="团队策略"
            value={mode}
            onChange={(e) => change(setMode, e.target.value)}
          >
            <option value="learned">强化学习 · 冻结模型</option>
            <option value="tactical">规则基线 · 换人与输出</option>
            <option value="aggressive">规则基线 · 直接输出</option>
          </select>
        </label>
        <label>
          只改 A 队机制
          <select
            aria-label="团队调整方案"
            disabled={busy}
            value={variant}
            onChange={(e) => {
              change(setVariant, e.target.value);
              setResultVersion(
                e.target.value === "baseline" ? "baseline" : "changed",
              );
            }}
          >
            {Object.entries(PATCHES).map(([id, v]) => (
              <option key={id} value={id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <BuildEditor
        data={data}
        a={a}
        b={b}
        disabled={busy}
        onChange={(d) => change(setData, d)}
      />
      {!configurationMatches ? (
        <p className="team-note">
          当前培养配置已修改，回放正在用旧模型检验新配置。原训练得分暂不展示；重新搜索并训练后才能形成这一配置的评估记录。
        </p>
      ) : null}
      <details className="team-loadouts">
        <summary>查看双方六人名单、四技能与特性</summary>
        <h3>A · {teams.a.name}</h3>
        <TeamPreview team={teams.a} data={data} />
        <h3>B · {teams.b.name}</h3>
        <TeamPreview team={teams.b} data={data} />
      </details>
      <section className="team-replay" aria-label="完整团队回放">
        <header>
          <div>
            <small>
              {resultVersion === "changed" && results.changed
                ? "调整规则"
                : "原规则"}{" "}
              · {summary(match.state)}
            </small>
            <h2>
              {step.phase === "lead"
                ? "选择首发"
                : step.phase === "replace"
                  ? `第 ${step.round} 回合前 · 力竭补位`
                  : `第 ${step.round} 回合`}
            </h2>
          </div>
          <div className="team-replay-controls">
            <button disabled={index === 0} onClick={() => setIndex(0)}>
              回到开局
            </button>
            <button
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
            >
              上一步
            </button>
            <button
              disabled={index >= match.trace.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              下一步
            </button>
            <select
              aria-label="显示的回放版本"
              value={resultVersion}
              onChange={(e) => {
                setResultVersion(e.target.value);
                setIndex(0);
              }}
            >
              <option value="baseline">原规则回放</option>
              <option value="changed" disabled={!results.changed}>
                调整后回放
              </option>
            </select>
          </div>
        </header>
        <input
          className="team-scrubber"
          type="range"
          aria-label="团队回放进度"
          min="0"
          max={match.trace.length - 1}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
        />
        <div className="squad-pair">
          <Squad
            side={step.after[0]}
            data={data}
            label={"A · " + teams.a.name}
          />
          <Squad
            side={step.after[1]}
            data={data}
            label={"B · " + teams.b.name}
          />
        </div>
        <ol className="team-events">
          {step.events.map((e, i) => (
            <li key={i} className={e.kind}>
              <span>{e.side === 0 ? "A" : "B"}</span>
              {e.text}
              {e.kind === "move" ? (
                <small>
                  消耗 {e.cost} ·{" "}
                  {data.moves[e.move].kind === "defense"
                    ? "防御技能"
                    : data.moves[e.move].kind === "status"
                      ? "状态技能"
                      : "攻击技能"}
                </small>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      <section className="team-evidence">
        <header>
          <div>
            <h2>队友实际提供了什么</h2>
            <p>
              只记录本局发生且没有溢出的后台收益；点击一条证据，回到对应决策。
            </p>
          </div>
          <span>{support.length} 条支援记录</span>
        </header>
        {support.length ? (
          <div className="support-list">
            {support.map((e, i) => (
              <button key={i} onClick={() => setIndex(e.index)}>
                <small>
                  回合 {e.round} · {e.side === 0 ? "A" : "B"} 队
                </small>
                <strong>{e.text}</strong>
              </button>
            ))}
          </div>
        ) : (
          <p>
            这一局没有产生后台支援收益。这不能证明机制没有价值，需要检查 AI
            是否选择了相关技能与阵容。
          </p>
        )}
      </section>
      <section className="team-comparison">
        <h2>保持六人队伍，比较改动的代价</h2>
        <p>
          使用冻结强化学习模型，同一 A 队对其余 3
          个实验阵容，交叉两名智能体与两种同速顺序，共 12
          个成对场景。对手与策略种子保持一致。
        </p>
        <button
          className="primary"
          disabled={variant === "baseline" || busy}
          onClick={compare}
        >
          运行团队机制对照
        </button>
        {batch ? (
          <>
            <div className="team-result-line">
              <strong>
                {pct(mean(batch, "base"))} → {pct(mean(batch, "after"))}
              </strong>
              <span>A 队得分 · 胜 1 / 平 0.5 / 负 0</span>
              <b>
                {batch.filter((r) => r.base !== r.after).length} /{" "}
                {batch.length} 个场景胜负得分改变
              </b>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>对手</th>
                    <th>智能体 / 同速优先</th>
                    <th>原得分 → 调整后</th>
                    <th>回合数变化</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.map((r, i) => (
                    <tr key={i}>
                      <td>{r.opponent}</td>
                      <td>
                        {r.role === 0 ? "A/B" : "B/A"} /{" "}
                        {r.tieFirst === 0 ? "我方" : "对方"}
                      </td>
                      <td>
                        {r.base} → {r.after}
                      </td>
                      <td>
                        {r.baseRounds} → {r.afterRounds}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={() =>
                download("6v6-成对实验.json", {
                  rules: TEAM_RULE_VERSION,
                  dataVersion: data.version,
                  configurationId: teamConfigurationId(data),
                  teams: data.teams,
                  model,
                  policySeeds: {
                    leftBase: 771,
                    rightBase: 881,
                    formula: "base + role * 2 + tieFirst",
                  },
                  team: a,
                  variant: PATCHES[variant],
                  rows: batch,
                })
              }
            >
              下载本次实验记录
            </button>
          </>
        ) : null}
        <p className="team-note">
          这里测的是当前打法对机制的依赖。零差异照实保留；若减益后得分反升，应先检查策略覆盖与行动变化，不能直接解释成“机制越弱越强”。改规则后还应分别重新训练，检查新反制。
        </p>
      </section>
      <section className="team-training">
        <h2>先选培养配置，再训练完整 6v6 决策</h2>
        <p>
          每名成员的候选集为 30 种性格 × 三项满资质的 20 种分配，共 600 组。先用
          1,000
          场预训练策略筛选，再以选中配置重训。四个阵容使用相同预算，配招与参考对手固定。
        </p>
        {model.configurationSearch ? (
          <div className="build-search-result">
            <b>本模型已完成培养搜索</b>
            <span>
              {model.configurationSearch.battles.toLocaleString()} 场筛选对战 ·{" "}
              {model.configurationSearch.log.filter((r) => r.changed).length} /
              24 个位置调整培养
            </span>
            <p>
              按成员依次搜索一轮，保留完整对手检查中不劣于原方案的候选。这里展示的是本轮搜索结果；尚未穷举全队组合、配招及低资质控速方案。
            </p>
          </div>
        ) : null}
        <p>
          当前模型：种子 {model.seed} · {model.episodes.toLocaleString()}{" "}
          场团队对战 · {model.updates.toLocaleString()} 次参数更新。
        </p>
        <div className="team-setup">
          <label>
            训练局数
            <select
              aria-label="团队训练局数"
              disabled={busy}
              value={episodes}
              onChange={(e) => setEpisodes(Number(e.target.value))}
            >
              <option value="1000">1,000 · 检查流程</option>
              <option value="4000">4,000 · 基准训练</option>
              <option value="12000">12,000 · 延长训练</option>
            </select>
          </label>
          <label>
            随机种子
            <input
              aria-label="团队训练种子"
              disabled={busy}
              type="number"
              min="0"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() => train(true)}
          >
            {busy ? "正在计算…" : "搜索培养配置并重新训练"}
          </button>
          <button disabled={busy} onClick={() => train(false)}>
            只训练当前配置
          </button>
          {busy ? (
            <button
              onClick={() => {
                worker.current?.terminate();
                setBusy(false);
                setProgress(null);
              }}
            >
              停止训练
            </button>
          ) : null}
        </div>
        <p role="status">
          {progress
            ? progress.phase === "search"
              ? `培养搜索 ${progress.completed} / ${progress.total} 个位置；已模拟 ${progress.battles} 场。`
              : `${progress.phase === "warm" ? "搜索前预训练" : "选定配置训练"} ${progress.episode} / ${progress.phase === "warm" ? 1000 : episodes} 场；累计主动换人 ${progress.switches} 次；回合上限平局 ${progress.draws} 场。`
            : "出招、换人、首发与力竭补位都是智能体的动作。双方不能读取对手本回合指令。"}
        </p>
        <div className="team-model-actions">
          <button disabled={busy} onClick={() => loadModel(42)}>
            读取种子 42
          </button>
          <button disabled={busy} onClick={() => loadModel(137)}>
            读取种子 137
          </button>
          <button onClick={() => download("6v6-强化学习模型.json", model)}>
            下载团队模型
          </button>
        </div>
        {evaluation && configurationMatches ? (
          <div className="team-training-stats">
            <div>
              <b>{pct(evaluation.ruleScore)}</b>
              <span>对两种规则基线的得分 · 48 个场景</span>
            </div>
            <div>
              <b>{pct(evaluation.drawRate)}</b>
              <span>模型交叉对战的上限平局率</span>
            </div>
            <div>
              <b>{evaluation.meanSwitches.toFixed(1)}</b>
              <span>每场双方平均主动换人次数</span>
            </div>
          </div>
        ) : null}
        {configurationMatches &&
        Number.isFinite(evaluation?.initialRuleScore) ? (
          <p>
            同一组规则对手场景：启发式初始化得分{" "}
            {pct(evaluation.initialRuleScore)} → 训练后{" "}
            {pct(evaluation.ruleScore)}
            。这个差值才是本次训练的观察结果，不能将初始规则能力计入学习收益。
          </p>
        ) : null}
        {model.patch ? (
          <p className="team-note">
            当前模型曾在调整规则 {JSON.stringify(model.patch)}{" "}
            下训练。上方原规则回放属于跨规则检验。
          </p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </section>
      <details className="team-boundary">
        <summary>哪些规则已经接入，哪些仍需核准</summary>
        <p>
          已实现：六人名单与四技能合法性检查、种族值、独立资质、六维性格修正、首发、主动换人、力竭补位、四点魔力、聚能五点、独立资源、攻防与能量增益、应对、防御冷却、技能永久变化，以及当前样本的后台支援与入场收益。
        </p>
        <p>
          本版使用 BWIKI 的 10 个形态、42 个明确注册技能、18
          属性表；模板是实验队伍。未接入首领化、愿力、印记、天气、随机技能和完整图鉴技能。没有暴击或随机伤害浮动。模型训练中的探索与同分动作采样使用固定种子。
        </p>
        <p>
          六人对战框架不等于全游戏复刻。社区面板与伤害公式、同速结算、防御时点、永久效果和离场清除仍需游戏内逐回合录像校准。实验公开双方配置，尚未实现隐藏配招下的信息推断。
        </p>
        <p>
          强化学习为两个独立策略梯度模型，使用公开的启发式权重初始化，并加入历史策略和规则对手。从整场胜负更新策略，未借助大模型判断胜负。固定四组阵容，未自动搜索配队或配招，没有最优性保证；基线场景与训练阵容重叠，不是泛化能力测试。
        </p>
      </details>
    </div>
  );
}
