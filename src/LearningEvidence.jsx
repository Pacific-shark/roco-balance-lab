import React, { useState } from "react";
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const kinds = {
  finish: "收掉残血",
  focus: "两步收尾（诊断题）",
  switch: "保留魔力的换人",
};
const delta = (x) => `${x > 0 ? "+" : ""}${(100 * x).toFixed(2)} 个百分点`;

function NeuralStudy({ study }) {
  if (!study) return null;
  const unstable = study.selected.every(
    (row) =>
      row.scores.some((s) => s.delta > 0) &&
      row.scores.some((s) => s.delta < 0),
  );
  const zeroMean = study.selected.every(
    (row) =>
      Math.abs(
        row.scores.reduce((n, s) => n + s.delta, 0) / row.scores.length,
      ) < 1e-9,
  );
  return (
    <section className="wb-learning-study">
      <h3>有限候选配队验证</h3>
      <p>
        {study.candidateCount} 套候选 → 验证后锁定 {study.selected.length} 套 →
        留出测试与特性对照，共 {study.totalBattles} 局。
        {study.weightsUnchanged
          ? "评估前后模型参数一致。"
          : "参数一致性未确认。"}
      </p>
      <p className="wb-muted">
        本次使用三个种子的实体模型，经过局部决策补训后冻结；没有为候选队伍单独重训。
        队伍和培养配置仅用于流程验证，尚未做最优性格、天分和配招搜索，不能作为实战推荐。
        对局得分为胜 1、回合上限 0.5、负 0；对手含规则策略和冻结神经策略。
      </p>
      {study.selected.map((row, i) => (
        <article className="wb-learning-team" key={row.team.id}>
          <h4>
            候选 {i + 1} · {row.team.lineup.map((m) => m.name).join(" / ")}
          </h4>
          <div className="wb-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>训练种子</th>
                  <th>保留特性得分</th>
                  <th>移除特性得分</th>
                  <th>保留 − 移除</th>
                </tr>
              </thead>
              <tbody>
                {row.scores.map((s) => (
                  <tr key={s.seed}>
                    <td>{s.seed}</td>
                    <td>{pct(s.baseline)}</td>
                    <td>{pct(s.traitRemoved)}</td>
                    <td>{delta(s.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="wb-muted">
            每个种子、每种条件 {row.scores[0].battlesPerCondition}{" "}
            局；只覆盖两套测试对手构筑。
          </p>
          <details>
            <summary>查看六人配招与培养配置</summary>
            <ul className="wb-learning-lineup">
              {row.team.lineup.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong> · {m.trait} · {m.nature}
                  <br />
                  {m.moveNames.join(" / ")}
                  <br />
                  <small>
                    原型天分（生命 / 物攻 / 物防 / 魔攻 / 魔防 / 速度）：
                    {["hp", "atk", "def", "spa", "spd", "spe"]
                      .map((k) => m.ivs[k])
                      .join(" / ")}
                  </small>
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
      <p>
        {unstable
          ? "所选队伍的特性移除差值都随种子反转。"
          : "特性移除结果需要结合逐种子差值判断。"}
        {zeroMean && "各队跨种子的平均差值均为 0。"}
        这一冻结策略对照不能单独证明精灵过强或特性无用。
        同定位替换、技能补盲、双方重新适应和设计目标核对仍待完成。
      </p>
    </section>
  );
}
const behavior = (score) => {
  const b = score?.behavior;
  if (!b) return { switches: null, full: null };
  const total = [
    "attack",
    "defense",
    "status",
    "focus",
    "switch",
    "wait",
  ].reduce((n, k) => n + (b[k] ?? 0), 0);
  return {
    switches: total ? (b.switch ?? 0) / total : null,
    full: b.fullEnergyFocus ?? 0,
  };
};

export default function LearningEvidence({ data }) {
  const [selected, setSelected] = useState(data.runs.at(-1)?.id ?? "");
  const run = data.runs.find((r) => r.id === selected);
  if (!run)
    return <p>还没有归档实验。完成训练并校验结果后，这里会显示全部种子。</p>;
  return (
    <div className="wb-learning">
      <p className="wb-muted">
        先验证 AI
        是否学会对战，再研究精灵。这里保留每次实验的实际结果，包括未改善和超时的运行。
      </p>
      <label className="wb-learning-picker">
        选择实验
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {data.runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.config.architecture.toUpperCase()} · 种子 {r.config.seed} ·{" "}
              {r.config.curriculum
                ? "局部决策补训"
                : r.config.shaping
                  ? "过程反馈"
                  : "纯胜负"}{" "}
              · {r.trainingSteps.toLocaleString()} 步 ·{" "}
              {r.config.trainPool ?? 4} 套训练构筑
            </option>
          ))}
        </select>
      </label>
      {run.config.curriculum && (
        <p className="wb-muted">
          从已完成 {run.config.parentTrainingSteps.toLocaleString()}{" "}
          个环境决策步的模型继续；本次 {run.trainingSteps.toLocaleString()}{" "}
          步为双方合计的单方补训决策数，训练前指父模型。两种步数口径不同。
        </p>
      )}
      <div className="wb-learning-facts">
        <div>
          <span>训练前</span>
          <strong>{pct(run.initialValidation?.winFraction)}</strong>
        </div>
        <div>
          <span>训练后</span>
          <strong>{pct(run.trainedValidation?.winFraction)}</strong>
        </div>
        <div>
          <span>训练对局</span>
          <strong>{run.completedTrainingGames.toLocaleString()}</strong>
        </div>
        <div>
          <span>本次用时</span>
          <strong>{run.elapsedSeconds.toFixed(0)} 秒</strong>
        </div>
      </div>
      <p>
        状态：
        {run.status === "completed"
          ? "已完成"
          : run.status === "budget-exhausted"
            ? "达到预算上限"
            : run.status}
        。
        {run.trainedValidation
          ? `最终验证 ${run.trainedValidation.wins} 胜 / ${run.trainedValidation.battles} 局，${run.trainedValidation.roundCaps} 局达到回合上限。`
          : "尚无完整训练后验证结果。"}
      </p>
      <h3>训练进展与行为</h3>
      <div className="wb-table-wrap">
        <table>
          <thead>
            <tr>
              <th>训练步数</th>
              <th>验证胜局 / 局数</th>
              <th>主动换人占比</th>
              <th>满能量聚能</th>
            </tr>
          </thead>
          <tbody>
            {run.curve.map((row, i) => {
              const b = behavior(row);
              return (
                <tr key={i}>
                  <td>{row.trainingSteps.toLocaleString()}</td>
                  <td>
                    {row.wins} / {row.battles}
                  </td>
                  <td>{pct(b.switches)}</td>
                  <td>{b.full ?? "未记录"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>具体能力是否学会</h3>
      <p className="wb-muted">
        人工构造的六成员残局；每项含双方策略、不同槽位、座位和同速方。
        {run.config.curriculum
          ? "这里只展示未参与补训的槽位排列；并非未见物种或新机制。"
          : "这些场景没有用于本次基础训练。"}
        成功比例与实战胜率分开呈现。
      </p>
      <div className="wb-table-wrap">
        <table>
          <thead>
            <tr>
              <th>能力题</th>
              <th>训练前成功</th>
              <th>训练后成功</th>
            </tr>
          </thead>
          <tbody>
            {run.resourceOutcomes && (
              <tr>
                <td>资源残局 · 实际终局胜利</td>
                <td>
                  {run.resourceOutcomes.initial.wins} /{" "}
                  {run.resourceOutcomes.initial.battles}
                </td>
                <td>
                  {run.resourceOutcomes.trained.wins} /{" "}
                  {run.resourceOutcomes.trained.battles}
                </td>
              </tr>
            )}
            {Object.entries(kinds).map(([key, title]) => {
              const first = run.capabilities.initialCapabilities?.[key],
                last = run.capabilities.trainedCapabilities?.[key];
              return (
                <tr key={key}>
                  <td>{title}</td>
                  <td>
                    {first ? `${first.successes} / ${first.cases}` : "未记录"}
                  </td>
                  <td>
                    {last ? `${last.successes} / ${last.cases}` : "未记录"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="wb-muted">
        “两步收尾”限定完成速度；资源残局的实际胜负另列。早期聚能诊断题允许安全换人，后续已修正对手行为和场下血量，不能跨版本直接比较该题成功率。
      </p>
      <NeuralStudy study={data.neuralStudy} />
      <details>
        <summary>适用范围与复现信息</summary>
        <ul>
          {data.limitations.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p>训练过程 API token：{run.apiTokens}。不包含开发对话成本。</p>
        <p>
          配置与报告摘要已核对；参数更新
          {run.parameterUpdatesVerified ? "已验证" : "未确认"}。
        </p>
        <code className="wb-learning-hash">
          环境：{run.environmentHash}
          <br />
          训练器：{run.trainerHash}
        </code>
      </details>
      <a
        href="api/learning"
        download="learning-evidence.json"
        className="wb-button"
      >
        下载全部实验摘要
      </a>
    </div>
  );
}
