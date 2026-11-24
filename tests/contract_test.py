"""Contract test for the Smart Irrigation integration server.

Requires the backend running, e.g.:
  python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
Run:
  BASE_URL=http://127.0.0.1:8000 python3 tests/contract_test.py
"""

import json
import os
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000")
DEVICE = os.environ.get("DEVICE_CODE", "ESP32-DEMO-001")


def post(path, payload):
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.loads(r.read().decode())


def get(path):
    with urllib.request.urlopen(BASE_URL + path, timeout=10) as r:
        return r.status, json.loads(r.read().decode())


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        raise SystemExit(1)


status, body = post(f"/api/devices/{DEVICE}/telemetry", {
    "device_code": DEVICE,
    "recorded_at": None,
    "raw_adc": 2150,
    "soil_moisture_pct": 43.0,
    "temperature_c": 27.5,
    "humidity_pct": 62.5,
    "flow_rate_lpm": None,
    "flow_pulse_count": None,
    "cumulative_water_litres": None,
    "pump_state": "off",
})
check("telemetry accepted", status == 200 and body.get("ok") is True)

status, cmd = post(f"/api/devices/{DEVICE}/commands", {"command": "start"})
check("start command created", status == 200 and cmd.get("command") == "start" and cmd.get("command_id"))

status, pending = get(f"/api/devices/{DEVICE}/command")
check("pending command visible", status == 200 and pending.get("command_id") == cmd["command_id"])

status, ack = post(f"/api/devices/{DEVICE}/ack", {
    "device_code": DEVICE,
    "command_id": cmd["command_id"],
    "accepted": True,
    "pump_state": "on",
    "reason": "ok",
})
check("ack accepted and pending cleared", status == 200 and ack.get("cleared_pending") == 1)

status, pending = get(f"/api/devices/{DEVICE}/command")
check("no pending command after ack", status == 200 and pending.get("command") == "none")

status, state = get(f"/api/devices/{DEVICE}/state")
check("state reports latest telemetry", status == 200 and state.get("latest_telemetry") is not None)

print("All contract tests passed.")
