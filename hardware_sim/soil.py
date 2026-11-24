"""Simulated capacitive soil-moisture sensor with field moisture dynamics.

The soil itself is modelled: irrigation water raises moisture, ambient
evapotranspiration lowers it. The sensor converts moisture to a noisy raw ADC
value using the same dry/wet calibration the firmware uses, so calibration
direction bugs would show up here exactly as on real hardware.
"""

from __future__ import annotations

import random


class SoilMoistureSensor:
    def __init__(
        self,
        dry_adc: int = 3000,
        wet_adc: int = 1200,
        initial_pct: float = 35.0,
        pct_per_litre: float = 6.0,
        drying_pct_per_hour: float = 0.8,
        noise_adc: float = 8.0,
    ) -> None:
        self.dry_adc = dry_adc
        self.wet_adc = wet_adc
        self.moisture_pct = initial_pct
        self.pct_per_litre = pct_per_litre
        self.drying_pct_per_hour = drying_pct_per_hour
        self.noise_adc = noise_adc
        self.disconnected = False
        self.manual_override_pct: float | None = None

    def tick(self, dt_s: float, water_litres: float, rain_pct: float = 0.0) -> None:
        """Advance soil physics by dt_s; water_litres actually delivered."""
        if self.manual_override_pct is not None:
            self.moisture_pct = max(0.0, min(100.0, self.manual_override_pct))
            return
        self.moisture_pct += water_litres * self.pct_per_litre
        if rain_pct > 10.0:
            self.moisture_pct += (rain_pct / 100.0) * 4.5 * (dt_s / 3600.0)
        self.moisture_pct -= self.drying_pct_per_hour * dt_s / 3600.0
        self.moisture_pct = max(0.0, min(100.0, self.moisture_pct))

    def read_adc(self) -> int | None:
        """Raw ADC as the ESP32 would see it. None = disconnected sensor."""
        if self.disconnected:
            return None
        pct = self.manual_override_pct if self.manual_override_pct is not None else self.moisture_pct
        if self.dry_adc > self.wet_adc:
            adc = self.dry_adc - (pct / 100.0) * (self.dry_adc - self.wet_adc)
        else:
            adc = self.dry_adc + (pct / 100.0) * (self.wet_adc - self.dry_adc)
        adc += random.gauss(0.0, self.noise_adc)
        return int(max(0, min(4095, adc)))
