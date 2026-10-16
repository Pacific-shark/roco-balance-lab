/** Sept 30 official simultaneous-exit rule, isolated from general action order.
 * Speeds must already include the applicable effects. No probability law is
 * assumed: an equal-speed event requires an externally recorded outcome.
 * This resolver is not yet wired into the legacy battle/learning loop.
 */
export function simultaneousExitCandidates(outgoingSpeeds) {
  if (!Array.isArray(outgoingSpeeds) || outgoingSpeeds.length !== 2 ||
      outgoingSpeeds.some(speed => !Number.isFinite(speed) || speed < 0))
    throw new RangeError("Two finite nonnegative outgoing speeds are required");
  const [left, right] = outgoingSpeeds;
  return left === right ? [[0, 1], [1, 0]] : left > right ? [[0, 1]] : [[1, 0]];
}

export function resolveSimultaneousExit(outgoingSpeeds, { firstSide } = {}) {
  const candidates = simultaneousExitCandidates(outgoingSpeeds);
  if (firstSide !== undefined && firstSide !== 0 && firstSide !== 1)
    throw new RangeError("Recorded first side must be zero or one");
  if (candidates.length === 2 && firstSide === undefined) {
    const error = new Error("Equal-speed exit needs a recorded chance outcome; distribution is unverified");
    error.code = "EXIT_CHANCE_OUTCOME_REQUIRED";
    error.candidates = candidates;
    throw error;
  }
  const order = candidates.find(candidate => firstSide === undefined || candidate[0] === firstSide);
  if (!order) throw new Error("Recorded exit order contradicts outgoing speed order");
  return {
    sourceRule: "official-fix-2026-09-30-simultaneous-exit",
    outgoingSpeeds: [...outgoingSpeeds], order: [...order],
    resolution: candidates.length === 1 ? "speed" : "recorded-chance-outcome",
    samplingDistribution: null,
    departureOrder: [...order], replacementOrder: [...order],
    // The announcement does not settle whether both departures occur before
    // either arrival, or where entry/exit-triggered effects interleave.
    fullEventInterleavingVerified: false,
  };
}
