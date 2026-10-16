import copy
import unittest
from learning.audit import verified_score

class AuditTest(unittest.TestCase):
    def fixture(self):
        return {'rows':[{'case':0,'return':1,'winner':0,'seat':0,'endReason':'prototype-victory'},
                        {'case':1,'return':-1,'winner':1,'seat':0,'endReason':'prototype-victory'},
                        {'case':2,'return':0,'winner':'draw','seat':1,'endReason':'prototype-round-cap'}],
                'wins':1,'losses':1,'battles':3,'roundCaps':1,'meanReturn':0}
    def test_recomputes_victory_loss_and_cap_separately(self):
        score=verified_score(self.fixture());self.assertEqual(score['roundCaps'],1);self.assertNotIn('rows',score)
        self.assertIsNone(verified_score(None))
    def test_rejects_wrong_denominator_outcome_and_duplicate_match(self):
        for field in ('battles','wins','meanReturn'):
            score=self.fixture();score[field]=99
            with self.assertRaises(AssertionError):verified_score(score)
        score=self.fixture();score['rows'][0]['winner']=1
        with self.assertRaises(AssertionError):verified_score(score)
        score=self.fixture();score['rows'][1]['case']=0
        with self.assertRaises(AssertionError):verified_score(score)

if __name__=='__main__':unittest.main()
