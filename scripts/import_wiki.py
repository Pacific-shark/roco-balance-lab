"""Normalize attributed BWIKI facts, preserving source IDs and restrictions.

Usage: python scripts/import_wiki.py ../work/roco-research
Input is a local cache of public MediaWiki API responses and visible list rows.
No renderer code, illustrations, flavour text or user/account data are exported.
"""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from wiki_data import read_module


def build(root):
    root = Path(root)
    names = ['Catalog', 'Index', 'Skills', 'Learnsets', 'Terms']
    data = {name: read_module(root / 'wiki-api' / (name + '.json')) for name in names}
    modules = []
    for name in names:
        raw = json.loads((root / 'wiki-api' / (name + '.json')).read_text(encoding='utf-8'))['parse']
        modules.append({'name': name, 'revision': raw['revid'],
            'url': 'https://wiki.biligame.com/nrc/' + quote('Module:Pets/data/' + name, safe='/:') + '?oldid=' + str(raw['revid']),
            'sha256': hashlib.sha256(raw['wikitext']['*'].encode()).hexdigest()})
    visible = json.loads((root / 'bwiki-creatures-2026-10-14.json').read_text(encoding='utf-8'))
    visible_rows = [row for page in visible['pages'] for row in page['rows']]
    by_title = {unquote(urlsplit(row['url']).path).split('/nrc/', 1)[1]: row for row in visible_rows}
    assert len(visible_rows) == len(data['Catalog']) == len(by_title) == 625
    skills = {}
    for key, value in data['Skills'].items():
        if value['category'] == '特性':
            category = '特性'
        else:
            category = value.get('damage_class') or value['category']
        skills[key] = {'id': key, 'name': value['name'], 'type': value['element'].removesuffix('系'),
            'category': category, 'cost': value['energy'], 'power': value.get('power'),
            'description': value['desc'], 'terms': value.get('desc_notes') or [],
            'source': 'https://wiki.biligame.com/nrc/' + quote(value['name'])}
    creatures, links, mismatches = [], 0, []
    for key, value in data['Catalog'].items():
        title = value.get('title') or data['Index']['titles'][key]
        row = by_title[title]
        stats = value['stats']
        expected = dict(zip(['hp','spe','atk','spa','def','spd'], [row[k] for k in ['hp','speed','attack','spAttack','defense','spDefense']]))
        if stats != expected or sum(stats.values()) != row['total']:
            mismatches.append({'title': title, 'fields': 'stats', 'table': expected, 'module': stats})
        assert value['types'] == row['types'], title
        trait = value['feature_skill_id']
        assert trait in skills and skills[trait]['category'] == '特性', title
        if skills[trait]['description'] != row['traitDescription']:
            mismatches.append({'title': title, 'fields': 'trait description'})
        learned = data['Learnsets'][value['learnset_id']]
        pool = []
        for entry in learned.get('native_skills', []):
            pool.append({'skill': entry['skill'], 'method': '自学', 'level': entry['level'], 'stage': entry.get('stage')})
        for skill in learned.get('skill_stones', []):
            pool.append({'skill': skill, 'method': '技能石'})
        for entry in learned.get('blood_skills', []):
            pool.append({'skill': entry['skill'], 'method': '血脉', 'blood': entry['blood'], 'level': entry.get('level')})
        if learned.get('legendary'):
            special = learned['legendary']
            pool.append({'skill': special['skill'], 'method': '传说', 'requires': special.get('requires')})
        for entry in pool:
            assert entry['skill'] in skills, (title, entry)
            assert skills[entry['skill']]['category'] != '特性', (title, entry)
        links += len(pool)
        creatures.append({'id': key, 'dex': value['number'], 'name': value['name'], 'title': title,
            'form': value.get('form') or row['form'], 'stage': row['stage'], 'types': [v.removesuffix('系') for v in value['types']],
            'stats': stats, 'total': sum(stats.values()), 'trait': trait, 'learnset': value['learnset_id'],
            'season': row['season'], 'skills': pool, 'source': row['url']})
    creatures.sort(key=lambda c: (int(c['dex']), c['title']))
    # Keep duplicate internal trait IDs; three identical names map to six IDs.
    # Name-based collapsing would destroy exact species-to-trait provenance.
    trait_names = {s['name'] for s in skills.values() if s['category'] == '特性'}
    public_skill_rows = json.loads((root / 'bwiki-skills-2026-10-14.json').read_text(encoding='utf-8'))['rows']
    public_traits = json.loads((root / 'bwiki-traits-2026-10-14.json').read_text(encoding='utf-8'))['rows']
    assert {s['name'] for s in skills.values() if s['category'] != '特性'} == {s['name'] for s in public_skill_rows}
    assert trait_names == {s['name'] for s in public_traits}
    assert not mismatches, mismatches[:10]
    terms = [{'id': str(k), 'name': v['note'], 'description': v['desc']} for k, v in data['Terms'].items()]
    return {'meta': {'snapshot': 'bwiki-2026-10-14', 'capturedAt': '2026-10-14',
        'sourceName': '洛克王国：世界 BWIKI 玩家社区', 'license': 'CC BY-SA 4.0',
        'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
        'siteStatement': 'https://wiki.biligame.com/nrc/洛克王国世界:站点声明',
        'source': 'https://wiki.biligame.com/nrc/首页', 'modules': modules,
        'counts': {'forms': len(creatures), 'dexNumbers': len({c['dex'] for c in creatures}),
            'skills': len(public_skill_rows), 'traitNames': len(trait_names),
            'traitIds': len(skills)-len(public_skill_rows), 'learnsets': len(data['Learnsets']),
            'learnsetEntries': links, 'terms': len(terms)},
        'validation': {'visibleListMatched': len(creatures), 'missingSkillReferences': 0, 'statMismatches': 0},
        'limitations': ['页面收录完整，不代表游戏全部内容或所有合法组合已核验。',
            '技能池包含自学、技能石、血脉和传说来源；血脉技能不可视为同时可装备。',
            '学习阶段、血脉与传说条件按来源保留，尚未实现组合合法性验证。',
            '图鉴数据层尚未接入全量战斗引擎；训练仍使用单独的六精灵 S3 实验子集。',
            '洛克广场小程序尚未读取，数据源为 BWIKI。']},
        'creatures': creatures, 'skills': skills, 'terms': terms}


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    result = build(sys.argv[1])
    output = Path(__file__).resolve().parents[1] / 'public' / 'data' / 'bwiki-2026-10-14.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps(result['meta'], ensure_ascii=False, indent=2))
