"""Virtual ESP32: runs the same control logic as the real firmware.

Reads the simulated hardware (soil ADC, DHT22, flow pulses, rain, tank, light),
uploads telemetry, polls for commands, and acknowledges — implementing the
identical safety contract as firmware/smart_irrigation_esp32.ino:

- pump OFF at boot
- STOP / EMERGENCY STOP override START
- emergency stop latches until explicitly cleared with pump OFF
- sensor faults reported as null, never fabricated
- commands idempotent via command_id; 800 ms relay chatter guard
- max pump run-time cutoff + comms-loss auto-stop + dry-tank cutoff
"""

from __future__ import annotations

import json
import time
import urllib.request
from collections import deque
from datetime import datetime, timezone
from typing import Callable

from .dht22 import DHT22
from .extra_sensors import LightSensor, RainSensor, WaterTankSensor
from .flow import FlowSensor
from .pump import PumpRelay
from .soil import SoilMoistureSensor


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class VirtualESP32:
    FW_VERSION = "esp32-sim-1.2.0"

    def __init__(
        self,
        device_code: str,
        base_url: str,
        soil: SoilMoistureSensor,
        dht22: DHT22,
        flow: FlowSensor,
        pump: PumpRelay,
        rain: RainSensor | None = None,
        tank: WaterTankSensor | None = None,
        light: LightSensor | None = None,
        telemetry_interval_s: float = 15.0,
        poll_interval_s: float = 2.0,
        max_pump_run_s: float = 900.0,
        comms_timeout_s: float = 60.0,
        transport_post: Callable[[str, dict], dict | None] | None = None,
        transport_get: Callable[[str], dict | None] | None = None,
        device_ip: str = "192.168.1.42",
    ) -> None:
        self.device_code = device_code
        self.base_url = base_url.rstrip("/")
        self.soil = soil
        self.dht22 = dht22
        self.flow = flow
        self.pump = pump
        self.rain = rain or RainSensor()
        self.tank = tank or WaterTankSensor()
        self.light = light or LightSensor()
        self.telemetry_interval_s = telemetry_interval_s
        self.poll_interval_s = poll_interval_s
        self.max_pump_run_s = max_pump_run_s
        self.comms_timeout_s = comms_timeout_s
        # Auto-stop thresholds while the pump is running (wet-soil / rain skip;
        # same defaults as the weather advisor and the Lab's rain-skip hint).
        self.soil_wet_stop_pct = 68.0
        self.rain_stop_pct = 25.0
        self._transport_post = transport_post
        self._transport_get = transport_get
        self.device_ip = device_ip

        self.wifi_connected = True
        self.power_5v_connected = True
        self.power_3v3_connected = True
        self.gnd_common_connected = True
        self.led_connected = True

        self._serial_log: deque[dict] = deque(maxlen=80)
        self.reset_boot_state()

    def reset_boot_state(self) -> None:
        """Boot / watchdog reset — mandatory pump OFF."""
        self.pump.set(False)
        self.pump.dry_blocked = False
        self.pump_on = False
        self.safety_lock = False
        self.comms_fault = False
        self.safety_reason = ""
        self.last_command_id: str | None = None
        self.last_state_change = 0.0
        self.pump_started_at: float | None = None
        self._offline_elapsed_s = 0.0
        self.cumulative_litres = 0.0
        self.last_flow_lpm = 0.0
        self._boot_time = time.monotonic()
        self._last_backend_ok = time.monotonic()
        self._last_telemetry = 0.0
        self._last_poll = 0.0
        self._fail_streak = 0
        self.last_payload: dict | None = None
        self._log("BOOT", f"{self.device_code} booted — GPIO27 HIGH (relay OFF), pump safe OFF")

    def _log(self, tag: str, msg: str) -> None:
        self._serial_log.append(
            {"ts": _utcnow_iso(), "tag": tag, "message": msg}
        )

    @property
    def serial_log(self) -> list[dict]:
        return list(self._serial_log)

    # -- actuation ---------------------------------------------------------
    _NORMAL_REASONS = {"", "ok", "running", "command_start", "command_stop", "safety_cleared"}

    def _set_pump(self, on: bool, force: bool = False, reason: str = "") -> None:
        now = time.monotonic()
        if not force and on == self.pump_on:
            return
        if not force and (now - self.last_state_change) < 0.8:
            return
        if on and self.safety_lock:
            return
        if on and not self._rail_5v_powered():
            self._log("WARN", "Start blocked: 5V VIN or Common GND rail open — relay coil unpowered")
            return
        if on and not self.tank.disconnected and self.tank.level_pct <= 2.0:
            self.pump.dry_blocked = True
            self.safety_lock = True
            self.safety_reason = "tank_empty_cutoff"
            self._log("WARN", "Start blocked: water tank empty (<=2%) — safety lock engaged")
            return
        self.pump.set(on)
        self.pump_on = self.pump.is_on if on else False
        self.last_state_change = now
        if self.pump_on:
            self.pump_started_at = now
            self.safety_reason = ""
            self._log("PUMP", "GPIO27 -> LOW (active-low relay energized), priming...")
        else:
            self.pump_started_at = None
            if reason in self._NORMAL_REASONS:
                if not self.safety_lock:
                    self.safety_reason = ""
            else:
                self.safety_reason = reason
            self._log("PUMP", f"GPIO27 -> HIGH (relay OFF){' [' + reason + ']' if reason else ''}")

    # -- HTTP / in-process transport ---------------------------------------
    def _record_backend_ok(self) -> None:
        self._last_backend_ok = time.monotonic()
        self._offline_elapsed_s = 0.0
        self._fail_streak = 0
        if self.comms_fault:
            self.comms_fault = False
            if self.safety_reason == "comms_loss_cutoff":
                self.safety_reason = ""
            self._log("NET", "Backend communication restored")

    def _post(self, path: str, payload: dict) -> dict | None:
        if not self.wifi_connected:
            return None
        if self._transport_post is not None:
            try:
                res = self._transport_post(path, payload)
                if res is not None:
                    self._record_backend_ok()
                return res
            except Exception:
                return None
        try:
            req = urllib.request.Request(
                self.base_url + path,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                self._record_backend_ok()
                return json.loads(r.read().decode())
        except Exception:
            return None

    def _get(self, path: str) -> dict | None:
        if not self.wifi_connected:
            return None
        if self._transport_get is not None:
            try:
                res = self._transport_get(path)
                if res is not None:
                    self._record_backend_ok()
                return res
            except Exception:
                return None
        try:
            with urllib.request.urlopen(self.base_url + path, timeout=10) as r:
                self._record_backend_ok()
                return json.loads(r.read().decode())
        except Exception:
            return None

    # -- sensing -----------------------------------------------------------
    def _sensors_powered(self) -> bool:
        # The on-board AMS1117 is fed from the 5V/VIN rail, so losing 5V also
        # collapses the regulated 3.3V rail that powers every Domain A sensor.
        return (
            self.power_5v_connected
            and self.power_3v3_connected
            and self.gnd_common_connected
        )

    def _rail_5v_powered(self) -> bool:
        return self.power_5v_connected and self.gnd_common_connected

    def _read_soil(self) -> tuple[int | None, float | None]:
        if not self._sensors_powered():
            return None, None
        raw = self.soil.read_adc()
        if raw is None or raw <= 40 or raw >= 4055:
            return None, None
        dry, wet = self.soil.dry_adc, self.soil.wet_adc
        if dry == wet:
            return raw, None
        if dry > wet:
            pct = 100.0 * (dry - raw) / (dry - wet)
        else:
            pct = 100.0 * (raw - dry) / (wet - dry)
        return raw, round(max(0.0, min(100.0, pct)), 1)

    def snapshot_readings(self) -> dict:
        powered_3v3 = self._sensors_powered()
        powered_5v = self._rail_5v_powered()
        raw_adc, moisture = self._read_soil()
        if powered_3v3:
            temp_c, hum_pct, climate_ok = self.dht22.read()
            rain_pct, rain_adc = self.rain.read()
            light_pct, light_lux = self.light.read()
        else:
            temp_c = hum_pct = rain_pct = rain_adc = light_pct = light_lux = None
            climate_ok = False
        if powered_5v:
            tank_pct, tank_l = self.tank.read()
        else:
            tank_pct = tank_l = None
        pump_state = (
            "emergency" if self.safety_lock
            else ("priming" if self.pump.is_priming else ("on" if self.pump_on else "off"))
        )
        return {
            "raw_adc": raw_adc,
            "soil_moisture_pct": moisture,
            "temperature_c": temp_c if climate_ok else None,
            "humidity_pct": hum_pct if climate_ok else None,
            "rain_pct": rain_pct,
            "rain_adc": rain_adc,
            "tank_level_pct": tank_pct,
            "tank_litres": tank_l,
            "light_pct": light_pct,
            "light_lux": light_lux,
            "pump_state": pump_state,
        }

    # -- telemetry ---------------------------------------------------------
    def send_telemetry(self, flow_lpm: float, pulses: int | None) -> bool:
        snap = self.snapshot_readings()
        if not self._rail_5v_powered():
            pulses = None
        payload = {
            "device_code": self.device_code,
            "recorded_at": _utcnow_iso() if self.wifi_connected else None,
            "uptime_ms": int((time.monotonic() - self._boot_time) * 1000),
            "raw_adc": snap["raw_adc"],
            "soil_moisture_pct": snap["soil_moisture_pct"],
            "temperature_c": snap["temperature_c"],
            "humidity_pct": snap["humidity_pct"],
            "flow_rate_lpm": round(flow_lpm, 3) if pulses is not None else None,
            "flow_pulse_count": pulses,
            "cumulative_water_litres": round(self.cumulative_litres, 3) if pulses is not None else None,
            "rain_pct": snap["rain_pct"],
            "light_pct": snap["light_pct"],
            "light_lux": snap["light_lux"],
            "tank_level_pct": snap["tank_level_pct"],
            "tank_litres": snap["tank_litres"],
            "pump_state": "on" if self.pump_on else "off",
            "safety_lock": self.safety_lock,
            "comms_fault": self.comms_fault,
            "fw_version": self.FW_VERSION,
            "ip": self.device_ip if self.wifi_connected else None,
            "simulated": True,
        }
        self.last_payload = payload
        ok = self._post(f"/api/devices/{self.device_code}/telemetry", payload) is not None
        if ok:
            self._fail_streak = 0
            self.comms_fault = False
        else:
            self._fail_streak += 1
            if self._fail_streak >= 3:
                self.comms_fault = True
        return ok

    # -- commands ----------------------------------------------------------
    def _ack(self, command_id: str, accepted: bool, reason: str) -> None:
        self._post(
            f"/api/devices/{self.device_code}/ack",
            {
                "device_code": self.device_code,
                "command_id": command_id,
                "accepted": accepted,
                "pump_state": "on" if self.pump_on else "off",
                "reason": reason,
            },
        )

    def execute_direct(self, command: str) -> tuple[bool, str]:
        """Execute a bench command locally or from polled backend command."""
        accepted, reason = True, "ok"
        if command == "start":
            if self.safety_lock:
                accepted, reason = False, "safety_lock_active"
            elif not self._rail_5v_powered():
                accepted, reason = False, "vin_5v_or_gnd_open"
            elif not self.tank.disconnected and self.tank.level_pct <= 2.0:
                self.pump.dry_blocked = True
                self.safety_lock = True
                self.safety_reason = "tank_empty_cutoff"
                accepted, reason = False, "tank_empty_cutoff"
            else:
                self._set_pump(True, reason="command_start")
                if not self.pump_on:
                    accepted, reason = False, "pump_did_not_engage"
        elif command == "stop":
            self._set_pump(False, force=True, reason="command_stop")
        elif command == "emergency_stop":
            self.safety_lock = True
            self._set_pump(False, force=True, reason="emergency_stop_latched")
            reason = "emergency_stop_latched"
        elif command == "clear_safety":
            if self.pump_on:
                accepted, reason = False, "pump_must_be_off_before_clearing_safety"
            else:
                self.safety_lock = False
                self.safety_reason = ""
                if self.tank.disconnected or self.tank.level_pct > 2.0:
                    self.pump.dry_blocked = False
                self._log("SAFE", "Safety lock cleared")
        else:
            accepted, reason = False, "unknown_command"
        return accepted, reason

    def _execute(self, command_id: str, command: str) -> None:
        if not command_id or command_id == self.last_command_id:
            return
        self.last_command_id = command_id
        accepted, reason = self.execute_direct(command)
        self._log("CMD", f"cmd={command} ({command_id}) -> accepted={accepted} ({reason})")
        self._ack(command_id, accepted, reason)

    def poll_command(self) -> None:
        body = self._get(f"/api/devices/{self.device_code}/command")
        if not body:
            return
        command = body.get("command", "none")
        if not command or command == "none":
            return
        self._execute(body.get("command_id", ""), command)

    # -- safety watchdogs --------------------------------------------------
    def _enforce_safety_guards(self, now: float) -> None:
        if not self.pump_on:
            return
        # 1. Dry-tank auto cutoff (latches safety_lock to prevent dry-run cycling)
        if not self.tank.disconnected and self.tank.level_pct <= 2.0:
            self.pump.dry_blocked = True
            self.safety_lock = True
            self._set_pump(False, force=True, reason="tank_empty_cutoff")
            self._log("SAFE", "Auto-STOP: water tank depleted (<=2%) — safety lock engaged")
            return
        self.pump.dry_blocked = False
        # 2. Max continuous run-time watchdog (uses simulated pump runtime so timewarp applies)
        elapsed_run_s = max(self.pump.on_time_s, (now - self.pump_started_at) if self.pump_started_at else 0.0)
        if self.max_pump_run_s > 0 and elapsed_run_s >= self.max_pump_run_s:
            self._set_pump(False, force=True, reason="max_runtime_cutoff")
            self._log("SAFE", f"Auto-STOP: max pump runtime ({int(self.max_pump_run_s)}s) reached")
            return
        # 3. Wi-Fi / backend comms-loss cutoff (tracks simulated & wall-clock offline time)
        offline_s = max(self._offline_elapsed_s, (now - self._last_backend_ok) if not self.wifi_connected else 0.0)
        if self.comms_timeout_s > 0 and (not self.wifi_connected or self.comms_fault) and offline_s >= self.comms_timeout_s:
            self.comms_fault = True
            self._set_pump(False, force=True, reason="comms_loss_cutoff")
            self._log("SAFE", f"Auto-STOP: backend unreachable for >{int(self.comms_timeout_s)}s")
        # 4. Soil-too-wet auto stop (wet-soil skip; threshold matches the weather
        #    advisor's soil_wet_threshold default)
        if self.soil_wet_stop_pct > 0 and self.soil.moisture_pct >= self.soil_wet_stop_pct:
            self._set_pump(False, force=True, reason="soil_too_wet")
            self._log(
                "SAFE",
                f"Auto-STOP: soil moisture {self.soil.moisture_pct:.0f}% "
                f">= {self.soil_wet_stop_pct:.0f}% (wet soil)",
            )
            return
        # 5. Rain auto stop (rain board at/above threshold; matches the Lab
        #    UI's "Rain-skip active" display at 25%)
        if self.rain_stop_pct > 0 and self.rain.rain_pct >= self.rain_stop_pct:
            self._set_pump(False, force=True, reason="rain_auto_stop")
            self._log(
                "SAFE",
                f"Auto-STOP: rain board wet {self.rain.rain_pct:.0f}% "
                f">= {self.rain_stop_pct:.0f}%",
            )
            return

    # -- single step & main loop -------------------------------------------
    def step(self, tick_s: float = 0.25, force_telemetry: bool = False) -> bool | None:
        now = time.monotonic()

        if not self.wifi_connected or self.comms_fault:
            self._offline_elapsed_s += max(0.0, tick_s)
        else:
            self._offline_elapsed_s = 0.0

        if not self.gnd_common_connected and self.pump_on:
            self._set_pump(False, force=True, reason="ground_disconnected")
        elif not self.power_5v_connected and self.pump_on:
            self._set_pump(False, force=True, reason="vin_5v_disconnected")

        self.pump.dry_blocked = (self._rail_5v_powered() and not self.tank.disconnected and self.tank.level_pct <= 2.0)
        self.pump.tick(tick_s)
        flow_lpm = self.pump.flow_lpm if self._rail_5v_powered() else 0.0
        self.last_flow_lpm = flow_lpm
        self.flow.tick(tick_s, flow_lpm if self._rail_5v_powered() else 0.0)
        water_litres = flow_lpm * tick_s / 60.0
        self.rain.tick(tick_s)
        self.tank.tick(tick_s, water_litres, self.rain.rain_pct)
        self.soil.tick(tick_s, water_litres, self.rain.rain_pct)

        self._enforce_safety_guards(now)

        if now - self._last_poll >= self.poll_interval_s:
            self._last_poll = now
            self.poll_command()

        sent = None
        if force_telemetry or (now - self._last_telemetry >= self.telemetry_interval_s):
            self._last_telemetry = now
            pulses = self.flow.read_pulses()
            interval_min = max(tick_s, self.telemetry_interval_s) / 60.0
            if pulses is not None:
                litres = pulses / self.flow.pulses_per_litre
                self.cumulative_litres += litres
                interval_lpm = flow_lpm if force_telemetry else (litres / interval_min if interval_min else 0.0)
            else:
                interval_lpm = 0.0
            sent = self.send_telemetry(interval_lpm, pulses)
        return sent

    def run_forever(self, tick_s: float = 0.2) -> None:
        print(f"[virtual-esp32] {self.device_code} booted, pump OFF, polling {self.base_url}")
        while True:
            sent = self.step(tick_s)
            if sent is not None:
                print(
                    f"[virtual-esp32] telemetry {'ok' if sent else 'FAIL'} "
                    f"pump={'ON' if self.pump_on else 'off'} "
                    f"flow={self.last_flow_lpm:.2f}L/min soil={self.soil.moisture_pct:.1f}% "
                    f"tank={self.tank.level_pct:.0f}%"
                )
            time.sleep(tick_s)
