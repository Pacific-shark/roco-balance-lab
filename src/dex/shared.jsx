import React, { useState } from "react";

export const STAT_NAMES = {
  hp: "生命",
  atk: "物攻",
  def: "物防",
  spa: "魔攻",
  spd: "魔防",
  spe: "速度",
};
export const TYPE_COLORS = {
  水系: "#2778c4",
  草系: "#4c8b43",
  火系: "#c85539",
  电系: "#a47b13",
  冰系: "#3a8eaa",
  翼系: "#7b71ae",
  幽系: "#82669b",
  毒系: "#9c5ca1",
  光系: "#b38d20",
  地系: "#9d7952",
  普通系: "#768390",
  龙系: "#6363af",
  虫系: "#7b8e39",
  武系: "#ab6346",
  萌系: "#ba7091",
  恶系: "#71637b",
  机械系: "#637e8c",
  幻系: "#8170b6",
};
export function Icon({ name, size = 20 }) {
  const paths = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    book: (
      <>
        <path d="M12 5v16M3 4c4-1 6 0 9 1 3-1 5-2 9-1v15c-4-1-6 0-9 2-3-2-5-3-9-2Z" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    external: (
      <>
        <path d="M14 4h6v6M20 4l-9 9M10 5H4v15h15v-6" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 3C9 2 3 6 4 13s11 9 14 0c1-3 1-7 2-10ZM3 22 15 9" />
      </>
    ),
    flask: (
      <>
        <path d="M9 3h6M10 3v7L4 20h16l-6-10V3M7 15h10" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function TypeTag({ type }) {
  return (
    <span
      className="dex-type"
      style={{ "--type": TYPE_COLORS[type] ?? "#718098" }}
    >
      {type}
    </span>
  );
}
export function Portrait({ creature, large = false, eager = false }) {
  const [failed, setFailed] = useState(false);
  const src = large ? creature.illustration : creature.head;
  return (
    <span className={`dex-portrait ${large ? "large" : ""}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={large ? `${creature.name}立绘` : ""}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="dex-image-fallback"
          role="img"
          aria-label={`${creature.name}图片暂不可用`}
        >
          {creature.name.slice(0, 2)}
        </span>
      )}
    </span>
  );
}
export function SkillDescription({ skill }) {
  return (
    <>
      <p>{skill.description}</p>
      {skill.notes?.length > 0 && (
        <details className="dex-terms">
          <summary>效果术语</summary>
          {skill.notes.map((n, i) => (
            <p key={i}>
              <b>{n.note ?? n.name}</b> {n.desc}
            </p>
          ))}
        </details>
      )}
    </>
  );
}
