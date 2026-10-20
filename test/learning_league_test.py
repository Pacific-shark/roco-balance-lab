import copy
import time
import unittest
from unittest.mock import patch

import torch
from torch.distributions import Categorical

from learning.league import cases, checked_score, evaluate_cell, summarize
from learning.research import run


class ConstantPolicy:
    def __init__(self, action):
        self.action = action

    def initial_hidden(self, _):
        return torch.zeros(1, 1)

    def step(self, obs, hidden, start):
        probabilities = torch.zeros(1, 12)
        probabilities[0, self.action] = 1
        return Categorical(probs=probabilities), torch.zeros(1), hidden


class RecordingBridge:
    def __init__(self):
        self.resets, self.actions = [], []

    def request(self, **message):
        if message['op'] == 'reset':
            self.resets.append(message)
            observation = dict(pets=[], actions=[], **{'global': []}, mask=[True]*12)
            return dict(observation=[observation, observation], rules=[dict(attack=3, support=4)]*2)
        self.actions.append(message['actions'])
        return dict(done=True, terminal=dict(winner=0, rounds=1, endReason='prototype-victory'))


class LeagueTest(unittest.TestCase):
    def test_both_policy_pairs_builds_seats_and_ties_have_equal_exposure(self):
        schedule = cases()
        self.assertEqual(len(schedule), 32)
        self.assertEqual(len({tuple(c[k] for k in ('team','role','opponentRole','seat','tieFirst')) for c in schedule}), 32)
        self.assertEqual({c['opponentRole'] for c in cases(True)}, {'attack', 'support'})

    def test_crossplay_uses_distinct_opponent_weights_and_never_patches_traits(self):
        bridge = RecordingBridge()
        result = evaluate_cell(bridge, [ConstantPolicy(1), ConstantPolicy(2)],
                               [ConstantPolicy(7), ConstantPolicy(8)], [{'id':'a'}, {'id':'b'}], time.monotonic()+10)
        self.assertEqual(result['meanScore'], .5)
        for case, reset, actions in zip(cases(), bridge.resets, bridge.actions):
            self.assertNotIn('patch', reset)
            self.assertEqual(actions[case['seat']], case['role']+1)
            self.assertEqual(actions[1-case['seat']], case['opponentRole']+7)

    def test_incomplete_or_duplicate_pool_cannot_produce_model_ranking(self):
        result = {'checkpoints':[{'id':'a','architecture':'entity_mlp','seed':42}], 'cells':[]}
        with self.assertRaises(ValueError): summarize(result)
        bridge = RecordingBridge()
        score = evaluate_cell(bridge,[ConstantPolicy(1)]*2,None,[{},{}],time.monotonic()+10)
        bad = copy.deepcopy(score['rows']);bad[0]['score']=1-bad[0]['score']
        with self.assertRaises(ValueError): checked_score(bad)
        with self.assertRaises(ValueError): checked_score(score['rows']+score['rows'][:1])

    def test_legacy_ablation_is_blocked_before_writing_or_starting_a_simulator(self):
        with patch('learning.research.InferenceBridge') as bridge:
            with self.assertRaisesRegex(ValueError, 'legacy diagnostic'):run([],None,None,6,60)
            bridge.assert_not_called()


if __name__ == '__main__': unittest.main()
