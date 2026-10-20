import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
from pilot_scope import build_scope, teammate_candidates, inspect_roster_proposal, DEFAULT_TARGETS


class ScopeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads((ROOT/'data/catalog-s4-20261015.json').read_text(encoding='utf-8'))
        cls.engine = json.loads((ROOT/'public/data/team-2026-10-14.json').read_text(encoding='utf-8'))
        cls.scope = build_scope(cls.snapshot, cls.engine, DEFAULT_TARGETS)

    def test_few_targets_do_not_shrink_the_teammate_or_opponent_universe(self):
        other = build_scope(self.snapshot, self.engine, DEFAULT_TARGETS[:1])
        self.assertEqual([r['id'] for r in other['candidates']], [r['id'] for r in self.scope['candidates']])
        self.assertEqual(len(other['candidates']), 259)
        mates = teammate_candidates(other, DEFAULT_TARGETS[0])
        self.assertEqual(len(mates), 258)
        self.assertTrue(any(not r['prototypeFormPresent'] for r in mates))
        self.assertEqual(other['policy']['opponents'], 'same-full-legal-universe')

    def test_missing_engine_support_keeps_proposals_but_never_creates_fake_scores(self):
        target = DEFAULT_TARGETS[0]
        unsupported = [r['id'] for r in teammate_candidates(self.scope, target) if not r['prototypeFormPresent']][:5]
        proposal = inspect_roster_proposal(self.scope, target, [target, *unsupported])
        self.assertTrue(proposal['sourceRosterAccepted'])
        self.assertEqual(proposal['missingPrototypeForms'], unsupported)
        self.assertFalse(proposal['trainingAllowed'])
        self.assertIsNone(proposal['score'])
        self.assertEqual(len(proposal['pendingLegality']), 6)

    def test_support_does_not_certify_legality_or_complete_movesets(self):
        rows = [r for r in self.scope['candidates'] if r['prototypeFormPresent']]
        self.assertTrue(rows)
        self.assertTrue(all(r['legalPvpStatus'] == 'pending' for r in rows))
        self.assertTrue(all(r['missingPrototypeMoveIds'] for r in rows))
        self.assertFalse(self.scope['trainingAllowed'])
        self.assertTrue(all(r['sourceUnionIsNotEquippablePool'] for r in rows))

    def test_invalid_targets_and_rosters_are_rejected(self):
        lord = next(pid for pid,c in self.snapshot['modules']['Catalog'].items() if c['stage'] == 4)
        for targets in ([], [lord], [DEFAULT_TARGETS[0]]*2):
            with self.assertRaises(ValueError): build_scope(self.snapshot, self.engine, targets)
        target = DEFAULT_TARGETS[0]
        with self.assertRaises(ValueError): inspect_roster_proposal(self.scope, target, [target]*6)
        without = [r['id'] for r in teammate_candidates(self.scope, target)][:6]
        with self.assertRaises(ValueError): inspect_roster_proposal(self.scope, target, without)


if __name__ == '__main__':
    unittest.main()
