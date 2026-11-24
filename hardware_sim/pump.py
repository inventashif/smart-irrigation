"""Simulated relay module + DC water pump.

The pump needs a short priming delay after the relay energizes before water
actually flows — the case the flow sensor exists to detect ("pump commanded
ON" vs "water actually moving").
"""

from __future__ import annotations


class PumpRelay:
    def __init__(self, flow_lpm: float = 2.5, priming_s: float = 2.0) -> None:
        self._rated_flow_lpm = flow_lpm
        self._priming_s = priming_s
        self._commanded_on = False
        self._on_time_s = 0.0
        self.relay_disconnected = False
        self.power_disconnected = False
        self.flyback_diode_connected = True
        self.emi_back_emf_events = 0
        self.dry_blocked = False

    @property
    def rated_flow_lpm(self) -> float:
        return self._rated_flow_lpm

    @rated_flow_lpm.setter
    def rated_flow_lpm(self, value: float) -> None:
        self._rated_flow_lpm = max(0.2, min(12.0, float(value)))

    @property
    def priming_s(self) -> float:
        return self._priming_s

    @priming_s.setter
    def priming_s(self, value: float) -> None:
        self._priming_s = max(0.0, min(10.0, float(value)))

    def set(self, on: bool) -> None:
        was_running = self._commanded_on and not self.relay_disconnected and not self.power_disconnected
        if self.relay_disconnected:
            self._commanded_on = False
            self._on_time_s = 0.0
            return
        if on and not self._commanded_on:
            self._on_time_s = 0.0
        if not on and was_running and not self.flyback_diode_connected:
            self.emi_back_emf_events += 1
        self._commanded_on = on
        if not on:
            self._on_time_s = 0.0

    @property
    def is_on(self) -> bool:
        return self._commanded_on and not self.relay_disconnected

    @property
    def is_priming(self) -> bool:
        return (
            self.is_on
            and not self.power_disconnected
            and not self.dry_blocked
            and self._on_time_s < self._priming_s
        )

    @property
    def on_time_s(self) -> float:
        return self._on_time_s if self.is_on else 0.0

    def tick(self, dt_s: float) -> None:
        if self.is_on:
            self._on_time_s += dt_s

    @property
    def flow_lpm(self) -> float:
        """Actual water flow right now (0 until primed or if unpowered/empty)."""
        if not self.is_on or self.power_disconnected or self.dry_blocked:
            return 0.0
        if self._on_time_s < self._priming_s:
            return 0.0
        return self._rated_flow_lpm
