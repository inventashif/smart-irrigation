"""Simulated DHT22 temperature/humidity sensor.

Slow ambient drift plus measurement noise; a small random chance of a
checksum failure, exactly the case the firmware must report as missing
instead of fabricating.
"""

from __future__ import annotations

import math
import random
import time


class DHT22:
    def __init__(
        self,
        base_temp_c: float = 27.5,
        base_humidity_pct: float = 62.0,
        fail_rate: float = 0.01,
    ) -> None:
        self.base_temp_c = base_temp_c
        self.base_humidity_pct = base_humidity_pct
        self.fail_rate = fail_rate
        self.disconnected = False
        self.pullup_disconnected = False
        self.checksum_fault = False
        self.manual_temp_c: float | None = None
        self.manual_humidity_pct: float | None = None
        self._t0 = time.monotonic()

    def read(self) -> tuple[float | None, float | None, bool]:
        """Returns (temperature_c, humidity_pct, valid)."""
        if self.disconnected or self.pullup_disconnected or self.checksum_fault or random.random() < self.fail_rate:
            return None, None, False
        elapsed = time.monotonic() - self._t0
        if self.manual_temp_c is not None:
            temp = self.manual_temp_c + random.gauss(0.0, 0.05)
        else:
            temp = self.base_temp_c + 0.6 * math.sin(elapsed / 300.0) + random.gauss(0.0, 0.15)
        if self.manual_humidity_pct is not None:
            hum = self.manual_humidity_pct + random.gauss(0.0, 0.2)
        else:
            hum = self.base_humidity_pct + 2.0 * math.cos(elapsed / 420.0) + random.gauss(0.0, 0.6)
        hum = max(0.0, min(100.0, hum))
        return round(temp, 1), round(hum, 1), True
