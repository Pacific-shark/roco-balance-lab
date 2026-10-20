"""Use real terminal outcomes for held-out resource probes, not a two-turn limit."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import torch
from .inference import InferenceBridge
from .models import ActorCritic,tensor_observations
from .train import parameter_hash,write_json


def measure(models,deadline):
    rows=[]
    with InferenceBridge() as bridge,torch.random.fork_rng(devices=[]):
        meta=bridge.request(op='init')
        for variant in (3,4,5):
            for side in (0,1):
                for tieFirst in (0,1):
                    for policy,model in enumerate(models):
                        if time.monotonic()>=deadline:raise TimeoutError('Resource evaluation budget exhausted')
                        seed=951000+len(rows);torch.manual_seed(seed)
                        current=bridge.request(op='probeReset',case={'kind':'focus','variant':variant,'side':side,'tieFirst':tieFirst})
                        probe=current['probe'];hidden=model.initial_hidden(1);start=torch.ones(1,dtype=torch.bool);actions=[]
                        for _ in range(220):
                            with torch.no_grad():dist,_,hidden=model.step(tensor_observations([current['observation'][side]]),hidden,start);own=int(dist.sample().item())
                            actions.append(own);pair=[0,0];pair[side]=own;pair[1-side]=probe['enemySlot']
                            step=bridge.request(op='step',actions=pair)
                            if step['done']:
                                rows.append({'variant':variant,'side':side,'tieFirst':tieFirst,'policy':policy,'seed':seed,
                                             'won':step['terminal']['winner']==side,'firstActionCorrect':actions[0] in probe['expectedSlots'],
                                             'actions':actions,**step['terminal']});break
                            current=step['next'];start=torch.zeros(1,dtype=torch.bool)
                        else:raise RuntimeError('Probe did not terminate')
    return {'battles':len(rows),'wins':sum(r['won'] for r in rows),'firstActionCorrect':sum(r['firstActionCorrect'] for r in rows),
            'rows':rows,'environmentHash':meta['executionHash'],'adapterHash':meta['adapterHash']}


def load(path):
    saved=torch.load(path,map_location='cpu',weights_only=True)
    models=[ActorCritic(saved['schema'],saved['config']['architecture'],saved['config']['hidden']) for _ in range(2)]
    for m,s in zip(models,saved['models']):m.load_state_dict(s);m.eval()
    return saved,models


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--before',required=True,type=Path);p.add_argument('--after',required=True,type=Path);a=p.parse_args()
    torch.set_num_threads(1);deadline=time.monotonic()+60
    parent,initial=load(a.before);saved,trained=load(a.after)
    assert parent['environmentHash']==saved['environmentHash']
    before=measure(initial,deadline);after=measure(trained,deadline)
    assert before['environmentHash']==saved['environmentHash']
    result={'scope':'held-out slot permutations 3..5; scripted artificial late-game positions',
            'metric':'actual engine victory, no evaluator-imposed two-turn deadline',
            'initial':before,'trained':after,'beforeCheckpointSha256':hashlib.sha256(a.before.read_bytes()).hexdigest(),
            'afterCheckpointSha256':hashlib.sha256(a.after.read_bytes()).hexdigest(),
            'parameterHashes':[parameter_hash(m) for m in trained],
            'caveat':'This retrospective metric correction does not certify novel-species or real-match generalization. Original two-turn results remain in the raw training report.'}
    write_json(a.after.parent/'resource-outcomes.json',result)
    print(json.dumps({'model':a.after.parent.name,'before':before['wins'],'after':after['wins'],'battles':after['battles']}),flush=True)


if __name__=='__main__':main()
