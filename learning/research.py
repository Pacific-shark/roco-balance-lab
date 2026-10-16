"""Bounded, frozen neural-policy candidate screening and paired trait checks.

This is a finite prototype search, not optimal teams or current-game rankings.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import time
import torch
from .bridge import ROOT
from .inference import InferenceBridge
from .models import ActorCritic, tensor_observations
from .train import parameter_hash, write_json


def evaluate(bridge,models,team,opponents,deadline,*,target=None,disable_trait=False,record=False):
    rows=[]
    with torch.random.fork_rng(devices=[]):
        for oi,opponent in enumerate(opponents):
            for role in (0,1):
                for seat in (0,1):
                    for tie in (0,1):
                        for mode in ('rule','frozen'):
                            if time.monotonic()>=deadline:raise TimeoutError('Research budget exhausted')
                            seed=530000+oi*100+role*20+seat*4+tie*2+(mode=='frozen')
                            torch.manual_seed(seed)
                            current=bridge.request(op='reset',teamA=team if seat==0 else opponent,
                                teamB=opponent if seat==0 else team,tieFirst=tie,
                                patch={'side':seat,'disableTrait':target} if disable_trait else None)
                            hidden=[m.initial_hidden(1) for m in models];start=torch.ones(1,dtype=torch.bool)
                            trace=[]
                            while True:
                                if time.monotonic()>=deadline:raise TimeoutError('Research budget exhausted')
                                bridge.timeout=max(.1,min(30,deadline-time.monotonic()))
                                pair=[0,0]
                                with torch.no_grad():
                                    for side in (0,1):
                                        if side!=seat and mode=='rule':pair[side]=current['rules'][side]['attack'];continue
                                        index=role if side==seat else 1-role
                                        dist,_,hidden[index]=models[index].step(tensor_observations([current['observation'][side]]),hidden[index],start)
                                        pair[side]=int(dist.sample().item())
                                step=bridge.request(op='step',actions=pair,record=record and not rows)
                                if step.get('trace'):trace.append(step['trace'])
                                if step['done']:
                                    winner=step['terminal']['winner'];score=.5 if winner=='draw' else float(winner==seat)
                                    rows.append({'opponent':opponent['id'],'role':role,'seat':seat,'tieFirst':tie,'mode':mode,'seed':seed,
                                                 'score':score,**step['terminal'],**({'trace':trace} if trace else {})})
                                    break
                                current=step['next'];start=torch.zeros(1,dtype=torch.bool)
    return {'battles':len(rows),'wins':sum(r['score']==1 for r in rows),'roundCaps':sum(r['score']==.5 for r in rows),
            'meanScore':sum(r['score'] for r in rows)/len(rows),'rows':rows}


def paired_delta(base,changed):
    key=lambda r:(r['opponent'],r['role'],r['seat'],r['tieFirst'],r['mode'],r['seed'])
    a={key(r):r['score'] for r in base['rows']};b={key(r):r['score'] for r in changed['rows']}
    if len(a)!=len(base['rows']) or len(b)!=len(changed['rows']) or a.keys()!=b.keys():raise ValueError('Unpaired intervention rows')
    return sum(a[k]-b[k] for k in a)/len(a)


def run(checkpoints,output,target,count,seconds):
    if output.exists():raise FileExistsError('Use a new report path')
    if not output.resolve().is_relative_to(ROOT/'.local'):raise ValueError('Keep raw research output in .local')
    output.parent.mkdir(parents=True,exist_ok=True)
    torch.set_num_threads(1);started=time.monotonic();deadline=started+seconds
    result={'scope':'restricted-prototype','status':'running','canPublishBalanceConclusion':False,
            'target':target,'candidateCount':count,'apiTokens':0,'checkpoints':[],'screening':[],'selected':[],
            'limitations':['Finite candidate generation; no global optimum or complete dex coverage.',
                'Frozen policies; candidate-specific adaptation and both-side retraining are not implemented in this neural pipeline.',
                'Trait removal measures frozen sensitivity, not total individual contribution or proven imbalance.',
                'Nature and IVs are sampled legal prototype builds, not certified optima.',
                'Two held-out opposing builds per split; repeated seeds and seats are not independent matchups.']}
    try:
        with InferenceBridge() as bridge:
            meta=bridge.request(op='init');result['environmentHash']=meta['executionHash'];result['adapterHash']=meta['adapterHash']
            model_sets=[]
            for path in checkpoints:
                saved=torch.load(path,map_location='cpu',weights_only=True)
                if saved['environmentHash']!=meta['executionHash'] or saved['schema']!=meta['schema']:raise ValueError('Checkpoint and inference environment differ')
                models=[ActorCritic(saved['schema'],saved['config']['architecture'],saved['config']['hidden']) for _ in range(2)]
                for m,state in zip(models,saved['models']):m.load_state_dict(state);m.eval()
                model_sets.append(models)
                result['checkpoints'].append({'config':saved['config'],'trainingSteps':saved['trainingSteps'],
                    'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'parameterHashes':[parameter_hash(m) for m in models]})
            result['split']={'validation':meta['split']['validation'],'test':meta['split']['test']}
            teams=bridge.request(op='candidates',target=target,count=count,seed=17026)
            for team in teams:
                scores=[evaluate(bridge,models,team,meta['split']['validation'],deadline) for models in model_sets]
                result['screening'].append({'team':team,'validation':scores,'meanScore':sum(s['meanScore'] for s in scores)/len(scores)})
                write_json(output,result)
                print(json.dumps({'event':'candidate','completed':len(result['screening']),'total':len(teams)}),flush=True)
            selected=[]
            for row in sorted(result['screening'],key=lambda r:(-r['meanScore'],r['team']['id'])):
                ids={m['id'] for m in row['team']['members']}
                if all(len(ids & {m['id'] for m in s['team']['members']})<=4 for s in selected):selected.append(row)
                if len(selected)==2:break
            # Freeze candidate IDs before opening test results; never rerank by test score.
            result['selectionLockedBeforeTest']=[r['team']['id'] for r in selected]
            write_json(output,result)
            for row in selected:
                per_seed=[]
                for i,models in enumerate(model_sets):
                    base=evaluate(bridge,models,row['team'],meta['split']['test'],deadline,record=i==0)
                    changed=evaluate(bridge,models,row['team'],meta['split']['test'],deadline,target=target,disable_trait=True)
                    per_seed.append({'seed':result['checkpoints'][i]['config']['seed'],'baseline':base,'traitRemoved':changed,'frozenTraitDelta':paired_delta(base,changed)})
                result['selected'].append({'team':row['team'],'validationScore':row['meanScore'],'testBySeed':per_seed,
                    'dimensions':{'performance':'prototype-heldout-evidence','contribution':'needs-same-role-replacement',
                        'identity':'frozen-trait-sensitivity-only','counterplay':'needs-both-side-retraining','designAlignment':'needs-sourced-design-goal'}})
                write_json(output,result)
            after=[[parameter_hash(m) for m in models] for models in model_sets]
            if after!=[r['parameterHashes'] for r in result['checkpoints']]:raise ValueError('Evaluation changed model parameters')
            result['weightsUnchanged']=True;result['status']='completed'
    except TimeoutError as e:
        result['status']='budget-exhausted';result['error']=str(e)
    except Exception as e:
        result['status']='failed';result['error']=f'{type(e).__name__}: {e}'
        raise
    finally:
        result['elapsedSeconds']=time.monotonic()-started;write_json(output,result)
    print(json.dumps({'event':'research-finished','status':result['status'],'selected':len(result['selected']),'seconds':round(result['elapsedSeconds'],1)}),flush=True)
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('checkpoints',type=Path,nargs='+')
    p.add_argument('--target',default='pet_000028');p.add_argument('--candidates',type=int,default=6)
    p.add_argument('--max-seconds',type=int,default=240);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    if not 1<=len(a.checkpoints)<=3 or not 2<=a.candidates<=12 or not 30<=a.max_seconds<=600:p.error('checkpoints 1..3, candidates 2..12, seconds 30..600')
    return 0 if run(a.checkpoints,a.output,a.target,a.candidates,a.max_seconds)['status']=='completed' else 2


if __name__=='__main__':raise SystemExit(main())
