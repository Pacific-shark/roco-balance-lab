# 本地 PPO 与冻结配队试点

2026-10-16 · 当前实现说明

**评价路线更新：** 主流程保留全部特性，模型比较使用 [共同冻结对手交叉评估](algorithm-plan-v5.md)。下文第 3 步是历史诊断复现，需要显式参数；它不再作为精灵强度或特色的主要评价。

实际成绩、失败案例和解释见 [训练与配队试点结果](learning-results-2026-10-16.md)。[第一轮文档](learning-pilot-v1.md)作为历史记录保留；其中的“尚未接入工作台”等状态仅对应 v1。

## 训练如何实现

Node.js 复用同一个 6v6 原型执行器，Python/PyTorch 通过隐藏子进程管道收集轨迹。双方动作提交后统一结算。模型使用两个独立参数的 Actor-Critic，通过 PPO、GAE、价值损失和熵奖励学习，不调用语言模型逐回合判断。

| 部分 | 当前实现 |
| --- | --- |
| 信息 | `visible-vector-2-provisional`；12×104 精灵字段、24 全局字段、12×187 行动字段及掩码；未知对方面板不输入网络 |
| 行动 | 4 技能槽、聚能、6 换人槽、等待；概率分布和引擎双重合法检查 |
| 架构 | 线性、两层 MLP、共享实体编码＋行动条件打分、相同实体编码＋GRU |
| 对手 | 当前策略、规则策略、最近历史快照；本局对手不会中途替换 |
| 奖励 | 胜 +1、负 −1，原型回合上限 0；可选可见势函数差分，终局势函数为 0 |
| 更新 | GAE γ=.99、λ=.95；PPO clip=.2；价值系数 .5；梯度上限 .5；每次 3 轮更新 |
| 基础训练 | 学习率 3e−4，熵 .01；4 环境×32 步采集；最多 64 套训练构筑；本轮用 32 套 |
| 局部补训 | 只支持实体 MLP；学习率 1e−4、熵 .02；实际终局 PPO＋父策略 KL 系数 .2 |
| 记录 | 参数、环境及训练源码哈希，实际对手构成，梯度与损失，行为计数，逐局验证和能力题 |

GRU 在新对局重置记忆；按序列更新，使用采集时起始隐状态做截断反向传播，没有完整历史重算或 burn-in。共享编码不等于已证明未见物种泛化。

基础训练每 8,192 步验证一次。训练／验证／测试按完整构筑去重，两个留出验证构筑和两个测试构筑固定生成。本轮模型开发观察过验证结果；测试在候选锁定后才运行。只有两套对手构筑，不能用重复座位和随机种子制造独立样本量。

## 从训练到研究

以下在项目根目录运行，输出目录必须新建且在忽略的 `.local` 下。需要 Python 3.12、Node.js 24+；依赖在项目 `.venv-rl`。已有环境无需重装。

```powershell
python -m venv .venv-rl
.venv-rl/Scripts/python.exe -m pip install torch==2.14.1+cpu --index-url https://download.pytorch.org/whl/cpu
.venv-rl/Scripts/python.exe -m pip install numpy==2.3.4
# Node 不在 PATH 时：$env:ROCO_NODE = '实际的 node.exe 路径'

# 1. 两种实体模型，同输入同预算，三个种子全部保留。
.venv-rl/Scripts/python.exe -m learning.train --models entity_mlp entity_gru --seeds 42 137 256 --steps 32768 --envs 4 --max-seconds 480 --threads 1 --shaping 1 --train-pool 32 --output .local/my-base

# 2. 每个实体 MLP 从自己的基础权重补训；不使用 GRU 的最好种子替换。
foreach ($seed in 42,137,256) {
  .venv-rl/Scripts/python.exe -m learning.resource_curriculum ".local/my-base/entity_mlp-$seed/model.pt" --steps-per-agent 2048 --max-seconds 240 --output ".local/my-mixed/entity_mlp-$seed"
  .venv-rl/Scripts/python.exe -m learning.resource_outcomes --before ".local/my-base/entity_mlp-$seed/model.pt" --after ".local/my-mixed/entity_mlp-$seed/model.pt"
}

# 3. 仅在需要复现历史诊断时显式开启；新模型比较见 algorithm-plan-v5.md。
.venv-rl/Scripts/python.exe -m learning.research .local/my-mixed/entity_mlp-42/model.pt .local/my-mixed/entity_mlp-137/model.pt .local/my-mixed/entity_mlp-256/model.pt --target pet_000028 --candidates 6 --max-seconds 360 --legacy-trait-diagnostic --output .local/my-study/report.json

# 4. 重算分母和逐局胜负后生成工作台摘要。
.venv-rl/Scripts/python.exe -m learning.audit --groups my-base my-mixed --research .local/my-study/report.json
pnpm build
pnpm start
```

打开工作台“学习验证”。该页显示归档证据，**不会在点击时启动训练**。原有“创建实验”仍是旧轻量流程。上述命令在不同机器上可能先达到累计预算；报告会如实保存状态，不保证所有设备在同一墙钟时间内完成。

基础训练 `--max-seconds` 按每个架构、每个种子计，含评估；预算在环境步和更新边界检查，单次更新可能有少量超时。默认 1 CPU 线程。检查点可以用于冻结评估，尚不支持完整随机状态、对局和历史池的无损续训。补训检查点不保留失效的父优化器状态。

模型、数据库、运行缓存留在 `.local` 和 `.venv-rl`，不上传 GitHub。训练、评估及本地 UI 均不调用大模型 API；开发对话成本另计。

## 验证和后续边界

```powershell
node --test --test-isolation=none test/*.test.mjs
.venv-rl/Scripts/python.exe -m unittest discover -s test -p 'learning*_test.py' -v
```

检查覆盖动作掩码、观察隔离、GRU 重置、GAE 终止边界、PPO 裁剪、真正学会奖励动作、势函数消去、前馈向量化等价、训练与推理桥一致、构筑去重、能力题可解、配对干预和报告计数。

本轮配队没有逐候选重训、多代搜索、最优培养搜索。MAP-Elites、LightGBM 辅助筛选、PSRO、同定位替换和双边适应均未实现。更高的验证分不能替代完整机制核准。执行范围仍为 10 形态、42 技能，正式强度入口关闭。

算法依据：[PPO](https://arxiv.org/abs/1707.06347)、[Deep Sets](https://arxiv.org/abs/1703.06114)、[势函数奖励塑形](https://people.eecs.berkeley.edu/~pabbeel/cs287-fa09/readings/NgHaradaRussell-shaping-ICML1999.pdf)。这些文献提供方法背景，不为本游戏原型的强度判断背书。
