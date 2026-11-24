# Smart Irrigation Project

ESP32-based irrigation sensing and pump-control MVP, built from the hardware
integration handoff. The package contains everything needed to assemble,
calibrate, and acceptance-test the prototype.

Core principle: the ESP32 senses, reports, executes commands safely, and
confirms what physically happened. The backend owns irrigation session state.

## What is included

- `firmware/smart_irrigation_esp32.ino` + `firmware/config.h`
  ESP32 firmware: soil-moisture ADC with calibration, DHT22, flow-pulse
  counting, telemetry upload, command polling, ack, safe pump control.
- `firmware/pin_map.md`
  Final GPIO map with boot/ADC/Wi-Fi constraints.
- `hardware/wiring-diagram.md`
  Power architecture and signal wiring for the low-voltage DC prototype.
- `hardware/bom.md`
  Component list with purchase checks and a column for actual model/serial.
- `hardware/power-notes.md`
  Separate pump/logic power domains, grounding, and protection.
- `backend/app.py`
  FastAPI integration server implementing the device contract, the browser
  dashboard at `/`, and the interactive hardware lab at `/simulator`.
- `backend/sim_manager.py`
  Electrical model of the bench: 30-pin ESP32 DevKit header map, 17 real nets,
  passive components (4.7kΩ pull-up, 10k/20k and 1k/2k dividers, 330Ω LED
  resistor, 1N4007 flyback) and fault propagation.
- `backend/weather.py`
  API-key-free weather crawler (wttr.in or any custom HTTP(S) page) with a
  10-minute cache, offline fallback and a rain-skip advisor.
- `frontend/`
  Web dashboard: HTML shell (`templates/index.html`), design system
  (`static/css/dashboard.css`), application logic (`static/js/dashboard.js`),
  the Hardware Lab (`static/js/simulator.js`, `static/js/sim-schematic.js`,
  `static/css/simulator.css`) and vendored Chart.js (`static/js/vendor/`).
  Served by the backend at `/` and `/static/` — no build step, works offline.
  UI reference screenshots in `frontend/screenshots/`.
- `simulator/device_simulator.py`
  Lightweight device-level simulator for quick contract checks.
- `hardware_sim/` — full hardware simulation
  Every physical component simulated: soil-moisture dynamics, DHT22,
  flow sensor, relay + pump (with priming delay), plus a virtual ESP32
  running the same control logic as the real firmware. Run with
  `python3 -m hardware_sim.run --base-url http://127.0.0.1:8000`.
  Fault drills: `--fault soil-disconnect|dht-disconnect|flow-disconnect`.
- `docker/Dockerfile` + `docker/docker-compose.yml`
  Containerized full stack: backend + hardware simulator.
  `docker compose -f docker/docker-compose.yml up --build`
- `tests/contract_test.py`
  End-to-end contract test for telemetry, command, ack, and state.
- `docs/integration-contract.md`
  Telemetry/command/ack schema and behavior.
- `docs/dashboard-api.md`
  Dashboard endpoints, device registry, and the server-side schedule scheduler.
- `docs/safety.md`
  Mandatory safety behavior.
- `docs/soil-moisture-calibration.md`, `docs/flow-sensor-calibration.md`
  Calibration methods and records.
- `docs/test-plan.md`, `docs/handoff-checklist.md`
  Acceptance tests and team handoff checklist.

## Quick start — software demo (no hardware needed)

```bash
cd ~/workspace/smart-irrigation
./demo.sh
```

This installs backend dependencies, starts the integration server, runs the
contract test against it, then starts the full hardware simulation. Open
`http://127.0.0.1:8000/` for the **dashboard** (real-time status cards,
telemetry charts, Start / Stop / Emergency stop / Clear safety). Watch the
simulator log: soil moisture climbs while the pump runs and flow reads zero
until the pump primes.

The same server hosts the **ESP32 Hardware Lab** at
`http://127.0.0.1:8000/simulator` — a concrete 30-pin DevKit with every wire
switchable, live sensor sliders, crawled weather and pump watchdogs. No extra
process or API key is needed.

### Dashboard features

- **Dashboard** — live cards (pump, soil moisture with progress bar, flow,
  temperature/humidity, safety lock, uptime) plus soil / flow / environment /
  pump-activity charts (1h – 7d ranges).
- **Devices** — auto-lists every device that sends telemetry; register
  friendly names, locations, and coordinates for each.
- **Telemetry** — paginated sensor history with time-range filter and CSV
  export.
- **Commands** — quick action buttons, scheduled irrigation (recurring
  weekly start/stop runs enforced server-side), and full command/ack log.
- **Settings** — poll interval, retention, device timeout, default device,
  theme (dark/light/system), chart theme, UI density, motion preferences,
  and settings import/export (stored in the browser, per-user).
- Keyboard: `1`–`6` switch views (`2` opens the Hardware Lab), `r` refreshes.
  Fully responsive, works offline (Chart.js is vendored; no CDN or build step).

### ESP32 Hardware Lab (`/simulator`)

A live electrical workbench behind the dashboard. Nothing is a drawing: every
wire carries a state, and cutting one changes what the firmware can sense.

- **Concrete 30-pin DevKit header.** All 30 physical pins (`L1`–`L15`,
  `R1`–`R15`) are modelled with their real names — `EN`, `VP/G36`, `VN/G39`,
  `GPIO34/35/32/33/25/26/27/14/12/13`, `GND` (`L14`/`R14`), `VIN/5V` (`L15`),
  `3V3` (`R15`) and the right-side `G23…G15`, `GND`, `3V3`. Input-only
  `GPIO34-39`, ADC1 vs ADC2 and the unrouted strapping pins are marked on the
  board, and the schematic labels which pin is used for which signal.
- **17 real nets, two galvanically isolated domains.**
  Domain A: `USB 5V/VIN` (L15), `3V3` (R15), common `GND`, DHT22 `4.7kΩ`
  pull-up on `GPIO33` (L7), YF-S201 `5V` feed plus a `10kΩ/20kΩ` divider into
  `GPIO25` (L8), `GPIO13` (L13) through `330Ω` to the LED, soil `AOUT` on
  `GPIO32` (L6), rain `AO` on `GPIO34` (L4), LDR `AO` on `GPIO35` (L5),
  HC-SR04 `TRIG` on `GPIO26` (L9) and `ECHO` through `1kΩ/2kΩ` on `GPIO14`
  (L11), active-LOW PC817 relay `VCC/GND/IN` on `GPIO27` (L10).
  Domain B: isolated `12V` PSU `+`/`−`, relay `COM`/`NO`/`NC`, pump `M+`/`M−`
  and the `1N4007` flyback diode.
- **Every wire is switchable and every cut has a consequence.** Open `5V` and
  the AMS1117 loses its input, so `3V3` collapses, the MCU reads *UNPOWERED*
  and every sensor goes `null`. Open the `20kΩ` ground leg and `GPIO25` sits at
  `5.02V` — an overvoltage hazard flagged in the banner and on the pin. Open
  the `4.7kΩ` pull-up and the DHT22 bus floats (`BUS FAULT`). Split `TRIG` or
  `ECHO` and the reservoir reading dies. Open the relay coil or the `12V` loop
  and the pump cannot run. Remove the `1N4007` and every pump stop logs a
  back-EMF arc.
- **Live sensor sliders.** Soil moisture, DHT22 temperature/humidity, rain
  wetness, reservoir level and ambient light can be dragged. The slider shows
  `LOCKED` while you hold a manual value and `PHYSICS` when it is released back
  to the simulated dynamics.
- **Website weather crawler, no API key.** Fetches `wttr.in/<city>` (or any
  custom HTTP(S) URL) through the backend, parses the page, caches for 10
  minutes and falls back to the last report when offline. Crawled weather can
  sync the ambient sensors and auto-skip scheduled runs when it is raining or
  the soil is already wet.
- **Pump safety watchdogs.** A newer command supersedes a stale pending one, a
  cancelled schedule cleans up its run pair, and the firmware stops the pump on
  maximum run time, dry tank, or lost backend contact. Reboot leaves the pump
  off and the relay de-energised.

The lab drives the same backend the real device uses: telemetry goes through
`POST /api/devices/{code}/telemetry` and commands through the normal command
queue, so the dashboard cards and charts update from it exactly as they would
from hardware.

## Docker

```bash
cd ~/workspace/smart-irrigation
docker compose -f docker/docker-compose.yml up --build
```

Starts the backend (port 8000, data in the `irrigation-data` volume) and the
hardware simulator against it. Same dashboard at `http://127.0.0.1:8000/`.

## Quick start — real hardware

1. Wire the prototype using `hardware/wiring-diagram.md` and
   `firmware/pin_map.md`, using the specified parts in `hardware/bom.md`.
2. Edit `firmware/config.h` — only three things are yours to fill in:
   - Wi-Fi SSID and password
   - `BACKEND_BASE_URL` (IP of the machine running the backend)
   - soil dry/wet ADC values + flow pulses/litre after calibration
     (measured on your sensor; never copy from elsewhere)
3. Flash the ESP32 with the Arduino IDE or `arduino-cli`.
4. Start the backend:
   ```bash
   cd backend
   python3 -m pip install --user --break-system-packages -r requirements.txt
   python3 -m uvicorn app:app --host 0.0.0.0 --port 8000
   ```
5. Open `http://<server-ip>:8000/` dashboard and run Start → Stop → Emergency
   Stop from the Commands view (or from the dashboard top bar controls).
6. Calibrate soil moisture and flow using the docs, then run
   `docs/test-plan.md`.

The original handoff document is bundled at `docs/00-source-handoff.docx`.

Without hardware, test the contract with:

```bash
cd backend
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
BASE_URL=http://127.0.0.1:8000 python3 ../tests/contract_test.py
```

Or run the simulator:

```bash
python3 simulator/device_simulator.py --base-url http://127.0.0.1:8000
```

## Safety summary

- Pump is OFF at boot and after reset.
- STOP and EMERGENCY STOP override START.
- Emergency stop latches until explicitly cleared with the pump OFF.
- Sensor faults are reported as missing, never fabricated.
- No agronomic thresholds are embedded in firmware.
- A newer command supersedes a stale pending one, so an old `start` cannot
  restart the pump after a `stop`.
- The pump stops itself on maximum run time, on a dry tank, and when the
  backend has been unreachable for longer than the comms-loss window.

## Limitations

- Physical wiring, calibration measurements, and demo evidence must be done
  with the real hardware; they cannot be completed remotely.
- The backend here is an MVP integration server using SQLite, not the full
  production FastAPI/PostgreSQL app.
- Exact purchased model/serial numbers must be recorded in `hardware/bom.md`.
- Flow-sensor signal voltage must be verified before connecting the ESP32.
