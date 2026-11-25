# Flow-Sensor Calibration Record

Do not blindly trust a generic manufacturer pulse-to-flow constant. Measure the
actual sensor and setup.

## Wiring check first

1. YF-S201 red → 5 V supply, black → common logic GND.
2. Yellow signal → 10 kΩ → GPIO25 junction → 15 kΩ → GND. The junction is the
   only connection to GPIO25; never feed the raw 5 V pulse into the ESP32.
3. Measure the junction high level: it must be below 3.3 V (about 3.0 V with
   the 10 kΩ / 15 kΩ pair).
4. Power the pump and confirm `flow_pulse_count` in the dashboard starts rising.
   If it stays at 0, the firmware sets `flow_fault: true` after
   `FLOW_NO_PULSE_TIMEOUT_MS` (10 s) while the pump is on. That means the sensor
   is not wired/level-shifted correctly, or the pump is not moving water.

## Method

1. Place the flow sensor in the real irrigation line.
2. Fill a measuring container with a known volume (1 L is convenient).
3. Note `flow_pulse_count` before the run (it is cumulative).
4. Run the pump through the sensor into the container.
5. Note `flow_pulse_count` after the run; subtract the before value.
6. Repeat at more than one flow rate if practical.
7. Derive pulses per litre: `pulses / known_volume_litres`.
8. Enter the value in `firmware/config.h` as `FLOW_PULSES_PER_LITRE`.
9. Compare calculated litres against the known collected volume and repeat
   until the error is acceptable.

A YF-S201 is commonly specified near 450 pulses/L, so a 1 L run should produce
roughly 450 pulses if the sensor and wiring are healthy. Treat that as a sanity
check only — use your measured value.

## Record

| Item | Value |
| --- | --- |
| Date |  |
| Flow sensor unit / serial |  |
| Known volume collected (L) |  |
| Pulse count before run 1 |  |
| Pulse count after run 1 |  |
| Pulse count before run 2 |  |
| Pulse count after run 2 |  |
| Pulse count before run 3 |  |
| Pulse count after run 3 |  |
| Flow rate notes |  |
| Derived pulses per litre |  |
| `FLOW_PULSES_PER_LITRE` entered |  |
| Verification error vs known volume |  |
| Checked by |  |

## Example only (not a real calibration)

Known volume: 1.0 L. Pulse count before: 1200; after: 1650. Derived:
450 pulses/L. Replace with measured values.
