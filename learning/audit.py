"""Recompute archived result metrics and export a small workbench data file."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from datetime import datetime, timezone
from .bridge import ROOT


def verified_score(score):
    if not score:return None
    rows=score['rows'];wins=sum(r['return']==1 for r in rows);losses=sum(r['return']==-1 for r in rows)
    assert rows and all(r['return'] in (-1,0,1) for r in rows)
    assert len({r['case'] for r in rows})==len(rows)
    for row in rows:
        if row['return']==0:assert row['endReason']=='prototype-round-cap' and row['winner']=='draw'
        else:assert row['return']==(1 if row['winner']==row['seat'] else -1) and row['endReason']=='prototype-victory'
    assert wins==score['wins'] and losses==score['losses'] and len(rows)==score['battles']
    assert len(rows)-wins-losses==score['roundCaps']
    assert abs((wins-losses)/len(rows)-score['meanReturn'])<1e-9
    return {k:v for k,v in score.items() if k not in ('rows','interpretation')}


def summarize(path):
    raw=path.read_bytes();r=json.loads(raw)
    assert 0<=r['trainingSteps']<=r['config']['steps']
    if r['status']=='completed':assert r['trainingSteps']==r['config']['steps']
    before=verified_score(r.get('initialValidation'));after=verified_score(r.get('trainedValidation'))
    curve=[{'trainingSteps':0,**before}] if before else []
    curve.extend({'trainingSteps':v['trainingSteps'],**verified_score(v)} for v in r.get('validationCurve',[]))
    if after:curve.append({'trainingSteps':r['trainingSteps'],**after})
    for update in r.get('updates',[]):
        agents=update.get('agents',[update.get('ppo',{})])
        assert all(math.isfinite(v) for a in agents for v in a.values() if isinstance(v,(int,float)))
    capabilities={}
    for phase in ('initialCapabilities','trainedCapabilities'):
        if phase not in r:continue
        for kind,score in r[phase]['byKind'].items():
            rows=[x for x in r[phase]['rows'] if x['kind']==kind]
            assert len(rows)==score['cases'] and sum(x['success'] for x in rows)==score['successes']
        capabilities[phase]=r[phase]['byKind']
        if r['config'].get('curriculum'):
            selected=[row for row in r[phase]['rows'] if row['variant']>=3]
            capabilities[phase]={kind:{'cases':len(rows),'successes':sum(row['success'] for row in rows)}
                for kind in ('finish','focus','switch') for rows in [[row for row in selected if row['kind']==kind]]}
    resources=None;resource_path=path.parent/'resource-outcomes.json'
    if resource_path.exists():
        resources=json.loads(resource_path.read_text(encoding='utf-8'))
        for phase in ('initial','trained'):
            score=resources[phase];rows=score['rows']
            assert len(rows)==score['battles']==24 and all(row['variant'] in (3,4,5) for row in rows)
            assert sum(row['won'] for row in rows)==score['wins']
            assert all(row['won']==(row['winner']==row['side']) for row in rows)
            resources[phase]={k:v for k,v in score.items() if k!='rows'}
    return {'id':path.parent.parent.name+'/'+path.parent.name,'sourceReportSha256':hashlib.sha256(raw).hexdigest(),
            'status':r['status'],'config':r['config'],'trainingSteps':r['trainingSteps'],
            'completedTrainingGames':r['completedTrainingGames'],'elapsedSeconds':round(r['elapsedSeconds'],2),
            'initialValidation':before,'trainedValidation':after,'curve':curve,'capabilities':capabilities,
            'parameterUpdatesVerified':bool(r.get('finalHashes')) and all(a!=b for a,b in zip(r['initialHashes'],r['finalHashes'])),
            'environmentHash':r.get('environmentHash'),'trainerHash':r.get('trainerHash'),
            'apiTokens':r['apiTokens'],'error':r.get('error'),'resourceOutcomes':resources,
            'configurationCorrection':r.get('configurationCorrection')}


def summarize_study(path):
    from .research import paired_delta
    study=json.loads(path.read_text(encoding='utf-8'));total=0
    def check(score):
        nonlocal total
        assert len(score['rows'])==score['battles']
        assert sum(r['score']==1 for r in score['rows'])==score['wins']
        assert sum(r['score']==.5 for r in score['rows'])==score['roundCaps']
        for r in score['rows']:assert r['score']==(.5 if r['winner']=='draw' else float(r['winner']==r['seat']))
        assert abs(sum(r['score'] for r in score['rows'])/len(score['rows'])-score['meanScore'])<1e-9
        total+=score['battles']
    for candidate in study['screening']:
        for score in candidate['validation']:check(score)
    selected=[]
    assert study['selectionLockedBeforeTest']==[r['team']['id'] for r in study['selected']]
    for row in study['selected']:
        scores=[]
        for run in row['testBySeed']:
            check(run['baseline']);check(run['traitRemoved'])
            assert abs(paired_delta(run['baseline'],run['traitRemoved'])-run['frozenTraitDelta'])<1e-9
            scores.append({'seed':run['seed'],'baseline':run['baseline']['meanScore'],'traitRemoved':run['traitRemoved']['meanScore'],
                           'delta':run['frozenTraitDelta'],'battlesPerCondition':run['baseline']['battles']})
        selected.append({'team':row['team'],'scores':scores,'dimensions':row['dimensions'],
                         'sampleReplay':next((r['trace'] for r in row['testBySeed'][0]['baseline']['rows'] if r.get('trace')),[])})
    return {'status':study['status'],'target':study['target'],'candidateCount':study['candidateCount'],
            'totalBattles':total,'weightsUnchanged':study.get('weightsUnchanged',False),'selected':selected,
            'sourceReportSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'limitations':study['limitations']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--groups',nargs='+',required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'docs/evidence/learning-progress-v2.json')
    parser.add_argument('--research',type=Path)
    args=parser.parse_args();runs=[]
    for name in args.groups:
        if Path(name).name!=name:raise ValueError('Use local experiment directory names')
        paths=sorted((ROOT/'.local'/name).glob('*/report.json'))
        if not paths:raise ValueError('No reports in '+name)
        runs.extend(summarize(p) for p in paths)
    result={'version':3,'archivedAt':datetime.now(timezone.utc).isoformat(),'scope':'prototype-only',
            'canPublishBalanceConclusion':False,'assessment':'share-with-caveats','runs':runs,
            'limitations':['10 个形态、42 个技能的受限模拟器；不是现行全量 PVP。',
                '验证只有两套留出构筑；重复座位与训练种子不能当作独立对位。',
                '能力题为人工构造的六成员残局，不能代表实战中的出现频率。',
                '胜率采用真实终局；过程奖励不计入验证胜负。',
                '该页显示已归档实验；测试集未用于调参。']}
    if args.research:result['neuralStudy']=summarize_study(args.research)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps({'runs':len(runs),'complete':sum(r['status']=='completed' for r in runs),'output':str(args.output)},ensure_ascii=False))


if __name__=='__main__':main()
