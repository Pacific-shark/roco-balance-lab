"""Small-budget architecture comparison; not current-game strength training.

python -m learning.train --models linear mlp entity_gru --seeds 42 137 256
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import time
from collections import Counter
import numpy as np
import torch

from .bridge import BattleBridge, ROOT
from .models import ARCHITECTURES, ActorCritic, tensor_observations
from .ppo import generalized_advantage, update_policy
from .rewards import visible_potential, shape_rewards
from .capabilities import evaluate_capabilities


class BudgetExpired(Exception):
    pass


def check_budget(deadline):
    if time.monotonic() >= deadline:
        raise BudgetExpired("Cumulative run time budget exhausted")


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def parameter_hash(model):
    digest = hashlib.sha256()
    for name, value in model.state_dict().items():
        digest.update(name.encode())
        digest.update(value.detach().cpu().contiguous().numpy().tobytes())
    return digest.hexdigest()


def frozen(model):
    clone = copy.deepcopy(model).eval()
    clone.requires_grad_(False)
    return clone


def evaluate(models, node, expected_hash, deadline, *, split="validation", seed=82026):
    """Fixed visible-rule opponents; separate from training RNG and datasets."""
    rows = []
    behavior = Counter()
    with torch.random.fork_rng(devices=[]), BattleBridge(node) as bridge:
        metadata = bridge.request(op="init", seed=seed, envs=1, scope="prototype")
        if metadata["executionHash"] != expected_hash:
            raise RuntimeError("Evaluation simulator differs from training")
        cases = [(team, policy, seat, tie, style) for team in (0, 1) for policy in (0, 1)
                 for seat in (0, 1) for tie in (0, 1) for style in ("attack", "support")]
        for case, (team, policy, seat, tie, style) in enumerate(cases):
            check_budget(deadline)
            torch.manual_seed(seed + case)
            current = bridge.request(op="reset", options={"split": split, "a": team if seat == 0 else 1-team,
                                     "b": 1-team if seat == 0 else team, "tieFirst": tie})
            model = models[policy]
            hidden, start = model.initial_hidden(1), torch.ones(1, dtype=torch.bool)
            while True:
                check_budget(deadline)
                bridge.timeout = max(0.1, min(30, deadline-time.monotonic()))
                with torch.no_grad():
                    dist, _, hidden = model.step(tensor_observations([current["observation"][seat]]), hidden, start)
                    own_action = int(dist.sample().item())
                obs=current['observation'][seat]
                if obs['global'][1]:
                    kind=next(k for k in ('attack','defense','status','focus','switch','wait') if obs['actions'][own_action][metadata['schema']['actionNames'].index(k)])
                    behavior[kind]+=1
                    if kind=='focus' and any(p[2] and p[4]>=1 for p in obs['pets'][:6]):behavior['fullEnergyFocus']+=1
                actions = [0, 0]
                actions[seat] = own_action
                actions[1-seat] = current["rules"][1-seat][style]
                result = bridge.request(op="step", actions=[actions], autoReset=False)[0]
                if result["done"]:
                    reward = result["rewards"][seat]
                    rows.append({"case": case, "team": team, "opponentTeam": 1-team,
                                 "policy": policy, "seat": seat, "tieFirst": tie,
                                 "opponentStyle": style, "seed": seed+case,
                                 "return": reward, **result["terminal"]})
                    break
                current, start = result["next"], torch.zeros(1, dtype=torch.bool)
    wins = sum(row["return"] == 1 for row in rows)
    losses = sum(row["return"] == -1 for row in rows)
    caps = len(rows)-wins-losses
    return {"split": split, "battles": len(rows), "wins": wins, "losses": losses,
            "roundCaps": caps, "winFraction": wins/len(rows), "roundCapFraction": caps/len(rows),
            "meanReturn": (wins-losses)/len(rows), "rows": rows, "behavior":dict(behavior),
            "interpretation": "Two held-out configurations, simple visible-only rules; repeated seats are not independent matchups. Round caps are reported separately, not natural draws."}


def choose_opponent(rng, archive):
    choice = rng.random()
    mode = "self" if choice < .5 else "rule" if choice < .75 or not archive else "history"
    model = archive[int(rng.integers(len(archive)))] if mode == "history" else None
    return {"mode": mode, "side": int(rng.integers(2)), "style": "support" if rng.random()<.5 else "attack",
            "model": model, "hidden": model.initial_hidden(1) if model else None}


def run_experiment(config, output, node=None):
    if (output / "report.json").exists():
        raise FileExistsError("Experiment already exists; choose a new output directory")
    started = time.monotonic()
    deadline = started + config["maxSeconds"]
    output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(config["threads"])
    torch.manual_seed(config["seed"])
    rng = np.random.default_rng(config["seed"])
    report = {"scope": "prototype-only", "status": "running", "config": config,
              "apiCalls": 0, "apiTokens": 0, "canPublishBalanceConclusion": False,
              "trainingSteps": 0, "completedTrainingGames": 0, "trainingRoundCaps": 0,
              "opponentDecisionCounts": {"self": 0, "rule": 0, "history": 0}, "updates": [],
              "limits": ["10 forms / 42 skills, not full game", "provisional visibility protocol",
                         "architectures use the same view; original omniscient linear agent is excluded",
                         "no optimal build search or balance conclusions", "terminal prototype round caps receive zero return",
                         "model checkpoints do not resume in-flight episodes", "validation results do not select teams or certify capability",
                         "test split remains unopened"]}
    try:
        with BattleBridge(node) as bridge:
            metadata = bridge.request(op="init", envs=config["envs"], seed=config["seed"], scope="prototype",trainPool=config.get('trainPool',4))
            schema = metadata["schema"]
            report.update({"environmentHash": metadata["executionHash"], "dataVersion": metadata["dataVersion"],
                           "schema": schema, "split": metadata["split"], "torchVersion": torch.__version__})
            source_hash = hashlib.sha256()
            for name in ("bridge.py", "models.py", "ppo.py", "train.py", "rewards.py", "capabilities.py"):
                source_hash.update(name.encode())
                source_hash.update((ROOT / "learning" / name).read_bytes())
            report["trainerHash"] = source_hash.hexdigest()
            models = [ActorCritic(schema, config["architecture"], config["hidden"]) for _ in range(2)]
            optimizers = [torch.optim.Adam(m.parameters(), lr=config["learningRate"], eps=1e-5) for m in models]
            initial_hashes = [parameter_hash(m) for m in models]
            report["initialHashes"] = initial_hashes
            report["parametersPerAgent"] = sum(p.numel() for p in models[0].parameters())
            report["initialValidation"] = evaluate(models, node, metadata["executionHash"], deadline)
            report['initialCapabilities']=evaluate_capabilities(models,node,deadline)
            report['validationCurve']=[]
            current = metadata["observations"]
            hidden = [m.initial_hidden(config["envs"]) for m in models]
            starts = torch.ones(config["envs"], dtype=torch.bool)
            archive = []
            opponents = [choose_opponent(rng, archive) for _ in current]
            while report["trainingSteps"] < config["steps"]:
                check_budget(deadline)
                horizon = min(config["horizon"], (config["steps"]-report["trainingSteps"])//config["envs"])
                initial_hidden = [h.clone() for h in hidden]
                trajectories = [{k: [] for k in ("observations", "actions", "logp", "values", "rewards", "dones", "starts", "learn")} for _ in range(2)]
                for _ in range(horizon):
                    check_budget(deadline)
                    distributions, values, observations = [], [], []
                    with torch.no_grad():
                        for side in (0, 1):
                            obs = tensor_observations([row["observation"][side] for row in current])
                            distribution, value, hidden[side] = models[side].step(obs, hidden[side], starts)
                            observations.append(obs)
                            distributions.append(distribution)
                            values.append(value)
                        joint = torch.stack([d.sample() for d in distributions], dim=1)
                        learn = torch.ones(config["envs"], 2, dtype=torch.bool)
                        for i, opponent in enumerate(opponents):
                            report["opponentDecisionCounts"][opponent["mode"]] += 1
                            side = opponent["side"]
                            if opponent["mode"] == "self":
                                continue
                            learn[i, side] = False
                            if opponent["mode"] == "rule":
                                joint[i, side] = current[i]["rules"][side][opponent["style"]]
                            else:
                                distribution, _, opponent["hidden"] = opponent["model"].step(
                                    tensor_observations([current[i]["observation"][side]]), opponent["hidden"], starts[i:i+1])
                                joint[i, side] = distribution.sample()[0]
                        logps = [d.log_prob(joint[:, side]) for side, d in enumerate(distributions)]
                    bridge.timeout = max(0.1, min(30, deadline-time.monotonic()))
                    result = bridge.request(op="step", actions=joint.tolist())
                    dones = torch.tensor([r["done"] for r in result], dtype=torch.bool)
                    for side in (0, 1):
                        row = trajectories[side]
                        for key, value in {"observations": observations[side], "actions": joint[:, side],
                                           "logp": logps[side], "values": values[side], "rewards": torch.tensor([r["rewards"][side] for r in result], dtype=torch.float32),
                                           "dones": dones, "starts": starts, "learn": learn[:, side]}.items():
                            row[key].append(value)
                        if config.get('shaping',0):
                            before=visible_potential(observations[side])
                            after=visible_potential(tensor_observations([(r['next'] or current[i])['observation'][side] for i,r in enumerate(result)]))
                            row['rewards'][-1]=shape_rewards(row['rewards'][-1],before,after,dones,config['shaping'])
                    report["trainingSteps"] += config["envs"]
                    for i, result_row in enumerate(result):
                        if result_row["done"]:
                            report["completedTrainingGames"] += 1
                            report["trainingRoundCaps"] += int(result_row["terminal"]["endReason"] == "prototype-round-cap")
                            opponents[i] = choose_opponent(rng, archive)
                    current, starts = [r["next"] for r in result], dones
                update_logs = []
                for side in (0, 1):
                    check_budget(deadline)
                    with torch.no_grad():
                        _, final_value, _ = models[side].step(tensor_observations([row["observation"][side] for row in current]), hidden[side], starts)
                    trajectory = trajectories[side]
                    batch = {key: torch.stack(value) for key, value in trajectory.items() if key != "observations"}
                    batch["observations"] = {key: torch.stack([v[key] for v in trajectory["observations"]]) for key in trajectory["observations"][0]}
                    batch["initial_hidden"] = initial_hidden[side]
                    batch["advantage"], batch["returns"] = generalized_advantage(batch["rewards"], batch["values"], batch["dones"], final_value)
                    update_logs.append(update_policy(models[side], optimizers[side], batch, epochs=config["epochs"]))
                    hidden[side] = hidden[side].detach()
                report["updates"].append({"trainingSteps": report["trainingSteps"], "agents": update_logs})
                # Archive persists across rollout boundaries; active games retain their sampled opponent.
                if len(report["updates"]) % 2 == 0:
                    archive.extend(frozen(m) for m in models)
                    archive = archive[-8:]
                checkpoint = {"schema": schema, "config": config, "environmentHash": metadata["executionHash"],
                              "trainerHash": report["trainerHash"], "trainingSteps": report["trainingSteps"],
                              "models": [m.state_dict() for m in models], "optimizers": [o.state_dict() for o in optimizers],
                              "scope": "prototype-only", "resumeSupported": False}
                torch.save(checkpoint, output / "model.pt.tmp")
                (output / "model.pt.tmp").replace(output / "model.pt")
                report["finalHashes"] = [parameter_hash(m) for m in models]
                report["elapsedSeconds"] = time.monotonic()-started
                write_json(output / "report.json", report)
                if config.get('evalEvery',0) and report['trainingSteps']%config['evalEvery']==0 and report['trainingSteps']<config['steps']:
                    score=evaluate(models,node,metadata['executionHash'],deadline)
                    report['validationCurve'].append({'trainingSteps':report['trainingSteps'],**score})
                    print(json.dumps({'event':'validation','steps':report['trainingSteps'],'wins':score['wins'],'battles':score['battles']}),flush=True)
            report["trainedValidation"] = evaluate(models, node, metadata["executionHash"], deadline)
            report['trainedCapabilities']=evaluate_capabilities(models,node,deadline)
            report["validationReturnDelta"] = report["trainedValidation"]["meanReturn"]-report["initialValidation"]["meanReturn"]
            report["status"] = "completed"
    except (BudgetExpired, TimeoutError) as exc:
        report["status"], report["error"] = "budget-exhausted", str(exc)
    except Exception as exc:
        report["status"], report["error"] = "failed", f"{type(exc).__name__}: {exc}"
        raise
    finally:
        report["elapsedSeconds"] = time.monotonic()-started
        write_json(output / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", choices=ARCHITECTURES, default=list(ARCHITECTURES))
    parser.add_argument("--seeds", nargs="+", type=int, default=[42, 137, 256])
    parser.add_argument("--steps", type=int, default=1024)
    parser.add_argument("--envs", type=int, default=4)
    parser.add_argument("--max-seconds", type=int, default=180, help="Per-run cumulative budget including evaluations")
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--node")
    parser.add_argument('--shaping',type=float,choices=(0.,1.),default=0.,help='Visible potential difference; 0 keeps terminal-only control')
    parser.add_argument('--eval-every',type=int,default=8192)
    parser.add_argument('--train-pool',type=int,default=4)
    parser.add_argument("--output", type=Path, default=ROOT/".local/deep-rl")
    args = parser.parse_args()
    if not 1 <= args.envs <= 16 or not 1 <= args.threads <= 4 or not 30 <= args.max_seconds <= 600:
        parser.error("envs 1..16, threads 1..4, max-seconds 30..600")
    if not 128 <= args.steps <= 65536 or args.steps % (args.envs*32):
        parser.error("steps 128..65536 and divisible by envs*32")
    if args.eval_every<0 or args.eval_every%(args.envs*32):
        parser.error('eval-every must be zero or a multiple of envs*32')
    if not 4<=args.train_pool<=64:parser.error('train-pool must be 4..64')
    if len(set(args.seeds)) != len(args.seeds) or not 1 <= len(args.seeds) <= 5 or any(s<0 or s>2**31-1 for s in args.seeds):
        parser.error("Use 1..5 distinct seeds in 0..2^31-1")
    if len(set(args.models)) != len(args.models):
        parser.error("Duplicate architecture")
    output = args.output.resolve()
    if not output.is_relative_to(ROOT/".local"):
        parser.error("Training outputs must stay inside the ignored .local directory")
    output.mkdir(parents=True, exist_ok=True)
    summary = {"scope": "engineering-pilot", "apiTokens": 0, "testSplitUsed": False, "runs": []}
    for architecture in args.models:
        for seed in args.seeds:
            config = {"architecture": architecture, "seed": seed, "steps": args.steps, "envs": args.envs,
                      "horizon": 32, "hidden": 64, "epochs": 3, "learningRate": 3e-4,
                      "threads": args.threads, "maxSeconds": args.max_seconds}
            config.update(shaping=args.shaping,evalEvery=args.eval_every,trainPool=args.train_pool)
            print(json.dumps({"event": "start", **config}), flush=True)
            result = run_experiment(config, output/f"{architecture}-{seed}", args.node)
            compact = {key: result.get(key) for key in ("status", "trainingSteps", "completedTrainingGames", "trainingRoundCaps",
                       "parametersPerAgent", "elapsedSeconds", "initialHashes", "finalHashes", "environmentHash", "trainerHash",
                       "validationReturnDelta", "opponentDecisionCounts", "error")}
            compact["config"] = config
            for phase in ("initialValidation", "trainedValidation"):
                compact[phase] = {k: v for k, v in result.get(phase, {}).items() if k != "rows"}
            summary["runs"].append(compact)
            write_json(output/"summary.json", summary)
            print(json.dumps({"event": "finished", "architecture": architecture, "seed": seed,
                              "status": result["status"], "steps": result["trainingSteps"],
                              "seconds": round(result["elapsedSeconds"], 2), "validationReturnDelta": result.get("validationReturnDelta")}), flush=True)
    return 0 if all(r["status"] == "completed" for r in summary["runs"]) else 2


if __name__ == "__main__":
    raise SystemExit(main())
