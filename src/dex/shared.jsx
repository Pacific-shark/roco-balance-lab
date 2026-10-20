import React, { useState } from "react";
import {
  Search,
  BookOpen,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  X,
  Check,
  Heart,
  Sword,
  Shield,
  Sparkles,
  Wind,
  Droplet,
  ExternalLink,
  Leaf,
  FlaskConical,
} from "lucide-react";
const ICONS = {
  search: Search,
  book: BookOpen,
  arrow: ChevronRight,
  chevron: ChevronDown,
  back: ChevronLeft,
  close: X,
  check: Check,
  heart: Heart,
  sword: Sword,
  shield: Shield,
  spark: Sparkles,
  wind: Wind,
  drop: Droplet,
  external: ExternalLink,
  leaf: Leaf,
  flask: FlaskConical,
};

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
  const Component = ICONS[name];
  return Component ? (
    <Component size={size} strokeWidth={1.8} aria-hidden="true" />
  ) : null;
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
