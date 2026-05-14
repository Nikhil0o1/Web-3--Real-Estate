"""Governance caps for autonomous monitoring (spam / runaway prevention)."""
from __future__ import annotations

from dataclasses import dataclass, field

MAX_USERS_PER_TICK = 400
MAX_EVENTS_GLOBAL_PER_TICK = 80
MAX_EVENTS_PER_USER_PER_TICK = 4


@dataclass
class TickBudget:
    remaining_global: int = MAX_EVENTS_GLOBAL_PER_TICK
    per_user: dict[int, int] = field(default_factory=dict)

    def allow(self, user_id: int) -> bool:
        if self.remaining_global <= 0:
            return False
        u = int(user_id)
        if self.per_user.get(u, 0) >= MAX_EVENTS_PER_USER_PER_TICK:
            return False
        return True

    def consume(self, user_id: int) -> None:
        u = int(user_id)
        self.remaining_global -= 1
        self.per_user[u] = self.per_user.get(u, 0) + 1
