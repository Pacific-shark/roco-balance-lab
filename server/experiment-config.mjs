import { pilotAdmission } from "../src/pilot-admission.mjs";

export const ROLES = [
  "不预设角色",
  "进攻",
  "防守",
  "支援",
  "轮转",
  "针对性反制",
];
export function validateExperiment(input, manifest, prototypeData) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("实验配置必须是对象");
  const allowed = [
    "target",
    "role",
    "mode",
    "episodes",
    "maxSeconds",
    "seed",
    "population",
  ];
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw Error("实验包含未知配置字段");
  const cfg = {
    role: ROLES[0],
    mode: "prototype",
    episodes: 100,
    maxSeconds: 60,
    seed: 42,
    population: 3,
    ...input,
  };
  for (const [name, lo, hi] of [
    ["episodes", 100, 2000],
    ["maxSeconds", 10, 600],
    ["seed", 0, 1000000000],
    ["population", 2, 6],
  ])
    if (!Number.isInteger(cfg[name]) || cfg[name] < lo || cfg[name] > hi)
      throw Error(`${name} 必须在 ${lo}—${hi} 之间`);
  if (cfg.episodes % 100)
    throw Error("训练局数须为100的整数倍，每100局保存一次检查点");
  if (!ROLES.includes(cfg.role)) throw Error("角色假设无效");
  if (!["prototype", "formal"].includes(cfg.mode)) throw Error("实验模式无效");
  if (cfg.mode === "formal") {
    const gate = pilotAdmission(manifest);
    if (!gate.trainingAllowed)
      throw Error(`正式强度研究尚有 ${gate.blockers.length} 项核验未完成`);
    throw Error("正式规则适配器尚未实现，不能使用旧原型替代");
  }
  const entity = manifest.roster.find((r) => r.id === cfg.target);
  if (!entity || entity.classification !== "highest-normal-candidate")
    throw Error("研究对象必须是最高常规形态候选");
  if (!Object.hasOwn(prototypeData.creatures, cfg.target))
    throw Error("该精灵尚未接入可执行原型，可建档但不能训练");
  return Object.freeze(cfg);
}
