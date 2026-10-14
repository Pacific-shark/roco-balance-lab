import React, { useEffect, useMemo, useRef, useState } from "react";
import { ROSTER, MOVES, getSpirit, DEFAULT_ENV } from "./data.mjs";
import { assess } from "./rl.mjs";
const pct = (n) => (n * 100).toFixed(1) + "%";
const delta = (n) => (n > 0 ? "+" : "") + (n * 100).toFixed(1) + " pp";
export default function Training({ model, onModel, env, patch, onReplay }) {
  const [id, setId] = useState("020"),
    [seed, setSeed] = useState(42),
    [episodes, setEpisodes] = useState(24000),
    [progress, setProgress] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [usePatch, setUsePatch] = useState(false);
  const worker = useRef(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const analysis = useMemo(
    () => (model ? assess(model, id, env) : null),
    [model, id, env],
  );
  const training = () => {
    setBusy(true);
    setError("");
    setProgress(null);
    worker.current = new Worker(
      new URL("./train.worker.mjs", import.meta.url),
      { type: "module" },
    );
    worker.current.onmessage = ({ data }) => {
      if (data.kind === "progress") setProgress(data.row);
      if (data.kind === "done") {
        onModel(data.model);
        setBusy(false);
        worker.current.terminate();
        worker.current = null;
      }
      if (data.kind === "error") {
        setError(data.message);
        setBusy(false);
        worker.current.terminate();
        worker.current = null;
      }
    };
    worker.current.onerror = () => {
      setError("训练线程失败，请重试或使用已保存模型。");
      setBusy(false);
      worker.current?.terminate();
      worker.current = null;
    };
    worker.current.postMessage({
      seed,
      episodes,
      env: { ...env, policy: "both" },
      patch: usePatch ? patch : null,
    });
  };
  const load = async (s) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}models/selfplay-${s}.json`,
      );
      if (!r.ok) throw new Error("模型文件未加载成功");
      onModel(await r.json());
      setSeed(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const last = model?.history.at(-1),
    first = model?.history[0];
  const download = () => {
    const blob = new Blob([JSON.stringify(model)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `selfplay-${model.seed}-${model.episodes}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="training">
      <div className="research-intro">
        <p>
          <strong>两个 AI 先学着打，再检查赢法。</strong>
          从自博弈中观察常用招式、特性收益和反制缺口；调整参数后，重新训练或用冻结策略对照。
        </p>
        <span>独立 Q-learning · 本机训练</span>
      </div>
      <section className="train-controls">
        <label>
          训练局数
          <select
            value={episodes}
            onChange={(e) => setEpisodes(Number(e.target.value))}
          >
            <option value="6000">6,000 · 快速试跑</option>
            <option value="24000">24,000 · 标准实验</option>
            <option value="60000">60,000 · 延长训练</option>
          </select>
        </label>
        <label>
          随机种子
          <input
            aria-label="训练随机种子"
            type="number"
            min="0"
            max="2147483647"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={usePatch}
            onChange={(e) => setUsePatch(e.target.checked)}
          />
          采用当前调整参数
          <br />
          <small>
            {getSpirit(patch.id).name} · 威力 {patch.power}% · 特性{" "}
            {patch.trait}
          </small>
        </label>
        <button className="primary" onClick={training} disabled={busy}>
          训练两个 AI
        </button>
        {busy ? (
          <button
            onClick={() => {
              worker.current?.terminate();
              worker.current = null;
              setBusy(false);
              setError("训练已停止，保留上一次完整模型。");
            }}
          >
            停止
          </button>
        ) : null}
        <div className="training-progress" role="status">
          {busy
            ? `正在训练 ${progress?.episode.toLocaleString() ?? "…"} / ${episodes.toLocaleString()}`
            : error || "模型只使用本地计算，不调用大模型 API。"}
        </div>
      </section>
      <div className="model-line">
        <strong>
          {model
            ? `当前模型：种子 ${model.seed} / ${model.episodes.toLocaleString()} 局`
            : "正在加载已训练模型…"}
        </strong>
        <span>
          <span>
            {model?.env.loadout === "coverage"
              ? "火神携带水系泡沫"
              : "原生配招"}
          </span>{" "}
          ·{" "}
          {model?.patch
            ? `训练使用调整参数：${getSpirit(model.patch.id).name} ${model.patch.power}% / ${model.patch.trait}`
            : "基准规则训练"}
        </span>
        <button disabled={busy} onClick={() => load(42)}>
          读取种子 42
        </button>
        <button disabled={busy} onClick={() => load(137)}>
          读取种子 137
        </button>
        <button disabled={busy} onClick={() => load(43)}>
          读取补盲实验
        </button>
        {model ? <button onClick={download}>下载模型</button> : null}
      </div>
      {model && analysis ? (
        <>
          <div className="training-top">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>有没有学到东西</h2>
                  <p>冻结模型后，对即时伤害和能量效率策略的得分。</p>
                </div>
                <span className="small-label">越高越好</span>
              </div>
              <LearningCurve history={model.history} />
              <div className="agent-results">
                {last.bench.map((b, i) => (
                  <div key={b.agent}>
                    <strong>{b.agent}</strong>
                    <span>
                      {pct(first.bench[i].ruleScore)} →{" "}
                      <b>{pct(b.ruleScore)}</b>
                    </span>
                    <small>未见状态回退 {pct(b.fallbackRate)}</small>
                  </div>
                ))}
              </div>
              <p className="footnote">
                每个检查点每个 AI：对规则策略 120 局，对随机策略 60
                局。固定评估套件复用，不是独立测试集，也不是最优策略证明。
              </p>
            </section>
            <section className="panel training-notes">
              <h2>先看评估能否成立</h2>
              <dl>
                <div>
                  <dt>实际更新的回合</dt>
                  <dd>{model.transitions.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>两张 Q 表的状态数</dt>
                  <dd>
                    {model.states.map((s) => s.toLocaleString()).join(" / ")}
                  </dd>
                </div>
                <div>
                  <dt>对随机策略得分</dt>
                  <dd>
                    {last.bench.map((b) => pct(b.randomScore)).join(" / ")}
                  </dd>
                </div>
                <div>
                  <dt>自博弈累计胜局</dt>
                  <dd>
                    {last.aWins.toLocaleString()} /{" "}
                    {last.bWins.toLocaleString()}
                  </dd>
                </div>
              </dl>
              <p>
                自博弈接近五五开只说明对手相互适应。要结合外部策略、不同种子和未见状态回退率，才能判断模型够不够用。
              </p>
              <p className="caution">
                目前只在六只精灵、固定配招上训练。状态离散化会丢信息，双方同时学习也没有收敛保证。
              </p>
            </section>
          </div>
          <section className="panel learned">
            <div className="section-head">
              <div>
                <h2>AI 找到了什么打法</h2>
                <p>
                  AI A 对 AI B
                  的基准规则回放。只描述观察到的行为，不把它叫作最佳配招。
                </p>
              </div>
              <select
                aria-label="分析精灵"
                value={id}
                onChange={(e) => setId(e.target.value)}
              >
                {ROSTER.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="training-assumption">
              分析沿用工作台环境：统一生命 {env.hp}、初始能量 {env.startEnergy}
              。
              {model.patch ||
              model.env.hp !== env.hp ||
              model.env.startEnergy !== env.startEnergy ||
              model.env.loadout !== env.loadout
                ? "与当前模型的训练条件不同，属于迁移评估。"
                : "与训练环境一致。"}
              动作未见状态回退：{pct(analysis.fallbackRate)}。
            </div>
            <div className="matchup-list">
              {analysis.vs.map((r) => (
                <button
                  key={r.opponent}
                  onClick={() => onReplay(id, r.opponent)}
                >
                  <span>对 {getSpirit(r.opponent).name}</span>
                  <strong>{r.opening}</strong>
                  <span>
                    {r.score === 1 ? "胜" : r.score === 0 ? "负" : "平"} ·{" "}
                    {r.turns} 回合 ↗
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="design-evidence">
            <div>
              <h2>从赢法回到设计问题</h2>
              <p>
                以下是冻结策略消融。它反映当前打法的依赖，不能代替改变规则后重新训练。
              </p>
            </div>
            <div className="design-grid">
              <article>
                <span className="design-num">01 / 特色</span>
                <h3>特性有没有用</h3>
                <strong className="evidence-value">
                  {delta(analysis.traitDelta)}
                </strong>
                <p>
                  保留特性相对移除特性的得分差。
                  {Math.abs(analysis.traitDelta) < 0.001
                    ? "这里没有观察到胜负差异，不等于特性无效，可能被配招或短回合掩盖。"
                    : "回看触发回合，确认优势确实来自特性，并检查是否还有反制。"}
                </p>
              </article>
              <article>
                <span className="design-num">02 / 技能分配</span>
                <h3>是不是太依赖某一招</h3>
                {analysis.skills.map((s) => (
                  <div className="skill-delta" key={s.move}>
                    <span>禁用 {MOVES[s.move].name}</span>
                    <b>{delta(s.delta)}</b>
                  </div>
                ))}
                <p>
                  数值表示禁用前后得分之差。禁用可能触发未训练动作选择，需要再训练验证。
                </p>
              </article>
              <article>
                <span className="design-num">03 / 打击面</span>
                <h3>异系补盲贡献多少</h3>
                <strong className="evidence-value">
                  {delta(analysis.coverageDelta)}
                </strong>
                <p>
                  将异系攻击的克制与抗性倍率统一改成
                  1，保留威力、能耗和本系加成规则，再比较得分。
                  {analysis.coverageDelta === 0
                    ? "当前样本没有观察到补盲收益，需要扩展对手池后再验证。"
                    : "继续检查哪些对位改变了，而不是只看汇总值。"}
                </p>
              </article>
            </div>
            <p className="caution">
              “特色明显”是设计判断，这里不做统计显著性宣称。六只精灵缺冰、电对手；不能据此给出全游戏削弱建议。
            </p>
          </section>
          <details className="method">
            <summary>训练方法、奖励和下一步</summary>
            <p>
              两张独立 Q 表，同步提交技能，通过同一个规则引擎结算。胜 +1、负
              −1、回合上限平局 0；加入系数 0.1
              的生命差势函数塑形，终局势函数归零，避免靠反复回血刷奖励。学习率
              0.18，折扣 0.98，探索率从 0.8 线性降到 0.08。
            </p>
            <p>
              观察包括双方精灵编号、生命分箱、能量、攻防增益、减耗、技能使用次数和回合数；合法动作是四个技能与聚能。评估无探索、无
              Q
              更新；未见状态以固定哈希在合法动作里选择，明确计入回退率。参数变化后的状态覆盖要重新检查。
            </p>
            <p>
              提供一组火神加入水系泡沫的人工候选配招作对照；本轮没有做自动配招搜索、6v6
              换宠或深度网络。优先补数据和规则校准，再扩展配招搜索与对手池。训练与评估过程可用命令行复现。
            </p>
            <a
              href="https://www.incompleteideas.net/book/bookdraft2018mar21.pdf"
              target="_blank"
              rel="noreferrer"
            >
              算法参考：Sutton & Barto，Reinforcement Learning ↗
            </a>
          </details>
        </>
      ) : null}
    </div>
  );
}
function LearningCurve({ history }) {
  const width = 560,
    height = 175,
    x = (e) => 40 + (e / history.at(-1).episode) * 500,
    y = (s) => 140 - s * 120;
  return (
    <div className="curve">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="训练检查点的规则对手得分曲线，纵轴0到100%"
      >
        {[0, 0.5, 1].map((s) => (
          <g key={s}>
            <line x1="40" x2="540" y1={y(s)} y2={y(s)} stroke="#e3e9e6" />
            <text x="0" y={y(s) + 4} fontSize="11" fill="#77867f">
              {s * 100}%
            </text>
          </g>
        ))}
        {[0, 1].map((i) => (
          <g key={i}>
            <polyline
              fill="none"
              stroke={i === 0 ? "#23745c" : "#c49a63"}
              strokeWidth="2"
              points={history
                .map((h) => `${x(h.episode)},${y(h.bench[i].ruleScore)}`)
                .join(" ")}
            />
            {history.map((h) => (
              <circle
                key={h.episode}
                cx={x(h.episode)}
                cy={y(h.bench[i].ruleScore)}
                r="2.5"
                fill={i === 0 ? "#23745c" : "#c49a63"}
              >
                <title>
                  {h.episode} 局，AI {i ? "B" : "A"}：
                  {pct(h.bench[i].ruleScore)}
                </title>
              </circle>
            ))}
          </g>
        ))}
        <text x="40" y="168" fill="#77867f" fontSize="11">
          0 局
        </text>
        <text x="480" y="168" fill="#77867f" fontSize="11">
          {history.at(-1).episode.toLocaleString()} 局
        </text>
      </svg>
      <div className="curve-legend">
        <span>● AI A</span>
        <span>● AI B</span>
      </div>
    </div>
  );
}
