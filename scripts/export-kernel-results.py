"""Publish measured local-run evidence and a readable report; never infer strength scores."""
import argparse
import copy
import difflib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TARGETS=[("pet_000005","水灵"),("pet_000028","奇丽花"),("pet_000076","火焰猿")]


def save(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf-8")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("run",type=Path)
    parser.add_argument("--evidence",default="kernel-ppo-20261018-v4")
    args=parser.parse_args()
    run=args.run.resolve()
    report=json.loads((run/"report.json").read_text(encoding="utf-8"))
    meta=json.loads((run/"manifest.json").read_text(encoding="utf-8"))
    assert report["status"]=="completed" and report["weightsChanged"]
    assert report["environmentHash"]==meta["executionHash"]
    assert meta["traitsIntact"] and not meta["fullRosterAdmission"]
    flat=[h for values in meta["splitHashes"].values() for h in values]
    assert len(flat)==len(set(flat)),"Split contamination"
    for phase in ("selection","initialTest","trainedTest"):
        part=report[phase]
        assert part["battles"]==len(part["rows"])
        assert part["wins"]+part["losses"]+part["roundCaps"]+part["simultaneousKOs"]==part["battles"]
    case_keys=("candidate","split","opponent","policy","seat","tieFirst")
    cases=lambda key:{tuple(r[k] for k in case_keys):r for r in report[key]["rows"]}
    before,after=cases("initialTest"),cases("trainedTest")
    assert before.keys()==after.keys()
    evidence=ROOT/"docs/evidence"/args.evidence
    evidence.mkdir(parents=True,exist_ok=True)
    exported=copy.deepcopy(report)
    exported["config"]["output"]=run.relative_to(ROOT).as_posix()
    save(evidence/"report.json",exported)
    save(evidence/"manifest.json",meta)
    if report.get("evaluationRecovery"):
        current=json.loads((run/"evaluation-manifest.json").read_text(encoding="utf-8"))
        assert current["executionHash"]==report["evaluationRecovery"]["evaluationExecutionHash"]
        assert current["splitHashes"]==meta["splitHashes"] and current["schema"]==meta["schema"]
        save(evidence/"evaluation-manifest.json",current)
        delta="".join(difflib.unified_diff((run/"bridge-before-output-fix.mjs").read_text(encoding="utf-8").splitlines(True),
            (ROOT/"scripts/kernel-learning-bridge.mjs").read_text(encoding="utf-8").splitlines(True),
            fromfile="training-bridge",tofile="evaluation-bridge"))
        (evidence/"replay-output-fix.diff").write_text(delta,encoding="utf-8")
    initial,trained=report["initialTest"],report["trainedTest"]
    review_note = (
        "> **2026-10-18 复审：撤回对配队筛选有效性的判断。** 本文保留历史构筑和原始计数供排错，不作为配队推荐、个体强度或平衡结论。水灵＋彩蝶鲨训练覆盖不足，选中队伍携带落雨但没有水系攻击技能；完整审查见 [雨天小轴复审](rain-core-review-2026-10-18.md)。"
        if args.evidence == "kernel-ppo-20261018-v4"
        else "> **仅为工程记录：未验证配队研究有效性。** 不作为配队推荐、个体强度或平衡结论。"
    )
    lines=["# 双智能体训练工程记录（配队研究未通过审查）", "", "2026-10-18 · 私人项目 · 受限规则实验", "", review_note, "",
           f"已完成 **{report['trainingSteps']:,} 步环境交互、{report['completedTrainingGames']:,} 场训练对局**。两个独立实体 GRU 策略通过 PPO 更新；冻结后，在相同留出条件上，未训练模型胜 {initial['wins']}/{initial['battles']} 场，训练后胜 {trained['wins']}/{trained['battles']} 场。", "",
           "这个结果仅记录策略参数更新后，对这组固定规则对手的胜局变化。它没有验证真实游戏中的配队协同，也没有完成用户要求的配队研究。以下队伍不作为推荐。", "",
           "## 留出测试结果", "",
           "| 固定在队中的研究对象 | 未训练模型胜局 | 训练后胜局 | 训练后负局 | 达到回合上限 | 不同对手构筑 |",
           "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for t in report["teams"]:
        name=TARGETS[t["candidate"]//12][1]; a,b=t["initialTest"],t["trainedTest"]
        lines.append(f"| {name} | {a['wins']}/{a['battles']} | {b['wins']}/{b['battles']} | {b['losses']} | {b['roundCaps']} | 8 |")
    lines += ["", "每个研究对象对应一支筛选后队伍，面对 8 支测试对手构筑；每个对位使用 2 个冻结策略、2 个座位和 2 个固定同速优先方，共 64 场。重复座位与优先方不是新的独立对位，不据此制作置信区间或宣称统计显著。对手为固定的可见信息规则策略，尚未经过专家策略或真人检验。", "",
              f"未训练模型达到回合上限 {initial['roundCaps']} 场，训练后 {trained['roundCaps']} 场。80 回合上限属于实验预算，计为截断，不能当作游戏判定的平局。", "",
              "| 独立策略 | 未训练胜局 | 训练后胜局 | 训练后截断 |", "| --- | ---: | ---: | ---: |"]
    for policy in (0,1):
        a=[x for x in initial['rows'] if x['policy']==policy];b=[x for x in trained['rows'] if x['policy']==policy]
        lines.append(f"| 策略 {policy+1} | {sum(x['outcome']=='win' for x in a)}/{len(a)} | {sum(x['outcome']=='win' for x in b)}/{len(b)} | {sum(x['outcome']=='round-cap' for x in b)} |")
    lines += ["", "## 筛选出的候选队伍", "",
              "各目标先随机生成 12 套合法的受限构筑，再由冻结策略在 4 支验证对手上筛选 1 套。筛选分数约定为胜 1 分、负 0 分、截断或同时倒下 0.5 分。测试对手未参与筛选；配队本身由采样与筛选产生，尚不是强化学习自动生成。", ""]
    for team in report["teams"]:
        target,name=TARGETS[team["candidate"]//12]
        rows=[r for r in trained["rows"] if r["candidate"]==team["candidate"]]
        enters=sum(r["targetActivity"]["entries"]>0 for r in rows)
        moves=sum(r["targetActivity"]["moves"] for r in rows)
        damage=sum(r["targetActivity"]["directDamage"] for r in rows)
        lines += [f"### {name}所在队伍", "",
                  f"验证阶段胜 {team['validation']['wins']}/{team['validation']['battles']} 场；最终测试胜 {team['trainedTest']['wins']}/{team['trainedTest']['battles']} 场。", "",
                  "| 成员 | 原有特性 | 四个技能 | 性格 | 三项资质加成 |",
                  "| --- | --- | --- | --- | --- |"]
        labels={"hp":"生命","atk":"物攻","def":"物防","spa":"魔攻","spd":"魔防","spe":"速度"}
        for p in team["members"]:
            iv="、".join(f"{labels[k]} {v}" for k,v in p["ivs"].items() if v)
            lines.append(f"| {p.get('title',p['name'])}{'（研究对象）' if p['id']==target else ''} | {p['trait']} | {' / '.join(p['moveNames'])} | {p['nature']} | {iv} |")
        lines += ["",f"{name}在 {enters}/{len(rows)} 场测试中实际登场，共使用 {moves} 次技能，记录到的直接攻击伤害合计 {damage:,}。这些是活动记录，不是净贡献；没有登场也可能存在场下特性影响。尚未通过合法替代与重新适应实验区分个体、搭档和对手的贡献。", ""]
    coverage=report["trainingCoverage"]
    lines += ["## 运行范围和可复查证据", "",
              f"- 来源范围：259 个最高常规形态候选。当前可执行池为 {meta['executableForms']} 个形态，实际训练队伍涉及 {len(coverage['formsInTrainingTeams'])} 个，实际登场 {len(coverage['formsActuallyEntered'])} 个，实际执行 {len(coverage['movesActuallyUsed'])} 个不同技能。",
              "- 每队始终六只、每只四个已实现的来源合法技能；保留各自原有特性。没有用空操作代替未实现的技能或特性。每队同图鉴编号只采用一个形态，季节形态仍可作为不同候选参与搜索；这是本轮实验约束，不代表已核实正式服的同种限制。",
              "- 60 级、五星基准；从进攻、速度、耐久三种培养预设中采样。没有完成性格、资质、配招和血脉的全局最优搜索。血脉固定 ID 2；共鸣、愿力与首领化未参加本轮。",
              f"- {len(meta['teams']['train'])} 支训练构筑，36 支候选构筑，4 支验证对手，8 支测试对手。完整构筑哈希互不重复，但成员与技能可以重叠，这是构筑留出，不是全新精灵泛化。",
              f"- 训练种子 {report['seed']}，构筑种子 {report['config']['pool_seed']}；每个智能体 {report['parametersPerAgent']:,} 个参数。共 {report['agentDecisions']:,} 次双方动作选择，训练完成 {report['completedTrainingGames']} 场，其中 {report['trainingRoundCaps']} 场达到回合上限。",
              "- 训练主要为两个独立策略自博弈，每第四轮混入可见信息规则对手。采用合法动作掩码、GRU 记忆、GAE 和 PPO；奖励为终局胜负加可见局面势函数差，不查询大模型。",
              f"- 本次总耗时 {report['elapsedSeconds']:.1f} 秒；本地训练／评估模型 API 调用 {report['apiCalls']} 次、API token {report['apiTokens']}。开发会话 token 和本地 CPU 时间另计。",
              "- v1 发现印记层数未进入观察向量；v2 暴露聚盐成长被按每次连击重复结算；v3 的配队池允许同图鉴编号的不同季节形态同队。已补齐输入、修正结算并按图鉴编号约束配队。v1—v3 均保留在本地且不纳入本报告；本报告只使用 v4，构筑种子为 20261021。",
              "- 聚盐现在按每段回复生命、每次使用只增加 1 次永久连击，连续三次使用对应 2／3／4 连击。回放保留全部动作，事件样例最多导出前 5000 条，并标注截断；活动统计从完整事件流单独计算。", "",
              "完整特性只表示执行器没有关闭特性；不表示所有时点、数值与正式服一致。当前仍缺全图鉴技能池、特殊机制、实机逐事件对照，以及双方针对性反制训练。", "",
              f"[逐局结果、梯度与参数校验值](evidence/{args.evidence}/report.json) · [训练／验证／测试构筑和范围](evidence/{args.evidence}/manifest.json) · [核验与旧实验排除记录](evidence/{args.evidence}/verification.json)", "",
              f"模型权重和代表性回放保存在仓库的 `{run.relative_to(ROOT).as_posix()}/`，不随 Git 提交。", "",
              "## 复现", "", "```powershell",
              "$env:ROCO_NODE='你的 node.exe 绝对路径'",
              "& .venv-rl/Scripts/python.exe -m learning.kernel_train --steps 32768 --pool-seed 20261021 --output .local/kernel-ppo-reproduce",
              "```", "", "输出目录必须是尚不存在的新目录。完整图鉴研究入口仍由原有核验门槛控制，本实验使用独立的 `experimental-training` 范围。", ""]
    path=ROOT/"docs/kernel-ppo-results-2026-10-18.md"
    path.write_text("\n".join(lines),encoding="utf-8")
    print(json.dumps({"report":str(path),"evidence":str(evidence),"winsBefore":initial["wins"],"winsAfter":trained["wins"]},ensure_ascii=False))


if __name__=="__main__":main()
