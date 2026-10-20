"""Synthetic quota fixtures: numeric values below are not game evidence."""
import sys
from pathlib import Path
import unittest
from dataclasses import FrozenInstanceError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from pilot_resonance import (MAGICS, TeamResonance, resonance_contract, check_team_resonance,
                             debit_resonance, tick_resonance_cooldown)
from pilot_builds import compile_bloodline_options, check_resonance_conditions


def profile():
    return compile_bloodline_options([], [{'id':1,'name':'普通'},{'id':19,'name':'首领'}],
        level=60,stage=3,lord_conversions=[{'targetId':'lord','item':'token'}])


class ResonanceTests(unittest.TestCase):
    def test_all_three_magic_choices_are_pairwise_exclusive(self):
        for selected in MAGICS:
            state=TeamResonance(selected,2,0)
            for requested in MAGICS:
                self.assertEqual(not check_team_resonance(state,requested),selected==requested)

    def test_multiple_selections_and_unset_slot_are_rejected(self):
        for selected in [None,[],list(MAGICS),'',True]:
            with self.assertRaises(ValueError):TeamResonance(selected,2,0)

    def test_unknown_or_nonfinite_limits_do_not_mean_unlimited(self):
        for limit in [None,float('inf'),-1,0,True,2.5]:
            with self.assertRaises(ValueError):TeamResonance('wish-amplification',limit,0)
        for cooldown in [None,-1,False,1.5]:
            with self.assertRaises(ValueError):TeamResonance('wish-amplification',2,cooldown)

    def test_different_users_spend_the_same_team_budget(self):
        state=TeamResonance('wish-amplification',2,0)
        # Members A and B act on this same side-owned state; actor is not a ledger key.
        state=debit_resonance(state,'wish-amplification')
        state=debit_resonance(state,'wish-amplification')
        self.assertIn('team-resonance-uses-exhausted',check_team_resonance(state,'wish-amplification'))
        with self.assertRaises(ValueError):debit_resonance(state,'wish-amplification')

    def test_cooldown_ticks_do_not_replenish_uses(self):
        state=debit_resonance(TeamResonance('photosynthetic-healing',2,3),'photosynthetic-healing')
        self.assertIn('team-resonance-on-cooldown',check_team_resonance(state,'photosynthetic-healing'))
        for _ in range(3):state=tick_resonance_cooldown(state)
        self.assertEqual(state.uses_spent,1)
        self.assertFalse(check_team_resonance(state,'photosynthetic-healing'))

    def test_rejected_magic_does_not_spend_uses_or_change_equipment(self):
        state=TeamResonance('evolution-power',1,0)
        with self.assertRaises(ValueError):debit_resonance(state,'wish-amplification')
        self.assertEqual(state.uses_spent,0)
        with self.assertRaises(FrozenInstanceError):state.selected_magic='wish-amplification'

    def test_bloodline_alone_does_not_authorize_a_magic(self):
        p=profile()
        no_slot=check_resonance_conditions(p,bloodline='普通',resonance='wish-amplification')
        self.assertFalse(no_slot['knownConditionsSatisfied'])
        grass=TeamResonance('photosynthetic-healing',2,0)
        for blood,magic in [('普通','wish-amplification'),('首领','evolution-power')]:
            result=check_resonance_conditions(p,bloodline=blood,resonance=magic,team_resonance=grass,
                lord_target='lord' if blood=='首领' else None,unlocked_items=['token'])
            self.assertIn('requested-magic-not-equipped',result['reasons'])

    def test_correct_bloodline_and_equipment_still_need_remaining_uses(self):
        exhausted=debit_resonance(TeamResonance('evolution-power',1,0),'evolution-power')
        r=check_resonance_conditions(profile(),bloodline='首领',resonance='evolution-power',
            team_resonance=exhausted,lord_target='lord',unlocked_items=['token'])
        self.assertFalse(r['knownConditionsSatisfied'])
        self.assertIn('team-resonance-uses-exhausted',r['reasons'])

    def test_grass_magic_accepts_all_known_bloodlines_but_does_not_authorize_execution(self):
        p=compile_bloodline_options([], [{'id':1,'name':'普通'},{'id':2,'name':'草'},
            {'id':19,'name':'首领'},{'id':20,'name':'污染'}],level=60,stage=3)
        for blood in ['普通','草','首领','污染']:
            with self.subTest(blood=blood):
                r=check_resonance_conditions(p,bloodline=blood,resonance='photosynthetic-healing',
                    team_resonance=TeamResonance('photosynthetic-healing',2,0))
                self.assertTrue(r['knownConditionsSatisfied'])
                self.assertFalse(r['executionAllowed'])
                self.assertFalse(r['gameVerified'])
                if blood=='污染':
                    self.assertIn('special-bloodline-current-mode-access-unverified',r['pending'])

    def test_grass_magic_does_not_bypass_equipment_quota_cooldown_or_identity(self):
        for blood,ledger,reason in [
            ('普通',TeamResonance('wish-amplification',2,0),'requested-magic-not-equipped'),
            ('普通',TeamResonance('photosynthetic-healing',2,0,uses_spent=2),'team-resonance-uses-exhausted'),
            ('普通',TeamResonance('photosynthetic-healing',2,3,cooldown_remaining=1),'team-resonance-on-cooldown'),
            ('不存在',TeamResonance('photosynthetic-healing',2,0),'exactly-one-known-bloodline-required')]:
            with self.subTest(reason=reason):
                r=check_resonance_conditions(profile(),bloodline=blood,resonance='photosynthetic-healing',team_resonance=ledger)
                self.assertFalse(r['knownConditionsSatisfied'])
                self.assertIn(reason,r['reasons'])

    def test_grass_magic_cannot_request_lord_transformation(self):
        r=check_resonance_conditions(profile(),bloodline='首领',resonance='photosynthetic-healing',
            team_resonance=TeamResonance('photosynthetic-healing',2,0),lord_target='lord',unlocked_items=['token'])
        self.assertIn('lord-transformation-is-not-this-magic',r['reasons'])

    def test_reviewed_descriptions_are_separate_from_unverified_execution_parameters(self):
        c=resonance_contract()
        self.assertEqual(c['slots'],1)
        self.assertFalse(c['resetOnSwitch'])
        self.assertFalse(c['consumesRegularAction'])
        self.assertFalse(c['eventOrderingVerified'])
        self.assertFalse(c['battleEffectsImplemented'])
        options={x['id']:x for x in c['options']}
        self.assertEqual(options['evolution-power']['maxUses'],1)
        self.assertEqual(options['evolution-power']['maxUsesStatus'],'user-confirmed')
        self.assertIsNone(options['evolution-power']['reviewedDescription']['hpInheritance'])
        self.assertIsNone(options['evolution-power']['reviewedDescription']['otherStateInheritance'])
        self.assertFalse(options['evolution-power']['reviewedDescription']['currentVersionCertified'])
        self.assertIsNone(options['photosynthetic-healing']['maxUses'])
        self.assertIsNone(options['wish-amplification']['maxUses'])
        self.assertTrue(all(x['cooldownTurns'] is None for x in c['options']))
        grass=options['photosynthetic-healing']['reviewedDescription']
        self.assertEqual(grass['bloodlineScope'],'any')
        self.assertEqual(grass['immediateHealingPercent'],15)
        self.assertFalse(grass['settlementBoundariesVerified'])
        wish=options['wish-amplification']['reviewedDescription']
        self.assertEqual(wish['unusedReplacementExpires'],'end-of-activation-turn')
        self.assertFalse(wish['expiryDeterminesRefundPolicy'])
        self.assertEqual(wish['historicalMaxUses'],2)
        self.assertEqual(wish['historicalCooldownTurns'],3)
        self.assertFalse(wish['currentVersionCertified'])


if __name__=='__main__':unittest.main()
