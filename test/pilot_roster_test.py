import importlib.util
from pathlib import Path
import sys
import hashlib
import json
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('pilot_prep', ROOT / 'scripts/prepare-pilot.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def pet(pid, number, stage=1):
    return {'id': pid, 'number': str(number), 'name': pid, 'stage': stage,
            'feature_skill_id': 'trait', 'learnset_id': 'pool', 'stats': {}}


class RosterTests(unittest.TestCase):
    def test_branches_and_lord_are_not_flattened(self):
        catalog = {p: pet(p,n,s) for p,n,s in [('a',99,1),('b',8,2),('c',7,2),('lord',1,4)]}
        graph = {'group': [
            {'chain':[{'id':'a'},{'id':'b'}], 'lord_branches':[{'id':'lord','cond':'首领化'}]},
            {'chain':[{'id':'a'},{'id':'c'}], 'lord_branches':{}},
        ]}
        by_id = {r['id']:r for r in module.classify_roster(catalog,graph)}
        self.assertEqual(by_id['a']['classification'],'excluded-lower-form')
        self.assertEqual(by_id['b']['classification'],'highest-normal-candidate')
        self.assertEqual(by_id['c']['classification'],'highest-normal-candidate')
        self.assertEqual(by_id['lord']['classification'],'lord-special-mechanism')
        self.assertEqual(by_id['b']['lordConversions'][0]['targetId'],'lord')

    def test_successors_across_multiple_chains_prevent_false_terminal(self):
        c={x:pet(x,i) for i,x in enumerate(['a','b','c'])}
        e={'g':[{'chain':[{'id':'a'},{'id':'b'}]}, {'chain':[{'id':'b'},{'id':'c'}]}]}
        r={x['id']:x for x in module.classify_roster(c,e)}
        self.assertEqual(r['b']['classification'],'excluded-lower-form')

    def test_unmapped_is_not_automatically_terminal(self):
        self.assertEqual(module.classify_roster({'x':pet('x',1)}, {})[0]['classification'],'unresolved-evolution')

    def test_same_dex_forms_stay_separate(self):
        c={x:pet(x,1) for x in ['summer','spring']}
        e={x:[{'chain':[{'id':x}]}] for x in c}
        self.assertEqual(len(module.classify_roster(c,e)),2)

    def test_cycles_and_broken_references_are_rejected(self):
        with self.assertRaises(ValueError):
            module.classify_roster({'a':pet('a',1)}, {'g':[{'chain':[{'id':'a'},{'id':'missing'}]}]})
        with self.assertRaises(ValueError):
            module.classify_roster({'a':pet('a',1),'b':pet('b',2)}, {'g':[{'chain':[{'id':'a'},{'id':'b'},{'id':'a'}]}]})

    def test_learning_sources_preserve_blood_constraints(self):
        entries=module.learn_entries({'native_skills':[{'skill':'m','level':1}], 'blood_skills':[{'skill':'n','blood':2},{'skill':'n','blood':3}]})
        self.assertEqual(len(entries),3)
        self.assertEqual([e['blood'] for e in entries if e['method']=='血脉'],[2,3])

    def test_pinned_cache_rejects_partial_refresh_or_tampering(self):
        cache=Path('fixture-cache'); modules=[]; files={}
        for i,name in enumerate(module.NAMES):
            text='return {}'
            raw={'parse':{'revid':i,'wikitext':{'*':text}}}
            files[f'{name}.json']=json.dumps(raw)
            modules.append({'name':name,'revision':i,'sha256':hashlib.sha256(text.encode()).hexdigest()})
        with patch.object(Path,'read_text',autospec=True,side_effect=lambda path,**kw:files[path.name]):
            manifest={'modules':modules}
            self.assertEqual(set(module.load_sources(cache,manifest)),set(module.NAMES))
            files['Catalog.json']=json.dumps({'parse':{'revid':999,'wikitext':{'*':'return {}'}}})
            with self.assertRaises(ValueError):module.load_sources(cache,manifest)

    def test_duplicate_manifest_module_is_rejected(self):
        with self.assertRaises(ValueError):
            module.load_sources(Path('.'), {'modules':[{'name':'Catalog'}]*7})


if __name__=='__main__': unittest.main()
