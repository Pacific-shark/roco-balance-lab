/** Floor an integer damage amount after an exact decimal reduction.
 * This fixes binary floating-point loss; it does not certify the game's
 * damage formula or where in the damage pipeline reduction must occur.
 */
export function reduceIntegerDamage(damage, reduction) {
  if (!Number.isSafeInteger(damage) || damage < 0)
    throw new RangeError("Damage must be a nonnegative safe integer");
  if (!Number.isFinite(reduction) || reduction < 0 || reduction > 1)
    throw new RangeError("Damage reduction must be between zero and one");
  if (damage === 0 || reduction === 1) return 0;
  if (reduction === 0) return damage;
  const [coefficient, exponent = "0"] = String(reduction).split("e");
  const [whole, fractional = ""] = coefficient.split(".");
  const scale = fractional.length - Number(exponent);
  let numerator = BigInt(whole + fractional);
  let denominator = 1n;
  if (scale >= 0) denominator = 10n ** BigInt(scale);
  else numerator *= 10n ** BigInt(-scale);
  return Number((BigInt(damage) * (denominator - numerator)) / denominator);
}
