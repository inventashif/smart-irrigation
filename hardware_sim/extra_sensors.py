"""Simulated Rain, Ultrasonic Tank Level, and LDR Light sensors."""

from __future__ import annotations

import math
import random
import time


class RainSensor:
    """Resistive/capacitive rain-drop board on GPIO34 (ADC1)."""

    def __init__(self, initial_pct: float = 0.0) -> None:
        self.rain_pct = max(0.0, min(100.0, initial_pct))
        self.manual_override: float | None = None
        self.disconnected = False

    def tick(self, dt_s: float) -> None:
        if self.manual_override is not None:
            self.rain_pct = max(0.0, min(100.0, self.manual_override))
            return
        if self.rain_pct > 0.0:
            self.rain_pct = max(0.0, self.rain_pct - 1.5 * dt_s / 60.0)

    def read(self) -> tuple[float | None, int | None]:
        if self.disconnected:
            return None, None
        pct = max(0.0, min(100.0, self.rain_pct + random.gauss(0.0, 0.3)))
        raw_adc = int(max(50, min(4040, 4000 - (pct / 100.0) * 3200)))
        return round(pct, 1), raw_adc


class WaterTankSensor:
    """HC-SR04 ultrasonic tank-level sensor on GPIO26 (TRIG) / GPIO14 (ECHO)."""

    def __init__(self, capacity_litres: float = 50.0, initial_pct: float = 82.0) -> None:
        self.capacity_litres = max(5.0, capacity_litres)
        self.litres = self.capacity_litres * max(0.0, min(100.0, initial_pct)) / 100.0
        self.manual_override_pct: float | None = None
        self.trig_disconnected = False
        self.echo_disconnected = False

    @property
    def disconnected(self) -> bool:
        return self.trig_disconnected or self.echo_disconnected

    @disconnected.setter
    def disconnected(self, value: bool) -> None:
        flag = bool(value)
        self.trig_disconnected = flag
        self.echo_disconnected = flag

    @property
    def level_pct(self) -> float:
        if self.manual_override_pct is not None:
            return max(0.0, min(100.0, self.manual_override_pct))
        return round(100.0 * self.litres / self.capacity_litres, 1)

    def set_level_pct(self, pct: float) -> None:
        pct = max(0.0, min(100.0, pct))
        self.litres = self.capacity_litres * pct / 100.0
        if self.manual_override_pct is not None:
            self.manual_override_pct = pct

    def tick(self, dt_s: float, pumped_litres: float, rain_pct: float = 0.0) -> None:
        if self.manual_override_pct is not None:
            self.litres = self.capacity_litres * self.manual_override_pct / 100.0
            return
        self.litres -= max(0.0, pumped_litres)
        if rain_pct > 15.0:
            self.litres += (rain_pct / 100.0) * 0.25 * (dt_s / 60.0)
        self.litres = max(0.0, min(self.capacity_litres, self.litres))

    def read(self) -> tuple[float | None, float | None]:
        if self.disconnected:
            return None, None
        pct = max(0.0, min(100.0, self.level_pct + random.gauss(0.0, 0.15)))
        litres = round(self.capacity_litres * pct / 100.0, 2)
        return round(pct, 1), litres


class LightSensor:
    """LDR photoresistor voltage divider on GPIO35 (ADC1)."""

    def __init__(self, base_pct: float = 68.0) -> None:
        self.base_pct = max(0.0, min(100.0, base_pct))
        self.manual_override: float | None = None
        self.disconnected = False
        self._t0 = time.monotonic()

    def read(self) -> tuple[float | None, int | None]:
        if self.disconnected:
            return None, None
        if self.manual_override is not None:
            pct = self.manual_override
        else:
            elapsed = time.monotonic() - self._t0
            pct = self.base_pct + 6.0 * math.sin(elapsed / 240.0) + random.gauss(0.0, 0.5)
        pct = max(0.0, min(100.0, pct))
        lux = int(round((pct / 100.0) ** 1.7 * 45000))
        return round(pct, 1), lux
