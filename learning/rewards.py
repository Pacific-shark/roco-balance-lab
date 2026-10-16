"""Visible-state potential shaping; terminal potential is always zero."""
from __future__ import annotations
import torch

GAMMA = 0.99


def visible_potential(observation):
    # Known slots are last-seen values. Unknown slots contribute zero observed damage.
    pets = observation['pets']
    own_damage = (1-pets[..., :6, 3]).sum(-1)/6
    enemy_damage = ((1-pets[..., 6:, 3])*pets[..., 6:, 0]).sum(-1)/6
    magic = observation['global'][..., 4]-observation['global'][..., 5]
    return .5*magic + .5*(enemy_damage-own_damage)


def shape_rewards(rewards, before, after, dones, coefficient=1., gamma=GAMMA):
    # A reset observation is never used as the terminal successor potential.
    following = torch.where(dones, torch.zeros_like(after), after)
    return rewards + coefficient*(gamma*following-before)
