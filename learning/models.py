"""Three architectures sharing identical visible observations and action masks."""
from __future__ import annotations
import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical

ARCHITECTURES = ("linear", "mlp", "entity_mlp", "entity_gru")


def tensor_observations(rows):
    return {key: torch.as_tensor(np.asarray([r[key] for r in rows]),
                               dtype=torch.bool if key == "mask" else torch.float32)
            for key in ("pets", "global", "actions", "mask")}


def masked_distribution(logits, mask):
    if logits.shape != mask.shape or not mask.any(dim=-1).all():
        raise ValueError("Every decision needs a correctly shaped nonempty legal-action mask")
    return Categorical(logits=logits.masked_fill(~mask, -torch.inf))


class ActorCritic(nn.Module):
    def __init__(self, schema, architecture="entity_gru", hidden=64):
        super().__init__()
        if architecture not in ARCHITECTURES:
            raise ValueError("Unknown architecture")
        self.schema = schema
        self.architecture = architecture
        self.hidden_size = hidden
        pet_dim, action_dim, global_dim = (schema[k] for k in ("petDim", "actionDim", "globalDim"))
        flat_dim = 12 * pet_dim + 12 * action_dim + global_dim
        if architecture == "linear":
            self.body = nn.Identity()
            self.actor = nn.Linear(flat_dim, 12)
            self.critic = nn.Linear(flat_dim, 1)
        elif architecture == "mlp":
            self.body = nn.Sequential(nn.Linear(flat_dim, hidden), nn.Tanh(), nn.Linear(hidden, hidden), nn.Tanh())
            self.actor = nn.Linear(hidden, 12)
            self.critic = nn.Linear(hidden, 1)
        else:
            self.pet_encoder = nn.Sequential(nn.Linear(pet_dim, hidden), nn.Tanh())
            self.context = nn.Sequential(nn.Linear(4 * hidden + global_dim, hidden), nn.Tanh())
            self.memory = nn.GRUCell(hidden, hidden) if architecture=='entity_gru' else None
            self.action_encoder = nn.Sequential(nn.Linear(action_dim, hidden), nn.Tanh())
            self.actor = nn.Sequential(nn.Linear(2 * hidden, hidden), nn.Tanh(), nn.Linear(hidden, 1))
            self.critic = nn.Linear(hidden, 1)
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.orthogonal_(module.weight, gain=1.0)
                nn.init.zeros_(module.bias)
        actor_output = self.actor[-1] if isinstance(self.actor, nn.Sequential) else self.actor
        nn.init.orthogonal_(actor_output.weight, gain=0.01)

    def initial_hidden(self, batch):
        return torch.zeros(batch, self.hidden_size)

    def step(self, observation, hidden, episode_start):
        pets, actions, global_obs = (observation[k] for k in ("pets", "actions", "global"))
        if self.architecture in ('linear','mlp'):
            x = self.body(torch.cat((pets.flatten(1), actions.flatten(1), global_obs), dim=-1))
            return masked_distribution(self.actor(x), observation["mask"]), self.critic(x).squeeze(-1), hidden * 0
        # Pool only present entities. Unknown opponent members are not zero-valued known pets.
        embedding = self.pet_encoder(pets)
        present = pets[:, :, 0:1]
        active = pets[:, :, 2:3]
        pooled = []
        for part in (slice(0, 6), slice(6, 12)):
            part_e, part_m = embedding[:, part], present[:, part]
            pooled.append((part_e * part_m).sum(1) / part_m.sum(1).clamp_min(1))
            pooled.append((part_e * active[:, part]).sum(1))
        x = self.context(torch.cat((*pooled, global_obs), dim=-1))
        hidden = hidden * (~episode_start.bool()).unsqueeze(-1)
        hidden = self.memory(x, hidden) if self.memory is not None else x
        action_embedding = self.action_encoder(actions)
        context = hidden[:, None, :].expand(-1, 12, -1)
        logits = self.actor(torch.cat((context, action_embedding), dim=-1)).squeeze(-1)
        return masked_distribution(logits, observation["mask"]), self.critic(hidden).squeeze(-1), hidden

    def sequence(self, observations, initial_hidden, episode_starts):
        if self.architecture != 'entity_gru':
            # Feedforward models have no temporal dependence; evaluate the batch
            # in one operation without changing sequence alignment or masks.
            time, batch = episode_starts.shape
            flat = {k: v.reshape(time*batch, *v.shape[2:]) for k,v in observations.items()}
            distribution, value, _ = self.step(flat, self.initial_hidden(time*batch), episode_starts.reshape(-1))
            return Categorical(logits=distribution.logits.reshape(time,batch,-1)), value.reshape(time,batch)
        hidden = initial_hidden.detach()
        logits, values = [], []
        for t in range(episode_starts.shape[0]):
            distribution, value, hidden = self.step({k: v[t] for k, v in observations.items()}, hidden, episode_starts[t])
            logits.append(distribution.logits)
            values.append(value)
        return Categorical(logits=torch.stack(logits)), torch.stack(values)
