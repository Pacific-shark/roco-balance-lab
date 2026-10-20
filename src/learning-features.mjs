// Derived descriptors use the same public metadata and player view as the encoder.
// Attack pressure has no opponent defense, speed, hidden move or future action.
export const combatFeatureNames = [
  "physical",
  "special",
  "hits",
  "currentPower",
  "sameType",
  "targetTypeKnown",
  "typeEffect",
  "attackPressure",
  "focusGain",
];
export function combatFeatures(data, view, move, slot) {
  const own = view.own.pets[view.own.active];
  const enemy = view.opponent.known[view.opponent.activeEncounter]?.lastSeen;
  if (!move)
    return [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      slot === 4 && own ? Math.min(5, 10 - own.energy) / 5 : 0,
    ];
  const effect = move.effect,
    physical = move.category === "物攻",
    special = move.category === "魔攻";
  const power =
    (move.power ?? 0) +
    (effect.growth ?? 0) * (own.uses[move.id] ?? 0) +
    own.powerBonus;
  const stab = own.types.includes(move.type) ? 1.25 : 1;
  const factors = enemy?.types.map(
    (type) => data.types[type]?.[move.type] ?? 1,
  );
  const multiplier = !factors
    ? 1
    : factors.length === 2 && factors.every((x) => x === 2)
      ? 3
      : factors.reduce((a, b) => a * b, 1);
  const key = physical ? "atk" : "spa",
    boost = own.boosts[key] ?? 0;
  const pressure =
    move.kind === "attack"
      ? (power *
          (effect.hits ?? 1) *
          stab *
          multiplier *
          own.stats[key] *
          own.nextAttack *
          (1 + Math.max(0, boost))) /
        (1 + Math.max(0, -boost)) /
        50000
      : 0;
  return [
    +physical,
    +special,
    (effect.hits ?? 1) / 3,
    power / 150,
    stab / 1.25,
    +Boolean(enemy),
    multiplier / 3,
    Math.min(5, pressure),
    0,
  ];
}
