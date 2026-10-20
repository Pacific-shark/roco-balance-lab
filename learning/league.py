"""Compare frozen checkpoints against one shared pool, with every trait intact.

Validation only: this is not PSRO training, optimal team search or a balance rank.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
from pathlib import Path
import time

import torch

from .bridge import ROOT
from .inference import InferenceBridge
from .models import ActorCritic, tensor_observations
from .train import parameter_hash, write_json


def cases(rule=False):
    """Equal exposure to both builds, own policies, seats and tie orientations."""
    opponent_roles = ('attack', 'support') if rule else (0, 1)
    return [dict(case=i, team=team, role=role, opponentRole=other, seat=seat,
                 tieFirst=tie, seed=184000+i)
            for i, (team, role, other, seat, tie) in enumerate(
                itertools.product((0, 1), (0, 1), opponent_roles, (0, 1), (0, 1)))]


def checked_score(rows):
    if not rows or len({r['case'] for r in rows}) != len(rows):
        raise ValueError('Empty or duplicate cross-play cases')
    for row in rows:
        expected = .5 if row['winner'] == 'draw' else float(row['winner'] == row['seat'])
        reason = 'prototype-round-cap' if row['winner'] == 'draw' else 'prototype-victory'
        if row['score'] != expected or row['endReason'] != reason:
            raise ValueError('Outcome does not match the actual terminal result')
    return dict(battles=len(rows), wins=sum(r['score'] == 1 for r in rows),
                losses=sum(r['score'] == 0 for r in rows),
                roundCaps=sum(r['score'] == .5 for r in rows),
                meanScore=sum(r['score'] for r in rows)/len(rows), rows=rows)


def evaluate_cell(bridge, models, opponents, teams, deadline):
    rows = []
    with torch.random.fork_rng(devices=[]), torch.no_grad():
        for case in cases(rule=opponents is None):
            if time.monotonic() >= deadline:
                raise TimeoutError('Cross-play budget exhausted')
            torch.manual_seed(case['seed'])
            seat = case['seat']
            own = models[case['role']]
            other = None if opponents is None else opponents[case['opponentRole']]
            players = [own if side == seat else other for side in (0, 1)]
            hidden = [p.initial_hidden(1) if p is not None else None for p in players]
            start = torch.ones(1, dtype=torch.bool)
            focal, opposing = teams[case['team']], teams[1-case['team']]
            current = bridge.request(op='reset', teamA=focal if seat == 0 else opposing,
                                     teamB=opposing if seat == 0 else focal,
                                     tieFirst=case['tieFirst'])
            # No patch is accepted by this protocol: full species traits always apply.
            while True:
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('Cross-play budget exhausted')
                bridge.timeout = max(.1, min(30, remaining))
                actions = []
                for side, model in enumerate(players):
                    if model is None:
                        action = current['rules'][side][case['opponentRole']]
                    else:
                        distribution, _, hidden[side] = model.step(
                            tensor_observations([current['observation'][side]]), hidden[side], start)
                        action = int(distribution.sample().item())
                    actions.append(action)
                step = bridge.request(op='step', actions=actions)
                if step['done']:
                    terminal = step['terminal']
                    score = .5 if terminal['winner'] == 'draw' else float(terminal['winner'] == seat)
                    rows.append({**case, **terminal, 'score': score})
                    break
                current = step['next']
                start = torch.zeros(1, dtype=torch.bool)
    return checked_score(rows)


def summarize(result):
    ids = [c['id'] for c in result['checkpoints']]
    expected = {(a, b) for a in ids for b in [*ids, 'visible-rules']}
    actual = {(r['learner'], r['opponent']) for r in result['cells']}
    if actual != expected or len(actual) != len(result['cells']):
        raise ValueError('Cross-play matrix incomplete or duplicated; no ranking can be exported')
    for cell in result['cells']:
        verified = checked_score(cell['score']['rows'])
        if verified != cell['score'] or verified['battles'] != 32:
            raise ValueError('Incorrect cross-play denominator')
        planned = cases(rule=cell['opponent'] == 'visible-rules')
        if any(any(row[k] != plan[k] for k in plan) for row, plan in zip(verified['rows'], planned)):
            raise ValueError('Cross-play cases differ from the locked protocol')
    summary = []
    for checkpoint in result['checkpoints']:
        cells = [r for r in result['cells'] if r['learner'] == checkpoint['id']]
        neural = [r['score']['meanScore'] for r in cells if r['opponent'] != 'visible-rules']
        rules = next(r['score']['meanScore'] for r in cells if r['opponent'] == 'visible-rules')
        summary.append(dict(id=checkpoint['id'], architecture=checkpoint['architecture'], seed=checkpoint['seed'],
                            neuralPoolScore=sum(neural)/len(neural), worstPoolCheckpoint=min(neural),
                            ruleScore=rules, battles=sum(r['score']['battles'] for r in cells)))
    return summary


def run(paths, output, seconds):
    output = output.resolve()
    if output.exists() or not output.is_relative_to(ROOT/'.local'):
        raise ValueError('Use a fresh report path inside .local')
    if not 2 <= len(paths) <= 8 or not 30 <= seconds <= 600:
        raise ValueError('Use 2..8 checkpoints and 30..600 seconds')
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    started = time.monotonic()
    deadline = started+seconds
    result = dict(protocol='intact-traits-crossplay-v1', scope='prototype-validation', status='running',
                  traitsIntact=True, testSplitUsed=False, canPublishBalanceConclusion=False,
                  apiTokens=0, maxSeconds=seconds, checkpoints=[], cells=[],
                  limitations=['Only two validation builds; repeated cases are not independent matchups.',
                               'The common frozen pool includes all supplied checkpoints, including each learner itself.',
                               'This is cross-play evaluation, not best-response training or a PSRO equilibrium.',
                               'No team-specific adaptation, optimal cultivation or current full-game claims.'])
    try:
        with InferenceBridge() as bridge:
            meta = bridge.request(op='init')
            result.update(environmentHash=meta['executionHash'], adapterHash=meta['adapterHash'],
                          validationTeams=meta['split']['validation'], evaluatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
            model_sets, seen = [], set()
            for path in paths:
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                if digest in seen:
                    raise ValueError('Duplicate checkpoint would change the opponent mixture weights')
                seen.add(digest)
                saved = torch.load(path, map_location='cpu', weights_only=True)
                if saved['environmentHash'] != meta['executionHash'] or saved['schema'] != meta['schema']:
                    raise ValueError('Checkpoint schema or simulator differs')
                models = [ActorCritic(saved['schema'], saved['config']['architecture'], saved['config']['hidden']) for _ in range(2)]
                for model, state in zip(models, saved['models']):
                    model.load_state_dict(state)
                    model.eval()
                model_sets.append(models)
                result['checkpoints'].append(dict(id=digest, architecture=saved['config']['architecture'],
                    seed=saved['config']['seed'], trainingSteps=saved['trainingSteps'], config=saved['config'],
                    parameterHashes=[parameter_hash(m) for m in models]))
            # Save the full common pool before any evaluation result is available.
            write_json(output, result)
            for i, models in enumerate(model_sets):
                for j, opponents in enumerate([*model_sets, None]):
                    score = evaluate_cell(bridge, models, opponents, meta['split']['validation'], deadline)
                    result['cells'].append(dict(learner=result['checkpoints'][i]['id'],
                        opponent=result['checkpoints'][j]['id'] if opponents is not None else 'visible-rules', score=score))
                    write_json(output, result)
                print(json.dumps(dict(event='crossplay-row', completed=i+1, total=len(paths))), flush=True)
            result['summary'] = summarize(result)
            result['totalBattles'] = sum(c['score']['battles'] for c in result['cells'])
            after = [[parameter_hash(m) for m in models] for models in model_sets]
            if after != [c['parameterHashes'] for c in result['checkpoints']]:
                raise ValueError('Evaluation mutated policy parameters')
            result.update(weightsUnchanged=True, status='completed')
    except TimeoutError as exc:
        result.update(status='budget-exhausted', error=str(exc))
    except Exception as exc:
        result.update(status='failed', error=f'{type(exc).__name__}: {exc}')
        raise
    finally:
        result['elapsedSeconds'] = time.monotonic()-started
        write_json(output, result)
    print(json.dumps({k: result.get(k) for k in ('status', 'totalBattles', 'elapsedSeconds', 'summary')}), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoints', type=Path, nargs='+')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-seconds', type=int, default=240)
    args = parser.parse_args()
    return 0 if run(args.checkpoints, args.output, args.max_seconds)['status'] == 'completed' else 2


if __name__ == '__main__':
    raise SystemExit(main())
