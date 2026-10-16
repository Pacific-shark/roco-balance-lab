"""Inspect chosen actions using only the policy's own visible input."""
from __future__ import annotations
import argparse
from collections import Counter
import json
from pathlib import Path
import time
import torch
from .bridge import BattleBridge, ROOT
from .models import ActorCritic, tensor_observations
from .train import parameter_hash, write_json


def action_description(obs, slot, schema):
    phase = next(k for k in ('lead', 'battle', 'replace') if obs['global'][schema['globalNames'].index(k)])
    kind = next(k for k in ('attack', 'defense', 'status', 'focus', 'switch', 'wait') if obs['actions'][slot][schema['actionNames'].index(k)])
    row = {'phase': phase, 'kind': kind, 'slot': slot}
    if kind == 'focus':
        active = next(p for p in obs['pets'][:6] if p[2])
        row['energyBefore'] = round(active[schema['petNames'].index('energy')]*10, 6)
    return row


def measure(models, *, node=None, split='validation', seed=82026, trace_cases=2):
    counts, rows, traces = Counter(), [], []
    with torch.random.fork_rng(devices=[]), BattleBridge(node) as bridge:
        meta = bridge.request(op='init', envs=1, seed=seed, scope='prototype')
        for team in (0, 1):
            for policy in (0, 1):
                for seat in (0, 1):
                    for tie in (0, 1):
                        for style in ('attack', 'support'):
                            case = len(rows)
                            torch.manual_seed(seed+case)
                            current = bridge.request(op='reset', options={'split': split, 'a': team if seat == 0 else 1-team, 'b': 1-team if seat == 0 else team, 'tieFirst': tie})
                            model = models[policy]
                            hidden, start = model.initial_hidden(1), torch.ones(1, dtype=torch.bool)
                            trace = []
                            while True:
                                obs = current['observation'][seat]
                                with torch.no_grad():
                                    dist, _, hidden = model.step(tensor_observations([obs]), hidden, start)
                                    action = int(dist.sample().item())
                                description = action_description(obs, action, meta['schema'])
                                counts[description['phase']+':'+description['kind']] += 1
                                if description.get('energyBefore') == 10:
                                    counts['fullEnergyFocus'] += 1
                                pair = [0, 0]
                                pair[seat], pair[1-seat] = action, current['rules'][1-seat][style]
                                result = bridge.request(op='step', actions=[pair], autoReset=False)[0]
                                if case < trace_cases:
                                    trace.append({**description, 'opponentAction': pair[1-seat]})
                                if result['done']:
                                    rows.append({'case': case, 'team': team, 'policy': policy, 'seat': seat, 'tieFirst': tie, 'style': style, 'return': result['rewards'][seat], **result['terminal']})
                                    if case < trace_cases:
                                        traces.append({'case': case, 'decisions': trace})
                                    break
                                current, start = result['next'], torch.zeros(1, dtype=torch.bool)
    battle = sum(v for k, v in counts.items() if k.startswith('battle:'))
    return {'split': split, 'schemaVersion': meta['schema']['version'], 'environmentHash': meta['executionHash'], 'counts': dict(counts), 'battleDecisions': battle,
            'voluntarySwitchFraction': counts['battle:switch']/max(1, battle), 'attackFraction': counts['battle:attack']/max(1, battle),
            'wins': sum(r['return']==1 for r in rows), 'battles': len(rows), 'rows': rows, 'traces': traces}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--split',choices=('train','validation'),default='validation')
    args=parser.parse_args()
    torch.set_num_threads(1)
    checkpoint=torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    models=[ActorCritic(checkpoint['schema'], checkpoint['config']['architecture'], checkpoint['config']['hidden']) for _ in range(2)]
    for model, state in zip(models, checkpoint['models']):
        model.load_state_dict(state)
        model.eval()
    result=measure(models,split=args.split)
    if result['environmentHash'] != checkpoint['environmentHash']:
        raise ValueError('Checkpoint environment differs; do not compare silently')
    result['parameterHashes']=[parameter_hash(m) for m in models]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.output, result)
    print(json.dumps({k:v for k,v in result.items() if k not in ('rows','traces','parameterHashes')}, ensure_ascii=False))


if __name__=='__main__':
    main()
