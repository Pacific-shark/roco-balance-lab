"""Team-owned resonance slot and finite ledger, separate from battle effects.

The user confirmed one team slot, finite uses, and one evolution per battle.
Unconfirmed use limits and cooldown boundaries remain unset.
"""
from dataclasses import dataclass, replace

MAGICS = {
    'wish-amplification': '愿力强化',
    'evolution-power': '进化之力',
    'photosynthetic-healing': '光合治愈（草魔法）',
}


def resonance_contract():
    reviewed_descriptions = {
        'wish-amplification': {
            'bloodlineScope': 'elemental',
            'temporaryReplacement': 'first-move-slot-for-current-turn',
            'unusedReplacementExpires': 'end-of-activation-turn',
            'expiryEvidence': 'user-confirmed-2026-10-16',
            'expiryDeterminesRefundPolicy': False,
            'historicalMaxUses': 2, 'historicalCooldownTurns': 3,
            'source': 'https://www.taptap.cn/moment/797783824686647996',
            'sourceDate': '2026-04-27',
            'evidence': 'official-video-game-ui-observed-at-35.65s',
            'currentVersionCertified': False,
        },
        'evolution-power': {
            'maxUses': 1,
            'maxUsesEvidence': 'user-confirmed-2026-10-16',
            'hpInheritance': None,
            'otherStateInheritance': None,
            'currentVersionCertified': False,
        },
        'photosynthetic-healing': {
            'bloodlineScope': 'any',
            'immediateHealingPercent': 15,
            'endOfTurnHealingPercent': 15, 'durationTurns': 3,
            'source': 'https://rocom.qq.com/web202507/sub/detail.html?newsid=18852676',
            'effectiveDate': '2026-09-10',
            'modeAdmissionImplied': False,
            'settlementBoundariesVerified': False,
            'currentVersionCertified': False,
        },
    }
    return {
        'version': 'team-resonance-single-slot-v3-user-confirmed-action-budget',
        'slots': 1, 'selectionScope': 'team-before-battle',
        'usageScope': 'team-per-battle', 'resetOnSwitch': False,
        'mutuallyExclusive': list(MAGICS),
        'structuralEvidence': 'user-correction-2026-10-15-team-resonance',
        'consumesRegularAction': False,
        'actionCostEvidence': 'user-confirmed-2026-10-16',
        'eventOrderingVerified': False,
        'options': [{'id': key, 'name': name,
                     'maxUses': 1 if key == 'evolution-power' else None,
                     'maxUsesStatus': 'user-confirmed' if key == 'evolution-power' else 'pending',
                     'cooldownTurns': None,
                     'cooldownStatus': 'pending',
                     'reviewedDescription': reviewed_descriptions.get(key),
                     'parameterStatus': 'partially-user-confirmed' if key == 'evolution-power'
                                        else 'pending-current-mode-verification'} for key, name in MAGICS.items()],
        'knownCandidateSetIsExhaustive': False,
        'ledgerImplemented': True, 'battleEffectsImplemented': False,
    }


@dataclass(frozen=True)
class TeamResonance:
    selected_magic: str
    max_uses: int
    cooldown_turns: int
    uses_spent: int = 0
    cooldown_remaining: int = 0

    def __post_init__(self):
        if not isinstance(self.selected_magic, str) or self.selected_magic not in MAGICS:
            raise ValueError('Exactly one reviewed resonance must occupy the team slot')
        if type(self.max_uses) is not int or self.max_uses < 1:
            raise ValueError('A finite positive use limit is required; unknown is not unlimited')
        if type(self.cooldown_turns) is not int or self.cooldown_turns < 0:
            raise ValueError('Explicit nonnegative cooldown required')
        if type(self.uses_spent) is not int or not 0 <= self.uses_spent <= self.max_uses:
            raise ValueError('Invalid usage ledger')
        if type(self.cooldown_remaining) is not int or not 0 <= self.cooldown_remaining <= self.cooldown_turns:
            raise ValueError('Invalid cooldown ledger')


def check_team_resonance(state, requested):
    reasons = []
    if not isinstance(state, TeamResonance):
        reasons.append('team-resonance-slot-and-ledger-required')
    else:
        if requested != state.selected_magic:
            reasons.append('requested-magic-not-equipped')
        if state.uses_spent >= state.max_uses:
            reasons.append('team-resonance-uses-exhausted')
        if state.cooldown_remaining > 0:
            reasons.append('team-resonance-on-cooldown')
    return reasons


def debit_resonance(state, requested):
    """Ledger update after an accepted activation; does not execute its effect.

    The future engine must call this at the verified activation event, not at
    command selection. All six members must use the same side-owned ledger.
    """
    reasons = check_team_resonance(state, requested)
    if reasons:
        raise ValueError(','.join(reasons))
    return replace(state, uses_spent=state.uses_spent + 1, cooldown_remaining=state.cooldown_turns)


def tick_resonance_cooldown(state):
    """One ledger tick; the real game's tick boundary is still unverified."""
    if not isinstance(state, TeamResonance):
        raise ValueError('Team resonance ledger required')
    return replace(state, cooldown_remaining=max(0, state.cooldown_remaining - 1))
