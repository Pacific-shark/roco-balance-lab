"""Separate a small research target list from the complete teammate universe.

This inventories source candidates; it neither certifies PvP legality nor starts
the ten-form prototype trainer. Missing execution support never removes a mate.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pilot_prepare_scope', ROOT/'scripts/prepare-pilot.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
DEFAULT_TARGETS = ['pet_000005', 'pet_000028', 'pet_000076']


def build_scope(snapshot, engine, target_ids):
    data = snapshot['modules']
    classified = prepare.classify_roster(data['Catalog'], data['Evolutions'])
    eligible = [r for r in classified if r['classification'] == 'highest-normal-candidate']
    universe = {r['id'] for r in eligible}
    if not target_ids or len(set(target_ids)) != len(target_ids) or not set(target_ids) <= universe:
        raise ValueError('Targets must be distinct highest-normal source candidates')
    rows, moves, traits = [], set(), set()
    for row in eligible:
        creature = data['Catalog'][row['id']]
        links = prepare.learn_entries(data['Learnsets'][creature['learnset_id']])
        required = sorted({e['skill'] for e in links})
        trait = data['Skills'][creature['feature_skill_id']]
        for mid in required:
            if mid not in data['Skills']:
                raise ValueError(f'Broken skill reference: {mid}')
        old = engine['creatures'].get(row['id'])
        allowed = [] if old is None else sorted(set(required) & set(old['pool']) & set(engine['moves']))
        trait_handler = old['trait']['handler'] if old and old['trait']['id'] == creature['feature_skill_id'] else None
        moves.update(required)
        traits.add(creature['feature_skill_id'])
        rows.append({
            'id': row['id'], 'dex': row['dex'], 'name': row['name'], 'title': row['title'],
            'classification': row['classification'], 'legalPvpStatus': 'pending',
            'researchTarget': row['id'] in target_ids,
            'trait': {'id': creature['feature_skill_id'], 'name': trait['name'],
                      'description': trait['desc'], 'prototypeHandler': trait_handler},
            'sourceMoveIds': required, 'sourceLearningEntries': len(links),
            'sourceUnionIsNotEquippablePool': True,
            'prototypeFormPresent': old is not None,
            'prototypeStatsMatchSource': old['stats'] == creature['stats'] if old else None,
            'prototypeAllowedMoveIds': allowed,
            'missingPrototypeMoveIds': sorted(set(required)-set(allowed)),
            'lordConversions': row['lordConversions'],
            'dynamicClosureStatus': 'pending', 'jointBuildLegality': 'pending',
            'mechanismGameVerified': False,
        })
    return {
        'version': 'few-targets-open-roster-v1',
        'sourceManifest': snapshot['provenance'],
        'sourceDeclaredVersion': data['Config'].get('current_version'),
        'targetIds': target_ids,
        'policy': {
            'teamSize': 6, 'focalSlots': 1, 'teammateSlots': 5,
            'teammates': 'all-currently-legal-highest-normal-forms',
            'opponents': 'same-full-legal-universe',
            'role': 'not-prescribed', 'allTraitsIntact': True,
            'pendingLegality': 'retain-as-pending-never-call-legal',
            'unsupportedMechanism': 'retain-and-block-evaluation-never-score-zero',
            'lordForms': 'conditional-transformation-not-ordinary-team-slot',
            'budgetControls': ['target-count', 'candidate-count', 'steps-per-candidate',
                               'training-seeds', 'wall-clock-limit'],
        },
        'counts': {
            'sourceForms': len(classified), 'classification': dict(Counter(r['classification'] for r in classified)),
            'researchTargets': len(target_ids), 'teammateSourceCandidates': len(rows),
            'verifiedLegalCandidates': sum(r['legalPvpStatus'] == 'verified' for r in rows),
            'prototypeFormsPresent': sum(r['prototypeFormPresent'] for r in rows),
            'sourceMoveUnion': len(moves), 'sourceTraitUnion': len(traits),
            'prototypeMoveDefinitions': len(moves & set(engine['moves'])),
            'fullSourceMovePoolImplementedForms': sum(not r['missingPrototypeMoveIds'] for r in rows),
        },
        'candidates': rows,
        'trainingAllowed': False, 'trainingRunsStarted': 0,
        'strengthConclusionsAllowed': False,
        'blockers': ['current-mode-roster-legality', 'complete-move-trait-and-dynamic-effects',
                     'bloodline-resonance-and-lord-execution', 'current-version-game-validation',
                     'full-roster-observation-encoding', 'joint-search-training-adapter'],
    }


def teammate_candidates(scope, target_id):
    if target_id not in scope['targetIds']:
        raise ValueError('Not a selected research target')
    # Execution availability is deliberately not a search-universe filter.
    return [r for r in scope['candidates'] if r['id'] != target_id]


def inspect_roster_proposal(scope, target_id, member_ids):
    teammate_candidates(scope, target_id)
    registry = {r['id']: r for r in scope['candidates']}
    if (len(member_ids) != 6 or len(set(member_ids)) != 6 or
            target_id not in member_ids or not set(member_ids) <= set(registry)):
        raise ValueError('Require the target plus five distinct source candidates')
    # This validates identities only. Four moves, bloodline, cultivation and the
    # team magic still need joint legality checks before constructing a battle.
    return {
        'sourceRosterAccepted': True, 'members': member_ids,
        'missingPrototypeForms': [pid for pid in member_ids if not registry[pid]['prototypeFormPresent']],
        'pendingLegality': [pid for pid in member_ids if registry[pid]['legalPvpStatus'] != 'verified'],
        'jointBuildChecked': False, 'evaluationStatus': 'blocked',
        'trainingAllowed': False, 'score': None,
    }


def check_source_revisions(manifest):
    """A successful revision check still does not certify the live game."""
    check = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'currentGameVersionCertified': False}
    params = {'action': 'query', 'prop': 'revisions', 'rvprop': 'ids|timestamp', 'format': 'json',
              'titles': '|'.join('Module:Pets/data/'+m['name'] for m in manifest['modules'])}
    try:
        url = prepare.API+'?'+urlencode(params)
        with urlopen(Request(url, headers={'User-Agent': 'RocoPrivateResearch/0.1'}), timeout=12) as response:
            pages = json.load(response)['query']['pages']
        live = {p['title'].rsplit('/', 1)[-1]: p['revisions'][0] for p in pages.values()}
        if set(live) != {m['name'] for m in manifest['modules']}:
            raise ValueError('Incomplete revision response')
        check['modules'] = [{'name': m['name'], 'snapshotRevision': m['revision'],
                             'observedRevision': live[m['name']]['revid'],
                             'observedModifiedAt': live[m['name']]['timestamp']} for m in manifest['modules']]
        check['status'] = 'same-revisions' if all(m['snapshotRevision'] == m['observedRevision'] for m in check['modules']) else 'refresh-required'
    except Exception as exc:
        check.update(status='unverified', error=f'{type(exc).__name__}: {exc}')
    return check


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--targets', nargs='+', default=DEFAULT_TARGETS)
    parser.add_argument('--check-source', action='store_true')
    args = parser.parse_args()
    path = ROOT/'data/catalog-s4-20261015.json'
    snapshot = json.loads(path.read_text(encoding='utf-8'))
    engine = json.loads((ROOT/'public/data/team-2026-10-14.json').read_text(encoding='utf-8'))
    scope = build_scope(snapshot, engine, args.targets)
    scope['snapshotSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    scope['sourceRevisionCheck'] = check_source_revisions(snapshot['provenance']) if args.check_source else {'status': 'not-rechecked'}
    output = ROOT/'docs/evidence/open-roster-pilot.json'
    prepare.dump(output, scope)
    print(json.dumps({'counts': scope['counts'], 'targets': [r['name'] for r in scope['candidates'] if r['researchTarget']],
                      'sourceRevisionCheck': scope['sourceRevisionCheck'], 'trainingAllowed': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
