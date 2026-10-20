"""Build a complete reading index without filtering by simulator implementation.

The manual groups are navigation aids, never a synergy ranking. Current-mode
legality and game-event correctness remain unverified. No training is invoked.
"""
import argparse
from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check-source',action='store_true')
    args=parser.parse_args()
    raw=(ROOT/'data/catalog-s4-20261015.json').read_bytes()
    snapshot=json.loads(raw); modules=snapshot['modules']
    scope=json.loads((ROOT/'docs/evidence/open-roster-pilot.json').read_text(encoding='utf-8'))
    groups=json.loads((ROOT/'data/pvp-trait-reading-groups.json').read_text(encoding='utf-8'))
    membership={};counts=Counter()
    for g in groups['groups']:
        for n in g['ids']:
            tid=f'skill_{n:06d}';counts[tid]+=1;membership[tid]=g['name']
    needed={p['trait']['id'] for p in scope['candidates']}
    assert set(membership)==needed, {'missing':sorted(needed-set(membership)), 'extra':sorted(set(membership)-needed)}
    assert all(c==1 for c in counts.values()), 'Primary groups must partition required traits'
    rows=[]
    for candidate in scope['candidates']:
        p=modules['Catalog'][candidate['id']];tid=p['feature_skill_id'];t=modules['Skills'][tid]
        rows.append({'number':p['number'],'id':p['id'],'name':p['title'],'types':p['types'],
                     'traitId':tid,'trait':t['name'],'description':t['desc'],'group':membership[tid],
                     'learnsetId':p['learnset_id'],'sourceUrl':'https://wiki.biligame.com/nrc/'+p['title'],
                     'status':'source-text-read; live-build-and-replay-not-verified'})
    rows.sort(key=lambda r:(int(r['number']),r['id']))
    check={'status':'not-rechecked','currentGameVersionCertified':False}
    if args.check_source:
        from pilot_scope import check_source_revisions
        check=check_source_revisions(snapshot['provenance'])
    evidence={'reviewedAt':groups['reviewedAt'],'forms':len(rows),'uniqueTraits':len(needed),
              'groups':len(groups['groups']),'sourceSha256':hashlib.sha256(raw).hexdigest(),
              'sourceRevisionCheck':check,'modeLegalityCertified':False,'trainingStarted':False,
              'simulatorCoverageFilterApplied':False,'rows':rows,'provenance':snapshot['provenance']}
    (ROOT/'docs/evidence/pvp-trait-reading-2026-10-18.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    out=io.StringIO();w=csv.writer(out)
    w.writerow(['图鉴编号','形态ID','精灵','系别','特性ID','特性','特性描述','主检索分类','学习表ID','来源','核验状态'])
    for r in rows:w.writerow([r['number'],r['id'],r['name'],'/'.join(r['types']),r['traitId'],r['trait'],r['description'],r['group'],r['learnsetId'],r['sourceUrl'],r['status']])
    (ROOT/'docs/pvp-trait-reading-2026-10-18.csv').write_text(out.getvalue(),encoding='utf-8-sig')
    lines=['# 全候选特性阅读索引','',f"2026-10-18 · {len(rows)} 个最高常规形态候选 · {len(needed)} 条特性 · {len(groups['groups'])} 类检索主题",'',
           '已通读来源文本，未逐只完成实战核验。此处不按执行器支持情况删减精灵，也不据分类给强度或协同打分。当前模式合法性仍待逐项认证。',
           '', '[按图鉴编号排列的完整表格](pvp-trait-reading-2026-10-18.csv) · [版本与完整字段](evidence/pvp-trait-reading-2026-10-18.json)', '',
           '数据来源：洛克王国：世界 BWIKI 及贡献者，固定修订和校验值见证据文件。来源数据依 CC BY-SA 4.0 署名及相同方式共享；分类为本项目新增的阅读整理。','']
    for g in groups['groups']:
        lines.extend(['## '+g['name'],'','| 特性 | 涉及的最高常规形态候选 | 来源文本 |','| --- | --- | --- |'])
        for n in g['ids']:
            tid=f'skill_{n:06d}';t=modules['Skills'][tid]
            members='、'.join(r['name'] for r in rows if r['traitId']==tid)
            desc=t['desc'].replace('|','\\|').replace('\n',' ')
            lines.append(f"| {t['name']}（{tid}） | {members} | {desc} |")
        lines.append('')
    (ROOT/'docs/pvp-trait-reading-2026-10-18.md').write_text('\n'.join(lines),encoding='utf-8')
    print(json.dumps({k:evidence[k] for k in ('forms','uniqueTraits','groups','sourceRevisionCheck','trainingStarted')},ensure_ascii=False))

if __name__=='__main__':main()
