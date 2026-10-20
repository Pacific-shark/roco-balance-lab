"""Conditional build checks for the pinned source, not game-rule certification.

An acquisition union is useful for coverage, but cannot be sampled as a moveset.
These checks do not execute resonance magic or feed the legacy battle engine.
"""
from collections import defaultdict
from pilot_resonance import check_team_resonance

ELEMENTAL = frozenset('普通 草 火 水 光 地 冰 龙 电 毒 虫 武 翼 萌 幽 恶 机械 幻'.split())


def bloodline_registry(rows):
    registry = {}
    for row in rows:
        bid, name = row['id'], row['name']
        if type(bid) is not int or bid in registry or any(r['name'] == name for r in registry.values()):
            raise ValueError('Duplicate or malformed bloodline registry')
        kind = 'elemental' if name in ELEMENTAL else 'lord' if name == '首领' else 'special-unresolved'
        registry[bid] = {'id': bid, 'name': name, 'kind': kind}
    return registry


def resolve_bloodline(value, registry):
    # A list of several bloodlines, booleans and unknown aliases are invalid.
    if type(value) is int:
        return registry.get(value)
    if isinstance(value, str):
        return next((r for r in registry.values() if r['name'] == value), None)
    return None


def source_status(entry, level, stage):
    method = entry.get('method')
    if method not in {'自学', '技能石', '血脉'}:
        return 'unresolved-special-acquisition'
    if entry.get('requires'):
        return 'unresolved-extra-condition'
    if method in {'自学', '血脉'}:
        required_level = entry.get('level')
        if type(required_level) is not int or required_level < 1:
            return 'unresolved-level'
        if level < required_level:
            return 'ineligible-level'
    required_stage = entry.get('stage')
    if required_stage is not None:
        if type(required_stage) is not int or required_stage < 1:
            return 'unresolved-stage'
        if stage < required_stage:
            return 'ineligible-stage'
    return 'eligible-source'


def compile_bloodline_options(entries, bloodlines, *, level, stage, lord_conversions=()):
    if type(level) is not int or level < 1 or type(stage) is not int or stage < 1:
        raise ValueError('Explicit positive level and normal stage required')
    registry = bloodline_registry(bloodlines)
    common, conditional, unresolved, ineligible = set(), defaultdict(set), [], []
    for entry in entries:
        status = source_status(entry, level, stage)
        if status.startswith('unresolved'):
            unresolved.append({**entry, 'reason': status})
        elif status.startswith('ineligible'):
            ineligible.append({**entry, 'reason': status})
        elif entry['method'] == '血脉':
            blood = resolve_bloodline(entry.get('blood'), registry)
            if blood is None or blood['kind'] == 'special-unresolved':
                unresolved.append({**entry, 'reason': 'unresolved-bloodline'})
            else:
                conditional[blood['id']].add(entry['skill'])
        else:
            common.add(entry['skill'])
    options = []
    for bid, blood in registry.items():
        special = blood['kind'] == 'special-unresolved'
        pool = None if special else sorted(common | conditional[bid])
        options.append({**blood,
            'sourceCandidateMoveIds': pool,
            'sourceCandidateMoveCount': None if pool is None else len(pool),
            'bloodMoveIds': sorted(conditional[bid]),
            'wishBloodlineCondition': blood['kind'] == 'elemental',
            'lordBloodlineCondition': blood['kind'] == 'lord',
            'lordConversionCandidates': [dict(x) for x in lord_conversions] if blood['kind'] == 'lord' else [],
            'status': 'unresolved-special-bloodline' if special else 'source-filtered-not-game-certified',
            'battleActionsImplemented': False,
        })
    return {'version': 'conditional-bloodline-pools-v1', 'level': level, 'stage': stage,
            'commonMoveIds': sorted(common), 'commonMoveCount': len(common), 'options': options,
            'unresolvedSources': unresolved, 'ineligibleSources': ineligible,
            'sourceUnionIsNotEquippablePool': True, 'gameVerified': False}


def check_source_build(profile, *, bloodline, moves):
    """Validate a four-slot initial build against acquisition conditions only."""
    registry = bloodline_registry(profile['options'])
    blood = resolve_bloodline(bloodline, registry)
    errors, pending = [], []
    if blood is None:
        errors.append('exactly-one-known-bloodline-required')
    if (not isinstance(moves, list) or len(moves) != 4
            or any(not isinstance(m, str) or not m for m in moves)):
        errors.append('four-explicit-move-ids-required')
    elif len(set(moves)) != 4:
        errors.append('duplicate-move')
    if errors:
        return {'sourceConsistent': False, 'errors': errors, 'pending': pending, 'gameVerified': False}
    option = next(x for x in profile['options'] if x['id'] == blood['id'])
    if option['sourceCandidateMoveIds'] is None:
        pending.append('special-bloodline-acquisition-and-mode-access-unverified')
    else:
        possible = {e['skill'] for e in profile['unresolvedSources']}
        for mid in moves:
            if mid in option['sourceCandidateMoveIds']:
                continue
            if mid in possible:
                pending.append(f'unresolved-acquisition:{mid}')
            else:
                errors.append(f'no-eligible-source-for-selected-bloodline:{mid}')
    return {'sourceConsistent': not errors and not pending, 'errors': errors,
            'pending': pending, 'gameVerified': False}


def check_resonance_conditions(profile, *, bloodline, resonance, team_resonance=None, lord_target=None, unlocked_items=()):
    """Check known prerequisites, never authorize a battle action from this alone.

    This concerns the selected team magic. Trait-generated wish moves are a
    separate event source and must not be prohibited by this predicate.
    """
    blood = resolve_bloodline(bloodline, bloodline_registry(profile['options']))
    reasons = check_team_resonance(team_resonance, resonance)
    pending = ['current-mode-numeric-limits-and-cooldown-boundary',
               'activation-and-event-order', 'effect-settlement']
    if blood is None:
        reasons.append('exactly-one-known-bloodline-required')
    elif resonance == 'wish-amplification':
        if blood['kind'] != 'elemental':
            reasons.append('wish-magic-requires-elemental-bloodline')
        if lord_target is not None:
            reasons.append('lord-transformation-is-not-this-magic')
    elif resonance == 'evolution-power':
        if blood['kind'] != 'lord':
            reasons.append('evolution-magic-requires-lord-bloodline')
        option = next(x for x in profile['options'] if x['id'] == blood['id'])
        conversion = next((c for c in option['lordConversionCandidates'] if c['targetId'] == lord_target), None)
        if conversion is None:
            reasons.append('matching-lord-conversion-required')
        elif not conversion.get('item') or conversion['item'] not in unlocked_items:
            reasons.append('matching-unlock-evidence-required')
    elif resonance == 'photosynthetic-healing':
        # S4 explicitly permits every bloodline. This says nothing about
        # whether a special bloodline or creature is admitted to ranked play.
        if blood['kind'] == 'special-unresolved':
            pending.append('special-bloodline-current-mode-access-unverified')
        if lord_target is not None:
            reasons.append('lord-transformation-is-not-this-magic')
    else:
        reasons.append('resonance-not-reviewed')
    return {'knownConditionsSatisfied': not reasons, 'reasons': reasons,
            'executionAllowed': False, 'gameVerified': False,
            'pending': pending}
