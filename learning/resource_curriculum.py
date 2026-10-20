"""PPO on mixed resource/switch-critical positions with frozen-parent KL retention.

Only variants 0..2 train. Variants 3..5 provide a held-out slot-permutation probe.
Rewards are actual terminal wins/losses; the probe's two-step deadline is ignored.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import time
import numpy as np
import torch
from .bridge import ROOT
from .inference import InferenceBridge
from .models import ActorCritic,tensor_observations
from .ppo import generalized_advantage,update_policy
from .train import evaluate,parameter_hash,write_json
from .probe_review import evaluate as review_probes


def budget(deadline):
    if time.monotonic()>=deadline:raise TimeoutError('Curriculum budget exhausted')


def collect_anchors(bridge,models,rng,deadline,count=256):
    meta=bridge.request(op='init');pool=meta['split']['train'];rows=[[],[]]
    while min(map(len,rows))<count:
        budget(deadline);a,b=rng.choice(len(pool),size=2,replace=False)
        current=bridge.request(op='reset',teamA=pool[a],teamB=pool[b],tieFirst=int(rng.integers(2)))
        starts=torch.ones(1,dtype=torch.bool);hidden=[m.initial_hidden(1) for m in models]
        while True:
            budget(deadline);actions=[]
            with torch.no_grad():
                for side in (0,1):
                    obs=current['observation'][side];rows[side].append(obs)
                    dist,_,hidden[side]=models[side].step(tensor_observations([obs]),hidden[side],starts)
                    actions.append(int(dist.sample().item()))
            result=bridge.request(op='step',actions=actions)
            if result['done']:break
            current=result['next'];starts=torch.zeros(1,dtype=torch.bool)
    return [tensor_observations(r[:count]) for r in rows]


def fit(model,bridge,anchor,rng,steps,deadline):
    reference=copy.deepcopy(model).eval();reference.requires_grad_(False)
    optimizer=torch.optim.Adam(model.parameters(),lr=1e-4,eps=1e-5)
    with torch.no_grad():teacher,_,_=reference.step(anchor,reference.initial_hidden(len(anchor['mask'])),torch.ones(len(anchor['mask']),dtype=torch.bool))
    target_probs=teacher.probs.detach();target_log=teacher.logits.detach().masked_fill(~anchor['mask'],0)
    def reset():
        case={'kind':str(rng.choice(['focus','switch'])),'variant':int(rng.integers(3)),'side':int(rng.integers(2)),'tieFirst':int(rng.integers(2))}
        current=bridge.request(op='probeReset',case=case)
        return current,current['probe']
    current,probe=reset();start=torch.ones(1,dtype=torch.bool);hidden=model.initial_hidden(1)
    completed=wins=used=0;logs=[]
    while used<steps:
        batch={k:[] for k in ('observations','actions','logp','values','rewards','dones','starts')}
        for _ in range(min(32,steps-used)):
            budget(deadline);bridge.timeout=max(.1,min(30,deadline-time.monotonic()))
            obs=tensor_observations([current['observation'][probe['side']]])
            with torch.no_grad():dist,value,_=model.step(obs,hidden,start);action=dist.sample();logp=dist.log_prob(action)
            pair=[0,0];pair[probe['side']]=int(action.item());pair[1-probe['side']]=probe['enemySlot']
            result=bridge.request(op='step',actions=pair)
            # Do not use expectedSlots or synthetic probe.finished as a training label.
            done=result['done'];reward=0.
            if done:
                winner=result['terminal']['winner'];reward=0. if winner=='draw' else 1. if winner==probe['side'] else -1.
                completed+=1;wins+=reward==1
            for k,v in {'observations':obs,'actions':action,'logp':logp,'values':value,'rewards':torch.tensor([reward]),
                         'dones':torch.tensor([done]),'starts':start}.items():batch[k].append(v)
            used+=1
            if done:current,probe=reset()
            else:current=result['next']
            start=torch.tensor([done])
        with torch.no_grad():_,last,_=model.step(tensor_observations([current['observation'][probe['side']]]),hidden,start)
        tensors={k:torch.stack(v) for k,v in batch.items() if k!='observations'}
        tensors['observations']={k:torch.stack([v[k] for v in batch['observations']]) for k in batch['observations'][0]}
        tensors['initial_hidden']=hidden;tensors['learn']=torch.ones_like(tensors['dones'])
        tensors['advantage'],tensors['returns']=generalized_advantage(tensors['rewards'],tensors['values'],tensors['dones'],last)
        update=update_policy(model,optimizer,tensors,epochs=3,entropy_coef=.02)
        # Retain behavior learned on ordinary six-vs-six training configurations.
        student,_,_=model.step(anchor,model.initial_hidden(len(anchor['mask'])),torch.ones(len(anchor['mask']),dtype=torch.bool))
        kl=(target_probs*(target_log-student.logits.masked_fill(~anchor['mask'],0))).sum(-1).mean()
        optimizer.zero_grad(set_to_none=True);(.2*kl).backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(),.5);optimizer.step()
        if not torch.isfinite(kl):raise FloatingPointError('Nonfinite retention KL')
        logs.append({'steps':used,'games':completed,'wins':int(wins),'retentionKL':float(kl.detach()),'ppo':update})
    return logs,completed


def run(path,steps,max_seconds,output):
    if output.exists():raise FileExistsError('Choose a fresh output directory')
    if not output.resolve().is_relative_to(ROOT/'.local'):raise ValueError('Output must remain in .local')
    output.mkdir(parents=True);started=time.monotonic();deadline=started+max_seconds;torch.set_num_threads(1)
    saved=torch.load(path,map_location='cpu',weights_only=True);cfg=saved['config']
    if cfg['architecture']!='entity_mlp':raise ValueError('This retention pilot supports the feedforward entity model only')
    torch.manual_seed(cfg['seed']+7000);rng=np.random.default_rng(cfg['seed']+7000)
    models=[ActorCritic(saved['schema'],cfg['architecture'],cfg['hidden']) for _ in range(2)]
    for m,s in zip(models,saved['models']):m.load_state_dict(s)
    config={**cfg,'steps':steps*2,'parentTrainingSteps':saved['trainingSteps'],'curriculum':True,'shaping':0,'maxSeconds':max_seconds,
            'learningRate':1e-4,'envs':1,'evalEvery':0,'retentionKL':.2,'entropy':.02,'curriculumKinds':['focus','switch']}
    report={'scope':'curriculum-method-pilot','status':'running','config':config,'trainingSteps':0,'completedTrainingGames':0,
        'apiTokens':0,'canPublishBalanceConclusion':False,'environmentHash':saved['environmentHash'],
        'parentCheckpointSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'initialHashes':[parameter_hash(m) for m in models],
        'parametersPerAgent':sum(p.numel() for p in models[0].parameters()),'updates':[],
        'limits':['Actual win/loss PPO on scripted artificial positions; this is a different training distribution.',
                  'KL anchors come only from the ordinary training population; no validation/test observations are fitted.',
                  'Variants 3..5 are held out by slot permutation only, not new species or new mechanics.']}
    try:
        with InferenceBridge() as bridge:
            meta=bridge.request(op='init')
            if meta['executionHash']!=saved['environmentHash']:raise ValueError('Environment changed')
            report['adapterHash']=meta['adapterHash']
            h=hashlib.sha256()
            for name in ('learning/resource_curriculum.py','learning/inference.py','learning/ppo.py','learning/models.py'):
                h.update(name.encode());h.update((ROOT/name).read_bytes())
            report['trainerHash']=h.hexdigest()
            report['initialValidation']=evaluate(models,None,saved['environmentHash'],deadline)
            report['initialCapabilities']=review_probes(models)
            anchors=collect_anchors(bridge,models,rng,deadline)
            for i,model in enumerate(models):
                logs,games=fit(model,bridge,anchors[i],rng,steps,deadline)
                report['updates'].extend({'agent':i,**row} for row in logs)
                report['trainingSteps']+=steps;report['completedTrainingGames']+=games
            report['trainedValidation']=evaluate(models,None,saved['environmentHash'],deadline)
            report['trainedCapabilities']=review_probes(models)
            report['finalHashes']=[parameter_hash(m) for m in models]
            report['validationReturnDelta']=report['trainedValidation']['meanReturn']-report['initialValidation']['meanReturn']
            report['status']='completed'
            torch.save({**{k:v for k,v in saved.items() if k!='optimizers'},'models':[m.state_dict() for m in models],'config':config,'trainingSteps':steps*2,
                        'parentTrainingSteps':saved['trainingSteps'],'trainerHash':report['trainerHash'],'resumeSupported':False},output/'model.pt')
    except TimeoutError as e:report['status']='budget-exhausted';report['error']=str(e)
    except Exception as e:report['status']='failed';report['error']=f'{type(e).__name__}: {e}';raise
    finally:
        report['elapsedSeconds']=time.monotonic()-started;write_json(output/'report.json',report)
    print(json.dumps({'status':report['status'],'seed':cfg['seed'],'validation':report.get('trainedValidation',{}).get('wins'),
        'capabilities':report.get('trainedCapabilities',{}).get('byKind'),'seconds':round(report['elapsedSeconds'],1)}),flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('checkpoint',type=Path);p.add_argument('--steps-per-agent',type=int,default=2048)
    p.add_argument('--max-seconds',type=int,default=240);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
    if a.steps_per_agent<128 or a.steps_per_agent>8192 or a.steps_per_agent%32 or not 30<=a.max_seconds<=600:p.error('steps 128..8192 multiple of 32; seconds 30..600')
    run(a.checkpoint,a.steps_per_agent,a.max_seconds,a.output)


if __name__=='__main__':main()
