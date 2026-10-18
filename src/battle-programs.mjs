// Exact, fail-closed compilation of pinned source descriptions. A recognized
// prefix never licenses an unrecognized suffix; text is never evaluated as code.
export const PROGRAM_VERSION = "battle-programs-1";
const stats = {
  物攻: ["atk"],
  魔攻: ["spa"],
  物防: ["def"],
  魔防: ["spd"],
  速度: ["spe"],
  双攻: ["atk", "spa"],
  双防: ["def", "spd"],
  攻防: ["atk", "spa", "def", "spd"],
  攻防速: ["atk", "spa", "def", "spd", "spe"],
};
const categories = { 攻击: "attack", 状态: "status", 防御: "defense" };
const clean = (text) => text.trim().replace(/[。；，,\s]+$/u, "");
const operations = [
  "heal",
  "energy",
  "buff",
  "status",
  "mark",
  "guard",
  "power",
  "cost",
  "hits",
  "nextPower",
  "priority",
  "interrupt",
  "weather",
  "drain",
  "skillPower",
  "skillCost",
  "skillHits",
  "attackPower",
  "attackHits",
];
export const PROGRAM_OPS = Object.freeze(operations);

function buff(text) {
  const values = [];
  let remaining = text;
  while (remaining) {
    const match = remaining.match(
      /^((?:(?:物攻|魔攻|物防|魔防|速度|双攻|双防|攻防速|攻防)(?:和)?)+)(永久)?([+-]\d+)(%?)/u,
    );
    if (!match) return null;
    const names = match[1]
      .replaceAll("和", "")
      .match(/物攻|魔攻|物防|魔防|速度|双攻|双防|攻防速|攻防/gu);
    if (names.join("") !== match[1].replaceAll("和", "")) return null;
    for (const name of names)
      for (const stat of stats[name]) {
        // Speed points and speed percentages are different operations.
        if (stat !== "spe" && !match[4]) return null;
        values.push({
          stat,
          amount: Number(match[3]) / (match[4] ? 100 : 1),
          unit: match[4] ? "ratio" : "flat",
          permanent: !!match[2],
        });
      }
    remaining = remaining.slice(match[0].length).replace(/^和/u, "");
  }
  return values.length ? values : null;
}

function clause(raw, base) {
  const text = clean(raw).replace(/^(?:并|且|随后|额外使|额外|使用后)/u, "");
  let m;
  if (
    (m = text.match(
      /^每(?:次)?成功?应对(?:成功)?1次[,，]本技能(威力|连击数)永久([+-]\d+)$/u,
    )) ||
    (m = text.match(/^每应对成功1次[,，]本技能(威力|连击数)永久([+-]\d+)$/u))
  )
    return [
      {
        op: m[1] === "威力" ? "skillPower" : "skillHits",
        amount: +m[2],
        passive: "counter",
      },
    ];
  if (
    (m = text.match(
      /^每(?:次)?(?:使用1次|使用)其他([^系]+)系技能(?:后)?[,，]本技能(威力|能耗)永久([+-]\d+)$/u,
    ))
  )
    return [
      {
        op: m[2] === "威力" ? "skillPower" : "skillCost",
        amount: +m[3],
        passive: "otherMove",
        type: m[1],
      },
    ];
  if (
    (m = text.match(
      /^每(?:次)?(?:使用1次|使用)其他([^系]+)系技能(?:后)?[,，]本技能威力永久翻倍$/u,
    ))
  )
    return [
      { op: "skillPower", multiply: 2, passive: "otherMove", type: m[1] },
    ];
  if ((m = text.match(/^每次击败敌方[,，]本技能威力永久([+-]\d+|翻倍)$/u)))
    return [
      {
        op: "skillPower",
        ...(m[1] === "翻倍" ? { multiply: 2 } : { amount: +m[1] }),
        passive: "kill",
      },
    ];
  if ((m = text.match(/^(?:每次入场|每入场1次)[,，]本技能威力永久\+(\d+)$/u)))
    return [{ op: "skillPower", amount: +m[1], passive: "entry" }];
  if ((m = text.match(/^(自己|敌方)每有1层(中毒效果|冻结)[,，](.+)$/u))) {
    const effects = clause(m[3], base);
    if (!effects) return null;
    return effects.map((op) => ({
      ...op,
      scaleBy: {
        kind: m[2] === "中毒效果" ? "poisonEffect" : "status",
        name: "冻结",
        who: m[1] === "自己" ? "self" : "enemy",
      },
    }));
  }
  if ((m = text.match(/^(自己|敌方)每有1能量[,，](.+)$/u))) {
    const effects = clause(m[2], base);
    if (!effects) return null;
    return effects.map((op) => ({
      ...op,
      scaleBy: { kind: "energy", who: m[1] === "自己" ? "self" : "enemy" },
    }));
  }
  if ((m = text.match(/^敌方每有1只力竭精灵[,，](.+)$/u))) {
    const effects = clause(m[1], base);
    return (
      effects?.map((op) => ({
        ...op,
        scaleBy: { kind: "fainted", who: "enemy" },
      })) ?? null
    );
  }
  if ((m = text.match(/^本次技能威力([+-]\d+)%$/u)))
    return [{ op: "attackPower", percent: +m[1] / 100 }];
  if ((m = text.match(/^(自己|敌方)?(?:获得)?(\d+)回合禁足$/u)))
    return [
      { op: "trap", target: m[1] === "自己" ? "self" : "enemy", turns: +m[2] },
    ];
  if ((m = text.match(/^(自己|敌方)?脱离$/u)))
    return [
      {
        op: "departure",
        target: m[1] === "敌方" ? "enemy" : "self",
        mode: "pivot",
      },
    ];
  if (/^敌方和自己均脱离$/u.test(text))
    return [{ op: "departure", target: "both", mode: "pivot" }];
  if ((m = text.match(/^(?:使)?(自己|敌方)(?:精灵)?返场$/u)))
    return [
      {
        op: "departure",
        target: m[1] === "敌方" ? "enemy" : "self",
        mode: "reenter",
      },
    ];
  if (
    (m = text.match(
      /^(自己|敌方)?(?:回合结束时?|回合结束后)(?:使)?(自己|敌方)?(?:精灵)?返场$/u,
    ))
  )
    return [
      {
        op: "departure",
        target: (m[2] ?? m[1]) === "敌方" ? "enemy" : "self",
        mode: "reenter",
        timing: "end",
      },
    ];
  if ((m = text.match(/^回合结束时?(?:，|,)(.+)$/u))) {
    const result = clause(m[1], base);
    return (
      result?.map((op) => ({
        ...op,
        ...(op.op.startsWith("skill") ? { passive: "end" } : { timing: "end" }),
      })) ?? null
    );
  }
  if (/^迅捷$/u.test(text)) return [{ op: "swift" }];
  if ((m = text.match(/^本(?:次)?技能(?:威力)?\+(\d+)%$/u)))
    return [{ op: "attackPower", multiply: 1 + +m[1] / 100 }];
  if ((m = text.match(/^本次(?:技能)?(?:威力)?([+-]\d+)$/u)))
    return [{ op: "attackPower", amount: +m[1] }];
  if (/^本次伤害翻倍$/u.test(text)) return [{ op: "attackPower", multiply: 2 }];
  if ((m = text.match(/^改为(\d+)连击$/u)))
    return [{ op: "attackHits", set: +m[1] }];
  if ((m = text.match(/^本技能能耗([+-]\d+)$/u)))
    return [{ op: "immediateCost", amount: +m[1] }];
  if ((m = text.match(/^本技能(威力|能耗|连击数)永久([+-]\d+)$/u)))
    return [
      {
        op: { 威力: "skillPower", 能耗: "skillCost", 连击数: "skillHits" }[
          m[1]
        ],
        amount: +m[2],
      },
    ];
  if ((m = text.match(/^每次连击(?:使)?(.+)$/u))) {
    const result = clause(m[1], base);
    return result?.map((op) => ({ ...op, perHit: true })) ?? null;
  }
  if ((m = text.match(/^本次技能(?:威力)?([+-]\d+)$/u)))
    return [{ op: "attackPower", amount: +m[1] }];
  if ((m = text.match(/^本次技能连击数([+-]\d+)$/u)))
    return [{ op: "attackHits", amount: +m[1] }];
  if ((m = text.match(/^本次能耗([+-]\d+)$/u)))
    return [{ op: "immediateCost", amount: +m[1] }];
  if (/^本次技能连击数翻倍$/u.test(text))
    return [{ op: "attackHits", multiply: 2 }];
  if ((m = text.match(/^本技能(?:改为|变为)(\d+)连击$/u)))
    return [{ op: "attackHits", set: +m[1] }];
  if (
    /^(?:对敌方(?:精灵)?)?造成(?:大量|高额)?(?:物伤|魔伤|物理伤害|魔法伤害)$/u.test(
      text,
    )
  ) {
    const physical = /物/u.test(text);
    return base.kind === "attack" && physical === (base.category === "物攻")
      ? []
      : null;
  }
  if ((m = text.match(/^(\d+)连击$/u)))
    return [{ op: "hits", amount: +m[1], set: true }];
  if ((m = text.match(/^(?:自己)?回复(\d+)%生命(?:和(\d+)能量)?$/u)))
    return [
      { op: "heal", target: "self", fraction: +m[1] / 100 },
      ...(m[2] ? [{ op: "energy", target: "self", amount: +m[2] }] : []),
    ];
  if ((m = text.match(/^(?:自己)?回复(\d+)点?能量(?:和(\d+)%生命)?$/u)))
    return [
      { op: "energy", target: "self", amount: +m[1] },
      ...(m[2] ? [{ op: "heal", target: "self", fraction: +m[2] / 100 }] : []),
    ];
  if ((m = text.match(/^(?:为)?场下(?:每个|所有)精灵回复(\d+)能量$/u)))
    return [{ op: "energy", target: "bench", amount: +m[1] }];
  if ((m = text.match(/^敌方失去(\d+)能量$/u)))
    return [{ op: "energy", target: "enemy", amount: -m[1] }];
  if ((m = text.match(/^敌方队伍中所有精灵失去(\d+)能量$/u)))
    return [{ op: "energy", target: "enemyTeam", amount: -m[1] }];
  if ((m = text.match(/^偷取敌方(\d+)能量$/u)))
    return [{ op: "energy", target: "steal", amount: +m[1] }];
  if ((m = text.match(/^(自己|敌方)获得(\d+)层(中毒|灼烧|冻结|引电)$/u)))
    return [
      {
        op: "status",
        target: m[1] === "自己" ? "self" : "enemy",
        status: m[3],
        amount: +m[2],
      },
    ];
  if (
    (m = text.match(
      /^(自己|敌方)获得(\d+)层(攻击|中毒|棘刺|光合|湿润|风起|降灵|蓄势|龙噬|减速)印记$/u,
    ))
  )
    return [
      {
        op: "mark",
        target: m[1] === "自己" ? "self" : "enemy",
        mark: m[3],
        amount: +m[2],
      },
    ];
  if ((m = text.match(/^减伤(\d+)%$/u)))
    return [{ op: "guard", fraction: +m[1] / 100 }];
  if ((m = text.match(/^(?:本技能)?先手([+-]\d+)$/u)))
    return [{ op: "priority", amount: +m[1] }];
  if ((m = text.match(/^(?:本次攻击)?吸血(\d+)%$/u)))
    return [{ op: "drain", fraction: +m[1] / 100 }];
  if ((m = text.match(/^自己获得(\d+)%吸血$/u)))
    return [{ op: "drain", fraction: +m[1] / 100, persistent: true }];
  if ((m = text.match(/^(自己|敌方)?获得(?:全技能)?威力(永久)?([+-]\d+)$/u)))
    return [
      {
        op: "power",
        target: m[1] === "敌方" ? "enemy" : "self",
        amount: +m[3],
        permanent: !!m[2],
      },
    ];
  if ((m = text.match(/^(?:(自己|敌方)获得)?全技能能耗(永久)?([+-]\d+)$/u)))
    return [
      {
        op: "cost",
        target: m[1] === "敌方" ? "enemy" : "self",
        amount: +m[3],
        permanent: !!m[2],
      },
    ];
  if ((m = text.match(/^(自己|敌方)?获得连击数([+-]\d+)$/u)))
    return [
      { op: "hits", target: m[1] === "敌方" ? "enemy" : "self", amount: +m[2] },
    ];
  if ((m = text.match(/^(自己|敌方)?获得(.+)$/u))) {
    const changes = buff(m[2]);
    if (changes)
      return [
        { op: "buff", target: m[1] === "敌方" ? "enemy" : "self", changes },
      ];
  }
  if (
    (m = text.match(/^每次使用后[，,]本技能(威力|能耗|连击数)永久([+-]\d+)$/u))
  )
    return [
      {
        op: { 威力: "skillPower", 能耗: "skillCost", 连击数: "skillHits" }[
          m[1]
        ],
        amount: +m[2],
      },
    ];
  if ((m = text.match(/^下一次攻击时[，,]技能威力([+-]\d+)$/u)))
    return [{ op: "nextPower", amount: +m[1] }];
  if (/^(?:下一次攻击时[，,]技能|下次攻击技能)威力翻倍$/u.test(text))
    return [{ op: "nextPower", multiply: 2 }];
  if ((m = text.match(/^本次(?:技能)?威力变为(\d+(?:\.\d+)?)倍$/u)))
    return [{ op: "attackPower", multiply: +m[1] }];
  if (/^本次技能威力翻倍$/u.test(text))
    return [{ op: "attackPower", multiply: 2 }];
  if ((m = text.match(/^造成(\d+)倍伤害$/u)))
    return [{ op: "attackPower", multiply: +m[1] }];
  if (/^(?:额外)?打断被应对技能$/u.test(text)) return [{ op: "interrupt" }];
  if (
    (m = text.match(/^将天气改为(雨天|沙暴|暴风雪|雷鸣)[，,]持续(\d+)回合$/u))
  )
    return [{ op: "weather", weather: m[1], turns: +m[2] }];
  return null;
}

function parsePart(text, base) {
  if (!text) return { ops: [], unknown: [] };
  // These comma-bearing phrases form indivisible clauses.
  text = text
    .replace(
      /(每(?:次)?(?:成功?应对(?:成功)?1次|应对成功1次|(?:使用1次|使用)其他[^系]+系技能(?:后)?|击败敌方|入场))，/gu,
      "$1,",
    )
    .replace(
      /((?:自己|敌方)每有1(?:层(?:中毒效果|冻结)|能量|只力竭精灵))，/gu,
      "$1,",
    )
    .replaceAll("每次使用后，", "每次使用后,")
    .replaceAll("下一次攻击时，", "下一次攻击时,")
    .replaceAll("回合结束时，", "回合结束时,")
    .replace(/(造成(?:物伤|魔伤))并/g, "$1，")
    .replace(/(减伤\d+%)并/g, "$1，")
    .replace(/(将天气改为[^，]+)，/gu, "$1,");
  const parts = text
      .split(/[。，；]/u)
      .map(clean)
      .filter(Boolean),
    ops = [],
    unknown = [];
  const conditions = [
    [/^若先于敌方攻击$/u, () => ({ kind: "firstAttack" })],
    [/^若后手攻击$/u, () => ({ kind: "notFirstAttack" })],
    [/^若敌方本回合更换精灵$/u, () => ({ kind: "enemySwitch" })],
    [
      /^若(?:敌方有冻结|敌方有冻结效果)$/u,
      () => ({ kind: "status", name: "冻结", who: "enemy" }),
    ],
    [/^若敌方有中毒效果$/u, () => ({ kind: "poisonEffect", who: "enemy" })],
    [
      /^若上回合使用(攻击|状态|防御)技能$/u,
      (m) => ({ kind: "previousKind", value: categories[m[1]] }),
    ],
    [/^若上回合应对成功$/u, () => ({ kind: "previousCounter" })],
    [
      /^若上回合双方有精灵使用([^系]+)系技能$/u,
      (m) => ({ kind: "previousType", value: m[1] }),
    ],
    [/^迸发[:：](.*)$/u, () => ({ kind: "burst" })],
    [
      /^(?:若)?自己生命(?:大于|高于)(\d+)%时?$/u,
      (m) => ({
        kind: "hp",
        who: "self",
        comparison: "gt",
        value: +m[1] / 100,
      }),
    ],
    [
      /^若自己的生命低于(\d+)%$/u,
      (m) => ({
        kind: "hp",
        who: "self",
        comparison: "lt",
        value: +m[1] / 100,
      }),
    ],
    [
      /^若自己生命低于(\d+)%$/u,
      (m) => ({
        kind: "hp",
        who: "self",
        comparison: "lt",
        value: +m[1] / 100,
      }),
    ],
    [
      /^若敌方生命低于(\d+)%$/u,
      (m) => ({
        kind: "hp",
        who: "enemy",
        comparison: "lt",
        value: +m[1] / 100,
      }),
    ],
    [
      /^若敌方能量(小于等于|等于)(\d+)$/u,
      (m) => ({
        kind: "energy",
        who: "enemy",
        comparison: m[1] === "等于" ? "eq" : "lte",
        value: +m[2],
      }),
    ],
    [
      /^天气为(雨天|沙暴|暴风雪|雷鸣)时$/u,
      (m) => ({ kind: "weather", value: m[1] }),
    ],
  ];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const burst = part.match(/^迸发[:：](.+)$/u);
    if (burst) {
      const result = clause(burst[1], base);
      if (result === null) unknown.push(part);
      else
        ops.push(...result.map((op) => ({ ...op, when: { kind: "burst" } })));
      continue;
    }
    let when;
    for (const [pattern, convert] of conditions) {
      const match = part.match(pattern);
      if (match) {
        when = convert(match);
        break;
      }
    }
    if (when) {
      const following = parts[++i],
        result = following ? clause(following, base) : null;
      if (result === null)
        unknown.push(part, following ?? "missing-conditional-effect");
      else ops.push(...result.map((op) => ({ ...op, when })));
      continue;
    }
    const result = clause(part, base);
    if (result === null) unknown.push(part);
    else ops.push(...result);
  }
  return { ops, unknown };
}

export function compileMove(id, source) {
  const base = {
    id,
    name: source.name,
    kind: categories[source.category],
    type: source.element?.replace(/系$/u, ""),
    category: source.damage_class ?? null,
    power: source.power ?? 0,
    cost: source.energy,
  };
  const pending = [];
  if (
    !base.kind ||
    !Number.isFinite(base.power) ||
    !Number.isFinite(base.cost) ||
    (base.kind === "attack" && !Number.isFinite(source.power))
  )
    pending.push("unsupported-header");
  let text = clean(source.desc),
    counter = null,
    counterText = "",
    replace = false;
  if (text.includes("选择：")) {
    const [prefix, choice, ...extra] = text.split("选择："),
      branches = choice.split("或");
    if (extra.length || branches.length !== 2)
      return {
        ...base,
        version: PROGRAM_VERSION,
        sourceDescription: source.desc,
        status: "unsupported",
        pending: ["ambiguous-choice-branches"],
        gameVerified: false,
      };
    const choices = branches.map((branch) =>
      compileMove(id, {
        ...source,
        desc: prefix + branch.replace(/应对(状态|攻击|防御)时/gu, "应对$1："),
      }),
    );
    pending.push(...choices.flatMap((c) => c.pending));
    return {
      ...base,
      version: PROGRAM_VERSION,
      sourceDescription: source.desc,
      sourceTerms: source.desc_notes ?? [],
      status: pending.length ? "unsupported" : "compiled",
      pending,
      choices,
      gameVerified: false,
    };
  }
  const match = text.match(/^(.*?)应对(攻击|状态|防御)(?:[:：](.*))?$/u);
  if (match) {
    text = clean(match[1]);
    counter = categories[match[2]];
    counterText = match[3] ?? "";
  }
  if (counterText.startsWith("改为")) {
    // Only one simple base effect may be replaced. Composite/ambiguous cases
    // stay unsupported instead of erasing unrelated effects.
    replace = true;
    counterText = counterText.slice(2);
    if (/^回复/u.test(counterText)) counterText = "自己" + counterText;
    else if (/^(?:速度|物攻|魔攻|物防|魔防|双攻|双防)/u.test(counterText))
      counterText = "自己获得" + counterText;
  }
  const plain = parsePart(text, base);
  let response = parsePart(counterText, base);
  const amount = counterText.match(/^获得(\d+)层$/u);
  if (
    replace &&
    amount &&
    plain.ops.length === 1 &&
    plain.ops[0].op === "status"
  )
    response = { ops: [{ ...plain.ops[0], amount: +amount[1] }], unknown: [] };
  if (replace && plain.ops.length !== 1)
    pending.push("ambiguous-counter-replacement");
  pending.push(...plain.unknown, ...response.unknown);
  // Schema checks are strict; an empty unrecognized description is not a noop.
  if (!source.desc?.trim()) pending.push("missing-description");
  return {
    ...base,
    version: PROGRAM_VERSION,
    sourceDescription: source.desc,
    sourceTerms: source.desc_notes ?? [],
    status: pending.length ? "unsupported" : "compiled",
    counter,
    replaceOnCounter: replace,
    ops: plain.ops,
    counterOps: response.ops,
    pending,
    gameVerified: false,
  };
}

const traitEntry = (trigger, ops, extra = {}) => ({ trigger, ops, ...extra });
export function compileTrait(id, source) {
  const text = clean(source.desc),
    rules = [];
  let m;
  const effect = (trigger, body, extra = {}) => {
    const parsed = parsePart(body, { kind: "status" });
    if (!parsed.unknown.length) {
      rules.push(traitEntry(trigger, parsed.ops, extra));
      return true;
    }
    return false;
  };
  let recognized = false;
  if (text === "敌方精灵离场时，自己获得全技能能耗-3") {
    recognized = effect("enemyExit", "自己获得全技能能耗-3");
  } else if (text === "敌方精灵离场后，更换入场的精灵失去3能量") {
    rules.push(
      traitEntry("enemyReplacement", [
        { op: "energy", target: "enemy", amount: -3 },
      ]),
    );
    recognized = true;
  } else if (text === "离场后，更换入场的精灵获得双防+20%且免疫冻结") {
    recognized = effect("replacement", "自己获得双防+20%");
    rules.push(
      traitEntry("replacement", [{ op: "statusImmunity", name: "冻结" }]),
    );
  } else if (text === "离场后，更换入场的精灵获得双攻+20%且免疫灼烧") {
    recognized = effect("replacement", "自己获得双攻+20%");
    rules.push(
      traitEntry("replacement", [{ op: "statusImmunity", name: "灼烧" }]),
    );
  } else if (text === "造成克制伤害后，获得攻防速+20%，并回复2能量") {
    recognized = effect("effectiveAttack", "自己获得攻防速+20%，回复2能量");
  } else if (text === "每入场1次，永久获得双攻+30%") {
    recognized = effect("entry", "自己获得双攻永久+30%");
  } else if (text === "携带的攻击技能获得迸发：威力+40") {
    rules.push(traitEntry("static", [{ op: "burstPower", amount: 40 }]));
    recognized = true;
  } else if (text === "携带的电系技能获得迸发：能耗-2") {
    rules.push(
      traitEntry("static", [{ op: "burstCost", type: "电", amount: -2 }]),
    );
    recognized = true;
  } else if (text === "携带的龙系技能获得迅捷") {
    rules.push(traitEntry("static", [{ op: "swiftType", type: "龙" }]));
    recognized = true;
  } else if (text === "每次行动后脱离") {
    rules.push(
      traitEntry("afterAction", [
        { op: "departure", mode: "pivot", target: "self" },
      ]),
    );
    recognized = true;
  } else if (text === "敌方每有1层中毒效果，自己获得连击数+1") {
    rules.push(traitEntry("static", [{ op: "poisonHits", amount: 1 }]));
    recognized = true;
  } else if (text === "在场时，所有精灵连击数固定为2") {
    rules.push(traitEntry("static", [{ op: "fixedHits", amount: 2 }]));
    recognized = true;
  } else if (text === "入场时，若自己魔力值为1，自己获得双攻+100%") {
    recognized = effect("entry", "自己获得双攻+100%", { ownMagic: 1 });
  } else if (text === "入场时，若敌方魔力值为1，自己获得双防+100%") {
    recognized = effect("entry", "自己获得双防+100%", { enemyMagic: 1 });
  } else if (text === "天气为雷鸣时，使用电系技能后敌方获得引电") {
    recognized = effect("afterMove", "敌方获得1层引电", {
      type: "电",
      weather: "雷鸣",
    });
  } else if (text === "回合结束时，若自己能量为0则脱离") {
    rules.push(
      traitEntry("end", [{ op: "departure", mode: "pivot", target: "self" }], {
        ownEnergy: 0,
      }),
    );
    recognized = true;
  } else if (text === "使用防御技能后，回合结束时脱离") {
    rules.push(
      traitEntry(
        "afterMove",
        [{ op: "departure", mode: "pivot", target: "self", timing: "end" }],
        { moveKind: "defense" },
      ),
    );
    recognized = true;
  } else if (text === "携带的能耗小于3的技能，获得迅捷") {
    rules.push(traitEntry("static", [{ op: "swiftBelowCost", threshold: 3 }]));
    recognized = true;
  } else if (text === "在场时，敌方全技能能耗+1") {
    rules.push(traitEntry("static", [{ op: "enemyCostAura", amount: 1 }]));
    recognized = true;
  } else if (text === "应对成功后，获得全技能威力永久+30") {
    recognized = effect("counter", "自己获得全技能威力永久+30");
  } else if ((m = text.match(/^回合结束时，(回复\d+(?:能量|%生命))$/u)))
    recognized = effect("end", m[1]);
  else if ((m = text.match(/^使用([^系]+)系技能后，(.+)$/u)))
    recognized = effect("afterMove", m[2], { type: m[1] });
  else if ((m = text.match(/^入场时获得(\d+)%吸血$/u))) {
    rules.push(
      traitEntry("entry", [
        { op: "drain", fraction: +m[1] / 100, persistent: true },
      ]),
    );
    recognized = true;
  } else if ((m = text.match(/^离场时回复(\d+)能量$/u)))
    recognized = effect("exit", `回复${m[1]}能量`);
  else if (text === "自己的能量可以超过能量上限") {
    rules.push(traitEntry("static", [{ op: "energyCap", unlimited: true }]));
    recognized = true;
  } else if ((m = text.match(/^携带的防御技能能耗([+-]\d+)$/u))) {
    rules.push(
      traitEntry("static", [
        { op: "moveCost", kind: "defense", amount: +m[1] },
      ]),
    );
    recognized = true;
  } else if (text === "仅可以使用1号位技能") {
    rules.push(traitEntry("static", [{ op: "onlyFirstSlot" }]));
    recognized = true;
  } else if ((m = text.match(/^携带的(非)?([^系]+)系技能，威力\+(\d+)%$/u))) {
    rules.push(
      traitEntry("static", [
        {
          op: "movePower",
          type: m[2],
          exclude: !!m[1],
          multiply: 1 + +m[3] / 100,
        },
      ]),
    );
    recognized = true;
  } else if (
    (m = text.match(/^携带的能耗(大于|为)(\d+)的技能，威力\+(\d+)%$/u))
  ) {
    rules.push(
      traitEntry("static", [
        {
          op: "movePower",
          costTest: m[1] === "大于" ? "gt" : "eq",
          cost: +m[2],
          multiply: 1 + +m[3] / 100,
        },
      ]),
    );
    recognized = true;
  } else if (text === "若先于敌方攻击，本次技能威力+50%") {
    rules.push(
      traitEntry("static", [
        { op: "movePower", firstAttack: true, multiply: 1.5 },
      ]),
    );
    recognized = true;
  } else if (text === "使用非本系技能时威力+50%") {
    rules.push(
      traitEntry("static", [{ op: "movePower", nonStab: true, multiply: 1.5 }]),
    );
    recognized = true;
  } else if (text === "在场时，双方回合结束时的效果不会触发") {
    rules.push(traitEntry("static", [{ op: "suppressEnd" }]));
    recognized = true;
  } else if (text === "在场时，双方回合结束时的效果会额外触发1次") {
    rules.push(traitEntry("static", [{ op: "repeatEnd" }]));
    recognized = true;
  } else if (text === "每受到1次技能攻击（不含连击），敌方获得1层棘刺印记") {
    recognized = effect("afterAttacked", "敌方获得1层棘刺印记");
  } else if (text === "每受到1次技能攻击（不含连击），敌方获得1层暗涌印记") {
    recognized = effect("afterAttacked", "敌方获得1层暗涌印记");
  } else if (text === "首次入场时，失去自己一半的当前生命") {
    rules.push(
      traitEntry("firstEntry", [{ op: "loseCurrentHp", fraction: 0.5 }]),
    );
    recognized = true;
  } else if (text === "自己力竭时，少损失1点魔力") {
    rules.push(traitEntry("static", [{ op: "koMagic", amount: -1 }]));
    recognized = true;
  } else if (text === "应对成功后，下次攻击威力翻倍") {
    recognized = effect("counter", "下次攻击技能威力翻倍");
  } else if (
    (m = text.match(
      /^初始能量为0，入场前己方精灵每放1次([^系]+)系技能，回复(\d+)能量$/u,
    ))
  ) {
    rules.push(
      traitEntry("initial", [{ op: "setInitialEnergy", amount: 0 }]),
      traitEntry(
        "benchAllyMove",
        [{ op: "energy", target: "self", amount: +m[2] }],
        { type: m[1] },
      ),
    );
    recognized = true;
  } else if (
    text === "初始生命为10%，入场前己方精灵每使用1次草系技能，回复30%生命"
  ) {
    rules.push(
      traitEntry("initial", [{ op: "setInitialHp", fraction: 0.1 }]),
      traitEntry(
        "benchAllyMove",
        [{ op: "heal", target: "self", fraction: 0.3 }],
        { type: "草" },
      ),
    );
    recognized = true;
  } else if (
    (m = text.match(
      /^己方精灵每使用1次([^系]+)系技能，自己入场时获得全技能威力\+(\d+)$/u,
    ))
  ) {
    rules.push(
      traitEntry("entry", [
        { op: "powerFromTeamTypeUses", type: m[1], amount: +m[2] },
      ]),
    );
    recognized = true;
  } else if (
    (m = text.match(
      /^己方精灵每使用1次([^系]+)系技能，自己入场时获得全技能能耗-(\d+)$/u,
    ))
  ) {
    rules.push(
      traitEntry("entry", [
        { op: "costFromTeamTypeUses", type: m[1], amount: -m[2] },
      ]),
    );
    recognized = true;
  } else if ((m = text.match(/^使用([^系]+)系技能时，敌方获得(\d+)层中毒$/u))) {
    recognized = effect("beforeMove", `敌方获得${m[2]}层中毒`, { type: m[1] });
  } else if (
    (m = text.match(/^自己使用([^系]+)系技能后，敌方失去(\d+)能量$/u))
  ) {
    recognized = effect("afterMove", `敌方失去${m[2]}能量`, { type: m[1] });
  } else if ((m = text.match(/^使用能耗为(\d+)的技能时，获得(.+)$/u))) {
    recognized = effect("beforeMove", `自己获得${m[2]}`, { cost: +m[1] });
  } else if (
    (m = text.match(/^使用能耗小于等于(\d+)的技能时，敌方获得(\d+)层中毒$/u))
  ) {
    recognized = effect("beforeMove", `敌方获得${m[2]}层中毒`, {
      maxCost: +m[1],
    });
  } else if (text === "携带的无额外效果的攻击技能，威力+30%") {
    rules.push(
      traitEntry("static", [
        { op: "movePower", plainAttack: true, multiply: 1.3 },
      ]),
    );
    recognized = true;
  } else if (text === "携带的「虫鸣」技能威力+20") {
    rules.push(
      traitEntry("static", [{ op: "namedPower", name: "虫鸣", amount: 20 }]),
    );
    recognized = true;
  } else if (text === "队伍存在虫系精灵，自己获得双攻+50%") {
    rules.push(
      traitEntry("static", [
        { op: "teamTypeBuff", type: "虫", stats: ["atk", "spa"], amount: 0.5 },
      ]),
    );
    recognized = true;
  } else if (text === "每有1能量，获得双防+10%") {
    rules.push(
      traitEntry("static", [
        { op: "energyBuff", stats: ["def", "spd"], amount: 0.1 },
      ]),
    );
    recognized = true;
  } else if (text === "总技能能耗小于4时，自己获得双防+80%") {
    rules.push(
      traitEntry("static", [
        {
          op: "lowTotalCostBuff",
          threshold: 4,
          stats: ["def", "spd"],
          amount: 0.8,
        },
      ]),
    );
    recognized = true;
  } else if (text === "敌方携带技能总能耗每有1点，自己攻击时威力+10%") {
    rules.push(traitEntry("static", [{ op: "enemyCostPower", amount: 0.1 }]));
    recognized = true;
  } else if (text === "受到自己携带技能系别的攻击伤害-40%") {
    rules.push(
      traitEntry("static", [{ op: "ownMoveTypeResistance", fraction: 0.4 }]),
    );
    recognized = true;
  } else if (text === "受到非敌方系别的技能攻击时伤害-50%") {
    rules.push(
      traitEntry("static", [{ op: "nonStabResistance", fraction: 0.5 }]),
    );
    recognized = true;
  } else if (text === "能量等于0的精灵，无法对自己造成伤害") {
    rules.push(traitEntry("static", [{ op: "zeroEnergyImmunity" }]));
    recognized = true;
  } else if (text === "能耗小于等于1的攻击技能，无法对自己造成伤害") {
    rules.push(
      traitEntry("static", [{ op: "cheapAttackImmunity", maxCost: 1 }]),
    );
    recognized = true;
  } else if (text === "己方队伍中每有1只力竭的精灵，自己获得双攻+30%") {
    rules.push(
      traitEntry("static", [
        { op: "faintedBuff", stats: ["atk", "spa"], amount: 0.3 },
      ]),
    );
    recognized = true;
  } else if (
    (m = text.match(
      /^每携带1个([^系]+)系技能进入战斗，([^系]+)系技能威力\+(\d+)%$/u,
    ))
  ) {
    rules.push(
      traitEntry("static", [
        {
          op: "carriedTypePower",
          carriedType: m[1],
          type: m[2],
          amount: +m[3] / 100,
        },
      ]),
    );
    recognized = true;
  } else if (
    (m = text.match(
      /^每携带1个([^系]+)系技能进入战斗，([^系]+)系技能能耗-(\d+)$/u,
    ))
  ) {
    rules.push(
      traitEntry("static", [
        { op: "carriedTypeCost", carriedType: m[1], type: m[2], amount: -m[3] },
      ]),
    );
    recognized = true;
  } else if (text === "回合结束时，若自己的能量为0，则回复10能量") {
    rules.push(
      traitEntry("end", [{ op: "energy", target: "self", amount: 10 }], {
        ownEnergy: 0,
      }),
    );
    recognized = true;
  } else if (
    (m = text.match(/^(入场时|回合结束时，)偷取敌方场上所有精灵(\d+)能量$/u))
  ) {
    recognized = effect(
      m[1] === "入场时" ? "entry" : "end",
      `偷取敌方${m[2]}能量`,
    );
  } else if (text === "每回复1能量，同时回复5%生命") {
    rules.push(
      traitEntry("static", [{ op: "healOnEnergyGain", fraction: 0.05 }]),
    );
    recognized = true;
  } else if (text === "回合结束时，双方队伍中的所有精灵回复1能量") {
    rules.push(traitEntry("end", [{ op: "allTeamsEnergy", amount: 1 }]));
    recognized = true;
  } else if (
    (m = text.match(/^敌方每携带1种系别的技能，自己攻击时威力\+(\d+)$/u))
  ) {
    rules.push(
      traitEntry("static", [{ op: "enemyDistinctTypePower", amount: +m[1] }]),
    );
    recognized = true;
  } else if (text === "使用翼系技能后，获得连击数+1")
    recognized = effect("afterMove", "获得连击数+1", { type: "翼" });
  else if (text === "应对成功后，永久获得双攻+30%")
    recognized = effect("counter", "自己获得双攻永久+30%");
  else if (text === "天气为暴风雪时，冰系技能威力+100%") {
    rules.push(
      traitEntry("static", [
        { op: "weatherPower", weather: "暴风雪", type: "冰", multiply: 2 },
      ]),
    );
    recognized = true;
  } else if (text === "天气为沙暴时，自己获得速度+50") {
    rules.push(
      traitEntry("static", [
        { op: "weatherSpeed", weather: "沙暴", amount: 50 },
      ]),
    );
    recognized = true;
  } else if (
    text === "受到致命伤害时，获得1层萌化，并免疫此次伤害。（最多触发2次）"
  ) {
    recognized = false; // Form/stat/trait inheritance must exist before admission.
  }
  return {
    id,
    name: source.name,
    version: PROGRAM_VERSION,
    sourceDescription: source.desc,
    sourceTerms: source.desc_notes ?? [],
    rules,
    status: recognized ? "compiled" : "unsupported",
    pending: recognized ? [] : [source.desc],
    gameVerified: false,
  };
}

export function compileCatalogPrograms(skills) {
  return Object.fromEntries(
    Object.entries(skills).map(([id, s]) => [
      id,
      s.category === "特性" ? compileTrait(id, s) : compileMove(id, s),
    ]),
  );
}

export function assertProgram(program) {
  if (!program || program.status !== "compiled")
    throw new Error(
      `机制未实现：${program?.name ?? "unknown"}；${program?.pending?.join("；") ?? ""}`,
    );
}
