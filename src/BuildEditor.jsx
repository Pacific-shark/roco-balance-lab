import React, { useState } from "react";
import {
  STAT_KEYS,
  STAT_LABELS,
  IV_VALUES,
  NATURES,
  natureLabel,
  calculatePanel,
  validateBuild,
  presetBuild,
} from "./team-stats.mjs";
function MemberEditor({ member, creature, onApply }) {
  const [draft, setDraft] = useState({
      nature: member.nature,
      ivs: { ...member.ivs },
    }),
    [error, setError] = useState("");
  let panel = null;
  try {
    panel = calculatePanel(creature, draft);
  } catch {}
  function apply() {
    try {
      validateBuild(draft);
      onApply(draft);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="build-member">
      <div className="team-setup">
        <label>
          性格
          <select
            aria-label="培养性格"
            value={draft.nature}
            onChange={(e) => setDraft({ ...draft, nature: e.target.value })}
          >
            {Object.keys(NATURES).map((n) => (
              <option key={n} value={n}>
                {natureLabel(n)}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setDraft(presetBuild(creature, "offense"))}>
          输出起点
        </button>
        <button onClick={() => setDraft(presetBuild(creature, "speed"))}>
          速度起点
        </button>
        <button onClick={() => setDraft(presetBuild(creature, "durable"))}>
          耐久起点
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>属性</th>
              <th>种族值</th>
              <th>资质</th>
              <th>性格修正</th>
              <th>实际面板</th>
            </tr>
          </thead>
          <tbody>
            {STAT_KEYS.map((k) => (
              <tr key={k}>
                <th>{STAT_LABELS[k]}</th>
                <td>{creature.stats[k]}</td>
                <td>
                  <select
                    aria-label={`${STAT_LABELS[k]}资质`}
                    value={draft.ivs[k]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        ivs: { ...draft.ivs, [k]: Number(e.target.value) },
                      })
                    }
                  >
                    {IV_VALUES.map((v) => (
                      <option key={v} value={v}>
                        {v === 0 ? "无加成" : v}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {NATURES[draft.nature].up === k
                    ? "+10%"
                    : NATURES[draft.nature].down === k
                      ? "−10%"
                      : "—"}
                </td>
                <td>{panel?.stats[k] ?? "配置待修正"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        可有 1—3
        项资质加成。这里的预设只是搜索起点，不代表最优推荐。当前计算固定 60
        级对战口径，面板取整仍待实战校准。
      </p>
      <button className="primary" disabled={!panel} onClick={apply}>
        应用到本实验队伍
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
export default function BuildEditor({ data, onChange, a, b, disabled }) {
  const [side, setSide] = useState("a"),
    [slot, setSlot] = useState(0);
  const id = side === "a" ? a : b,
    team = data.teams.find((t) => t.id === id),
    member = team.members[slot],
    creature = data.creatures[member.id];
  return (
    <details className="build-editor">
      <summary>检查培养配置：种族值、资质、性格与六维面板</summary>
      <p>
        每只精灵都保留独立培养配置。改变配置会重新计算伤害、耐久和速度顺序；机制对照会保持培养配置不变。
      </p>
      <fieldset disabled={disabled}>
        <div className="team-setup">
          <label>
            编辑队伍
            <select
              aria-label="培养队伍"
              value={side}
              onChange={(e) => setSide(e.target.value)}
            >
              <option value="a">
                A · {data.teams.find((t) => t.id === a).name}
              </option>
              <option value="b">
                B · {data.teams.find((t) => t.id === b).name}
              </option>
            </select>
          </label>
          <label>
            编辑精灵
            <select
              aria-label="培养精灵"
              value={slot}
              onChange={(e) => setSlot(Number(e.target.value))}
            >
              {team.members.map((m, i) => (
                <option key={m.id} value={i}>
                  {data.creatures[m.id].name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <MemberEditor
          key={id + member.id + JSON.stringify([member.nature, member.ivs])}
          member={member}
          creature={creature}
          onApply={(build) =>
            onChange({
              ...data,
              teams: data.teams.map((t) =>
                t.id !== id
                  ? t
                  : {
                      ...t,
                      members: t.members.map((m, i) =>
                        i === slot ? { ...m, ...structuredClone(build) } : m,
                      ),
                    },
              ),
            })
          }
        />
      </fieldset>
    </details>
  );
}
