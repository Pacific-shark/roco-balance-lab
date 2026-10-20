"""Evaluation-only probes; oracle labels never enter the policy tensor."""
from collections import defaultdict
import torch
import time
from .bridge import BattleBridge
from .models import tensor_observations


def evaluate_capabilities(models, node=None, deadline=None):
    rows=[]
    with torch.random.fork_rng(devices=[]), BattleBridge(node) as bridge:
        bridge.request(op='init',envs=1,seed=29026,scope='prototype')
        suite=bridge.request(op='capabilities')
        for i,case in enumerate(suite['cases']):
            for policy,model in enumerate(models):
                if deadline is not None:
                    if time.monotonic()>=deadline:raise TimeoutError('Capability evaluation budget exhausted')
                    bridge.timeout=max(.1,min(30,deadline-time.monotonic()))
                torch.manual_seed(900000+i*2+policy)
                current=bridge.request(op='reset',options={'capability':case})
                probe=current['probe'];side=case['side']
                hidden=model.initial_hidden(1);start=torch.ones(1,dtype=torch.bool)
                actions=[];mass=None
                for t in range(probe['horizon']):
                    with torch.no_grad():
                        dist,_,hidden=model.step(tensor_observations([current['observation'][side]]),hidden,start)
                        if mass is None:mass=dist.probs[0,probe['expectedSlots']].sum().item()
                        own=int(dist.sample().item())
                    pair=[0,0];pair[side]=own;pair[1-side]=probe['enemySlot']
                    result=bridge.request(op='step',actions=[pair],autoReset=False)[0]
                    actions.append(own)
                    if result['probe']['finished']:break
                    current=result['next'];start=torch.zeros(1,dtype=torch.bool)
                rows.append({**case,'policy':policy,'actions':actions,'firstActionProbability':mass,'success':result['probe']['success']})
    grouped=defaultdict(list)
    for row in rows:grouped[row['kind']].append(row)
    return {'version':suite['version'],'scope':'artificial late-game positions; not match-win rates',
            'byKind':{k:{'cases':len(v),'successes':sum(r['success'] for r in v),
                       'successFraction':sum(r['success'] for r in v)/len(v),
                       'firstActionProbability':sum(r['firstActionProbability'] for r in v)/len(v)} for k,v in grouped.items()},'rows':rows}
