# Dashboard API & Scheduler

Endpoints added by the web dashboard (`frontend/`, served by `backend/app.py`).
The device contract endpoints in `docs/integration-contract.md` are unchanged.

## Session / device registry

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/devices` | List known devices: registered metadata merged with devices seen in telemetry. Includes `last_seen`, `last_telemetry`, `firmware_version`, `ip` when present. |
| POST | `/api/devices` | Register/update device metadata: `{device_code*, name, location, latitude, longitude, is_active}`. Upsert on `device_code`. |
| DELETE | `/api/devices/{code}` | Remove the *registration* only (telemetry history is kept). 404 if not registered. |

Devices are auto-discovered from telemetry — no registration step is required
for a device to appear in the dashboard.

## History

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/devices/{code}/telemetry?since=&limit=&offset=` | Telemetry history, oldest first, flattened payload + `_received_at`/`_recorded_at`. `limit` ≤ 5000. Returns `total`. |
| GET | `/api/devices/{code}/commands/history?limit=&offset=` | Command log newest first, each with the latest matching `ack` (`accepted`, `pump_state`, `reason`, `received_at`) or `null`. |
| GET | `/api/meta` | Server version, time, allowed commands, command TTL. |

## Schedules

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/devices/{code}/schedules` | List schedules for a device. |
| POST | `/api/devices/{code}/schedules` | Create `{name, time:"HH:MM"*, duration_minutes:1..480*, days:[0..6]*}` (`0` = Sunday). Command is always `start`. |
| PUT | `/api/schedules/{id}` | Partial update (e.g. `{enabled:false}`). |
| DELETE | `/api/schedules/{id}` | Delete schedule and its pending runs. |

**Enforcement is server-side.** A scheduler thread ticks every 15 s and:

1. Issues a `start` command on any enabled schedule whose weekday and
   `HH:MM` (server local time) have passed and that has not fired today
   (`last_fired_date` prevents double-firing), then records a run with
   `stop_at = started_at + duration_minutes`.
2. Issues a `stop` command for any run past `stop_at` and marks it stopped.

Runs persist in `schedule_runs`, so irrigation stops correctly even if the
server restarts mid-run (the stop is issued on the next tick). Safety
behaviour is unchanged: the firmware still latches emergency stop and rejects
`clear_safety` while the pump runs.

## UI settings

Dashboard preferences (poll interval, retention, theme, density, default
device, …) are per-browser and stored in `localStorage` under
`irrigation.settings.v1`. "Export settings" downloads them as JSON;
"Import settings" restores them. Clearing cache only affects local chart data.