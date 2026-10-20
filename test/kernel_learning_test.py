import copy
import json
import unittest
import torch
from learning.kernel_train import KernelBridge, KernelActorCritic
from learning.models import tensor_observations


class KernelLearningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        with KernelBridge() as bridge:
            cls.meta=bridge.request(op="init",envs=2,seed=42)

    def test_sixteen_actions_and_exact_legal_mask(self):
        torch.manual_seed(42)
        model=KernelActorCritic(self.meta["schema"])
        obs=tensor_observations([r["observation"][0] for r in self.meta["current"]])
        dist,values,hidden=model.step(obs,model.initial_hidden(2),torch.ones(2,dtype=torch.bool))
        self.assertEqual(tuple(dist.probs.shape),(2,16))
        self.assertTrue((dist.probs[~obs["mask"]]==0).all())
        self.assertTrue(torch.isfinite(values).all())
        self.assertTrue(torch.isfinite(hidden).all())

    def test_switch_scores_follow_member_not_arbitrary_slot(self):
        torch.manual_seed(42)
        model=KernelActorCritic(self.meta["schema"])
        row=copy.deepcopy(self.meta["current"][0]["observation"][0])
        swapped=copy.deepcopy(row)
        swapped["pets"][3],swapped["pets"][4]=swapped["pets"][4],swapped["pets"][3]
        swapped["actions"][12],swapped["actions"][13]=swapped["actions"][13],swapped["actions"][12]
        dist,_,_=model.step(tensor_observations([row,swapped]),model.initial_hidden(2),torch.ones(2,dtype=torch.bool))
        torch.testing.assert_close(dist.probs[0,12],dist.probs[1,13])
        torch.testing.assert_close(dist.probs[0,13],dist.probs[1,12])

    def test_completed_environment_cannot_accept_an_extra_command(self):
        with KernelBridge() as bridge:
            bridge.request(op="init",envs=1)
            rows=bridge.request(op="reset",cases=[{"a":["train",0],"b":["train",1],"maxRounds":1}])
            for _ in range(10):
                rows=bridge.request(op="step",actions=[rows[0]["ruleActions"]],autoReset=False)
                if rows[0]["done"]:break
            self.assertTrue(rows[0]["done"])
            with self.assertRaises(ValueError):
                bridge.request(op="step",actions=[[8,8]],autoReset=False)
            self.assertTrue(bridge.request(op="step",actions=[None],autoReset=False)[0]["done"])
            replay=bridge.request(op="replay")[0]
            self.assertEqual(len(replay["commands"]),2)
            self.assertLess(len(json.dumps(replay)),100000)
            for event in replay["state"]["events"]:
                self.assertTrue(all(not isinstance(v,(dict,list)) for v in event.get("source",{}).values()))


if __name__=="__main__":
    unittest.main()
