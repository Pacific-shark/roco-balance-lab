"""Refresh pinned public source modules and build a fail-closed pilot inventory.

No Lua is executed, no simulator data is overwritten, and no training is started.
Run: python scripts/prepare-pilot.py [--offline]
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from wiki_data import read_module
from pilot_builds import compile_bloodline_options
from pilot_resonance import resonance_contract

ROOT = Path(__file__).resolve().parents[1]
NAMES = ['Catalog', 'Index', 'Skills', 'Learnsets', 'Terms', 'Evolutions', 'Config']
API = 'https://wiki.biligame.com/nrc/api.php'
CACHE = ROOT / '.cache/pilot-source'
EVIDENCE = ROOT / 'docs/evidence'


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def request(params):
    url = API + '?' + urlencode(params)
    with urlopen(Request(url, headers={'User-Agent': 'RocoPrivateResearch/0.1'}), timeout=30) as response:
        result = json.load(response)
    if 'error' in result:
        raise ValueError(f'MediaWiki error: {result["error"]}')
    return result


def fetch_sources():
    listing = request({'action': 'query', 'prop': 'revisions', 'rvprop': 'ids|timestamp',
                       'titles': '|'.join('Module:Pets/data/' + n for n in NAMES), 'format': 'json'})
    by_name = {v['title'].rsplit('/', 1)[-1]: v for v in listing['query']['pages'].values()}
    if set(by_name) != set(NAMES):
        raise ValueError('Source module listing is incomplete')

    def fetch(name):
        rev = by_name[name]['revisions'][0]
        raw = request({'action': 'parse', 'oldid': rev['revid'], 'prop': 'wikitext|revid', 'format': 'json'})
        if raw['parse']['revid'] != rev['revid']:
            raise ValueError('Revision changed during capture')
        path = CACHE / f'{name}.json'
        dump(path, raw)
        value = read_module(path)
        dump(CACHE / f'{name}.parsed.json', value)
        return {'name': name, 'revision': rev['revid'], 'modifiedAt': rev['timestamp'],
                'sha256': hashlib.sha256(raw['parse']['wikitext']['*'].encode()).hexdigest(),
                'url': f'https://wiki.biligame.com/nrc/Module:Pets/data/{name}?oldid={rev["revid"]}'}

    with ThreadPoolExecutor(max_workers=3) as pool:
        modules = list(pool.map(fetch, NAMES))
    manifest = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'modules': modules,
                'source': '洛克王国：世界 BWIKI 及贡献者', 'license': 'CC BY-SA 4.0',
                'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
                'currentGameVersionCertified': False}
    dump(CACHE / 'manifest.json', manifest)
    return manifest


def as_list(value):
    if value == {} or value is None:
        return []
    if not isinstance(value, list):
        raise ValueError('Unexpected evolution array shape')
    return value


def load_sources(cache, manifest):
    modules = manifest.get('modules', [])
    if len(modules) != len(NAMES) or {m['name'] for m in modules} != set(NAMES):
        raise ValueError('Pinned manifest is incomplete or has duplicate modules')
    result = {}
    for module in modules:
        path = cache / f'{module["name"]}.json'
        raw = json.loads(path.read_text(encoding='utf-8'))['parse']
        digest = hashlib.sha256(raw['wikitext']['*'].encode()).hexdigest()
        if raw['revid'] != module['revision'] or digest != module['sha256']:
            raise ValueError(f'Cached source does not match pinned manifest: {module["name"]}')
        result[module['name']] = read_module(path)
    return result


def classify_roster(catalog, evolutions):
    normal, lords = set(), set()
    successors, groups, conversions = defaultdict(set), defaultdict(set), defaultdict(list)
    for gid, rows in evolutions.items():
        for row in as_list(rows):
            chain = as_list(row['chain'])
            ids = [n['id'] for n in chain]
            if not ids:
                raise ValueError(f'Empty evolution chain: {gid}')
            for pid in ids:
                if pid not in catalog:
                    raise ValueError(f'Unknown evolution reference: {pid}')
                normal.add(pid)
                groups[pid].add(gid)
            for before, after in zip(ids, ids[1:]):
                if before == after:
                    raise ValueError(f'Self cycle: {before}')
                successors[before].add(after)
            for lord in as_list(row.get('lord_branches')):
                lid = lord['id']
                if lid not in catalog:
                    raise ValueError(f'Unknown lord reference: {lid}')
                lords.add(lid)
                conversions[ids[-1]].append({'targetId': lid, 'conditions': lord.get('cond'),
                                            'item': lord.get('item'), 'group': gid,
                                            'status': 'source-described-not-game-verified'})
    # Detect cycles instead of interpreting a malformed graph as no final forms.
    visited, visiting = set(), set()
    def visit(pid):
        if pid in visiting:
            raise ValueError(f'Evolution cycle: {pid}')
        if pid in visited:
            return
        visiting.add(pid)
        for nxt in successors[pid]: visit(nxt)
        visiting.remove(pid)
        visited.add(pid)
    for pid in sorted(normal): visit(pid)
    rows = []
    for pid, c in catalog.items():
        if pid in lords or c.get('stage') == 4:
            status = 'lord-special-mechanism'
        elif pid not in normal:
            status = 'unresolved-evolution'
        elif successors[pid]:
            status = 'excluded-lower-form'
        else:
            status = 'highest-normal-candidate'
        rows.append({'id': pid, 'dex': c['number'], 'name': c['name'], 'title': c.get('title', c['name']),
                     'form': c.get('form'), 'classification': status,
                     'successors': sorted(successors[pid]), 'evolutionGroups': sorted(groups[pid]),
                     'lordConversions': conversions[pid], 'legalPvpStatus': 'pending',
                     'release': c.get('release'), 'traitId': c['feature_skill_id'],
                     'learnsetId': c['learnset_id'], 'stats': c['stats']})
    return sorted(rows, key=lambda r: (int(r['dex']), r['title'], r['id']))


def learn_entries(learnset):
    entries = []
    for x in as_list(learnset.get('native_skills')):
        entries.append({'skill': x['skill'], 'method': '自学', 'level': x['level'], 'stage': x.get('stage')})
    for sid in as_list(learnset.get('skill_stones')):
        entries.append({'skill': sid, 'method': '技能石'})
    for x in as_list(learnset.get('blood_skills')):
        entries.append({'skill': x['skill'], 'method': '血脉', 'blood': x['blood'], 'level': x.get('level')})
    if learnset.get('legendary'):
        x = learnset['legendary']
        entries.append({'skill': x['skill'], 'method': '传说', 'requires': x.get('requires')})
    return entries


def build_pilot(data, manifest, engine):
    catalog, skills, learnsets = data['Catalog'], data['Skills'], data['Learnsets']
    roster = classify_roster(catalog, data['Evolutions'])
    indexed = {r['id']: r for r in roster}
    pilot_names = ['魔力猫', '火神', '水灵', '岚鸟', '布克棱岩', '奇丽花']
    hypotheses = {
        '魔力猫': '进攻与自我续航是否能在同一套打法兑现',
        '火神': '连续火系行动的强化与突破，及其机会成本',
        '水灵': '减耗与持续施压是否形成可用资源循环',
        '岚鸟': '出手顺序优势、速度取舍与轮转衔接',
        '布克棱岩': '零初始能量与队友预热，何时值得入场',
        '奇丽花': '主动供能、支援时机与自我续航的取舍',
    }
    targets, all_needed = [], set()
    for name in pilot_names:
        matches = [c for c in engine['creatures'].values() if c['name'] == name]
        if len(matches) != 1:
            raise ValueError(f'Ambiguous pilot identity: {name}')
        old = matches[0]
        r = indexed[old['id']]
        if r['classification'] != 'highest-normal-candidate':
            raise ValueError(f'Pilot is not a terminal ordinary form: {name}')
        c = catalog[r['id']]
        links = learn_entries(learnsets[c['learnset_id']])
        unique = sorted({e['skill'] for e in links})
        required = unique + [c['feature_skill_id']]
        for sid in required:
            if sid not in skills:
                raise ValueError(f'Missing skill/trait {sid}')
        all_needed.update(required)
        implemented = [sid for sid in unique if sid in engine['moves'] and sid in old['pool']]
        dynamics = [sid for sid in unique if any(t in skills[sid]['desc'] for t in ['随机', '借用', '复制', '打乱', '替换为', '获得技能'])]
        bloodline_options = compile_bloodline_options(
            links, data['Config']['build_form']['bloodlines'], level=60, stage=c['stage'],
            lord_conversions=r['lordConversions'])
        for option in bloodline_options['options']:
            pool = option['sourceCandidateMoveIds']
            option['prototypeAllowedMoveIds'] = None if pool is None else [sid for sid in pool if sid in implemented]
            option['missingMoveIds'] = None if pool is None else [sid for sid in pool if sid not in implemented]
            option['dynamicDependencyCandidates'] = None if pool is None else [sid for sid in pool if sid in dynamics]
        targets.append({**r, 'roleHypothesis': hypotheses[name], 'status': 'rules-blocked',
                        'trait': {'id': c['feature_skill_id'], 'name': skills[c['feature_skill_id']]['name'],
                                  'description': skills[c['feature_skill_id']]['desc'],
                                  'prototypeHandler': old['trait']['handler'], 'gameVerified': False},
                        'learningSources': links, 'uniqueMoveCount': len(unique),
                        'bloodlineOptions': bloodline_options,
                        'sourceCount': len(links), 'prototypeAllowedMoveCount': len(implemented),
                        'prototypeAllowedMoveIds': implemented,
                        'missingMoveIds': [sid for sid in unique if sid not in implemented],
                        'dynamicDependencyCandidates': dynamics,
                        'dynamicClosureStatus': 'pending' if dynamics else 'needs-manual-semantic-review',
                        'jointBuildLegality': 'pending', 'lordMechanismStatus': 'pending' if r['lordConversions'] else 'not-listed'})
    old_catalog = {c['id']: c for c in json.loads((ROOT/'public/data/bwiki-2026-10-14.json').read_text(encoding='utf-8'))['creatures']}
    changes = []
    for pid, c in catalog.items():
        if pid not in old_catalog:
            changes.append({'id': pid, 'name': c['name'], 'kind': 'new-form'})
        else:
            for new, old in [('stats', 'stats'), ('feature_skill_id', 'trait'), ('learnset_id', 'learnset')]:
                if c[new] != old_catalog[pid][old]:
                    changes.append({'id': pid, 'name': c['name'], 'field': new, 'old': old_catalog[pid][old], 'new': c[new]})
    for pid in set(old_catalog) - set(catalog): changes.append({'id': pid, 'kind': 'removed-form'})
    checks = [
        {'id': 'source-refresh', 'status': 'passed', 'criticalForTraining': False,
         'detail': '按读取时的模块修订号固定快照；仅证明社区源刷新成功。'},
        {'id': 'current-version', 'status': 'pending', 'criticalForTraining': True,
         'detail': '当前版本公告及历史调整未完成逐项对账，不能把 Config 版本标签当实战认证。'},
        {'id': 'legal-roster-and-builds', 'status': 'pending', 'criticalForTraining': True,
         'detail': '已检查唯一血脉、共鸣整队单选与有限次数；进化每局一次已有用户确认。愿力与草魔法现行额度、冷却、PVP 准入、特殊学习条件及其余整队限制仍待核准。',
         'reviewEvidence': ['docs/evidence/battle-mechanics-followup-2026-10-16.json']},
        {'id': 'panel-and-damage', 'status': 'partial', 'criticalForTraining': True,
         'detail': '公测面板样例已有；防御减伤的浮点整数边界已修正，外部计算器单样例一致。当前版本及完整伤害链仍缺实机对照。',
         'reviewEvidence': ['docs/evidence/mechanics-engine-checks-2026-10-15.json']},
        {'id': 'mechanism-closure', 'status': 'partial', 'criticalForTraining': True,
         'detail': '草魔法任意血脉前提已更正；动态注册防御受公共冷却的检查通过。同速离场独立顺序解析器已测试，完整事件交错和随机分布仍未知，旧引擎尚未迁移。动态技能、首领化和共鸣效果未完成。',
         'reviewEvidence': ['docs/evidence/official-battle-rules-2026-10-15.json',
                            'docs/evidence/mechanics-engine-checks-2026-10-15.json']},
        {'id': 'observations', 'status': 'pending', 'criticalForTraining': True,
         'detail': '玩家原始记录支持大师明牌、大师以下暗牌；需区分阵容预览与配招、血脉、共鸣字段，尚未取得当前界面逐字段证据或完成模式接入。旧策略仍读取完整配置。',
         'reviewEvidence': ['docs/evidence/battle-mechanics-followup-2026-10-16.json']},
        {'id': 'policy-capability', 'status': 'pending', 'criticalForTraining': True,
         'detail': '需通过相关战术能力题与多对手基线，不能只检查自博弈胜率。'},
        {'id': 'evaluation-protocol', 'status': 'pending', 'criticalForTraining': True,
         'detail': '正式预算、验证池与独立测试池尚未冻结。'},
    ]
    return {'version': 'pilot-preflight-v3-team-resonance', 'createdAt': datetime.now(timezone.utc).isoformat(),
            'officialRuleReview': {'path': 'docs/evidence/official-battle-rules-2026-10-15.json',
                                  'status': 'official-text-reviewed-game-validation-incomplete',
                                  'formalTrainingAllowed': False},
            'teamResonance': resonance_contract(),
            'scope': '常规6v6，60级五星；最高常规形态；角色假设试点，非强度结论',
            'sourceManifest': manifest, 'sourceDeclaredVersion': data['Config'].get('current_version'),
            'counts': {'sourceForms': len(catalog), 'sourceSkillsAndTraits': len(skills),
                       'roster': dict(Counter(r['classification'] for r in roster)), 'pilotTargets': len(targets),
                       'pilotUniqueMoves': len({e['skill'] for t in targets for e in t['learningSources']}),
                       'pilotLearningSources': sum(t['sourceCount'] for t in targets)},
            'roster': roster, 'targets': sorted(targets, key=lambda t: int(t['dex'])),
            'dependencies': [{'id': sid, **skills[sid], 'prototypeImplemented': sid in engine['moves'] or any(c['trait']['id'] == sid for c in engine['creatures'].values()),
                              'gameVerified': False} for sid in sorted(all_needed)],
            'catalogBattleFieldChangesSinceBundledSnapshot': changes,
            'checks': checks, 'trainingAllowed': False, 'strengthConclusionsAllowed': False,
            'trainingRunsStarted': 0,
            'limitations': ['最高形态候选不等于当前模式合法名单。',
                           '技能池是获得来源合集，不表示任意四招可共存。',
                           '动态技能、首领化、队友和对手引入的依赖仍需闭包核查。',
                           '社区资料已刷新不等于游戏规则已经验证。']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((CACHE/'manifest.json').read_text(encoding='utf-8')) if args.offline else fetch_sources()
    data = load_sources(CACHE, manifest)
    engine = json.loads((ROOT/'public/data/team-2026-10-14.json').read_text(encoding='utf-8'))
    result = build_pilot(data, manifest, engine)
    dump(ROOT/'public/data/pilot-manifest.json', result)
    dump(EVIDENCE/'pilot-source-manifest.json', manifest)
    print(json.dumps({'sourceDeclaredVersion': result['sourceDeclaredVersion'], 'counts': result['counts'],
                      'changes': result['catalogBattleFieldChangesSinceBundledSnapshot'],
                      'targets': [{'name': t['name'], 'moves': t['uniqueMoveCount'], 'prototypeAllowed': t['prototypeAllowedMoveCount'],
                                   'dynamic': t['dynamicDependencyCandidates']} for t in result['targets']],
                      'trainingAllowed': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
