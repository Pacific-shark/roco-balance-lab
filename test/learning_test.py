import unittest
import torch
from learning.bridge import BattleBridge
from learning.models import ActorCritic, masked_distribution, tensor_observations
from learning.ppo import generalized_advantage, clipped_loss, update_policy

torch.set_num_threads(1)


class LearningTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bridge=BattleBridge()
        cls.metadata=cls.bridge.request(op="init",envs=2,seed=42,scope="prototype")
        cls.schema=cls.metadata["schema"]
        cls.obs=tensor_observations([v["observation"][0] for v in cls.metadata["observations"]])

    @classmethod
    def tearDownClass(cls):
        cls.bridge.close()

    def test_illegal_actions_have_zero_probability_and_zero_logit_gradient(self):
        logits=torch.tensor([[100.,2.,1.]],requires_grad=True)
        dist=masked_distribution(logits,torch.tensor([[False,True,True]]))
        self.assertEqual(dist.probs[0,0].item(),0)
        self.assertTrue((dist.sample((1000,))!=0).all())
        (-dist.log_prob(torch.tensor([1]))).backward()
        self.assertEqual(logits.grad[0,0].item(),0)
        with self.assertRaises(ValueError):masked_distribution(logits,torch.zeros_like(logits,dtype=torch.bool))

    def test_gae_stops_at_terminal_and_bootstraps_rollout_cut(self):
        rewards=torch.tensor([[0.],[1.],[100.]])
        values=torch.zeros_like(rewards)
        dones=torch.tensor([[False],[True],[True]])
        advantages,_=generalized_advantage(rewards,values,dones,torch.tensor([999.]),gamma=1,lam=1)
        torch.testing.assert_close(advantages,torch.tensor([[1.],[1.],[100.]]))
        boot,_=generalized_advantage(torch.tensor([[0.]]),torch.tensor([[.2]]),torch.tensor([[False]]),torch.tensor([.5]),gamma=1,lam=1)
        self.assertAlmostEqual(boot.item(),.3,places=6)

    def test_ppo_clips_both_advantage_signs(self):
        old=torch.zeros(2)
        new=torch.log(torch.tensor([2.,.5]))
        result=clipped_loss(new,old,torch.tensor([1.,-1.]),clip=.2)
        torch.testing.assert_close(result,torch.tensor([-1.2,.8]))

    def test_recurrent_state_resets_and_sequence_matches_online(self):
        torch.manual_seed(7)
        model=ActorCritic(self.schema,"entity_gru")
        zero=model.initial_hidden(2);random=torch.randn_like(zero)
        starts=torch.ones(2,dtype=torch.bool)
        d1,v1,h1=model.step(self.obs,zero,starts)
        d2,v2,h2=model.step(self.obs,random,starts)
        torch.testing.assert_close(d1.probs,d2.probs);torch.testing.assert_close(h1,h2)
        _,_,h3=model.step(self.obs,h1,torch.zeros_like(starts))
        self.assertFalse(torch.allclose(h1,h3))
        observations={k:torch.stack([v,v]) for k,v in self.obs.items()}
        seq,v=model.sequence(observations,zero,torch.stack([starts,torch.zeros_like(starts)]))
        dlast,vlast,_=model.step(self.obs,h1,torch.zeros_like(starts))
        torch.testing.assert_close(seq.probs[1],dlast.probs);torch.testing.assert_close(v[1],vlast)

    def test_all_architectures_update_on_sequences_and_preserve_masks(self):
        for architecture in ("linear","mlp","entity_gru"):
            with self.subTest(architecture=architecture):
                torch.manual_seed(9);model=ActorCritic(self.schema,architecture)
                initial={k:v.detach().clone() for k,v in model.state_dict().items()}
                obs={k:torch.stack([v,v,v]) for k,v in self.obs.items()}
                starts=torch.tensor([[True,True],[False,False],[False,False]])
                h=model.initial_hidden(2)
                with torch.no_grad():
                    dist,values=model.sequence(obs,h,starts)
                    actions=dist.sample();logp=dist.log_prob(actions)
                batch={"observations":obs,"starts":starts,"initial_hidden":h,"actions":actions,
                       "logp":logp,"learn":torch.ones(3,2,dtype=torch.bool),
                       "advantage":torch.tensor([[1.,-1.],[.5,-.5],[.2,-.2]]),"returns":values+.5}
                logs=update_policy(model,torch.optim.Adam(model.parameters(),lr=.001),batch,epochs=2)
                self.assertGreater(logs["updates"],0)
                self.assertTrue(any(not torch.equal(initial[k],v) for k,v in model.state_dict().items()))
                with torch.no_grad():new,_=model.sequence(obs,h,starts)
                self.assertTrue(torch.all(new.probs[~obs["mask"]]==0))

    def test_two_learners_do_not_share_parameters(self):
        a=ActorCritic(self.schema,"mlp");b=ActorCritic(self.schema,"mlp")
        self.assertTrue(all(x.data_ptr()!=y.data_ptr() for x,y in zip(a.parameters(),b.parameters())))


if __name__=="__main__":unittest.main()
