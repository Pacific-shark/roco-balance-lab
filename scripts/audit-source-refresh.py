"""Compare pinned community snapshots by source game_id, without running Lua.

Internal pet/skill IDs are version scoped. This audit never updates the engine.
Usage: python scripts/audit-source-refresh.py OLD.json NEW.json --out REPORT.json
"""
import argparse
import importlib.util
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_source_audit', ROOT/'scripts/prepare-pilot.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def diff(a, b, path=''):
    if a == b:
        return []
    if isinstance(a, dict) and isinstance(b, dict):
        return [row for key in sorted(set(a) | set(b), key=str)
                for row in diff(a.get(key), b.get(key), path+'/'+str(key))]
    return [{'path': path, 'before': a, 'after': b}]


def by_game(rows):
    result = {str(v['game_id']): (k, v) for k, v in rows.items()}
    if len(result) != len(rows):
        raise ValueError('Non-unique game_id: automatic alignment is unsafe')
    return result


def audit(old, new):
    a, b = old['modules'], new['modules']
    os, ns = by_game(a['Skills']), by_game(b['Skills'])
    oc, nc = by_game(a['Catalog']), by_game(b['Catalog'])
    skill_changes, remap, pet_changes, learn_changes = [], [], [], []
    for gid in sorted(set(os) | set(ns)):
        before, after = os.get(gid), ns.get(gid)
        if before and after:
            if before[0] != after[0]:
                remap.append({'gameId': gid, 'name': after[1]['name'], 'oldId': before[0], 'newId': after[0]})
            changes = diff(before[1], after[1])
            if changes:
                skill_changes.append({'gameId': gid, 'name': after[1]['name'], 'changes': changes})
        else:
            skill_changes.append({'gameId': gid, 'before': before, 'after': after})

    def battle(c, modules):
        return {**{k: c.get(k) for k in ['name', 'title', 'number', 'stage', 'stats', 'types', 'release']},
                'traitGameId': modules['Skills'][c['feature_skill_id']]['game_id']}

    def learn(c, modules):
        entries = prepare.learn_entries(modules['Learnsets'][c['learnset_id']])
        return sorted([{**{k: v for k, v in e.items() if k != 'skill'},
                        'skillGameId': modules['Skills'][e['skill']]['game_id'],
                        'name': modules['Skills'][e['skill']]['name']} for e in entries],
                      key=lambda x: json.dumps(x, sort_keys=True))

    for gid in sorted(set(oc) | set(nc)):
        before, after = oc.get(gid), nc.get(gid)
        if not before or not after:
            pet_changes.append({'gameId': gid, 'before': before, 'after': after})
            continue
        changes = diff(battle(before[1], a), battle(after[1], b))
        if changes:
            pet_changes.append({'gameId': gid, 'name': after[1]['name'], 'changes': changes})
        l1, l2 = learn(before[1], a), learn(after[1], b)
        if l1 != l2:
            learn_changes.append({'gameId': gid, 'name': after[1]['name'],
                                  'removed': [x for x in l1 if x not in l2],
                                  'added': [x for x in l2 if x not in l1]})

    classified = prepare.classify_roster(b['Catalog'], b['Evolutions'])
    eligible = [c for c in classified if c['classification'] == 'highest-normal-candidate']
    moves = {e['skill'] for c in eligible for e in prepare.learn_entries(b['Learnsets'][b['Catalog'][c['id']]['learnset_id']])}
    traits = {b['Catalog'][c['id']]['feature_skill_id'] for c in eligible}
    return {'sourceManifest': new['provenance'], 'oldManifest': old['provenance'],
            'counts': dict(Counter(c['classification'] for c in classified)),
            'latestModuleCounts': {k: len(v) for k, v in b.items()},
            'rawFieldChangeCounts': {k: len(diff(v, b[k])) for k, v in a.items()},
            'identityMethod': 'unique game_id per table; version-scoped internal IDs; remap learning references before comparison',
            'skillIdRemapping': remap, 'semanticSkillChanges': skill_changes,
            'semanticPetBattleChanges': pet_changes, 'semanticLearnsetChanges': learn_changes,
            'configChanges': diff(a['Config'], b['Config']),
            'requiredMoves': len(moves), 'requiredTraits': len(traits),
            'formalTrainingAllowed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('old'); parser.add_argument('new'); parser.add_argument('--out', required=True)
    args = parser.parse_args()
    result = audit(read(args.old), read(args.new))
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'counts': result['counts'], 'remappedSkillIds': len(result['skillIdRemapping']),
                      'semanticSkillChanges': len(result['semanticSkillChanges']),
                      'semanticPetBattleChanges': len(result['semanticPetBattleChanges']),
                      'semanticLearnsetChanges': len(result['semanticLearnsetChanges'])}, ensure_ascii=False))
