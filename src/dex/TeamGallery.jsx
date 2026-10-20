import React, { useState } from "react";
import {
  Icon,
  Portrait,
  TypeTag,
  STAT_NAMES,
  SkillDescription,
} from "./shared.jsx";

function MemberBuild({ member, creature, data, onOpen }) {
  const trait = data.skills[creature.trait];
  return (
    <div className="dex-member-build" aria-live="polite" aria-atomic="false">
      <div className="dex-member-profile">
        <h3>
          {creature.name}
          <button
            className="dex-text-button"
            onClick={() => onOpen(creature.id)}
          >
            查看图鉴 <Icon name="arrow" size={13} />
          </button>
        </h3>
        <div className="dex-member-types">
          {creature.types.map((type) => (
            <TypeTag key={type} type={type} />
          ))}
        </div>
        <p className="dex-role">
          {member.role ?? "成员已确认，具体定位与配置待补录。"}
        </p>
        <dl className="dex-cultivation">
          <div>
            <dt>推荐性格</dt>
            <dd>
              {member.nature ? (
                <>
                  <b>{member.nature}</b>
                  <span className="dex-nature-direction">
                    <span>↑ {STAT_NAMES[member.natureDirection.up]}</span>
                    <span>↓ {STAT_NAMES[member.natureDirection.down]}</span>
                  </span>
                </>
              ) : (
                <span className="dex-muted">待补录</span>
              )}
            </dd>
          </div>
          <div>
            <dt>血脉</dt>
            <dd>{member.bloodline ? `${member.bloodline}血脉` : "待补录"}</dd>
          </div>
          <div>
            <dt>天分方向</dt>
            <dd>
              {member.aptitudeStats.length
                ? member.aptitudeStats.map((s) => STAT_NAMES[s]).join(" / ")
                : "待补录"}
            </dd>
          </div>
        </dl>
        <details className="dex-member-trait">
          <summary>
            <span>固有特性</span>
            <b>{trait.name}</b>
            <Icon name="chevron" size={15} />
          </summary>
          <SkillDescription skill={trait} />
        </details>
        {member.nature && (
          <small className="dex-muted">
            性格与天分方向按本套案例记录，未做最优培养验证。
          </small>
        )}
      </div>
      <div className="dex-move-build">
        <h4>
          本队配招{" "}
          <span>{member.moves.length ? "4 个技能" : "尚未完整记录"}</span>
        </h4>
        {member.moves.length ? (
          <div className="dex-move-grid">
            {member.moves.map((id, i) => {
              const s = data.skills[id];
              return (
                <article className="dex-move" key={id}>
                  <span
                    className="dex-move-index"
                    aria-label={`技能槽 ${i + 1}`}
                  >
                    {i + 1}
                  </span>
                  <div className="dex-move-body">
                    <div className="dex-move-title">
                      <strong>{s.name}</strong>
                      <TypeTag type={s.type} />
                      <span className="dex-move-meta">
                        {s.damageClass ?? s.category}
                        <span>
                          威力 <b>{s.power ?? "—"}</b>
                        </span>
                      </span>
                      <span className="dex-cost">
                        <Icon name="drop" size={15} />
                        <span className="dex-sr-only">能耗</span>
                        <b>{s.cost ?? "—"}</b>
                      </span>
                    </div>
                    <p>{s.description}</p>
                    <details className="dex-move-reason">
                      <summary>
                        配招解析
                        <Icon name="chevron" size={13} />
                      </summary>
                      <p>{member.slotReasons[i]}</p>
                      {s.notes?.map((note, index) => (
                        <p key={index}>
                          <b>{note.note ?? note.name}</b> {note.desc}
                        </p>
                      ))}
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="dex-build-empty">
            <b>这套队伍的配招、性格还在核对</b>
            <p>先保留已确认的六人名单，避免把另一套队伍的配置直接套用。</p>
          </div>
        )}
      </div>
    </div>
  );
}
function SelectedTeam({ team, data, byId, selectedCreature, onOpen }) {
  const initial = new URLSearchParams(window.location.hash.slice(1)).get(
    "member",
  );
  const [memberId, setMemberId] = useState(() =>
    team.members.some((m) => m.id === initial) ? initial : selectedCreature,
  );
  const member = team.members.find((m) => m.id === memberId) ?? team.members[0];
  const choose = (id) => {
    setMemberId(id);
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.set("member", id);
    window.history.replaceState(null, "", `#${params}`);
  };
  return (
    <div className="dex-selected-team">
      <div className="dex-team-summary">
        <div>
          <p>{team.description}</p>
          <span className={`dex-evidence ${team.status}`}>
            {team.status === "build-recorded"
              ? "六人配置已收录"
              : "六人名单已收录 · 配置待补"}
            {team.author ? ` · ${team.author}` : ""}
          </span>
        </div>
        <a href={team.source} target="_blank" rel="noreferrer">
          {team.sourceLabel} <Icon name="external" size={14} />
        </a>
      </div>
      <div
        className="dex-lineup"
        role="group"
        aria-label={`${team.name}六人阵容`}
      >
        {team.members.map((m) => (
          <button
            key={m.id}
            className={`dex-teammate ${member.id === m.id ? "selected" : ""}`}
            aria-pressed={member.id === m.id}
            aria-label={`查看${m.name}在${team.name}中的配置`}
            onClick={() => choose(m.id)}
          >
            <span className="dex-avatar-ring">
              <Portrait key={m.id} creature={byId.get(m.id)} />
              {member.id === m.id && (
                <i className="dex-selected-check">
                  <Icon name="check" size={14} />
                </i>
              )}
            </span>
            <span>{m.name}</span>
          </button>
        ))}
      </div>
      <div className="dex-build-panel">
        <MemberBuild
          key={member.id}
          member={member}
          creature={byId.get(member.id)}
          data={data}
          onOpen={onOpen}
        />
        <aside className="dex-resonance">
          <div className="dex-resonance-label">
            <Icon name="leaf" size={18} /> 整队共鸣魔法
          </div>
          <strong>
            {team.resonance?.name ?? "待补录"}
            {team.resonance && <span> · {team.resonance.subtitle}</span>}
          </strong>
          <p>{team.resonance?.note ?? "来源中尚未确认这套队伍的共鸣选择。"}</p>
        </aside>
      </div>
    </div>
  );
}
export default function TeamGallery({ creature, data, byId, onOpen }) {
  const teams = data.teams.filter((team) =>
    team.members.some((member) => member.id === creature.id),
  );
  const [teamId, setTeamId] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("team"),
  );
  const selected = teams.find((t) => t.id === teamId) ?? teams[0];
  const choose = (id) => {
    setTeamId(id);
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.set("team", id);
    params.delete("member");
    window.history.replaceState(null, "", `#${params}`);
  };
  return (
    <section className="dex-teams" aria-labelledby="dex-teams-heading">
      <div className="dex-team-toolbar">
        <div className="dex-section-heading">
          <h2 id="dex-teams-heading">配队参考</h2>
          <span>
            {teams.length ? `${teams.length} 套公开案例` : "持续收录中"}
          </span>
        </div>
        {selected && (
          <div className="dex-team-tabs" role="group" aria-label="选择配队">
            {teams.map((team) => (
              <button
                key={team.id}
                aria-pressed={selected.id === team.id}
                className={selected.id === team.id ? "selected" : ""}
                onClick={() => choose(team.id)}
              >
                {team.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected ? (
        <>
          <SelectedTeam
            key={selected.id}
            team={selected}
            data={data}
            byId={byId}
            selectedCreature={creature.id}
            onOpen={onOpen}
          />
        </>
      ) : (
        <div className="dex-no-team">
          <Icon name="book" size={28} />
          <div>
            <h3>还没有收录{creature.name}的配队案例</h3>
            <p>基础资料与技能池可正常查阅。配队会按来源逐套补充。</p>
          </div>
          <button onClick={() => onOpen("pet_000005")}>
            看看水灵的 3 套案例 <Icon name="arrow" size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
