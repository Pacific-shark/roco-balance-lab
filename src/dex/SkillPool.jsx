import React, { useMemo, useState } from "react";
import { TypeTag, SkillDescription, Icon } from "./shared.jsx";

const METHODS = {
  native: "基础可学",
  stone: "技能石",
  blood: "血脉技能",
  special: "特殊学习",
};
export default function SkillPool({ creature, data }) {
  const [method, setMethod] = useState("native");
  const [query, setQuery] = useState("");
  const [blood, setBlood] = useState("");
  const entries = data.learnsets[creature.learnset] ?? [];
  const available = Object.keys(METHODS).filter((m) =>
    entries.some((e) => e.method === m),
  );
  const selected = available.includes(method) ? method : available[0];
  const rows = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.method === selected &&
          (!blood || selected !== "blood" || e.blood === blood) &&
          `${data.skills[e.skill].name}${data.skills[e.skill].description}`.includes(
            query.trim(),
          ),
      ),
    [entries, selected, blood, query, data.skills],
  );
  return (
    <section className="dex-pool" aria-labelledby="dex-pool-heading">
      <div className="dex-section-heading">
        <h2 id="dex-pool-heading">技能池</h2>
        <span>{entries.length} 条学习来源</span>
      </div>
      <div className="dex-pool-controls">
        <div className="dex-pool-tabs" role="group" aria-label="技能学习方式">
          {available.map((m) => (
            <button
              key={m}
              className={selected === m ? "selected" : ""}
              aria-pressed={selected === m}
              onClick={() => setMethod(m)}
            >
              {METHODS[m]}{" "}
              <span>{entries.filter((e) => e.method === m).length}</span>
            </button>
          ))}
        </div>
        {selected === "blood" && (
          <select
            aria-label="血脉筛选"
            value={blood}
            onChange={(e) => setBlood(e.target.value)}
          >
            <option value="">所有血脉</option>
            {[
              ...new Set(
                entries.filter((e) => e.method === "blood").map((e) => e.blood),
              ),
            ].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        )}
        <input
          type="search"
          aria-label="搜索技能"
          placeholder="搜索技能或效果"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {selected === "blood" && (
        <p className="dex-pool-note">
          血脉技能需使用对应血脉，列表不代表这些技能可以同时装备。
        </p>
      )}
      <div className="dex-skill-table">
        <div className="dex-skill-table-head">
          <span>技能</span>
          <span>类别</span>
          <span>威力</span>
          <span>能耗</span>
          <span>学习条件</span>
          <span aria-hidden="true" />
        </div>
        {rows.map((entry, index) => {
          const skill = data.skills[entry.skill];
          const condition = [
            entry.blood ? `${entry.blood}血脉` : null,
            entry.level ? `Lv.${entry.level}` : null,
            entry.stage ? `来源阶段 ${entry.stage}` : null,
            entry.requires,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <details key={`${entry.skill}-${index}`} className="dex-skill-row">
              <summary>
                <span className="dex-skill-name">
                  <b>{skill.name}</b>
                  <TypeTag type={skill.type} />
                  <span className="dex-skill-mobile-class">
                    {skill.damageClass ?? skill.category}
                  </span>
                </span>
                <span>{skill.damageClass ?? skill.category}</span>
                <span>{skill.power ?? "—"}</span>
                <span>{skill.cost ?? "—"}</span>
                <span className="dex-learning-condition">
                  {condition || METHODS[entry.method]}
                </span>
                <Icon name="chevron" size={17} />
              </summary>
              <div className="dex-skill-expanded">
                <SkillDescription skill={skill} />
                <a href={skill.source} target="_blank" rel="noreferrer">
                  查看原词条 <Icon name="external" size={13} />
                </a>
              </div>
            </details>
          );
        })}
        {!rows.length && (
          <p className="dex-inline-empty">
            没有符合条件的技能，试试其他名称或效果。
          </p>
        )}
      </div>
    </section>
  );
}
