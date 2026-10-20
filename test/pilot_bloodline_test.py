import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from pilot_builds import compile_bloodline_options, check_source_build, check_resonance_conditions
from pilot_resonance import TeamResonance

BLOODS = [{'id': 1, 'name': '普通'}, {'id': 2, 'name': '草'}, {'id': 16, 'name': '恶'},
          {'id': 19, 'name': '首领'}, {'id': 23, 'name': '污染'}, {'id': 24, 'name': '奇异'}]
ENTRIES = [{'skill': x, 'method': '自学', 'level': 1, 'stage': 1} for x in ['a', 'b', 'c']]
ENTRIES += [{'skill': 'stone', 'method': '技能石'},
            {'skill': 'rest', 'method': '血脉', 'blood': '普通', 'level': 15},
            {'skill': 'drain', 'method': '血脉', 'blood': '恶', 'level': 15}]


def profile(extra=(), level=60, stage=3):
    return compile_bloodline_options(ENTRIES + list(extra), BLOODS, level=level, stage=stage,
        lord_conversions=[{'targetId': 'lord-a', 'item': 'item-a'}, {'targetId': 'lord-b', 'item': 'item-b'}])


def resonance_check(profile, **kw):
    # Synthetic use limits only. This fixture does not certify game parameters.
    magic = kw['resonance']
    if magic in {'wish-amplification', 'evolution-power', 'photosynthetic-healing'}:
        kw['team_resonance'] = TeamResonance(magic, max_uses=2, cooldown_turns=0)
    return check_resonance_conditions(profile, **kw)


class BloodlineTests(unittest.TestCase):
    def test_foreign_blood_move_is_rejected(self):
        p = profile()
        self.assertTrue(check_source_build(p, bloodline='普通', moves=['a','b','c','rest'])['sourceConsistent'])
        r = check_source_build(p, bloodline='普通', moves=['a','b','rest','drain'])
        self.assertFalse(r['sourceConsistent'])
        self.assertIn('no-eligible-source-for-selected-bloodline:drain', r['errors'])

    def test_an_independent_stone_source_preserves_the_move(self):
        p = profile([{'skill':'drain','method':'技能石'}])
        self.assertTrue(check_source_build(p, bloodline='普通', moves=['a','b','rest','drain'])['sourceConsistent'])

    def test_changing_bloodline_revalidates_the_same_moves(self):
        p = profile(); moves=['a','b','c','rest']
        self.assertTrue(check_source_build(p, bloodline=1, moves=moves)['sourceConsistent'])
        self.assertFalse(check_source_build(p, bloodline=16, moves=moves)['sourceConsistent'])
        self.assertFalse(check_source_build(p, bloodline=19, moves=moves)['sourceConsistent'])

    def test_normal_is_an_elemental_bloodline_not_empty(self):
        p=profile()
        self.assertTrue(resonance_check(p, bloodline='普通', resonance='wish-amplification')['knownConditionsSatisfied'])
        self.assertFalse(resonance_check(p, bloodline=None, resonance='wish-amplification')['knownConditionsSatisfied'])

    def test_only_one_known_bloodline_can_be_selected(self):
        for value in [['普通','恶'], True, '', 999]:
            self.assertFalse(check_source_build(profile(), bloodline=value, moves=['a','b','c','stone'])['sourceConsistent'])

    def test_four_distinct_initial_moves_are_required(self):
        for moves in [['a','a','b','c'], ['a','b','c'], 'abcd', ['a','b','c',{}]]:
            self.assertFalse(check_source_build(profile(), bloodline=1, moves=moves)['sourceConsistent'])

    def test_level_and_stage_conditions_are_not_dropped(self):
        p=profile([{'skill':'late','method':'自学','level':61,'stage':3},
                   {'skill':'evolved','method':'自学','level':1,'stage':3}], level=14,stage=2)
        self.assertEqual(len(p['ineligibleSources']),4)
        for move in ['late','evolved','rest','drain']:
            self.assertFalse(check_source_build(p,bloodline=1,moves=['a','b','c',move])['sourceConsistent'])

    def test_unresolved_special_conditions_are_not_invented(self):
        p=profile([{'skill':'legend','method':'传说','requires':'unknown'},
                   {'skill':'missing-level','method':'自学'}])
        for mid in ['legend','missing-level']:
            r=check_source_build(p,bloodline=1,moves=['a','b','c',mid])
            self.assertFalse(r['sourceConsistent']); self.assertTrue(r['pending'])
        for blood in ['污染','奇异']:
            self.assertTrue(check_source_build(p,bloodline=blood,moves=['a','b','c','stone'])['pending'])

    def test_lord_and_elemental_magic_conditions_are_distinct(self):
        p=profile()
        self.assertFalse(resonance_check(p,bloodline='首领',resonance='wish-amplification')['knownConditionsSatisfied'])
        self.assertFalse(resonance_check(p,bloodline='草',resonance='evolution-power',lord_target='lord-a',unlocked_items=['item-a'])['knownConditionsSatisfied'])

    def test_lord_conversion_and_item_must_match(self):
        p=profile()
        for target,items in [('lord-a',[]),('lord-b',['item-a']),('other',['item-a'])]:
            self.assertFalse(resonance_check(p,bloodline='首领',resonance='evolution-power',lord_target=target,unlocked_items=items)['knownConditionsSatisfied'])
        r=resonance_check(p,bloodline='首领',resonance='evolution-power',lord_target='lord-b',unlocked_items=['item-b'])
        self.assertTrue(r['knownConditionsSatisfied'])
        self.assertFalse(r['executionAllowed']); self.assertFalse(r['gameVerified'])

    def test_unknown_magic_and_conflicting_request_fail_closed(self):
        self.assertFalse(resonance_check(profile(),bloodline=1,resonance='wish-amplification',lord_target='lord-a')['knownConditionsSatisfied'])
        self.assertFalse(resonance_check(profile(),bloodline=1,resonance='unknown')['knownConditionsSatisfied'])

    def test_real_flower_bloodline_and_common_skill_sources(self):
        # Source fixture from the pinned module. This is not a game verification.
        m=json.loads((ROOT/'public/data/pilot-manifest.json').read_text(encoding='utf-8'))
        t=next(t for t in m['targets'] if t['name']=='奇丽花')
        p=t['bloodlineOptions']; skills={s['name']:s['id'] for s in m['dependencies']}
        r=check_source_build(p,bloodline='普通',moves=[skills[n] for n in ['休息回复','贪婪','光能聚集','防反']])
        self.assertFalse(r['sourceConsistent'])
        self.assertTrue(check_source_build(p,bloodline='普通',moves=[skills[n] for n in ['休息回复','取念','光能聚集','防反']])['sourceConsistent'])
        self.assertTrue(check_source_build(p,bloodline='恶',moves=[skills[n] for n in ['贪婪','取念','光能聚集','防反']])['sourceConsistent'])
        self.assertEqual(p['commonMoveCount'],33)
        self.assertEqual({o['sourceCandidateMoveCount'] for o in p['options'] if o['kind']=='elemental'}, {34})


if __name__ == '__main__': unittest.main()
