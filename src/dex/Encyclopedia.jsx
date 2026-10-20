import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Icon,
  Portrait,
  TypeTag,
  STAT_NAMES,
  SkillDescription,
} from "./shared.jsx";
import TeamGallery from "./TeamGallery.jsx";
import SkillPool from "./SkillPool.jsx";
import "./dex.css";

function CatalogRail({ data, byId, selected, onSelect }) {
  const listRef = useRef(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [form, setForm] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().replace(/^#/, "").toLowerCase();
    return data.creatures.filter(
      (c) =>
        (!type || c.types.includes(type)) &&
        (!form || c.form === form) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.title?.toLowerCase().includes(q) ||
          c.number === q ||
          (/^\d+$/.test(q) && Number(c.number) === Number(q))),
    );
  }, [data.creatures, query, type, form]);
  const types = useMemo(
    () => [...new Set(data.creatures.flatMap((c) => c.types))],
    [data.creatures],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 30));
  const safePage = Math.min(page, pages - 1);
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector('[aria-current="true"]');
    if (
      list &&
      item &&
      (!window.matchMedia("(max-width: 760px)").matches || open)
    ) {
      list.scrollTop +=
        item.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
    }
  }, [selected, open]);
  const change = (setter, value) => {
    setter(value);
    setPage(0);
  };
  return (
    <aside
      className={`dex-rail ${open ? "is-open" : ""}`}
      aria-label="精灵列表"
    >
      <button
        className="dex-mobile-catalog-toggle"
        aria-expanded={open}
        aria-controls="dex-catalog-content"
        onClick={() => setOpen((v) => !v)}
      >
        <Portrait key={selected} creature={byId.get(selected)} />
        <span>
          选择精灵 <b>{byId.get(selected)?.name}</b>
        </span>
        <Icon name={open ? "close" : "chevron"} size={20} />
      </button>
      <div id="dex-catalog-content" className="dex-catalog-content">
        <label className="dex-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            aria-label="搜索精灵名称或图鉴编号"
            placeholder="名称 / 编号"
            value={query}
            onChange={(e) => change(setQuery, e.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => change(setQuery, "")}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        <div className="dex-filters">
          <label>
            <span>属性</span>
            <select
              aria-label="属性筛选"
              value={type}
              onChange={(e) => change(setType, e.target.value)}
            >
              <option value="">全部属性</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <Icon name="chevron" size={15} />
          </label>
          <label>
            <span>形态</span>
            <select
              aria-label="形态筛选"
              value={form}
              onChange={(e) => change(setForm, e.target.value)}
            >
              <option value="">全部形态</option>
              <option value="final">最终形态</option>
              <option value="evolving">可进化形态</option>
              <option value="lord">首领形态</option>
            </select>
            <Icon name="chevron" size={15} />
          </label>
        </div>
        <div className="dex-list-label">
          <h2>精灵列表</h2>
          <span>{filtered.length} 条形态</span>
        </div>
        <div className="dex-creature-list" ref={listRef}>
          {filtered.slice(safePage * 30, safePage * 30 + 30).map((c) => (
            <button
              key={c.id}
              className={`dex-list-item ${selected === c.id ? "selected" : ""}`}
              aria-current={selected === c.id ? "true" : undefined}
              aria-label={`查看${c.title ?? c.name}图鉴 ${c.number}`}
              onClick={() => {
                onSelect(c.id);
                setOpen(false);
              }}
            >
              <Portrait key={c.id} creature={c} />
              <span>
                <small>
                  #{c.number}
                  {c.form === "lord" ? " · 首领" : ""}
                </small>
                <b>{c.title ?? c.name}</b>
              </span>
              <i>{c.types[0]?.replace("系", "")}</i>
            </button>
          ))}
          {!filtered.length && (
            <div className="dex-rail-empty">
              <p>没有找到匹配的精灵</p>
              <button
                onClick={() => {
                  setQuery("");
                  setType("");
                  setForm("");
                  setPage(0);
                }}
              >
                清除筛选
              </button>
            </div>
          )}
        </div>
        <div className="dex-list-pagination">
          <button
            aria-label="上一页精灵"
            disabled={!safePage}
            onClick={() => setPage(safePage - 1)}
          >
            <Icon name="back" size={18} />
          </button>
          <span>
            {safePage + 1} / {pages}
          </span>
          <button
            aria-label="下一页精灵"
            disabled={safePage === pages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            <Icon name="arrow" size={18} />
          </button>
        </div>
        <p className="dex-rail-foot">含各阶段与首领形态</p>
      </div>
    </aside>
  );
}
function Evolution({ creature, data, byId, onSelect }) {
  const groups = data.evolutions[creature.evolution] ?? [];
  return (
    <div className="dex-evolution">
      <h3>进化与形态</h3>
      {groups.map((g, i) => (
        <div key={i} className="dex-evolution-group">
          <div className="dex-evolution-chain">
            {g.chain.map(
              (e, n) =>
                byId.has(e.id) && (
                  <React.Fragment key={e.id}>
                    {n > 0 && (
                      <span className="dex-evolution-arrow">
                        <Icon name="arrow" size={13} />
                        {e.level && <small>Lv.{e.level}</small>}
                      </span>
                    )}
                    <button
                      aria-label={`查看${e.name}进化图鉴`}
                      aria-pressed={e.id === creature.id}
                      onClick={() => onSelect(e.id)}
                    >
                      <Portrait key={e.id} creature={byId.get(e.id)} />
                      <span>{e.name}</span>
                    </button>
                  </React.Fragment>
                ),
            )}
          </div>
          {g.lord_branches.length > 0 && (
            <div className="dex-lord-links">
              <span>首领化</span>
              {g.lord_branches
                .filter((e) => byId.has(e.id))
                .map((e) => (
                  <button key={e.id} onClick={() => onSelect(e.id)}>
                    {e.name} <Icon name="external" size={12} />
                  </button>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
function Overview({ creature, data, byId, onSelect }) {
  const trait = data.skills[creature.trait];
  const total = Object.values(creature.stats).reduce((a, b) => a + b, 0);
  return (
    <section
      id="dex-overview"
      className="dex-overview"
      aria-label={`${creature.name}基础资料`}
    >
      <div className="dex-profile">
        <div className="dex-identity-heading">
          <div>
            <span className="dex-number">#{creature.number}</span>
            <h1>{creature.title ?? creature.name}</h1>
          </div>
          <div className="dex-types">
            {creature.types.map((t) => (
              <TypeTag key={t} type={t} />
            ))}
            {creature.form === "lord" && (
              <span className="dex-form-label">首领形态</span>
            )}
          </div>
        </div>
        <div className="dex-intro">
          <p className="dex-description">{creature.description}</p>
          <div className="dex-size">
            <span>身高 {creature.height ?? "—"}</span>
            <span>体重 {creature.weight ?? "—"}</span>
          </div>
        </div>
        <div className="dex-art">
          <Portrait key={creature.id} creature={creature} large eager />
        </div>
        <Evolution
          creature={creature}
          data={data}
          byId={byId}
          onSelect={onSelect}
        />
      </div>
      <div className="dex-stats-trait">
        <div className="dex-stat-panel">
          <div className="dex-stats-heading">
            <h2>种族值</h2>
            <span>
              总和 <strong>{total}</strong>
            </span>
          </div>
          <dl className="dex-stats">
            {Object.entries(STAT_NAMES).map(([key, name]) => (
              <div key={key} className={`dex-stat-${key}`}>
                <dt>
                  <Icon
                    name={
                      {
                        hp: "heart",
                        atk: "sword",
                        def: "shield",
                        spa: "spark",
                        spd: "shield",
                        spe: "wind",
                      }[key]
                    }
                    size={18}
                  />
                  {name}
                </dt>
                <dd>
                  <span className="dex-stat-track">
                    <i
                      style={{
                        width: `${Math.min(100, (creature.stats[key] / 200) * 100)}%`,
                      }}
                    />
                  </span>
                  <b>{creature.stats[key]}</b>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="dex-trait">
          <div className="dex-trait-emblem">
            <Icon name="spark" size={88} />
          </div>
          <span>固有特性</span>
          <h3>{trait.name}</h3>
          <SkillDescription skill={trait} />
        </div>
        <a
          className="dex-source-link"
          href={creature.source}
          target="_blank"
          rel="noreferrer"
        >
          原始图鉴资料 <Icon name="external" size={13} />
        </a>
      </div>
    </section>
  );
}
function LoadedDex({ data }) {
  const byId = useMemo(
    () => new Map(data.creatures.map((c) => [c.id, c])),
    [data.creatures],
  );
  const [id, setId] = useState(
    () =>
      new URLSearchParams(window.location.hash.slice(1)).get("pet") ??
      "pet_000005",
  );
  const creature = byId.get(id) ?? byId.get("pet_000005");
  const onSelect = (nextId) => {
    if (!byId.has(nextId)) return;
    setId(nextId);
    const params = new URLSearchParams({ pet: nextId });
    window.history.replaceState(null, "", `#${params}`);
    document.title = `${byId.get(nextId).title ?? byId.get(nextId).name} · 精灵资料`;
  };
  useEffect(() => {
    document.title = `${creature.title ?? creature.name} · 精灵资料`;
    const onHash = () => {
      if (
        [
          "#dex-main",
          "#dex-overview",
          "#dex-teams-heading",
          "#dex-pool-heading",
        ].includes(window.location.hash)
      )
        return;
      setId(
        new URLSearchParams(window.location.hash.slice(1)).get("pet") ??
          "pet_000005",
      );
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [creature.name]);
  return (
    <div className="dex-app">
      <a className="dex-skip" href="#dex-main">
        跳到精灵资料
      </a>
      <CatalogRail
        data={data}
        byId={byId}
        selected={creature.id}
        onSelect={onSelect}
      />
      <main id="dex-main" className="dex-main">
        <Overview
          creature={creature}
          data={data}
          byId={byId}
          onSelect={onSelect}
        />
        <TeamGallery
          key={`teams:${creature.id}`}
          creature={creature}
          data={data}
          byId={byId}
          onOpen={onSelect}
        />
        <SkillPool
          key={`skills:${creature.id}`}
          creature={creature}
          data={data}
        />
        <footer className="dex-footer">
          <span>
            资料快照 {data.meta.capturedAt.slice(0, 10)} · {data.meta.version}
          </span>
          {!import.meta.env.VITE_DEX_STATIC_ONLY && (
            <a href={`${import.meta.env.BASE_URL}research.html`}>研究工作台</a>
          )}
          <span>
            <a href={data.meta.sourceUrl} target="_blank" rel="noreferrer">
              BWIKI 社区资料
            </a>{" "}
            ·{" "}
            <a href={data.meta.licenseUrl} target="_blank" rel="noreferrer">
              CC BY-SA 4.0
            </a>
          </span>
          <p>
            非官方个人项目 ·
            游戏美术归原权利人。配队为公开案例整理，尚无本项目实测胜率；资料版本与当前对战环境需分别核对。
          </p>
        </footer>
      </main>
    </div>
  );
}
export default function Encyclopedia() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetch(`${import.meta.env.BASE_URL}data/dex.json`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error("图鉴加载失败");
        return r.json();
      })
      .then((result) => {
        if (!Array.isArray(result.creatures) || !result.teams || !result.skills)
          throw Error("图鉴资料不完整");
        setData(result);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  if (!data)
    return (
      <div className="dex-loading" role="status">
        <span className="dex-loading-orbit" aria-hidden="true" />
        <h1>{error ? "暂时没能加载资料" : "正在加载精灵资料"}</h1>
        <p>
          {error ? "请检查网络连接后重试。" : "立绘、种族值与配队即将显示。"}
        </p>
        {error && (
          <button onClick={() => setAttempt((v) => v + 1)}>重新加载</button>
        )}
      </div>
    );
  return <LoadedDex data={data} />;
}
