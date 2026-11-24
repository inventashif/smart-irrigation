"""In-process Hardware Lab manager driving VirtualESP32 + component models."""

from __future__ import annotations

import os
import sys
import threading
import time
from typing import Callable

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from hardware_sim.dht22 import DHT22
from hardware_sim.extra_sensors import LightSensor, RainSensor, WaterTankSensor
from hardware_sim.flow import FlowSensor
from hardware_sim.pump import PumpRelay
from hardware_sim.soil import SoilMoistureSensor
from hardware_sim.esp32 import VirtualESP32


WIRE_CATALOG = [
    {
        "id": "power_5v",
        "pin": "VIN / 5V (L15)",
        "to_pin": "Relay JD-VCC · Flow Pin 1 · HC-SR04 Pin 1",
        "label": "5.0V USB / VIN Bus",
        "component": "5V Actuator & Ultrasonic Rail",
        "detail": "USB 5V -> Relay VCC, YF-S201 VCC, HC-SR04 VCC",
        "kind": "power",
        "color": "#f43f5e",
    },
    {
        "id": "power_3v3",
        "pin": "3V3 (R15)",
        "to_pin": "Soil VCC · DHT22 Pin 1 · Rain VCC · LDR Top",
        "label": "3.3V Regulated Rail",
        "component": "3.3V Analog/Digital Bus",
        "detail": "AMS1117 3.3V -> Soil, DHT22, Rain, LDR",
        "kind": "power",
        "color": "#ef4444",
    },
    {
        "id": "gnd_common",
        "pin": "GND (L14 / R14)",
        "to_pin": "All Domain A GND + R2 (20kΩ) + LED K",
        "label": "Domain A Common Ground",
        "component": "Sensors + Relay + Divider GND",
        "detail": "Shared logic ground (galvanically isolated from 12V-)",
        "kind": "ground",
        "color": "#94a3b8",
    },
    {
        "id": "soil_sig",
        "pin": "GPIO32 (L6)",
        "to_pin": "Soil Probe Pin 3 (AOUT)",
        "label": "Soil Moisture AOUT",
        "component": "Capacitive Soil v1.2",
        "detail": "ADC1_CH4 · 0–3.3V (3000 dry -> 1200 wet)",
        "kind": "analog",
        "color": "#00d4aa",
    },
    {
        "id": "dht_sig",
        "pin": "GPIO33 (L7)",
        "to_pin": "DHT22 Pin 2 (DATA)",
        "label": "DHT22 1-Wire DATA",
        "component": "DHT22 Temp/RH",
        "detail": "1-Wire open-drain bidirectional bus",
        "kind": "digital",
        "color": "#38bdf8",
    },
    {
        "id": "dht_pullup",
        "pin": "R_PU 4.7kΩ",
        "to_pin": "3V3 Bus <-> DHT22 DATA (GPIO33)",
        "label": "DHT22 4.7kΩ Pull-Up",
        "component": "R_PU 4.7kΩ Passive",
        "detail": "Required open-drain pull-up to 3.3V",
        "kind": "passive",
        "color": "#7dd3fc",
    },
    {
        "id": "rain_sig",
        "pin": "GPIO34 (L4)",
        "to_pin": "Rain LM393 Pin 3 (AO)",
        "label": "Rain Drop Analog AO",
        "component": "LM393 Rain Sensor",
        "detail": "ADC1_CH6 input-only (no internal pull-up)",
        "kind": "analog",
        "color": "#22d3ee",
    },
    {
        "id": "light_sig",
        "pin": "GPIO35 (L5)",
        "to_pin": "GL5528 LDR + 10kΩ Tap",
        "label": "Ambient Light AO",
        "component": "GL5528 LDR Divider",
        "detail": "ADC1_CH7 input-only · 10kΩ pull-down to GND",
        "kind": "analog",
        "color": "#facc15",
    },
    {
        "id": "led_sig",
        "pin": "GPIO13 (L13)",
        "to_pin": "R_LED 330Ω -> LED Anode (A)",
        "label": "Pump Status LED",
        "component": "Indicator LED + 330Ω",
        "detail": "Digital output · Cathode (K) -> Domain A GND",
        "kind": "output",
        "color": "#a855f7",
    },
    {
        "id": "relay_in",
        "pin": "GPIO27 (L10)",
        "to_pin": "Opto-Relay Pin 2 (IN)",
        "label": "Relay Driver IN",
        "component": "PC817 5V Relay Module",
        "detail": "Active-LOW · HIGH at boot keeps COM->NO open",
        "kind": "output",
        "color": "#f59e0b",
    },
    {
        "id": "pump_12v",
        "pin": "12V+ -> COM/NO",
        "to_pin": "Relay NO -> Pump M+ -> M- -> 12V-",
        "label": "12V Isolated Pump Loop",
        "component": "Domain B 12V DC Pump",
        "detail": "Isolated high-current loop via Relay COM/NO",
        "kind": "power",
        "color": "#fb923c",
    },
    {
        "id": "flyback_diode",
        "pin": "D1 1N4007",
        "to_pin": "Cathode (K) Pump M+ <-> Anode (A) M-",
        "label": "1N4007 Flyback Diode",
        "component": "Inductive Clamp Diode",
        "detail": "Clamps motor turn-off back-EMF across M+/M-",
        "kind": "passive",
        "color": "#fdba74",
    },
    {
        "id": "flow_sig",
        "pin": "GPIO25 (L8)",
        "to_pin": "R1 10kΩ / R2 20kΩ Divider Tap",
        "label": "Flow Sensor Pulse IRQ",
        "component": "YF-S201 Hall Turbine",
        "detail": "5V Hall pulse -> 10kΩ/20kΩ -> 3.34V FALLING ISR",
        "kind": "irq",
        "color": "#60a5fa",
    },
    {
        "id": "flow_div_gnd",
        "pin": "R2 20kΩ Leg",
        "to_pin": "GPIO25 Tap -> 20kΩ -> Domain A GND",
        "label": "Flow Divider 20kΩ GND",
        "component": "Level-Shifter Lower Leg",
        "detail": "CRITICAL: if open, GPIO25 sees raw 5.0V!",
        "kind": "passive",
        "color": "#93c5fd",
    },
    {
        "id": "tank_trig",
        "pin": "GPIO26 (L9)",
        "to_pin": "HC-SR04 Pin 2 (TRIG)",
        "label": "Ultrasonic TRIG Out",
        "component": "HC-SR04 Reservoir",
        "detail": "10µs CMOS trigger pulse (3.3V -> HC-SR04)",
        "kind": "output",
        "color": "#34d399",
    },
    {
        "id": "tank_echo",
        "pin": "GPIO14 (L11)",
        "to_pin": "HC-SR04 Pin 3 (ECHO via 1kΩ/2kΩ)",
        "label": "Ultrasonic ECHO In",
        "component": "HC-SR04 + 1kΩ/2kΩ",
        "detail": "5V echo -> 1kΩ/2kΩ divider -> 3.3V pulseIn",
        "kind": "digital",
        "color": "#10b981",
    },
    {
        "id": "wifi_link",
        "pin": "2.4GHz PCB",
        "to_pin": "FastAPI :8000 HTTP",
        "label": "Wi-Fi 802.11n Link",
        "component": "ESP32 RF -> Backend",
        "detail": "Telemetry POST + Command Poll + Rain-Skip",
        "kind": "wireless",
        "color": "#818cf8",
    },
]


class SimulatorManager:
    def __init__(
        self,
        transport_post: Callable[[str, dict], dict | None],
        transport_get: Callable[[str], dict | None],
        weather_provider: Callable[[], dict] | None = None,
        device_code: str = "ESP32-DEMO-001",
    ) -> None:
        self._lock = threading.RLock()
        self._weather_provider = weather_provider
        self.running = True
        self.speed_multiplier = 1.0
        self.weather_sync = True
        self._thread: threading.Thread | None = None

        self.soil = SoilMoistureSensor(initial_pct=41.0)
        self.dht22 = DHT22(base_temp_c=27.5, base_humidity_pct=60.0, fail_rate=0.0)
        self.flow = FlowSensor(pulses_per_litre=450.0)
        self.pump = PumpRelay(flow_lpm=2.6, priming_s=2.0)
        self.rain = RainSensor(initial_pct=0.0)
        self.tank = WaterTankSensor(capacity_litres=50.0, initial_pct=84.0)
        self.light = LightSensor(base_pct=72.0)

        self.esp = VirtualESP32(
            device_code=device_code,
            base_url="http://127.0.0.1:8000",
            soil=self.soil,
            dht22=self.dht22,
            flow=self.flow,
            pump=self.pump,
            rain=self.rain,
            tank=self.tank,
            light=self.light,
            telemetry_interval_s=4.0,
            poll_interval_s=1.0,
            max_pump_run_s=900.0,
            comms_timeout_s=45.0,
            transport_post=transport_post,
            transport_get=transport_get,
        )
        self._last_weather_sync = 0.0

    def start_background(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        # Send one immediate boot telemetry frame so dashboard has live data right away
        with self._lock:
            now = time.monotonic()
            self.esp._last_poll = now
            self.esp.step(0.1, force_telemetry=True)
        self._thread = threading.Thread(target=self._loop, daemon=True, name="esp32-hardware-sim")
        self._thread.start()

    def _apply_weather_coupling(self) -> None:
        if not self.weather_sync or self._weather_provider is None:
            return
        now = time.monotonic()
        if (now - self._last_weather_sync) < 5.0:
            return
        self._last_weather_sync = now
        try:
            w = self._weather_provider()
        except Exception:
            return
        if not w:
            return
        with self._lock:
            if self.dht22.manual_temp_c is None and w.get("temperature_c") is not None:
                self.dht22.base_temp_c = float(w["temperature_c"])
            if self.dht22.manual_humidity_pct is None and w.get("humidity_pct") is not None:
                self.dht22.base_humidity_pct = float(w["humidity_pct"])
            if self.rain.manual_override is None:
                precip = float(w.get("precip_mm") or 0.0)
                cond = str(w.get("condition") or "").lower()
                if precip > 0.05:
                    self.rain.rain_pct = min(100.0, max(self.rain.rain_pct, precip * 18.0 + 15.0))
                elif any(k in cond for k in ("rain", "drizzle", "shower", "storm")):
                    self.rain.rain_pct = max(self.rain.rain_pct, 42.0)
            if self.light.manual_override is None and w.get("cloud_pct") is not None:
                cloud = float(w["cloud_pct"])
                self.light.base_pct = max(12.0, min(96.0, 92.0 - cloud * 0.65))
            adv = w.get("advisor") or {}
            if adv.get("estimated_drying_pct_per_hr") is not None:
                self.soil.drying_pct_per_hour = float(adv["estimated_drying_pct_per_hr"])

    def _loop(self) -> None:
        tick = 0.25
        while True:
            try:
                if self.running:
                    self._apply_weather_coupling()
                    with self._lock:
                        self.esp.step(tick * self.speed_multiplier)
            except Exception as exc:
                print(f"[sim] loop error: {exc}", flush=True)
            time.sleep(tick)

    # -- wire & fault mapping ----------------------------------------------
    def _wire_connected(self, wire_id: str) -> bool:
        return {
            "power_5v": self.esp.power_5v_connected,
            "power_3v3": self.esp.power_3v3_connected,
            "gnd_common": self.esp.gnd_common_connected,
            "soil_sig": not self.soil.disconnected,
            "dht_sig": not self.dht22.disconnected,
            "dht_pullup": not self.dht22.pullup_disconnected,
            "flow_sig": not self.flow.disconnected,
            "flow_div_gnd": not self.flow.divider_gnd_disconnected,
            "relay_in": not self.pump.relay_disconnected,
            "pump_12v": not self.pump.power_disconnected,
            "flyback_diode": self.pump.flyback_diode_connected,
            "led_sig": self.esp.led_connected,
            "rain_sig": not self.rain.disconnected,
            "light_sig": not self.light.disconnected,
            "tank_trig": not self.tank.trig_disconnected,
            "tank_echo": not self.tank.echo_disconnected,
            "tank_sig": not self.tank.disconnected,
            "wifi_link": self.esp.wifi_connected,
        }.get(wire_id, True)

    def set_wire(self, wire_id: str, connected: bool) -> dict:
        with self._lock:
            if wire_id == "power_5v":
                self.esp.power_5v_connected = connected
                if not connected and self.esp.pump_on:
                    self.esp._set_pump(False, force=True, reason="vin_5v_disconnected")
            elif wire_id == "power_3v3":
                self.esp.power_3v3_connected = connected
            elif wire_id == "gnd_common":
                self.esp.gnd_common_connected = connected
                if not connected and self.esp.pump_on:
                    self.esp._set_pump(False, force=True, reason="ground_disconnected")
            elif wire_id == "soil_sig":
                self.soil.disconnected = not connected
            elif wire_id == "dht_sig":
                self.dht22.disconnected = not connected
            elif wire_id == "dht_pullup":
                self.dht22.pullup_disconnected = not connected
                if not connected:
                    self.esp._log("WARN", "DHT22 4.7kΩ pull-up open -> GPIO33 open-drain bus floating (start-bit timeout)")
            elif wire_id == "flow_sig":
                self.flow.disconnected = not connected
            elif wire_id == "flow_div_gnd":
                self.flow.divider_gnd_disconnected = not connected
                if not connected:
                    self.esp._log("WARN", "OVERVOLTAGE: R2 20kΩ divider GND open -> GPIO25 exposed to 5.02V (>3.6V abs max)!")
            elif wire_id == "relay_in":
                self.pump.relay_disconnected = not connected
                if not connected:
                    self.esp._set_pump(False, force=True, reason="relay_wire_open")
            elif wire_id == "pump_12v":
                self.pump.power_disconnected = not connected
            elif wire_id == "flyback_diode":
                self.pump.flyback_diode_connected = connected
                if not connected:
                    self.esp._log("WARN", "D1 1N4007 flyback diode open -> relay contacts unguarded against 12V motor back-EMF!")
            elif wire_id == "led_sig":
                self.esp.led_connected = connected
            elif wire_id == "rain_sig":
                self.rain.disconnected = not connected
            elif wire_id == "light_sig":
                self.light.disconnected = not connected
            elif wire_id == "tank_trig":
                self.tank.trig_disconnected = not connected
            elif wire_id == "tank_echo":
                self.tank.echo_disconnected = not connected
            elif wire_id == "tank_sig":
                self.tank.disconnected = not connected
            elif wire_id == "wifi_link":
                self.esp.wifi_connected = connected
            else:
                raise ValueError(f"Unknown wire_id: {wire_id}")

            state_word = "CONNECTED" if connected else "DISCONNECTED"
            self.esp._log("WIRE", f"{wire_id} -> {state_word}")
            self.esp.step(0.05, force_telemetry=True)
            return self.get_state()

    def apply_preset(self, preset: str) -> dict:
        with self._lock:
            # First restore clean baseline wires/faults when requested or before specific drills
            for wid in [w["id"] for w in WIRE_CATALOG]:
                if wid != "wifi_link" or preset == "all_healthy":
                    self._set_wire_silent(wid, True)
            if preset == "all_healthy":
                self.esp.wifi_connected = True
                self.dht22.checksum_fault = False
                self.flow.jammed = False
                self.pump.emi_back_emf_events = 0
                if self.tank.level_pct < 20.0:
                    self.tank.set_level_pct(84.0)
                if not self.esp.pump_on:
                    self.esp.safety_lock = False
                    self.esp.safety_reason = ""
                    self.pump.dry_blocked = False
                self.esp._log("PRESET", "All connections restored & faults cleared")
            elif preset == "soil_disconnect":
                self.soil.disconnected = True
                self.esp._log("FAULT", "Injected: Soil probe wire open (GPIO32 -> null)")
            elif preset == "dht_fault":
                self.dht22.checksum_fault = True
                self.esp._log("FAULT", "Injected: DHT22 checksum failure (GPIO33 -> null)")
            elif preset == "dry_run_jam":
                self.flow.jammed = True
                self.esp._log("FAULT", "Injected: Flow turbine jammed (0 pulses while pumping)")
            elif preset == "wifi_drop":
                self.esp.wifi_connected = False
                self.esp._log("FAULT", "Injected: Wi-Fi link dropped")
            elif preset == "tank_empty":
                self.tank.manual_override_pct = None
                self.tank.set_level_pct(0.5)
                self.esp._log("FAULT", "Injected: Reservoir drained to 0.5% (dry-run protection test)")
            else:
                raise ValueError(f"Unknown preset: {preset}")
            self.esp.step(0.05, force_telemetry=True)
            return self.get_state()

    def _set_wire_silent(self, wire_id: str, connected: bool) -> None:
        if wire_id == "power_5v":
            self.esp.power_5v_connected = connected
        elif wire_id == "power_3v3":
            self.esp.power_3v3_connected = connected
        elif wire_id == "gnd_common":
            self.esp.gnd_common_connected = connected
        elif wire_id == "soil_sig":
            self.soil.disconnected = not connected
        elif wire_id == "dht_sig":
            self.dht22.disconnected = not connected
        elif wire_id == "dht_pullup":
            self.dht22.pullup_disconnected = not connected
        elif wire_id == "flow_sig":
            self.flow.disconnected = not connected
        elif wire_id == "flow_div_gnd":
            self.flow.divider_gnd_disconnected = not connected
        elif wire_id == "relay_in":
            self.pump.relay_disconnected = not connected
        elif wire_id == "pump_12v":
            self.pump.power_disconnected = not connected
        elif wire_id == "flyback_diode":
            self.pump.flyback_diode_connected = connected
        elif wire_id == "led_sig":
            self.esp.led_connected = connected
        elif wire_id == "rain_sig":
            self.rain.disconnected = not connected
        elif wire_id == "light_sig":
            self.light.disconnected = not connected
        elif wire_id == "tank_trig":
            self.tank.trig_disconnected = not connected
        elif wire_id == "tank_echo":
            self.tank.echo_disconnected = not connected
        elif wire_id == "tank_sig":
            self.tank.disconnected = not connected
        elif wire_id == "wifi_link":
            self.esp.wifi_connected = connected

    # -- slider & bench controls -------------------------------------------
    def update_controls(self, body: dict) -> dict:
        with self._lock:
            if "running" in body:
                self.running = bool(body["running"])
            if "device_code" in body and str(body["device_code"]).strip():
                self.esp.device_code = str(body["device_code"]).strip()
            if "speed_multiplier" in body:
                self.speed_multiplier = max(0.25, min(30.0, float(body["speed_multiplier"])))
            if "telemetry_interval_s" in body:
                self.esp.telemetry_interval_s = max(1.0, min(120.0, float(body["telemetry_interval_s"])))
            if "weather_sync" in body:
                self.weather_sync = bool(body["weather_sync"])
                if self.weather_sync:
                    self._last_weather_sync = 0.0
            if "max_pump_run_s" in body:
                self.esp.max_pump_run_s = max(5.0, min(7200.0, float(body["max_pump_run_s"])))

            # Manual vs physics mode release
            if body.get("release_manual"):
                target = body["release_manual"]
                if target in ("all", "soil"):
                    self.soil.manual_override_pct = None
                if target in ("all", "temperature"):
                    self.dht22.manual_temp_c = None
                if target in ("all", "humidity"):
                    self.dht22.manual_humidity_pct = None
                if target in ("all", "rain"):
                    self.rain.manual_override = None
                if target in ("all", "light"):
                    self.light.manual_override = None
                if target in ("all", "tank"):
                    self.tank.manual_override_pct = None
                self.esp._log("MODE", f"Released manual lock ({target}) -> live physics active")

            # Sensor sliders
            lock_manual = body.get("lock_manual", True)
            if "soil_moisture_pct" in body and body["soil_moisture_pct"] is not None:
                v = max(0.0, min(100.0, float(body["soil_moisture_pct"])))
                self.soil.moisture_pct = v
                self.soil.manual_override_pct = v if lock_manual else None
            if "temperature_c" in body and body["temperature_c"] is not None:
                v = max(-20.0, min(60.0, float(body["temperature_c"])))
                self.dht22.base_temp_c = v
                self.dht22.manual_temp_c = v if lock_manual else None
            if "humidity_pct" in body and body["humidity_pct"] is not None:
                v = max(0.0, min(100.0, float(body["humidity_pct"])))
                self.dht22.base_humidity_pct = v
                self.dht22.manual_humidity_pct = v if lock_manual else None
            if "rain_pct" in body and body["rain_pct"] is not None:
                v = max(0.0, min(100.0, float(body["rain_pct"])))
                self.rain.rain_pct = v
                self.rain.manual_override = v if lock_manual else None
            if "light_pct" in body and body["light_pct"] is not None:
                v = max(0.0, min(100.0, float(body["light_pct"])))
                self.light.base_pct = v
                self.light.manual_override = v if lock_manual else None
            if "tank_level_pct" in body and body["tank_level_pct"] is not None:
                v = max(0.0, min(100.0, float(body["tank_level_pct"])))
                self.tank.set_level_pct(v)
                self.tank.manual_override_pct = v if lock_manual else None
            if "rated_flow_lpm" in body and body["rated_flow_lpm"] is not None:
                self.pump.rated_flow_lpm = float(body["rated_flow_lpm"])
            if "priming_s" in body and body["priming_s"] is not None:
                self.pump.priming_s = float(body["priming_s"])

            # Fault toggles
            if "dht_checksum" in body:
                self.dht22.checksum_fault = bool(body["dht_checksum"])
            if "flow_jam" in body:
                self.flow.jammed = bool(body["flow_jam"])

            # Direct bench actions
            action = body.get("action")
            if action == "reboot":
                self.esp.reset_boot_state()
            elif action == "refill_tank":
                self.tank.manual_override_pct = None
                self.tank.set_level_pct(100.0)
                self.pump.dry_blocked = False
                if self.esp.safety_reason == "tank_empty_cutoff" and not self.esp.pump_on:
                    self.esp.safety_lock = False
                    self.esp.safety_reason = ""
                self.esp._log("TANK", "Water tank refilled to 100% (50.0 L)")
            elif action in ("start", "stop", "emergency_stop", "clear_safety"):
                self.esp.execute_direct(action)

            if body.get("force_telemetry", True):
                self.esp.step(0.05, force_telemetry=True)

            return self.get_state()

    def get_state(self) -> dict:
        with self._lock:
            snap = self.esp.snapshot_readings()
            rail_3v3 = self.esp._sensors_powered()
            rail_5v = self.esp._rail_5v_powered()
            physical_flow = round(self.pump.flow_lpm if rail_5v else 0.0, 2)
            flow_now = round(
                physical_flow if (rail_5v and not (self.flow.disconnected or self.flow.jammed)) else 0.0,
                2,
            )
            uptime_ms = int((time.monotonic() - self.esp._boot_time) * 1000)

            soil_v = round((snap["raw_adc"] / 4095.0) * 3.3, 2) if snap["raw_adc"] is not None else None
            rain_v = round((snap["rain_adc"] / 4095.0) * 3.3, 2) if snap["rain_adc"] is not None else None
            light_adc = int(round((snap["light_pct"] / 100.0) * 3800 + 120)) if snap["light_pct"] is not None else None
            light_v = round((light_adc / 4095.0) * 3.3, 2) if light_adc is not None else None
            echo_us = int(round(180 + (100.0 - snap["tank_level_pct"]) * 24.0)) if snap["tank_level_pct"] is not None else None
            flow_hz = round((flow_now * self.flow.pulses_per_litre) / 60.0, 1) if rail_5v and not self.flow.disconnected else 0.0

            flow_tap_v = 0.0 if not rail_5v else (5.02 if self.flow.divider_gnd_disconnected else 3.34)
            flow_overvolt = bool(rail_5v and not self.flow.disconnected and self.flow.divider_gnd_disconnected)

            wires = []
            for w in WIRE_CATALOG:
                wid = w["id"]
                conn = self._wire_connected(wid)
                sig = "OPEN"
                if conn:
                    if wid == "power_5v":
                        sig = "5.02 V" if self.esp.gnd_common_connected else "FLOAT"
                    elif wid == "power_3v3":
                        sig = "3.30 V" if self.esp.gnd_common_connected else "FLOAT"
                    elif wid == "gnd_common":
                        sig = "0.00 V REF"
                    elif wid == "soil_sig":
                        sig = f"{soil_v:.2f}V · {snap['raw_adc']} ADC" if snap["raw_adc"] is not None else ("NO 3V3" if not rail_3v3 else "FAULT")
                    elif wid == "dht_sig":
                        if not rail_3v3:
                            sig = "NO 3V3"
                        elif self.dht22.pullup_disconnected:
                            sig = "FLOAT (NO 4.7k)"
                        elif snap["temperature_c"] is not None:
                            sig = f"3.3V · {snap['temperature_c']}°C"
                        else:
                            sig = "CRC ERR"
                    elif wid == "dht_pullup":
                        sig = "3.30V · 0.7mA" if rail_3v3 else "0.00V (NO 3V3)"
                    elif wid == "flow_sig":
                        if not rail_5v:
                            sig = "NO 5V"
                        elif flow_overvolt:
                            sig = f"5.02V OVERVOLT! ({flow_hz:.1f}Hz)" if flow_hz > 0 else "5.02V OVERVOLT!"
                        elif self.flow.jammed:
                            sig = "3.34V JAM (0Hz)"
                        elif flow_hz > 0:
                            sig = f"3.34V · {flow_hz:.1f}Hz"
                        else:
                            sig = "3.34V IDLE (0Hz)"
                    elif wid == "flow_div_gnd":
                        sig = f"3.34V TAP · 0.17mA" if (rail_5v and not self.flow.disconnected) else ("0.00V GND" if self.esp.gnd_common_connected else "NO GND")
                    elif wid == "relay_in":
                        if not rail_5v:
                            sig = "NO 5V COIL"
                        else:
                            sig = "0.0V LOW (ON)" if self.esp.pump_on else "3.3V HIGH (OFF)"
                    elif wid == "pump_12v":
                        sig = "12.0V · 0.65A" if (self.esp.pump_on and rail_5v and not self.pump.power_disconnected) else "12.0V OPEN"
                    elif wid == "flyback_diode":
                        sig = "CLAMP READY (-0.7V)"
                    elif wid == "led_sig":
                        sig = "3.3V · 4.2mA" if (self.esp.pump_on and self.esp.led_connected and self.esp.gnd_common_connected) else "0.0V LOW"
                    elif wid == "rain_sig":
                        sig = f"{rain_v:.2f}V · {snap['rain_adc']} ADC" if snap["rain_adc"] is not None else "NO 3V3"
                    elif wid == "light_sig":
                        sig = f"{light_v:.2f}V · {snap['light_lux']} lx" if light_v is not None else "NO 3V3"
                    elif wid == "tank_trig":
                        sig = "10µs PULSE" if rail_5v else "NO 5V"
                    elif wid == "tank_echo":
                        if not rail_5v:
                            sig = "NO 5V"
                        elif self.tank.trig_disconnected:
                            sig = "NO TRIG (0µs)"
                        elif echo_us is not None:
                            sig = f"{echo_us}µs ({snap['tank_level_pct']}%)"
                        else:
                            sig = "TIMEOUT"
                    elif wid == "wifi_link":
                        sig = "RSSI -54dBm"
                else:
                    if wid == "flow_div_gnd" and rail_5v and not self.flow.disconnected:
                        sig = "OPEN -> 5V RISK!"
                    elif wid == "flyback_diode":
                        sig = f"OPEN ({self.pump.emi_back_emf_events} ARC)" if self.pump.emi_back_emf_events else "OPEN (NO CLAMP)"
                    elif wid == "dht_pullup":
                        sig = "OPEN (BUS FLOAT)"
                wires.append({**w, "connected": conn, "signal": sig})

            return {
                "running": self.running,
                "device_code": self.esp.device_code,
                "speed_multiplier": self.speed_multiplier,
                "telemetry_interval_s": self.esp.telemetry_interval_s,
                "weather_sync": self.weather_sync,
                "esp32": {
                    "fw_version": self.esp.FW_VERSION,
                    "ip": self.esp.device_ip if self.esp.wifi_connected else None,
                    "uptime_ms": uptime_ms,
                    "wifi_connected": self.esp.wifi_connected,
                    "power_5v_ok": rail_5v,
                    "power_3v3_ok": rail_3v3,
                    "gnd_ok": self.esp.gnd_common_connected,
                    "pump_on": self.esp.pump_on,
                    "pump_priming": self.pump.is_priming and rail_5v,
                    "pump_on_time_s": round(self.pump.on_time_s, 1),
                    "priming_s": round(self.pump.priming_s, 1),
                    "rated_flow_lpm": round(self.pump.rated_flow_lpm, 2),
                    "physical_flow_lpm": physical_flow,
                    "sensed_flow_lpm": None if (self.flow.disconnected or not rail_5v) else flow_now,
                    "flow_freq_hz": flow_hz,
                    "flow_tap_voltage_v": flow_tap_v,
                    "flow_overvolt_warning": flow_overvolt,
                    "flyback_diode_ok": self.pump.flyback_diode_connected,
                    "emi_back_emf_events": self.pump.emi_back_emf_events,
                    "dht_pullup_ok": not self.dht22.pullup_disconnected,
                    "max_pump_run_s": self.esp.max_pump_run_s,
                    "safety_lock": self.esp.safety_lock,
                    "comms_fault": self.esp.comms_fault,
                    "safety_reason": self.esp.safety_reason,
                    "last_command_id": self.esp.last_command_id,
                    "cumulative_litres": round(self.esp.cumulative_litres, 3),
                    "total_pulses": self.flow.total_pulses,
                    "led_on": bool(self.esp.pump_on and self.esp.led_connected and self.esp.gnd_common_connected),
                    "pins": {
                        "VIN_5V": "5.02V" if self.esp.power_5v_connected else "OPEN",
                        "3V3": (
                            "3.30V"
                            if (self.esp.power_3v3_connected and self.esp.power_5v_connected)
                            else ("0.00V (VIN OPEN)" if not self.esp.power_5v_connected else "OPEN")
                        ),
                        "GND": "0.00V" if self.esp.gnd_common_connected else "OPEN",
                        "GPIO32": f"{soil_v:.2f}V ({snap['raw_adc']})" if snap["raw_adc"] is not None else "OPEN",
                        "GPIO33": "1-WIRE OK" if snap["temperature_c"] is not None else ("FLOAT" if self.dht22.pullup_disconnected else "ERR"),
                        "GPIO34": f"{rain_v:.2f}V ({snap['rain_adc']})" if snap["rain_adc"] is not None else "OPEN",
                        "GPIO35": f"{light_v:.2f}V ({light_adc})" if light_v is not None else "OPEN",
                        "GPIO13": "3.3V HIGH" if (self.esp.pump_on and self.esp.led_connected and self.esp.gnd_common_connected) else "0.0V LOW",
                        "GPIO27": "0.0V LOW" if self.esp.pump_on else "3.3V HIGH",
                        "GPIO25": (
                            "5.02V OVERVOLT!"
                            if flow_overvolt
                            else (f"{flow_hz:.1f}Hz IRQ" if flow_hz > 0 else ("OPEN" if self.flow.disconnected else "3.34V IDLE"))
                        ),
                        "GPIO26": "10µs TRIG" if not self.tank.trig_disconnected else "OPEN",
                        "GPIO14": f"{echo_us}µs ECHO" if echo_us is not None else "NO ECHO",
                    },
                },
                "readings": {
                    **snap,
                    "soil_voltage_v": soil_v,
                    "rain_voltage_v": rain_v,
                    "light_adc": light_adc,
                    "light_voltage_v": light_v,
                    "tank_echo_us": echo_us,
                    "flow_freq_hz": flow_hz,
                    "flow_rate_lpm": None if (self.flow.disconnected or not rail_5v) else flow_now,
                    "tank_capacity_litres": self.tank.capacity_litres,
                    "drying_pct_per_hour": round(self.soil.drying_pct_per_hour, 2),
                },
                "sliders": {
                    "soil_moisture_pct": round(self.soil.manual_override_pct if self.soil.manual_override_pct is not None else self.soil.moisture_pct, 1),
                    "soil_manual": self.soil.manual_override_pct is not None,
                    "temperature_c": round(self.dht22.manual_temp_c if self.dht22.manual_temp_c is not None else self.dht22.base_temp_c, 1),
                    "temperature_manual": self.dht22.manual_temp_c is not None,
                    "humidity_pct": round(self.dht22.manual_humidity_pct if self.dht22.manual_humidity_pct is not None else self.dht22.base_humidity_pct, 1),
                    "humidity_manual": self.dht22.manual_humidity_pct is not None,
                    "rain_pct": round(self.rain.manual_override if self.rain.manual_override is not None else self.rain.rain_pct, 1),
                    "rain_manual": self.rain.manual_override is not None,
                    "light_pct": round(self.light.manual_override if self.light.manual_override is not None else self.light.base_pct, 1),
                    "light_manual": self.light.manual_override is not None,
                    "tank_level_pct": round(self.tank.level_pct, 1),
                    "tank_manual": self.tank.manual_override_pct is not None,
                    "rated_flow_lpm": round(self.pump.rated_flow_lpm, 2),
                    "priming_s": round(self.pump.priming_s, 1),
                },
                "faults": {
                    "dht_checksum": self.dht22.checksum_fault,
                    "flow_jam": self.flow.jammed,
                },
                "wires": wires,
                "serial_log": self.esp.serial_log[-30:],
            }
