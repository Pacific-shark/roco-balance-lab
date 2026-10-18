"""Local two-agent PPO on explicit incomplete-rule builds. No model API calls.

python -m learning.kernel_train --steps 16384 --output .local/kernel-ppo-20261018-v1
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import tempfile
import time
from collections import Counter
import numpy as np
import torch

from .bridge import BattleBridge, ROOT
from .models import ActorCritic, tensor_observations, masked_distribution
from .ppo import generalized_advantage, update_policy


class KernelBridge(BattleBridge):
    def __init__(self, timeout=30):
        executable = os.environ.get("ROCO_NODE") or shutil.which("node")
        if not executable:
            raise RuntimeError("Set ROCO_NODE to local Node.js")
        self.timeout, self.lines = timeout, queue.Queue()
        self.error_file = tempfile.TemporaryFile(mode="w+t", encoding="utf-8")
        self.process = subprocess.Popen(
            [executable, str(ROOT / "scripts/kernel-learning-bridge.mjs")], cwd=ROOT,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.error_file,
            text=True, encoding="utf-8", bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        def read():
            for line in self.process.stdout:
                self.lines.put(line)
            self.lines.put(None)
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def request(self, **payload):
        try:
            return super().request(**payload)
        except RuntimeError as exc:
            self.error_file.seek(0)
            diagnostic=self.error_file.read()[-8000:]
            raise RuntimeError(f"{exc}\n{diagnostic}") from exc

    def close(self):
        super().close()
        self.error_file.close()


class KernelActorCritic(ActorCritic):
    """Same entity-GRU architecture, dynamic action count; old checkpoints untouched."""
    def __init__(self, schema, hidden=64):
        super().__init__(schema, "entity_gru", hidden)

    def step(self, observation, hidden, episode_start):
        pets, actions, global_obs = (observation[k] for k in ("pets", "actions", "global"))
        embedding = self.pet_encoder(pets)
        pooled = []
        for part in (slice(0, 6), slice(6, 12)):
            e, present = embedding[:, part], pets[:, part, 0:1]
            pooled.extend([(e*present).sum(1)/present.sum(1).clamp_min(1),
                           (e*pets[:, part, 2:3]).sum(1)])
        x = self.context(torch.cat((*pooled, global_obs), dim=-1))
        hidden = self.memory(x, hidden*(~episode_start.bool()).unsqueeze(-1))
        context = hidden[:, None, :].expand(-1, actions.shape[1], -1)
        action_embedding = self.action_encoder(actions)
        # Associate each switch command with its actual member, so pooled team
        # context does not make healthy teammates indistinguishable.
        switch_embedding = torch.zeros_like(action_embedding)
        switch_embedding[:, 9:15, :] = embedding[:, :6, :]
        logits = self.actor(torch.cat((context, action_embedding+switch_embedding), dim=-1)).squeeze(-1)
        return masked_distribution(logits, observation["mask"]), self.critic(hidden).squeeze(-1), hidden


def write_json(path, value):
    temp = path.with_suffix(path.suffix+".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    temp.replace(path)


def parameter_hash(model):
    digest = hashlib.sha256()
    for name, v in model.state_dict().items():
        digest.update(name.encode())
        digest.update(v.detach().cpu().numpy().tobytes())
    return digest.hexdigest()


def potential(obs):
    p = obs["pets"]
    own = (1-p[:, :6, 3]).sum(-1)/6
    foe = ((1-p[:, 6:, 3])*p[:, 6:, 0]).sum(-1)/6
    return .5*(foe-own)+.5*(obs["global"][:, 6]-obs["global"][:, 7])


def summarize(rows):
    counts = Counter(r["outcome"] for r in rows)
    return {"battles":len(rows),"wins":counts["win"],"losses":counts["loss"],
            "roundCaps":counts["round-cap"],"simultaneousKOs":counts["simultaneous-ko"],
            "winFraction":counts["win"]/len(rows) if rows else None,
            "score":(counts["win"]+.5*(counts["round-cap"]+counts["simultaneous-ko"]))/len(rows) if rows else None}


def evaluate(models, cases, expected_hash, *, pool_seed=20261018, replay_path=None):
    """Greedy policies on fixed held-out opponents; batched, no hidden-state access."""
    rows, behavior, captured = [], Counter(), False
    with KernelBridge() as bridge:
        meta = bridge.request(op="init", envs=1, poolSeed=pool_seed)
        if meta["executionHash"] != expected_hash:
            raise RuntimeError("Training/evaluation execution hashes differ")
        for offset in range(0, len(cases), 8):
            chunk = cases[offset:offset+8]
            if offset%64==0:
                print(json.dumps({"event":"evaluation","split":chunk[0]["split"],"completed":offset,"total":len(cases)}),flush=True)
            current = bridge.request(op="reset", cases=[{
                "a":["candidates", c["candidate"]] if c["seat"]==0 else [c["split"],c["opponent"]],
                "b":[c["split"],c["opponent"]] if c["seat"]==0 else ["candidates",c["candidate"]],
                "tieFirst":c["tieFirst"]} for c in chunk])
            hidden = [models[c["policy"]].initial_hidden(1) for c in chunk]
            done = [False]*len(chunk)
            first = True
            for decision in range(1001):
                if all(done):
                    break
                actions=[]
                with torch.no_grad():
                    for j,c in enumerate(chunk):
                        if done[j]:
                            actions.append(None)
                            continue
                        obs=current[j]["observation"][c["seat"]]
                        dist,_,hidden[j]=models[c["policy"]].step(tensor_observations([obs]),hidden[j],torch.tensor([first]))
                        a=int(dist.logits.argmax(-1).item())
                        pair=list(current[j]["ruleActions"])
                        pair[c["seat"]]=a
                        actions.append(pair)
                        kind="move" if a<8 else "focus" if a==8 else "wait" if a==15 else "switch"
                        behavior[kind]+=1
                first=False
                current=bridge.request(op="step", actions=actions, autoReset=False)
                for j,c in enumerate(chunk):
                    if not done[j] and current[j]["done"]:
                        winner=current[j]["winner"]
                        outcome=("win" if winner==c["seat"] else "loss") if isinstance(winner,int) else winner
                        rows.append({**c,"outcome":outcome,"rounds":current[j]["rounds"],"decisions":decision+1})
                        done[j]=True
            else:
                raise RuntimeError("Evaluation failed to terminate")
            activity=bridge.request(op="activity",targets=[{"id":("pet_000005","pet_000028","pet_000076")[c["candidate"]//12],"side":c["seat"]} for c in chunk])
            for c,counts in zip(chunk,activity):
                row=next(r for r in rows if all(r[k]==v for k,v in c.items()))
                row["targetActivity"]={**counts,
                    "meaning":"Descriptive activity only; not causal marginal contribution."}
            if replay_path and not captured:
                write_json(replay_path,{"cases":chunk,"replays":bridge.request(op="replay")})
                captured=True
    return {**summarize(rows),"rows":rows,"behavior":dict(behavior),
            "opponent":"visible-rule-1","policy":"greedy","independentSeeds":1,
            "interpretation":"Repeated seats/policies share team matchups; not independent population samples."}


def cases_for(candidates, split, opponents, policies=(0,1)):
    return [{"candidate":c,"split":split,"opponent":o,"policy":p,"seat":s,"tieFirst":t}
            for c in candidates for o in range(opponents) for p in policies for s in (0,1) for t in (0,1)]


def run(args):
    output=args.output.resolve()
    if not output.is_relative_to(ROOT/".local"):
        raise ValueError("Run output must remain inside .local")
    output.mkdir(parents=True,exist_ok=False)
    torch.set_num_threads(1)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    started=time.monotonic()
    report={"status":"running","scope":"supported-builds-incomplete-rules","apiCalls":0,"apiTokens":0,
            "seed":args.seed,"trainingSteps":0,"agentDecisions":0,"completedTrainingGames":0,
            "trainingRoundCaps":0,"updates":[],"config":{**vars(args),"output":str(output)},
            "limitations":["107 of 259 source highest-form candidates; incomplete rules and move pools",
                           "All traits intact; resonance and lord mechanics unavailable",
                           "Single seed; three cultivation presets, not globally optimal",
                           "Sampled team search, not learned team generation; rule opponents are weak baselines",
                           "No live-game replay conformance; not real-game strength ranking"]}
    try:
        with KernelBridge() as bridge:
            meta=bridge.request(op="init",seed=args.seed,envs=args.envs,poolSeed=args.pool_seed)
            report["environmentHash"]=meta["executionHash"]
            report["trainerHash"]=hashlib.sha256(b"".join((ROOT/p).read_bytes() for p in
                ("learning/kernel_train.py","learning/models.py","learning/ppo.py","learning/bridge.py"))).hexdigest()
            write_json(output/"manifest.json",{k:v for k,v in meta.items() if k!="current"})
            models=[KernelActorCritic(meta["schema"]) for _ in range(2)]
            initial=[copy.deepcopy(m).eval() for m in models]
            report["parametersPerAgent"]=sum(p.numel() for p in models[0].parameters())
            report["initialHashes"]=[parameter_hash(m) for m in models]
            optimizers=[torch.optim.Adam(m.parameters(),lr=3e-4,eps=1e-5) for m in models]
            current=meta["current"]
            hidden=[m.initial_hidden(args.envs) for m in models]
            starts=torch.ones(args.envs,dtype=torch.bool)
            # Two independent learning agents. Every fourth episode includes the fixed
            # visible-rule opponent; only neural decisions contribute to PPO gradients.
            episode=np.zeros(args.envs,dtype=int)
            rule_side=np.array([i%2 if i%4==0 else -1 for i in range(args.envs)])
            while report["trainingSteps"]<args.steps:
                if time.monotonic()-started>args.max_seconds:
                    raise TimeoutError("Training wall-clock budget reached")
                initial_hidden=[h.detach().clone() for h in hidden]
                trajectories=[{k:[] for k in ("observations","actions","logp","values","rewards","dones","starts","learn")} for _ in range(2)]
                for _ in range(32):
                    obs=[tensor_observations([r["observation"][s] for r in current]) for s in (0,1)]
                    decisions=[]
                    with torch.no_grad():
                        for side in (0,1):
                            dist,values,hidden[side]=models[side].step(obs[side],hidden[side],starts)
                            action=dist.sample()
                            for i in range(args.envs):
                                if rule_side[i]==side: action[i]=current[i]["ruleActions"][side]
                            decisions.append(action)
                            tr=trajectories[side]
                            for key,val in (("observations",obs[side]),("actions",action),("values",values),
                                            ("logp",dist.log_prob(action)),("starts",starts.clone()),
                                            ("learn",torch.tensor(rule_side!=side))):
                                tr[key].append(val)
                    nxt=bridge.request(op="step",actions=torch.stack(decisions,dim=1).tolist(),autoReset=True)
                    dones=torch.tensor([r["done"] for r in nxt],dtype=torch.bool)
                    for side in (0,1):
                        reward=torch.tensor([r["rewards"][side] for r in nxt],dtype=torch.float32)
                        after=potential(tensor_observations([r["observation"][side] for r in nxt]))
                        reward+=.99*torch.where(dones,torch.zeros_like(after),after)-potential(obs[side])
                        trajectories[side]["rewards"].append(reward)
                        trajectories[side]["dones"].append(dones)
                    for i,r in enumerate(nxt):
                        if r["done"]:
                            episode[i]+=1
                            rule_side[i]=((int(episode[i])+i)//4)%2 if (int(episode[i])+i)%4==0 else -1
                            report["completedTrainingGames"]+=1
                            report["trainingRoundCaps"]+=int(r["winner"]=="round-cap")
                    report["trainingSteps"]+=args.envs
                    report["agentDecisions"]+=2*args.envs
                    current,starts=nxt,dones
                logs=[]
                for side in (0,1):
                    with torch.no_grad():
                        _,final_value,_=models[side].step(tensor_observations([r["observation"][side] for r in current]),hidden[side],starts)
                    tr=trajectories[side]
                    batch={k:torch.stack(v) for k,v in tr.items() if k!="observations"}
                    batch["observations"]={k:torch.stack([v[k] for v in tr["observations"]]) for k in tr["observations"][0]}
                    batch["initial_hidden"]=initial_hidden[side]
                    batch["advantage"],batch["returns"]=generalized_advantage(batch["rewards"],batch["values"],batch["dones"],final_value)
                    logs.append(update_policy(models[side],optimizers[side],batch,epochs=3))
                    hidden[side]=hidden[side].detach()
                report["updates"].append({"steps":report["trainingSteps"],"agents":logs})
                if report["trainingSteps"]%1024==0 or report["trainingSteps"]==args.steps:
                    report["elapsedSeconds"]=time.monotonic()-started
                    report["finalHashes"]=[parameter_hash(m) for m in models]
                    torch.save({"schema":meta["schema"],"models":[m.state_dict() for m in models],
                                "initialModels":[m.state_dict() for m in initial],"executionHash":meta["executionHash"],
                                "steps":report["trainingSteps"],"scope":report["scope"],"resumeSupported":False},output/"model.pt.tmp")
                    (output/"model.pt.tmp").replace(output/"model.pt")
                    write_json(output/"report.json",report)
                    print(json.dumps({"event":"training","steps":report["trainingSteps"],"games":report["completedTrainingGames"],"seconds":round(report["elapsedSeconds"],1)}),flush=True)
            report["status"]="trained-evaluating"
            report["trainingCoverage"]=bridge.request(op="stats")
            write_json(output/"report.json",report)
        # Frozen evaluation has its own finite case count; validation selects teams,
        # test is opened once after selection. No test-based model/lineup tuning.
        if args.smoke:
            selection=cases_for([0],"validation",1,policies=(0,))
        else:
            selection=cases_for(range(36),"validation",4,policies=(0,))
        report["selection"]=evaluate(models,selection,meta["executionHash"],pool_seed=args.pool_seed)
        chosen=[]
        for start in (0,12,24):
            options=range(start,start+12) if not args.smoke else ([0] if start==0 else [])
            scored=[]
            for candidate in options:
                r=[x for x in report["selection"]["rows"] if x["candidate"]==candidate]
                scored.append((summarize(r)["score"],candidate))
            if scored:
                chosen.append(sorted(scored,key=lambda r:(-r[0],r[1]))[0][1])
        report["selectedCandidates"]=chosen
        write_json(output/"report.json",report)
        print(json.dumps({"event":"selected","candidates":chosen}),flush=True)
        test_cases=cases_for(chosen,"test",1 if args.smoke else 8)
        report["initialTest"]=evaluate(initial,test_cases,meta["executionHash"],pool_seed=args.pool_seed)
        report["trainedTest"]=evaluate(models,test_cases,meta["executionHash"],pool_seed=args.pool_seed,replay_path=output/"test-replays.json")
        report["status"]="completed"
        report["weightsChanged"]=all(a!=b for a,b in zip(report["initialHashes"],report["finalHashes"]))
        report["teams"]=[{"candidate":i,"members":meta["teams"]["candidates"][i],
                          "validation":summarize([r for r in report["selection"]["rows"] if r["candidate"]==i]),
                          "initialTest":summarize([r for r in report["initialTest"]["rows"] if r["candidate"]==i]),
                          "trainedTest":summarize([r for r in report["trainedTest"]["rows"] if r["candidate"]==i])} for i in chosen]
    except Exception as exc:
        report["status"],report["error"]="failed",f"{type(exc).__name__}: {exc}"
        raise
    finally:
        report["elapsedSeconds"]=time.monotonic()-started
        write_json(output/"report.json",report)
    print(json.dumps({"event":"finished","steps":report["trainingSteps"],"initial":summarize(report["initialTest"]["rows"]),
                      "trained":summarize(report["trainedTest"]["rows"]),"seconds":round(report["elapsedSeconds"],1)}),flush=True)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps",type=int,default=16384)
    parser.add_argument("--envs",type=int,default=4)
    parser.add_argument("--seed",type=int,default=42)
    parser.add_argument("--pool-seed",type=int,default=20261018)
    parser.add_argument("--max-seconds",type=int,default=1200)
    parser.add_argument("--smoke",action="store_true")
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    if not 1<=args.envs<=16 or not 128<=args.steps<=65536 or args.steps%(32*args.envs):
        parser.error("1..16 envs, 128..65536 steps divisible by 32*envs")
    run(args)


if __name__=="__main__":
    main()
