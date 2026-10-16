"""Evaluate corrected resource probes; no fitting or test-match selection."""
import argparse
from pathlib import Path
from collections import defaultdict
import json
import torch
from .inference import InferenceBridge
from .models import ActorCritic,tensor_observations
from .train import parameter_hash,write_json


def evaluate(models):
    rows=[]
    with torch.random.fork_rng(devices=[]),InferenceBridge() as bridge:
        meta=bridge.request(op='init');suite=bridge.request(op='probes')
        for i,case in enumerate(suite['cases']):
            for policy,model in enumerate(models):
                torch.manual_seed(900000+i*2+policy)
                current=bridge.request(op='probeReset',case=case);probe=current['probe'];side=case['side']
                hidden=model.initial_hidden(1);start=torch.ones(1,dtype=torch.bool);mass=None;actions=[]
                for _ in range(probe['horizon']):
                    with torch.no_grad():
                        dist,_,hidden=model.step(tensor_observations([current['observation'][side]]),hidden,start)
                        if mass is None:mass=float(dist.probs[0,probe['expectedSlots']].sum())
                        own=int(dist.sample().item())
                    pair=[0,0];pair[side]=own;pair[1-side]=probe['enemySlot']
                    step=bridge.request(op='step',actions=pair);actions.append(own)
                    if step['probe']['finished']:break
                    current=step['next'];start=torch.zeros(1,dtype=torch.bool)
                rows.append({**case,'policy':policy,'actions':actions,'firstActionProbability':mass,'success':step['probe']['success']})
    groups=defaultdict(list)
    for row in rows:groups[row['kind']].append(row)
    return {'version':suite['version'],'environmentHash':meta['executionHash'],'adapterHash':meta['adapterHash'],'rows':rows,
            'byKind':{k:{'cases':len(v),'successes':sum(r['success'] for r in v),'successFraction':sum(r['success'] for r in v)/len(v),
                        'firstActionProbability':sum(r['firstActionProbability'] for r in v)/len(v)} for k,v in groups.items()}}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('checkpoints',nargs='+',type=Path);a=p.parse_args();torch.set_num_threads(1)
    for path in a.checkpoints:
        saved=torch.load(path,map_location='cpu',weights_only=True)
        old=json.loads((path.parent/'report.json').read_text(encoding='utf-8'))
        torch.manual_seed(saved['config']['seed'])
        models=[ActorCritic(saved['schema'],saved['config']['architecture'],saved['config']['hidden']) for _ in range(2)]
        assert [parameter_hash(m) for m in models]==old['initialHashes']
        initial=evaluate(models)
        for m,s in zip(models,saved['models']):m.load_state_dict(s)
        trained=evaluate(models)
        assert trained['environmentHash']==saved['environmentHash']
        assert [parameter_hash(m) for m in models]==old['finalHashes']
        result={'version':trained['version'],'initial':initial,'trained':trained,
                'reason':'Original focus probe allowed a safe switch and used an artificial two-turn deadline. Revised probe makes all switches actual losses. Both initial and trained policies are reevaluated on the same revision.'}
        write_json(path.parent/'reviewed-probes.json',result)
        print(json.dumps({'model':path.parent.name,'initial':initial['byKind'],'trained':trained['byKind']}),flush=True)


if __name__=='__main__':main()
