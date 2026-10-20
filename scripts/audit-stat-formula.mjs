import { readFile, writeFile } from 'node:fs/promises';
import { statPanel as currentStatPanel, STAT_KEYS, IV_VALUES } from '../src/team-stats.mjs';

// Preserve the old calculation here only, to measure the repair without changing old evidence.
function statPanel(base, iv = 0, hp = false, nature = 1) {
  return Math.round((Math.round((hp ? 1.7 : 1.1) * (base + 3 * iv)) + (hp ? 70 : 10)) * nature) + (hp ? 100 : 50);
}

// Diagnostic candidates, not an approved game formula. Never imported by the engine.
// Both candidates assume level 60, five-star growth, no battle buffs, and raw IVs.
// Integer arithmetic makes the choice of rounding stage explicit.
function candidate(base, iv, hp, percent, rounding) {
  const numerator = (hp ? 17 : 11) * (base + 3 * iv) + (hp ? 700 : 100);
  const core = rounding === 'two-stage' ? Math.floor((numerator + 5) / 10) * 10 : numerator;
  return Math.floor((core * percent + 500) / 1000) + (hp ? 100 : 50);
}

const data = JSON.parse(await readFile(new URL('../public/data/bwiki-2026-10-14.json', import.meta.url)));
const differences = [], roundingExamples = [];
let checked = 0, upliftDifferences = 0, roundingDifferences = 0;
for (const pet of data.creatures) for (const stat of STAT_KEYS) for (const iv of IV_VALUES) {
  for (const direction of ['up', 'neutral', 'down']) {
    const base = pet.stats[stat], hp = stat === 'hp';
    const percent = direction === 'up' ? 120 : direction === 'down' ? 90 : 100;
    const legacy = statPanel(base, iv, hp, direction === 'up' ? 1.1 : direction === 'down' ? 0.9 : 1);
    const single = candidate(base, iv, hp, percent, 'single-stage');
    const double = candidate(base, iv, hp, percent, 'two-stage');
    const row = { id: pet.id, title: pet.title, stat, base, initialIV: iv, nature: direction, legacy, singleStageCandidate: single, twoStageCandidate: double };
    checked++;
    if (direction === 'up' && legacy !== double) { upliftDifferences++; if (differences.length < 12) differences.push(row); }
    if (single !== double) { roundingDifferences++; if (roundingExamples.length < 24) roundingExamples.push(row); }
  }
}

const fixture = JSON.parse(await readFile(new URL('../docs/evidence/stat-panel-game-fixture.json', import.meta.url)));
const observedChecks = STAT_KEYS.map(stat => {
  const direction = stat === 'atk' ? 'up' : stat === 'spa' ? 'down' : 'neutral';
  const percent = direction === 'up' ? 120 : direction === 'down' ? 90 : 100;
  const base = fixture.baseStats[stat], iv = fixture.initialIVs[stat], hp = stat === 'hp';
  return { stat, observed: fixture.observedPanel[stat], corrected: currentStatPanel(base, iv, hp, percent / 100), legacy: statPanel(base, iv, hp, direction === 'up' ? 1.1 : percent / 100), singleStage: candidate(base, iv, hp, percent, 'single-stage') };
});
if (observedChecks.some(row => row.observed !== row.corrected)) throw Error('实机样例回归失败');
const report = {
  assessedAt: '2026-10-15', status: 'needs-current-game-validation',
  latestVersionCertified: false, gameFormulaVerified: false, formalTrainingReady: false,
  scope: 'All rows in the existing 625-form snapshot, including forms not confirmed legal for PVP. These are scalar calculations, not legal full builds or game observations.',
  assumptions: { level: 60, growthStars: 5, initialIVs: IV_VALUES, candidateNatureMultipliers: [0.9, 1, 1.2], excludes: ['awakening', 'battle buffs', 'traits modifying stats'] },
  sources: [
    { url: 'https://news.17173.com/content/03292026/165133482.shtml', kind: 'official-guide', supports: 'Growth increases individual aptitude and the positive nature effect; does not establish the complete current rounding formula.' },
    { url: 'https://www.bilibili.com/opus/1138388134177800227', kind: 'original-player-research-2025-test', supports: 'Historical five-star IV x6 and positive nature x1.2; one-stage final rounding; explicitly test-era, not current-version certification.' },
    { url: 'https://roco-showdown.com/battle-use-guide', kind: 'calculator-author-documentation', supports: 'Two-stage rounding; neutral attack example base128/IV10=234 and defense base121/IV10=226. Calculator examples, not independent game observations.' },
    { url: 'https://github.com/alvg233/rock-pvp-tool', kind: 'calculator-author-documentation', supports: 'Positive nature x1.2 and single-stage formula in README. README has outdated HP description conflicting with its own later changelog; do not use as game ground truth.' }
  ],
  checks: { forms: data.creatures.length, scalarCases: checked, positiveNatureChangedCases: upliftDifferences, roundingDisagreementCases: roundingDifferences },
  handChecks: [
    { label: 'Neutral example, not game verification', base: 128, initialIV: 10, hp: false, multiplier: 1, expectedFromCalculator: 234, actualLegacy: statPanel(128, 10) },
    { label: 'Neutral example, not game verification', base: 121, initialIV: 10, hp: false, multiplier: 1, expectedFromCalculator: 226, actualLegacy: statPanel(121, 10) },
    { label: 'Nature sensitivity; candidate only', base: 128, initialIV: 10, hp: false, oldPositive: statPanel(128, 10, false, 1.1), candidatePositive: candidate(128, 10, false, 120, 'two-stage') }
  ],
  positiveNatureExamples: differences, roundingDiscriminators: roundingExamples,
  currentGameObservedPanels: [],
  historicalGameFixture: fixture,
  historicalObservedChecks: observedChecks,
  implementationStatus: 'Corrected engine matches all six observed launch-version stats. Current-season certification remains blocked.',
  requiredObservationFields: ['source URL or local screenshot/video path', 'capture date and game patch', 'form ID', 'PVP mode', 'level', 'growth stars', 'six base stats with version', 'six initial IVs', 'nature', 'six observed panel stats', 'awakening state and battle modifiers', 'image region or video timestamp'],
  acceptance: [
    'Verify current five-star nature coefficients and IV growth against actual game panels.',
    'Use discriminating inputs where the candidates disagree; include HP and non-HP, positive/negative/neutral nature, IV0/7/8/9/10 and half-integer boundaries.',
    'Record observed values before evaluating formulas; never generate observed values with the calculator.',
    'Resolve all mismatches and obtain independent holdout observations before approving a formula. Passing these diagnostic comparisons alone cannot certify it.',
    'After approval, version the engine formula and invalidate old policy weights/evaluations; rerun calibration before training.'
  ]
};
const output = new URL('../docs/evidence/stat-formula-audit-2026-10-15.json', import.meta.url);
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, ...report.checks, historicalObservedChecks: observedChecks, currentGameObservedPanels: 0 }, null, 2));
