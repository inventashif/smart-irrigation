# Software-Hardware Integration Contract

Base URL example: `http://192.168.1.10:8000`
Device code example: `ESP32-DEMO-001`

The backend is the authoritative owner of irrigation session state. The ESP32
senses, reports, executes commands safely, and acknowledges what happened.

## Telemetry upload

`POST /api/devices/{device_code}/telemetry`

Request JSON:

```json
{
  "device_code": "ESP32-DEMO-001",
  "recorded_at": "2026-10-08T07:30:00Z",
  "uptime_ms": 123456,
  "raw_adc": 2150,
  "soil_moisture_pct": 43.0,
  "temperature_c": 27.5,
  "humidity_pct": 62.5,
  "flow_rate_lpm": 2.41,
  "flow_pulse_count": 1084,
  "cumulative_water_litres": 2.41,
  "pump_state": "off",
  "safety_lock": false,
  "comms_fault": false,
  "simulated": false
}
```

Rules:
- `recorded_at` may be `null` if the device clock is not synced; the backend
  then uses server receipt time.
- Any unavailable measurement must be `null`; fake or repeated placeholder
  values are not acceptable.
- `pump_state` is `"on"` or `"off"`.
- `simulated: true` marks bench-test data and must never be used as demo evidence.

Response: `{"ok": true}`.

## Command polling

`GET /api/devices/{device_code}/command`

Response when a command is pending:

```json
{
  "command": "start",
  "command_id": "cmd-9f2c1a",
  "issued_at": "2026-10-08T07:31:00Z",
  "expires_at": "2026-10-08T07:33:00Z"
}
```

Response when idle: `{"command": "none"}`.

Commands: `start`, `stop`, `emergency_stop`, `clear_safety`.

Rules:
- Commands expire 120 seconds after issue; expired commands are not returned.
- The device must ignore a repeated `command_id`.
- `stop` bypasses the relay chatter guard.
- `emergency_stop` only moves the actuator toward OFF and latches safety lock.
- `clear_safety` is rejected while the pump is ON.

## Acknowledgement

`POST /api/devices/{device_code}/ack`

```json
{
  "device_code": "ESP32-DEMO-001",
  "command_id": "cmd-9f2c1a",
  "accepted": true,
  "pump_state": "on",
  "reason": "ok"
}
```

The backend clears the pending command only when the ack `command_id` matches.

## Manual control

`POST /api/devices/{device_code}/commands`

```json
{"command": "start"}
```

Creates a pending command with a new `command_id`, `issued_at`, and 120-second
expiry. `emergency_stop` always moves toward OFF.

## Device state

`GET /api/devices/{device_code}/state`

Returns the latest telemetry, current pump state, pending command, and recent
command history for the web UI.
