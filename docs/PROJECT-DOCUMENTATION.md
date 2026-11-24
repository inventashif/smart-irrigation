# Smart Irrigation — Project Documentation

This document describes the whole project: what it does, how the parts fit
together, every feature, every API endpoint, the safety design, how to run and
test it, and the known issues found during review. It is written from the code
as it exists today. Where a document elsewhere in the repo disagrees with the
code, this document states what the code does and flags the gap in
[§11 Known issues](#11-known-issues).

Related documents (unchanged):

| Document | Covers |
|---|---|
| `README.md` | Quick start and overview |
| `docs/integration-contract.md` | Device ↔ backend contract (telemetry, command, ack) |
| `docs/dashboard-api.md` | Dashboard-only endpoints and the scheduler |
| `docs/safety.md` | Mandatory safety behaviour |
| `docs/test-plan.md`, `docs/handoff-checklist.md` | Hardware acceptance tests and handoff |
| `docs/soil-moisture-calibration.md`, `docs/flow-sensor-calibration.md` | Calibration records |
| `firmware/pin_map.md`, `hardware/*.md` | GPIO map, wiring, BOM, power |

---

## 1. Overview

Smart Irrigation is an ESP32-based soil-moisture sensing and pump-control
prototype with a FastAPI backend and a browser dashboard.

The design rule is that **the ESP32 senses, reports, executes commands safely,
and confirms what physically happened. The backend owns irrigation session
state.** The device never decides on its own to irrigate. All start/stop
decisions come from the dashboard, the scheduler, or the API, and the device
acts only on commands it polls from the backend.

Main parts:

```
 ┌──────────────────────┐   telemetry (POST)    ┌──────────────────────────┐
 │  ESP32 firmware      │ ────────────────────► │  FastAPI backend         │
 │  (or hardware_sim)   │ ◄──── command (GET) ─ │  backend/app.py          │
 │  sensors + relay     │ ────── ack (POST) ──► │  SQLite  + scheduler     │
 └──────────────────────┘                       └────────────▲─────────────┘
                                                             │ REST (JSON)
                                                ┌────────────┴─────────────┐
                                                │  Web dashboard           │
                                                │  frontend/ (static SPA)  │
                                                └──────────────────────────┘
```

The backend also hosts an in-process **ESP32 Hardware Lab** at `/simulator`.
It is not a separate simulator process: `backend/sim_manager.py` models the
electrical bench (30 DevKit header pins, 17 nets, passive components, two
galvanically isolated power domains) and pushes its readings through the same
device-contract endpoints, so the dashboard sees the lab exactly like real
hardware. `backend/weather.py` crawls a public weather page so the lab can sync
ambient conditions and skip scheduled irrigation when it is raining.

---

## 2. Repository layout

| Path | Purpose |
|---|---|
| `backend/app.py` | FastAPI server: device contract, dashboard API, schedules, scheduler thread, SQLite schema. Single file (~740 lines). |
| `backend/requirements.txt` | Backend Python dependencies. |
| `backend/sim_manager.py` | Hardware Lab electrical model: 30-pin header map, 17 nets, passives, fault propagation, presets. |
| `backend/weather.py` | API-key-free weather crawler (wttr.in or custom URL), 10-minute cache, offline fallback, rain-skip advisor. |
| `backend/run.md` | Short run instructions for the backend. |
| `frontend/templates/index.html` | Dashboard HTML shell (six views, modals, settings form). |
| `frontend/static/css/dashboard.css` | Design system, themes, density, responsive layout. |
| `frontend/static/css/simulator.css` | Hardware Lab layout, schematic styling, wire states, serial console. |
| `frontend/static/js/dashboard.js` | All dashboard logic: settings, API client, charts, views, commands, schedules. |
| `frontend/static/js/simulator.js` | Hardware Lab controller: netlist sidebar, sliders, weather panel, bench actions. |
| `frontend/static/js/sim-schematic.js` | 30-pin ESP32 DevKit + multi-terminal SVG schematic builder and live state updater. |
| `frontend/static/js/vendor/` | Vendored Chart.js and its date adapter (no CDN needed for charts). |
| `frontend/screenshots/` | UI reference screenshots. |
| `firmware/smart_irrigation_esp32.ino` | ESP32 firmware (Arduino). |
| `firmware/config.h` | Firmware configuration: Wi-Fi, backend URL, calibration, timing, GPIO. |
| `firmware/pin_map.md` | Final GPIO map and constraints. |
| `hardware_sim/` | Full physics-style simulator: soil, DHT22, flow, pump, and a virtual ESP32 that runs the same control logic as the firmware. |
| `simulator/device_simulator.py` | Lightweight device simulator for quick contract checks. |
| `tests/contract_test.py` | End-to-end contract test (telemetry → command → ack → state). |
| `docker/Dockerfile`, `docker/docker-compose.yml` | Container image and a two-service stack (backend + simulator). |
| `demo.sh` | One-command software demo. |
| `sample/` | Example telemetry and command/ack JSON. |
| `hardware/` | Wiring diagram, BOM, power notes. |
| `docs/` | Contract, safety, calibration, test plan, handoff. |

Runtime data: the SQLite database is `backend/smart_irrigation.db` by default
(overridable with `DB_PATH`). Docker uses `/data/smart_irrigation.db` on the
`irrigation-data` volume. Note that `backend/smart_irrigation.db` currently
exists in the project folder (see [§11](#11-known-issues)).

---

## 3. Running the project

### 3.1 One-command software demo (no hardware)

```bash
./demo.sh
```

What it does:

1. Installs backend dependencies (`pip install --user --break-system-packages`).
2. Deletes and recreates `backend/demo.db`, then starts uvicorn on `127.0.0.1:8000`.
3. Waits for the server, then runs `tests/contract_test.py` against it.
4. Starts the full hardware simulator (`hardware_sim/run.py`, 5 s telemetry).

Open `http://127.0.0.1:8000/` for the dashboard. Press Ctrl+C to stop the
simulator; the trap also stops the backend.

### 3.2 Backend only

```bash
cd backend
python3 -m pip install --user --break-system-packages -r requirements.txt
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000
```

Use `--host 0.0.0.0` only on a trusted network. The API has no authentication
(see [§9](#9-security)).

### 3.3 Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

- `backend`: port 8000, data in the `irrigation-data` volume, healthcheck on `/`.
- `hardware-sim`: waits for the backend to be healthy, then runs the simulator
  against `http://backend:8000` with a 5 s interval.

### 3.4 Real hardware

1. Wire the prototype (`hardware/wiring-diagram.md`, `firmware/pin_map.md`).
2. Edit `firmware/config.h` for your Wi-Fi, `BACKEND_BASE_URL`, and calibration.
   Keep `SIMULATE_SENSORS false` for real runs.
3. Flash with Arduino IDE or `arduino-cli`.
4. Start the backend (§3.2) and open the dashboard.
5. Calibrate soil and flow (`docs/*-calibration.md`), then run `docs/test-plan.md`.

### 3.5 Running the tests

The only automated test is the contract test. It needs a running backend:

```bash
cd backend && python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
BASE_URL=http://127.0.0.1:8000 python3 ../tests/contract_test.py
```

It checks: telemetry accepted, start command created, command visible when
polled, ack clears the pending command, no pending command after ack, and state
reports the latest telemetry. It does **not** cover schedules, device
registration, deletion, emergency stop, the scheduler, or the stale-command
behaviour in [§11](#11-known-issues).

### 3.6 Simulators

| Tool | Command | Notes |
|---|---|---|
| Hardware Lab | open `http://127.0.0.1:8000/simulator` | In-process bench: 30-pin DevKit, 17 switchable nets, sliders, crawled weather, watchdogs. No separate process or API key. |
| Full hardware sim | `python3 -m hardware_sim.run --base-url http://127.0.0.1:8000` | Options: `--device-code`, `--interval` (telemetry s, default 15), `--poll-interval` (default 2), `--initial-moisture` (default 35), `--fault none\|soil-disconnect\|dht-disconnect\|flow-disconnect`. |
| Light sim | `python3 simulator/device_simulator.py --base-url http://127.0.0.1:8000` | Options: `--device-code`, `--interval`. Simulates pump on/off from commands. |

Both always send `"simulated": true`. Simulated data must not be used as demo
evidence (see `docs/integration-contract.md`).

---

## 4. Architecture

### 4.1 Backend (`backend/app.py`)

- **Framework:** FastAPI, served by uvicorn. Version string `1.2.0` (`/health`,
  `/api/meta`).
- **Storage:** one SQLite connection (`check_same_thread=False`) guarded by a
  reentrant lock `_db_lock`. The RLock is required because the scheduler calls
  `_issue_command()` while already holding the lock.
- **Tables** (created on startup by `init_db()`):

| Table | Purpose | Key columns |
|---|---|---|
| `telemetry` | One row per uploaded telemetry payload | `device_code`, `received_at`, `recorded_at`, `payload` (JSON text) |
| `commands` | Command queue and status | `command_id` (unique), `command`, `issued_at`, `expires_at`, `status` (`pending`/`acked`) |
| `acks` | Device acknowledgements | `command_id`, `accepted`, `pump_state`, `reason`, `received_at` |
| `devices` | Dashboard device registry (optional metadata) | `device_code` (PK), `name`, `location`, `latitude`, `longitude`, `is_active` |
| `schedules` | Recurring weekly irrigation schedules | `device_code`, `name`, `time`, `duration_minutes`, `days` (JSON list), `command`, `enabled`, `last_fired_date` |
| `schedule_runs` | Scheduled start → stop pairs in progress | `schedule_id`, `started_at`, `stop_at`, `stop_command_id`, `stopped` |

- **Constants:** `COMMAND_TTL_SECONDS = 120`, `ALLOWED_COMMANDS = {start, stop,
  emergency_stop, clear_safety}`, `SCHEDULER_TICK_SECONDS = 15`,
  `SCHEDULE_RUN_RETENTION_DAYS = 7`.
- **Timestamps:** UTC ISO-8601 with a `Z` suffix, produced by `utcnow_iso()`.
- **Command IDs:** `cmd-` plus 8 hex characters of a random UUID.

### 4.2 Scheduler thread

Started in a daemon thread at application startup (`_startup`). Every 15 s it
runs `_scheduler_tick()`:

1. **Fire due schedules.** For each enabled schedule: skip if it already fired
   today (`last_fired_date == today`), skip if today's weekday is not in `days`,
   skip if the time has not been reached. Otherwise issue a `start` command,
   insert a `schedule_runs` row with `stop_at = now + duration_minutes`, and set
   `last_fired_date`.
2. **Stop finished runs.** For each unstopped run past `stop_at`: issue a `stop`
   command, mark the run stopped, and delete stopped runs older than 7 days.

Notes:
- Schedule times and weekdays use the **server's local time zone**.
- Weekday convention is JavaScript's: `0 = Sunday … 6 = Saturday`.
- Because runs are stored in SQLite, a server restart mid-run still issues the
  stop on the next tick.
- Any exception in a tick is printed and the loop continues.

### 4.3 Frontend (`frontend/`)

A single-page app with no build step:

- `index.html` is served by the backend at `/` (fallback text if the file is missing).
- `dashboard.js` (~1,530 lines) holds all logic in modules: `Settings`
  (localStorage), `Toast`, `Api` (fetch wrapper), `Charts` (Chart.js), and view
  renderers.
- Views are switched by hash (`#dashboard`, `#devices`, `#telemetry`,
  `#commands`, `#settings`, `#simulator`). Polling runs at the interval set in
  Settings.

---

## 5. Features

### 5.1 Dashboard view (`#dashboard`)

- Live status cards for the selected device: pump state, soil moisture (with a
  progress bar), flow, temperature and humidity, safety lock, and uptime.
- Charts for soil moisture, flow, environment (temperature and humidity), and
  pump activity, over ranges 1 h, 6 h, 24 h, 7 d, 30 d.
- Top-bar controls for Start, Stop, Emergency stop, and Clear safety.

### 5.2 Devices view (`#devices`)

- Lists every device that has sent telemetry, plus any registered devices, so no
  registration step is needed for a device to appear.
- Add or edit a device: `device_code` (required), name, location, latitude,
  longitude, and active flag.
- Remove a device registration. Telemetry history is kept.
- Shows last-seen time, firmware version, and IP when the telemetry includes them.

### 5.3 Telemetry view (`#telemetry`)

- Paginated history for a selected device (or all devices in the filter).
- Time-range filter and a page size.
- **CSV export** of the current view. The file is named
  `telemetry_<device>_<timestamp>.csv`.

### 5.4 Commands view (`#commands`)

- Quick action buttons: Start, Stop, Emergency stop, Clear safety.
- Emergency stop and Clear safety ask for confirmation first.
- Command log: each command with its status (`pending` or `acked`) and the latest
  matching ack (accepted, pump state, reason, time).
- **Schedules:** create, enable/disable, and delete weekly schedules for the
  selected device. Each has a name, a start time (`HH:MM`), a duration (1–480
  min), and the weekdays it runs on. Only `start` is supported; the server adds
  the matching `stop` after the duration.

### 5.5 Settings view (`#settings`)

Preferences are stored in the browser's `localStorage` under the key
`irrigation.settings.v1`. They are per browser and are not sent to the server.

| Setting | Default | Meaning |
|---|---|---|
| `pollInterval` | 5 s | How often the dashboard refreshes (1–300 s). |
| `chartRetention` | `6h` | Default chart time window. |
| `maxDataPoints` | 300 | Maximum points per chart series. |
| `autoRefresh` | true | Poll automatically. |
| `showNotifications` | true | Show toast messages. |
| `defaultDevice` | `""` | Device selected on load. |
| `deviceTimeout` | 60 s | Clamped to 10–3600 s. Used to decide whether a device is shown as connected. |
| `autoConnect` | true | Select the default device on load. |
| `theme` | `dark` | `dark`, `light`, or `system`. |
| `chartTheme` | `auto` | Chart colour scheme. |
| `density` | `compact` | UI spacing. |
| `animations`, `reducedMotion` | true, false | Motion preferences. |

Also on this view:
- **Export settings** downloads the settings as JSON.
- **Import settings** restores them from a JSON file.
- **Clear cache** clears local chart data only. It does not touch server data.

### 5.6 Hardware Lab view (`#simulator` or `/simulator`)

A live electrical workbench, not a drawing. Every wire carries state, and
cutting one changes what the firmware can sense.

- **Concrete 30-pin DevKit header.** `L1`–`L15` (`EN`, `VP/G36`, `VN/G39`,
  `GPIO34`, `GPIO35`, `GPIO32`, `GPIO33`, `GPIO25`, `GPIO26`, `GPIO27`,
  `GPIO14`, `GPIO12`, `GPIO13`, `GND`, `VIN/5V`) and `R1`–`R15` (`GPIO23`,
  `GPIO22`, `GPIO1/TX0`, `GPIO3/RX0`, `GPIO21`, `GPIO19`, `GPIO18`, `GPIO5`,
  `GPIO17`, `GPIO16`, `GPIO4`, `GPIO2`, `GPIO15`, `GND`, `3V3`). Input-only
  `GPIO34-39`, ADC1 vs ADC2 and the unrouted strapping pins are marked.
- **17 switchable nets.** Clicking a wire on the schematic or its rocker in the
  left netlist opens/closes it. The SVG darkens to a dashed red trace, the
  netlist row turns red, and the electrical consequences propagate to the
  sensors, pins and pump.
- **Two isolated domains.** Domain A: 5V/VIN, 3V3, common GND, DHT22 `4.7kΩ`
  pull-up, YF-S201 `10kΩ/20kΩ` divider, `330Ω` LED resistor, `1kΩ/2kΩ`
  HC-SR04 ECHO divider, PC817 opto-relay input. Domain B: isolated `12V` PSU,
  relay `COM`/`NO`/`NC`, pump `M+`/`M−`, `1N4007` flyback diode.
- **Live sensor sliders** for soil moisture, DHT22 temperature and humidity,
  rain wetness, reservoir level and ambient light. A dragged slider shows
  `LOCKED`; clicking the pill releases it back to `PHYSICS`.
- **Schematic zoom.** `Fit` / `−` / `+` scale the board; the stage scrolls when
  zoomed so pin labels stay readable in a narrow column.
- **Bench actions.** Start, Stop, E-STOP latch, Clear safety, Refill tank,
  reboot, pause clock, speed multiplier and a UART serial console.
- **Fault presets.** All healthy, open soil probe, DHT22 CRC fault, jam flow
  rotor, dry tank, drop Wi-Fi, plus inline DHT CRC and flow-jam toggles.
- **Website weather crawler.** `Crawl Now`, a location field and an optional
  custom HTTP(S) URL; crawled values can sync the ambient sensors and skip
  scheduled runs on rain or wet soil.
- **Pump watchdogs** surfaced as a safety banner: stale-command superseding,
  maximum run time, dry tank and comms loss.
- **Wet-soil / rain auto-stop** (Hardware Lab): while the pump runs, it stops
  automatically when soil moisture reaches 68% or the rain board is at 25% or
  higher; stops are logged as `SAFE` entries with reasons `soil_too_wet`
  / `rain_auto_stop`, visible via `safety_reason` in `/api/sim/state`.

### 5.7 Global behaviour

- **Keyboard:** `1`–`6` switch views (`2` = Hardware Lab); `r` refreshes;
  `Esc` closes modals. Keys are ignored while typing in an input, select, or
  textarea.
- **Modals:** device and schedule forms.
- **Responsive:** mobile menu on small screens.
- **Themes:** dark and light, with system follow.

---

## 6. Device contract (ESP32 ↔ backend)

Full schema and rules are in `docs/integration-contract.md`. Summary:

| Direction | Method and path | Purpose |
|---|---|---|
| Device → backend | `POST /api/devices/{code}/telemetry` | Upload one reading. |
| Device → backend | `GET /api/devices/{code}/command` | Poll for the newest pending command. Returns `{"command":"none"}` when idle. |
| Device → backend | `POST /api/devices/{code}/ack` | Report the result of a command. Clears the pending command when `command_id` matches. |
| Dashboard → backend | `POST /api/devices/{code}/commands` | Queue a manual command. |
| Dashboard → backend | `GET /api/devices/{code}/state` | Latest telemetry, pending command, recent commands and acks. |

### 6.1 Telemetry payload

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

- `recorded_at` may be `null`. The backend then stores server receipt time only.
- Any unavailable measurement is `null`. Values are never fabricated.
- The backend stores the whole payload as JSON. It only checks that the body's
  `device_code`, when present, matches the URL.

### 6.2 Command and ack

Command response:

```json
{"command": "start", "command_id": "cmd-9f2c1a",
 "issued_at": "2026-10-08T07:31:00Z", "expires_at": "2026-10-08T07:33:00Z"}
```

Ack request:

```json
{"device_code": "ESP32-DEMO-001", "command_id": "cmd-9f2c1a",
 "accepted": true, "pump_state": "on", "reason": "ok"}
```

Command meanings on the device:

| Command | Device behaviour |
|---|---|
| `start` | Rejected with `safety_lock_active` if the lock is set. Otherwise turns the pump on. |
| `stop` | Turns the pump off. Bypasses the 800 ms chatter guard. |
| `emergency_stop` | Sets the safety lock and turns the pump off. Reason `emergency_stop_latched`. |
| `clear_safety` | Clears the lock. Rejected with `pump_must_be_off_before_clearing_safety` if the pump is on. |

Any command ID the device has already executed is ignored (idempotent).

---

## 7. Dashboard API reference

All endpoints are JSON. Errors use FastAPI's `{"detail": "..."}` form.

### 7.1 Server

| Method | Path | Response / notes |
|---|---|---|
| GET | `/` | Dashboard HTML. |
| GET | `/static/*` | CSS, JS, vendor files. |
| GET | `/api/meta` | `{version, server_time, allowed_commands, command_ttl_seconds}`. |

### 7.2 Devices

| Method | Path | Body / params | Response / notes |
|---|---|---|---|
| GET | `/api/devices` | — | `{items, total}`. Union of registered devices and devices seen in telemetry. Each item: `device_code`, `registered`, `name`, `location`, `latitude`, `longitude`, `is_active`, `created_at`, `last_seen`, `last_telemetry`, `firmware_version`, `ip`. |
| POST | `/api/devices` | `{device_code*, name, location, latitude, longitude, is_active}` | Upsert. `400` if `device_code` is missing or latitude/longitude are not numbers. |
| DELETE | `/api/devices/{code}` | — | Removes the registration only. `404` if not registered. Telemetry is kept. |

### 7.3 Telemetry and history

| Method | Path | Params | Notes |
|---|---|---|---|
| GET | `/api/devices/{code}/telemetry` | `since` (ISO timestamp, compared to `received_at`), `limit` (1–5000, default 1000), `offset` | Oldest first. Each item is the payload plus `_received_at` and `_recorded_at`. Returns `total`, `limit`, `offset`. |
| GET | `/api/devices/{code}/commands/history` | `limit` (1–500, default 50), `offset` | Newest first. Each item has `command`, `command_id`, `issued_at`, `expires_at`, `status`, and the latest matching `ack` or `null`. |

### 7.4 Commands

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/devices/{code}/commands` | `{"command": "start" \| "stop" \| "emergency_stop" \| "clear_safety"}` | Creates a pending command (120 s TTL). `400` for any other value. Returns `{ok? no}`: returns the payload `{command, command_id, issued_at, expires_at}`. |
| GET | `/api/devices/{code}/command` | — | Device poll. Returns the newest pending, unexpired command, or `{"command":"none"}`. |
| POST | `/api/devices/{code}/ack` | `{command_id*, accepted, pump_state, reason}` | Marks the matching pending command as `acked` and stores the ack. Returns `cleared_pending` (0 or 1). |
| GET | `/api/devices/{code}/state` | — | `{device_code, latest_telemetry, pending_command, recent_commands (10), recent_acks (10)}`. |

### 7.5 Schedules

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/devices/{code}/schedules` | — | `{items}`, ordered by time. |
| POST | `/api/devices/{code}/schedules` | `{name, time*, duration_minutes*, days*, enabled}` | `time` is `HH:MM` 24-hour. `duration_minutes` is 1–480. `days` is a non-empty list of ints 0–6 (0 = Sunday). `name` defaults to `Irrigation`, max 100 characters. Command is always `start`. |
| PUT | `/api/schedules/{id}` | Any subset of the create fields | Partial update. `400` for an empty body. `404` if not found. |
| DELETE | `/api/schedules/{id}` | — | Deletes the schedule and its run records. |

Validation rules are enforced in `_validate_schedule_payload`. Times are
checked with the regex `^([01]\d|2[0-3]):([0-5]\d)$`.

### 7.6 Hardware Lab and weather

| Method | Path | Body / params | Notes |
|---|---|---|---|
| GET | `/simulator` | — | Serves the SPA with the Hardware Lab as the start view. Same app as `/#simulator`. |
| GET | `/health` | — | `{status, version}`; used by Docker and the lab header. |
| GET | `/api/sim/state` | — | Full lab state: `esp32` (30-pin map, `pins`, `safety_*`, `physical_flow_lpm`, `emi_back_emf_events`, `max_pump_run_s`), `wires` (17 entries with `connected`), `readings`, `faults`, `presets`, `serial`, `weather`. |
| POST | `/api/sim/control` | Any subset of `running`, `speed_multiplier`, `telemetry_interval_s`, `weather_sync`, `max_pump_run_s`, `lock_manual`, `release_manual`, `soil_moisture_pct`, `temperature_c`, `humidity_pct`, `rain_pct`, `light_pct`, `tank_level_pct`, `rated_flow_lpm`, `priming_s`, `dht_checksum`, `flow_jam`, `force_telemetry`, `action` | `release_manual` takes `all`/`soil`/`temperature`/`humidity`/`rain`/`light`/`tank` and hands that sensor back to physics. Slider keys set the value; `lock_manual` (default `true`) decides whether it is pinned or one-shot. `action` is `start`, `stop`, `emergency_stop`, `clear_safety`, `refill_tank` or `reboot`. Returns the new state. |
| POST | `/api/sim/wire` | `{wire_id*, connected*}` | Opens or closes one of the 17 nets. `400` if either key is missing or `wire_id` is unknown. |
| POST | `/api/sim/preset` | `{"preset": "all_healthy" \| "soil_open" \| "dht_crc" \| "flow_jam" \| "tank_dry" \| "wifi_drop"}` | Applies a fault drill. `400` for an unknown preset. |
| GET | `/api/weather` | `location`, `url`, `refresh` (bool), `device_code` | Crawled report plus `advisor` (`action`, `severity`, `summary`, skip reasons). `refresh=true` bypasses the 10-minute cache. |
| POST | `/api/weather/config` | `{location?, custom_url?, rain_skip_enabled?, weather_sync?}` | Persists crawler settings and returns the refreshed report. `400` on an invalid URL. |

The 17 net IDs are `power_5v`, `power_3v3`, `gnd_common`, `soil_sig`,
`dht_sig`, `dht_pullup`, `rain_sig`, `light_sig`, `led_sig`, `relay_in`,
`pump_12v`, `flyback_diode`, `flow_sig`, `flow_div_gnd`, `tank_trig`,
`tank_echo` and `wifi_link`.

---

## 8. Firmware (`firmware/smart_irrigation_esp32.ino`)

### 8.1 Configuration (`config.h`)

| Macro | Default | Meaning |
|---|---|---|
| `WIFI_SSID`, `WIFI_PASSWORD` | placeholders | Must be set before flashing. |
| `BACKEND_BASE_URL` | `http://192.168.1.10:8000` | Backend address. |
| `DEVICE_CODE` | `ESP32-DEMO-001` | Must match the code the dashboard uses. |
| `TELEMETRY_INTERVAL_MS` | 15000 | Upload interval. |
| `COMMAND_POLL_INTERVAL_MS` | 2000 | Command poll interval. |
| `WIFI_RETRY_INTERVAL_MS` | 5000 | Wi-Fi reconnect interval. |
| `MIN_PUMP_STATE_CHANGE_MS` | 800 | Relay chatter guard (not applied to stop). |
| `SOIL_DRY_ADC`, `SOIL_WET_ADC` | 3000, 1200 | Placeholders. Replace with measured values. Direction is handled in firmware. |
| `SOIL_SAMPLES` | 10 | ADC samples averaged per reading. |
| `SOIL_ADC_FAULT_LOW`, `SOIL_ADC_FAULT_HIGH` | 40, 4055 | Raw values outside this window are treated as a sensor fault. |
| `FLOW_SENSOR_PRESENT`, `FLOW_PULSES_PER_LITRE` | true, 450.0 | Replace the pulse constant with a measured one. |
| `DHT22_PRESENT` | true | Enable DHT22 reads. |
| `SIMULATE_SENSORS` | false | Synthetic sensor data, marked `simulated: true`. Never for field evidence. |
| `RELAY_ACTIVE_LOW` | true | Most 5 V relay modules are active-low. |
| `SOIL_ADC_PIN`, `DHT_DATA_PIN`, `FLOW_PULSE_PIN`, `RELAY_PUMP_PIN`, `STATUS_LED_PIN` | 32, 33, 25, 27, 13 | GPIO map (see `firmware/pin_map.md`). |

### 8.2 Runtime behaviour

- **Boot:** pump forced OFF before anything else. Wi-Fi connects. NTP sync is
  requested (`pool.ntp.org`, `time.nist.gov`).
- **Loop:**
  - If Wi-Fi is down, retry every 5 s and return early. The pump is **not**
    changed (see [§11](#11-known-issues)).
  - Poll `/command` every 2 s and execute any new command.
  - Every 15 s, read sensors and upload telemetry.
- **Sensors:**
  - Soil: average of 10 ADC samples, converted to percent from the dry and wet
    calibration. Out-of-range values become `null`.
  - DHT22: bit-banged read with checksum. Failures become `null`.
  - Flow: interrupt counter on GPIO 25. Litres and flow rate are computed from the
    pulse delta per interval.
- **Failure reporting:** three consecutive failed uploads set `comms_fault: true`.
  The next successful upload clears it.
- **Safety:** see [§10](#10-safety-design).

---

## 9. Security

Current state: **the system has no authentication or authorisation on any
endpoint.** Anyone who can reach port 8000 can:

- read all telemetry and device data,
- start the pump, stop it, or latch or clear the emergency lock,
- create, change, or delete schedules,
- register or delete devices.

The README runs uvicorn on `0.0.0.0:8000`, and `docker-compose.yml` publishes
8000 on the host. This is acceptable only on an isolated LAN during a prototype
demo. It should not be exposed to the internet or to an untrusted network.

Other notes:

- The dashboard builds HTML with `innerHTML` in about 20 places. Most inserted
  values go through `escapeHtml`. This review did not complete a full XSS audit
  of those call sites.
- Device credentials: none. The device identifies itself only by `device_code` in
  the URL. Anyone who knows the code can post telemetry or ack commands for it.
- Firmware `config.h` holds Wi-Fi credentials in plain text. Do not commit real
  values.
- The project database (`backend/smart_irrigation.db`) is inside the project
  folder. Keep it out of shared repositories.

---

## 10. Safety design

The safety rules are listed in `docs/safety.md`. In code they are:

| # | Rule | Where it is enforced |
|---|---|---|
| 1 | Pump OFF at power-up | `setup()` calls `setPump(false, true)`. |
| 2 | Pump forced OFF on reboot or watchdog recovery | `setup()` on reboot; `enforcePumpWatchdogs()` covers max run time and comms loss. |
| 3 | STOP and EMERGENCY STOP override START | `executeCommand` (stop uses `force`). |
| 4 | Emergency stop latches; START rejected until cleared with pump OFF | `safetyLock` in `setPump` and `executeCommand`. |
| 5 | Sensor or comms faults are reported as missing, never as normal | `readSoil`, `readDHT22`, `jsonFloatOrNull`, `commsFault`. |
| 6 | 800 ms relay chatter guard; STOP bypasses it | `setPump` (`MIN_PUMP_STATE_CHANGE_MS`). |
| 7 | Commands are idempotent by `command_id` | `executeCommand` (`lastCommandId`); backend `UPDATE … status='pending'`. |
| 8 | Commands expire after 120 s | Backend filters `expires_at > now` in `/command` and `/state`. |
| 9 | Flyback diode across pump | Hardware (`hardware/wiring-diagram.md`) and the lab's `1N4007` net. |
| 10 | Pump power separate from ESP32 power | Hardware (`hardware/power-notes.md`); the lab models it as isolated Domain B. |
| 11 | No mains-voltage work | Process rule. |
| 12 | Flow signal above 3.3 V must be divided | Hardware (`firmware/pin_map.md`); the lab raises `GPIO25` to `5.02V` if the divider's ground leg opens. |
| 13 | Pump stops at maximum run time | `enforcePumpWatchdogs()` → `MAX_PUMP_RUN_MS` (900 000 ms = 15 min, `config.h`). |
| 14 | Pump stops when the tank is dry | Simulator only: `PumpRelay.dry_blocked` and the `tank_empty_cutoff` lock. The real build has no tank sensor in the BOM. |
| 15 | Pump stops when the backend has been silent too long | `enforcePumpWatchdogs()` → `COMMS_LOSS_TIMEOUT_MS` (60 000 ms) since the last successful poll. |
| 16 | A stale Start cannot resurrect the pump after a Stop | Backend marks older pending commands `superseded` when a newer one is acked. |

Agronomic thresholds are deliberately absent from firmware. Irrigation
decisions are made by people or by schedules, not by sensor thresholds.

---

## 11. Known issues

Items marked **fixed** were resolved in the 1.2.0 Hardware Lab work. The rest
are still open.

### 11.1 Stale pending Start can restart the pump after a Stop (fixed)

Previously: `/command` returned the newest pending, unexpired command and
ignored older ones, so an older `start` survived a `stop` ack and restarted the
pump on the next poll (reproducible with the device offline for 120 s).

Now: acknowledging a command marks every older `pending` command for that
device as `superseded` (`POST /api/devices/{code}/ack`), so nothing can
resurrect the pump after a stop. The `commands.status` column can be
`pending`, `acked` or `superseded`.

### 11.2 No pump run-time limit, watchdog, or offline stop (fixed)

Previously: no maximum run time, no watchdog, and `loop()` returned early on a
Wi-Fi drop while leaving the pump on.

Now: `enforcePumpWatchdogs()` runs every loop and forces the pump OFF on
`MAX_PUMP_RUN_MS` (15 min) or when the backend has been unreachable for
`COMMS_LOSS_TIMEOUT_MS` (60 s). The simulator additionally models a dry-tank
cutoff. `docs/safety.md` item 2 is accurate again.

### 11.3 No authentication on any endpoint (high for any network exposure)

See [§9](#9-security).

### 11.4 Telemetry grows without limit

Every telemetry upload is stored (one row per device every 15 s, about 5,760 rows
per device per day). Nothing prunes `telemetry`. Only `schedule_runs` is pruned
(after 7 days). The dashboard's chart retention setting is a browser preference
and does not delete server data.

### 11.5 Database file is in the project folder

`backend/smart_irrigation.db` is present in the project tree. It contains data
from earlier runs. Remove it from any shared copy, and add `*.db` to `.gitignore`.

### 11.6 Documentation drift

- `docs/safety.md` item 2 (watchdog) is now implemented, see 11.2.
- The README says the dashboard "works offline (Chart.js is vendored; no CDN or
  build step)". The page still loads Google Fonts from `fonts.googleapis.com`.
  Without internet access the page falls back to system fonts.
- `README.md` does not list the scheduler behaviour in detail. This document
  covers it in §4.2.

### 11.7 Test coverage

Only `tests/contract_test.py` exists, and it covers the happy path of the device
contract. Not covered: schedules, scheduler, device registry, delete, emergency
stop and clear-safety sequences, the stale-command case in 11.1, the Hardware
Lab endpoints (`/api/sim/*`), the weather crawler, and the dashboard UI.

### 11.8 Minor

- In the firmware, `start` sets `pumpOn` before any flow is detected, so the
  `pump_did_not_engage` reason can only fire when the chatter guard or lock blocks
  the change. Flow confirmation is reported through telemetry instead.
- The device does not check `expires_at` itself. It relies on the backend not
  returning expired commands. A device with a bad clock could act on an expired
  command if it were ever delivered.
- Scheduled runs use server local time. A server time-zone change moves the
  schedules with it.
- The Hardware Lab is a model, not a SPICE solver. It reproduces the documented
  electrical consequences (rail loss, divider overvoltage, open-drain float,
  flyback arcs) but does not compute real analog tolerances.
- The weather crawler parses `wttr.in` output and arbitrary HTML. If that page
  changes its layout, the parser falls back to the last cached report.

---

## 12. Testing checklist

Before a demo or hardware run:

- [ ] `python3 ../tests/contract_test.py` passes against the target backend.
- [ ] Dashboard loads at `/` and the six views render (including Hardware Lab).
- [ ] Device appears in Devices with a last-seen time.
- [ ] Start → pump on (hardware) → Stop → pump off (`docs/test-plan.md` #11–#12).
- [ ] Emergency stop latches; Start is rejected until clear with pump off (#13).
- [ ] Sensor disconnect shows `null` in telemetry, not a fabricated value (#14).
- [ ] Reboot leaves the pump off (#9).
- [ ] A schedule with a short window starts and then stops on time.
- [ ] Stale-command case (§11.1): queue Start, then Stop, with the device offline.
      The pump must not restart. **Expected to pass now.**
- [ ] `simulated` is `false` in all field-evidence telemetry.
- [ ] Hardware Lab: all 30 header pins and 17 nets render; the counter shows
      `17 / 17 OK` with no faults.
- [ ] Hardware Lab: open `VIN/5V` → `3V3` collapses, the MCU reads
      `UNPOWERED`, and every sensor reads `null`.
- [ ] Hardware Lab: open the `20kΩ` ground leg → `GPIO25` shows `5.02V` and the
      overvoltage hazard banner appears.
- [ ] Hardware Lab: open the `4.7kΩ` pull-up → DHT22 reports `BUS FAULT`.
- [ ] Hardware Lab: open the `1N4007` diode, run the pump, stop it → the
      back-EMF arc counter increments.
- [ ] Hardware Lab: drag a slider (`LOCKED`), click the pill (`PHYSICS`), and
      confirm the value returns to the simulated dynamics.
- [ ] Hardware Lab: `Crawl Now` returns a live weather report without an API key.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| Device code | Identifier such as `ESP32-DEMO-001`. Used in every device URL. |
| Command | Instruction queued by the backend: `start`, `stop`, `emergency_stop`, `clear_safety`. |
| Ack | Device's report of whether it accepted a command and the resulting pump state. |
| Safety lock | Latch set by `emergency_stop`. Blocks `start` until `clear_safety` runs with the pump off. |
| Run | A scheduled start with a planned stop (`schedule_runs`). |
| Simulated | Telemetry produced by a simulator. Marked `simulated: true`. |
| Comms fault | Set after three consecutive failed telemetry uploads. |
