# Flow-Sensor Calibration Record

Do not blindly trust a generic manufacturer pulse-to-flow constant. Measure the
actual sensor and setup.

## Method

1. Place the flow sensor in the real irrigation line.
2. Collect a known volume of water in a measuring container.
3. Count pulses during that measured delivery.
4. Repeat at more than one flow rate if practical.
5. Derive pulses per litre for the actual sensor.
6. Enter the value in `firmware/config.h` as `FLOW_PULSES_PER_LITRE`.
7. Compare calculated litres against the known collected volume.

## Record

| Item | Value |
| --- | --- |
| Date |  |
| Flow sensor unit / serial |  |
| Known volume collected (L) |  |
| Pulse count, run 1 |  |
| Pulse count, run 2 |  |
| Pulse count, run 3 |  |
| Flow rate notes |  |
| Derived pulses per litre |  |
| `FLOW_PULSES_PER_LITRE` entered |  |
| Verification error vs known volume |  |
| Checked by |  |

## Example only (not a real calibration)

Known volume: 1.0 L, pulses: 450, derived: 450 pulses/L. Replace with measured values.
