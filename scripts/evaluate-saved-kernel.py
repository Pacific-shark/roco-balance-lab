"""Continue frozen evaluation after a verified output-only bridge repair."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import torch
from learning.kernel_train import ROOT,KernelBridge,KernelActorCritic,evaluate,cases_for,summarize,parameter_hash,write_json


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("run",type=Path)
    args=parser.parse_args(); out=args.run.resolve()
    assert out.is_relative_to(ROOT/".local")
    report=json.loads((out/"report.json").read_text(encoding="utf-8"))
    manifest=json.loads((out/"manifest.json").read_text(encoding="utf-8"))
    audit=json.loads((out/"transport-fix.json").read_text(encoding="utf-8"))
    before=audit["filesBefore"]
    previous=hashlib.sha256(json.dumps(before,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    assert previous==audit["trainingExecutionHash"]==report["environmentHash"]==manifest["executionHash"]
    changed=[]
    for p,h in before:
        if hashlib.sha256((ROOT/p).read_bytes()).hexdigest()!=h: changed.append(p)
    assert changed==[audit["allowedChangedFile"]],changed
    old_bridge=dict(before)[audit["allowedChangedFile"]]
    assert hashlib.sha256((out/"bridge-before-output-fix.mjs").read_bytes()).hexdigest()==old_bridge
    torch.set_num_threads(1)
    checkpoint=torch.load(out/"model.pt",map_location="cpu",weights_only=True)
    assert checkpoint["executionHash"]==previous and checkpoint["steps"]==report["trainingSteps"]
    with KernelBridge() as bridge: meta=bridge.request(op="init",envs=1,poolSeed=report["config"]["pool_seed"])
    assert meta["schema"]==manifest["schema"] and meta["splitHashes"]==manifest["splitHashes"]
    models=[KernelActorCritic(meta["schema"]) for _ in range(2)]
    initial=[KernelActorCritic(meta["schema"]) for _ in range(2)]
    for m,weights in zip(models,checkpoint["models"]):m.load_state_dict(weights);m.eval()
    for m,weights in zip(initial,checkpoint["initialModels"]):m.load_state_dict(weights);m.eval()
    assert [parameter_hash(m) for m in models]==report["finalHashes"]
    assert [parameter_hash(m) for m in initial]==report["initialHashes"]
    start=time.monotonic(); prior_elapsed=report["elapsedSeconds"]
    report["evaluationRecovery"]={**audit,"previousError":report.pop("error",None),
        "changedFiles":changed,"evaluationExecutionHash":meta["executionHash"],
        "modelWeightsUnchanged":True,"battleObservationAndActionFilesUnchanged":True}
    report["status"]="evaluating-saved-checkpoint"
    write_json(out/"evaluation-manifest.json",{k:v for k,v in meta.items() if k!="current"})
    write_json(out/"report.json",report)
    try:
        seed=report["config"]["pool_seed"]
        report["selection"]=evaluate(models,cases_for(range(36),"validation",4,policies=(0,)),meta["executionHash"],pool_seed=seed)
        chosen=[]
        for start_index in (0,12,24):
            scored=[(summarize([r for r in report["selection"]["rows"] if r["candidate"]==c])["score"],c) for c in range(start_index,start_index+12)]
            chosen.append(sorted(scored,key=lambda r:(-r[0],r[1]))[0][1])
        report["selectedCandidates"]=chosen
        write_json(out/"report.json",report)
        print(json.dumps({"event":"selected","candidates":chosen}),flush=True)
        cases=cases_for(chosen,"test",8)
        report["initialTest"]=evaluate(initial,cases,meta["executionHash"],pool_seed=seed)
        report["trainedTest"]=evaluate(models,cases,meta["executionHash"],pool_seed=seed,replay_path=out/"test-replays.json")
        report["weightsChanged"]=all(a!=b for a,b in zip(report["initialHashes"],report["finalHashes"]))
        report["teams"]=[{"candidate":c,"members":meta["teams"]["candidates"][c],
            "validation":summarize([r for r in report["selection"]["rows"] if r["candidate"]==c]),
            "initialTest":summarize([r for r in report["initialTest"]["rows"] if r["candidate"]==c]),
            "trainedTest":summarize([r for r in report["trainedTest"]["rows"] if r["candidate"]==c])} for c in chosen]
        report["status"]="completed"
    except Exception as exc:
        report["status"]="evaluation-failed";report["error"]=str(exc)
        raise
    finally:
        report["elapsedSeconds"]=prior_elapsed+time.monotonic()-start
        write_json(out/"report.json",report)
    print(json.dumps({"status":report["status"],"initial":summarize(report["initialTest"]["rows"]),"trained":summarize(report["trainedTest"]["rows"])}),flush=True)


if __name__=="__main__":main()
