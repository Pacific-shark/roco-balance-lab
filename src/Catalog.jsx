import React, { useDeferredValue, useEffect, useMemo, useState } from "react";

const statNames = {
  hp: "生命",
  atk: "物攻",
  def: "物防",
  spa: "魔攻",
  spd: "魔防",
  spe: "速度",
};
export default function Catalog() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [mode, setMode] = useState("creatures"),
    [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState("pet_000006");
  const search = useDeferredValue(query.trim().toLowerCase());
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}data/bwiki-2026-10-14.json`)
      .then((r) => {
        if (!r.ok) throw new Error("资料加载失败");
        return r.json();
      })
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const types = useMemo(
    () =>
      data ? [...new Set(data.creatures.flatMap((c) => c.types))].sort() : [],
    [data],
  );
  const filtered = useMemo(() => {
    if (!data) return [];
    let rows =
      mode === "creatures"
        ? data.creatures
        : mode === "skills"
          ? Object.values(data.skills).filter((s) => s.category !== "特性")
          : [
              ...new Map(
                Object.values(data.skills)
                  .filter((s) => s.category === "特性")
                  .map((s) => [s.name, s]),
              ).values(),
            ];
    return rows.filter((r) => {
      const feature = mode === "creatures" ? data.skills[r.trait] : null;
      const text =
        mode === "creatures"
          ? `${r.dex} ${r.title} ${r.form} ${feature.name} ${feature.description}`
          : `${r.name} ${r.description}`;
      return (
        (!search || text.toLowerCase().includes(search)) &&
        (!type || (r.types ?? [r.type]).includes(type))
      );
    });
  }, [data, mode, search, type]);
  useEffect(() => setPage(0), [search, type, mode]);
  if (error) return <p role="alert">{error}，请刷新页面重试。</p>;
  if (!data)
    return (
      <p role="status" className="catalog-loading">
        正在读取图鉴资料…
      </p>
    );
  const current =
      mode === "creatures"
        ? (filtered.find((c) => c.id === selected) ?? filtered[0])
        : data.creatures.find((c) => c.id === selected),
    trait = current ? data.skills[current.trait] : null,
    counts = data.meta.counts;
  const pages = Math.max(1, Math.ceil(filtered.length / 36)),
    safePage = Math.min(page, pages - 1);
  const nativeTypes = [
    ...new Set(
      (current?.skills ?? [])
        .filter((s) => s.method !== "血脉")
        .map((s) => data.skills[s.skill])
        .filter((s) => s.category === "物攻" || s.category === "魔攻")
        .map((s) => s.type),
    ),
  ];
  return (
    <div className="catalog">
      <div className="catalog-summary">
        <div>
          <strong>{counts.forms}</strong>
          <span>精灵形态 · {counts.dexNumbers} 个图鉴编号</span>
        </div>
        <div>
          <strong>{counts.skills}</strong>
          <span>战斗技能</span>
        </div>
        <div>
          <strong>{counts.traitNames}</strong>
          <span>特性名称 · {counts.traitIds} 条内部记录</span>
        </div>
        <div>
          <strong>{counts.learnsetEntries.toLocaleString()}</strong>
          <span>学习来源记录 · 按形态保留</span>
        </div>
      </div>
      <p className="catalog-boundary">
        BWIKI · 2026-10-14
        读取。这里用于核对资料和确定实验范围；全量数据尚未接入对战引擎。6v6
        团队实验目前覆盖 10 个形态与 42 个已注册技能。
      </p>
      <div className="catalog-controls">
        <div className="segmented">
          {[
            ["creatures", "精灵"],
            ["skills", "技能"],
            ["traits", "特性"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={mode === id ? "active" : ""}
              onClick={() => {
                setMode(id);
                setType("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="catalog-search">
          <span className="sr-only">搜索图鉴</span>
          <input
            aria-label="搜索图鉴"
            placeholder={
              mode === "creatures"
                ? "搜索精灵、编号、特性或效果"
                : "搜索名称或机制描述"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {mode !== "traits" ? (
          <select
            aria-label="筛选属性"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">所有属性</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        ) : null}
        <span aria-live="polite">{filtered.length} 条结果</span>
      </div>
      <div
        className={mode === "creatures" ? "catalog-layout" : "catalog-single"}
      >
        <section className="catalog-results" aria-label="图鉴搜索结果">
          {mode === "creatures" ? (
            <div className="creature-cards">
              {filtered.slice(safePage * 36, (safePage + 1) * 36).map((c) => (
                <button
                  key={c.id}
                  className={c.id === current?.id ? "active" : ""}
                  onClick={() => setSelected(c.id)}
                >
                  <small>
                    #{c.dex} · {c.types.join(" / ")}
                  </small>
                  <strong>{c.name}</strong>
                  <span>{c.form}</span>
                  <em>
                    {data.skills[c.trait].name} · 总种族 {c.total}
                  </em>
                </button>
              ))}
            </div>
          ) : (
            <div className="mechanic-list">
              {filtered.slice(safePage * 36, (safePage + 1) * 36).map((s) => (
                <article key={s.id}>
                  <div>
                    <h2>{s.name}</h2>
                    <a href={s.source} target="_blank" rel="noreferrer">
                      原条目 ↗
                    </a>
                  </div>
                  {mode === "skills" ? (
                    <small>
                      {s.type} · {s.category} · 能耗 {s.cost} · 威力{" "}
                      {s.power ?? "—"}
                    </small>
                  ) : null}
                  <p>{s.description}</p>
                  {s.terms.length ? (
                    <span className="term-tags">
                      {[
                        ...new Set(
                          s.terms
                            .map(
                              (t) =>
                                data.terms.find((x) => x.id === String(t))
                                  ?.name,
                            )
                            .filter(Boolean),
                        ),
                      ].join(" · ")}
                    </span>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          {!filtered.length ? (
            <p className="empty">
              没有匹配的记录。可以换一个名称或机制关键词。
            </p>
          ) : null}
          <div className="catalog-pagination">
            <button disabled={!safePage} onClick={() => setPage(safePage - 1)}>
              上一页
            </button>
            <span>
              {safePage + 1} / {pages}
            </span>
            <button
              disabled={safePage >= pages - 1}
              onClick={() => setPage(safePage + 1)}
            >
              下一页
            </button>
          </div>
        </section>
        {mode === "creatures" && current ? (
          <aside className="creature-detail">
            <div className="section-head">
              <div>
                <small>
                  #{current.dex} · {current.types.join(" / ")}
                </small>
                <h2>{current.name}</h2>
                <p>
                  {current.form} · {current.stage}
                </p>
              </div>
              <a href={current.source} target="_blank" rel="noreferrer">
                原图鉴 ↗
              </a>
            </div>
            <dl className="base-stats">
              {Object.entries(statNames).map(([key, name]) => (
                <div key={key}>
                  <dt>{name}</dt>
                  <dd>{current.stats[key]}</dd>
                </div>
              ))}
            </dl>
            <div className="trait-detail">
              <strong>{trait.name}</strong>
              <p>{trait.description}</p>
            </div>
            <details className="design-prompts">
              <summary>这只精灵值得验证什么</summary>
              <p>
                特性：先记录触发条件、频率与收益，再比较移除特性及重新训练后的变化。
              </p>
              <p>
                技能分配：自学与技能石提供 {nativeTypes.length} 种攻击系别（
                {nativeTypes.join("、")}
                ）。系别数量只是检查入口，不能直接判定打击面过强。
              </p>
              <p>
                血脉：逐个检验候选补盲带来的对位变化，同时保留血脉条件与技能槽位成本。列表不代表这些技能能够同时装备。
              </p>
            </details>
            <h3 className="pool-title">
              完整学习来源 · {current.skills.length} 条
            </h3>
            <p className="footnote">
              按来源分开保留；学习等级、阶段及特殊条件仍需参与配招合法性校验。
            </p>
            <div className="pool-list">
              {current.skills.map((entry, i) => {
                const s = data.skills[entry.skill];
                return (
                  <details key={`${entry.skill}-${i}`}>
                    <summary>
                      <b>{s.name}</b>
                      <span>
                        {entry.method}
                        {entry.blood ? "·" + entry.blood : ""}
                        {entry.level ? " Lv." + entry.level : ""}
                      </span>
                    </summary>
                    <p>
                      {s.type} · {s.category} · 威力 {s.power ?? "—"} · 能耗{" "}
                      {s.cost}
                    </p>
                    <p>{s.description}</p>
                    {entry.requires ? <p>条件：{entry.requires}</p> : null}
                    {entry.stage ? <p>来源记录阶段：{entry.stage}</p> : null}
                    <a href={s.source} target="_blank" rel="noreferrer">
                      核对原条目 ↗
                    </a>
                  </details>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>
      <details className="catalog-provenance">
        <summary>校验记录、版本与使用说明</summary>
        <p>
          625
          条形态的种族值、属性及特性说明已与列表逐条比对；学习来源不存在悬空技能引用。242
          个特性名称对应 245
          个内部编号，保留同名记录，避免丢失形态关系。这些是资料完整性检查，不是战斗规则正确性证明。
        </p>
        <ul>
          {data.meta.limitations.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="source-list">
          {data.meta.modules.map((m) => (
            <a key={m.name} href={m.url} target="_blank" rel="noreferrer">
              {m.name} · 修订 {m.revision} ↗
            </a>
          ))}
        </div>
        <a
          href={`${import.meta.env.BASE_URL}data/bwiki-2026-10-14.json`}
          download
        >
          下载带来源的完整数据 JSON
        </a>
      </details>
      <p className="catalog-credit">
        数据整理自{" "}
        <a href={data.meta.source} target="_blank" rel="noreferrer">
          洛克王国：世界 BWIKI 玩家社区
        </a>
        ，本项目进行了字段规范与关系展开，按{" "}
        <a href={data.meta.licenseUrl} target="_blank" rel="noreferrer">
          CC BY-SA 4.0
        </a>{" "}
        共享。游戏美术、角色与其他素材的权利归原权利人；本页未复制美术资源。
      </p>
    </div>
  );
}
