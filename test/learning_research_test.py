import unittest
from learning.research import paired_delta

class PairTest(unittest.TestCase):
    def rows(self):
        return [{'opponent':'a','role':0,'seat':0,'tieFirst':0,'mode':'rule','seed':42,'score':1},
                {'opponent':'b','role':1,'seat':1,'tieFirst':1,'mode':'frozen','seed':43,'score':.5}]
    def test_pairing_is_by_case_not_row_order(self):
        base=self.rows();changed=[{**r,'score':0} for r in reversed(base)]
        self.assertEqual(paired_delta({'rows':base},{'rows':changed}),.75)
    def test_rejects_duplicate_or_missing_intervention_cases(self):
        rows=self.rows()
        with self.assertRaises(ValueError):paired_delta({'rows':rows},{'rows':rows[:1]})
        with self.assertRaises(ValueError):paired_delta({'rows':[rows[0],rows[0]]},{'rows':[rows[0]]})
        with self.assertRaises(ValueError):paired_delta({'rows':rows},{'rows':rows+[rows[0]]})

if __name__=='__main__':unittest.main()
