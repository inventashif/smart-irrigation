"""Device simulator for the Smart Irrigation integration server.

Mimics the ESP32 firmware contract (telemetry + command polling + ack) so the
backend and manual control path can be tested without hardware.

All simulated values are marked "simulated": true.
"""

import argparse
import json
import math
import time
import urllib.request
from datetime import datetime, timezone


def utcnow_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def post(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--device-code", default="ESP32-DEMO-001")
    ap.add_argument("--interval", type=float, default=15.0)
    args = ap.parse_args()

    pump_on = False
    safety_lock = False
    last_command_id = ""
    pulses = 0
    cumulative = 0.0
    phase = 0.0

    print(f"Simulating {args.device_code} against {args.base_url}")
    while True:
        phase += 0.05
        flow_lpm = 2.5 if pump_on else 0.0
        litres = flow_lpm * args.interval / 60.0
        new_pulses = int(litres * 450.0)
        pulses += new_pulses
        cumulative += litres

        telemetry = {
            "device_code": args.device_code,
            "recorded_at": utcnow_iso(),
            "uptime_ms": int(time.monotonic() * 1000),
            "raw_adc": int(2100 + 250 * math.sin(phase)),
            "soil_moisture_pct": round(45.0 + 5.0 * math.sin(phase), 1),
            "temperature_c": round(27.0 + 0.4 * math.sin(phase * 0.7), 1),
            "humidity_pct": round(62.0 + 2.0 * math.cos(phase * 0.5), 1),
            "flow_rate_lpm": round(flow_lpm, 3),
            "flow_pulse_count": pulses,
            "cumulative_water_litres": round(cumulative, 3),
            "pump_state": "on" if pump_on else "off",
            "safety_lock": safety_lock,
            "comms_fault": False,
            "simulated": True,
        }
        try:
            post(f"{args.base_url}/api/devices/{args.device_code}/telemetry", telemetry)
        except Exception as e:  # noqa: BLE001 - simulator diagnostics
            print("telemetry failed:", e)

        try:
            cmd = get(f"{args.base_url}/api/devices/{args.device_code}/command")
        except Exception as e:  # noqa: BLE001
            print("command poll failed:", e)
            cmd = {"command": "none"}

        command = cmd.get("command", "none")
        command_id = cmd.get("command_id", "")
        if command not in ("none", "") and command_id and command_id != last_command_id:
            last_command_id = command_id
            accepted, reason = True, "ok"
            if command == "start":
                if safety_lock:
                    accepted, reason = False, "safety_lock_active"
                else:
                    pump_on = True
            elif command == "stop":
                pump_on = False
            elif command == "emergency_stop":
                safety_lock = True
                pump_on = False
                reason = "emergency_stop_latched"
            elif command == "clear_safety":
                if pump_on:
                    accepted, reason = False, "pump_must_be_off_before_clearing_safety"
                else:
                    safety_lock = False
            else:
                accepted, reason = False, "unknown_command"
            try:
                post(
                    f"{args.base_url}/api/devices/{args.device_code}/ack",
                    {
                        "device_code": args.device_code,
                        "command_id": command_id,
                        "accepted": accepted,
                        "pump_state": "on" if pump_on else "off",
                        "reason": reason,
                    },
                )
                print(f"executed {command} ({command_id}): accepted={accepted} pump={'on' if pump_on else 'off'}")
            except Exception as e:  # noqa: BLE001
                print("ack failed:", e)

        time.sleep(args.interval)


if __name__ == "__main__":
    main()
