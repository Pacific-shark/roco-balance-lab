"""Clipped actor-critic PPO with GAE and recurrent sequence minibatches."""
import torch


def generalized_advantage(rewards, values, dones, final_value, gamma=0.99, lam=0.95):
    if rewards.shape != values.shape or dones.shape != rewards.shape:
        raise ValueError("Rollout shapes disagree")
    advantages = torch.zeros_like(rewards)
    carry = torch.zeros_like(final_value)
    next_value = final_value
    for t in reversed(range(len(rewards))):
        alive = (~dones[t]).float()
        delta = rewards[t] + gamma * next_value * alive - values[t]
        carry = delta + gamma * lam * alive * carry
        advantages[t] = carry
        next_value = values[t]
    return advantages, advantages + values


def clipped_loss(new_logp, old_logp, advantages, clip=0.2):
    ratio = (new_logp - old_logp).exp()
    return -torch.minimum(ratio * advantages, ratio.clamp(1 - clip, 1 + clip) * advantages)


def update_policy(model, optimizer, batch, epochs=3, clip=0.2, entropy_coef=0.01):
    learn = batch["learn"].bool()
    if not learn.any():
        return {"updates": 0, "learnedDecisions": 0}
    advantage = batch["advantage"].clone()
    selected = advantage[learn]
    advantage = (advantage - selected.mean()) / selected.std(unbiased=False).clamp_min(1e-6)
    logs = []
    # Whole per-environment sequences retain temporal order; never shuffle timesteps.
    batch_size = learn.shape[1]
    for _ in range(epochs):
        for ids in torch.randperm(batch_size).split(max(1, batch_size // 2)):
            valid = learn[:, ids]
            if not valid.any():
                continue
            obs = {k: v[:, ids] for k, v in batch["observations"].items()}
            distribution, values = model.sequence(obs, batch["initial_hidden"][ids], batch["starts"][:, ids])
            new_logp = distribution.log_prob(batch["actions"][:, ids])
            old_logp = batch["logp"][:, ids]
            policy_loss = clipped_loss(new_logp, old_logp, advantage[:, ids], clip)[valid].mean()
            value_loss = ((values - batch["returns"][:, ids]) ** 2)[valid].mean()
            entropy = distribution.entropy()[valid].mean()
            loss = policy_loss + 0.5 * value_loss - entropy_coef * entropy
            if not torch.isfinite(loss):
                raise FloatingPointError("Non-finite PPO loss")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            if not torch.isfinite(norm):
                raise FloatingPointError("Non-finite gradient")
            optimizer.step()
            log_ratio = (new_logp - old_logp).detach()[valid]
            logs.append({"policyLoss": policy_loss.item(), "valueLoss": value_loss.item(),
                         "entropy": entropy.item(), "gradientNorm": norm.item(),
                         "approxKL": ((log_ratio.exp() - 1) - log_ratio).mean().item()})
    return {"updates": len(logs), "learnedDecisions": int(learn.sum()),
            **{k: sum(x[k] for x in logs) / len(logs) for k in logs[0]}}
