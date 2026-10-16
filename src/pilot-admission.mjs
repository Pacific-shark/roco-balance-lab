const REQUIRED = Object.freeze([
  'current-version', 'legal-roster-and-builds', 'panel-and-damage', 'mechanism-closure',
  'observations', 'policy-capability', 'evaluation-protocol',
]);

// Required checks are code-owned: dropping a row cannot make an experiment eligible.
export function pilotAdmission(manifest) {
  const blockers = [];
  const checks = manifest?.checks ?? [];
  for (const id of REQUIRED) {
    const rows = checks.filter(x => x.id === id);
    if (rows.length !== 1) { blockers.push({ id, reason: 'missing-or-duplicate-check' }); continue; }
    const row = rows[0];
    if (row.status !== 'passed') blockers.push({ id, reason: row.status ?? 'unknown', detail: row.detail });
    else if (!Array.isArray(row.evidence) || row.evidence.length === 0)
      blockers.push({ id, reason: 'passed-without-evidence' });
  }
  if (!manifest?.targets?.length) blockers.push({ id: 'targets', reason: 'empty' });
  for (const target of manifest?.targets ?? []) {
    if (target.classification !== 'highest-normal-candidate' || target.legalPvpStatus !== 'verified')
      blockers.push({ id: target.id, reason: 'target-not-certified' });
    if (target.missingMoveIds?.length || target.dynamicClosureStatus !== 'verified' || target.jointBuildLegality !== 'verified')
      blockers.push({ id: target.id, reason: 'incomplete-mechanism-or-legality' });
  }
  return { trainingAllowed: blockers.length === 0, blockers };
}

export function assertPilotAdmission(manifest) {
  const result = pilotAdmission(manifest);
  if (!result.trainingAllowed) {
    const error = new Error(`试点训练未获准入：${result.blockers.length} 项未完成；未启动训练。`);
    error.code = 'PILOT_NOT_READY';
    error.blockers = result.blockers;
    throw error;
  }
  return result;
}
