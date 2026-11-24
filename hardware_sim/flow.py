"""Simulated hall-effect flow sensor (YF-S201 class).

Emits pulses proportional to actual water flow; the virtual ESP32 counts them
with an interrupt-style accumulator, exactly like firmware.
"""

from __future__ import annotations

import random


class FlowSensor:
    def __init__(self, pulses_per_litre: float = 450.0) -> None:
        self.pulses_per_litre = pulses_per_litre
        self._pending = 0.0
        self.total_pulses = 0
        self.disconnected = False
        self.divider_gnd_disconnected = False
        self.jammed = False

    def tick(self, dt_s: float, flow_lpm: float) -> None:
        if self.disconnected or self.jammed or flow_lpm <= 0:
            return
        litres = flow_lpm * dt_s / 60.0
        self._pending += litres * self.pulses_per_litre * random.gauss(1.0, 0.02)

    def read_pulses(self) -> int | None:
        """Pulses since last read (interrupt counter semantics). None if missing."""
        if self.disconnected:
            return None
        pulses = int(self._pending)
        self._pending -= pulses
        self.total_pulses += pulses
        return pulses
