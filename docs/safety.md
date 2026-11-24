# Safety Behaviour

These are mandatory for the MVP and are implemented in firmware.

1. Pump defaults to OFF at power-up.
2. Pump is forced OFF on ESP32 reboot or watchdog recovery.
3. STOP and EMERGENCY STOP have priority over START.
4. EMERGENCY STOP latches a safety lock; START is rejected until safety is
   explicitly cleared while the pump is OFF.
5. A communication or sensor error is reported as fault/missing data, never as
   false “all normal.”
6. Relay chatter is prevented with an 800 ms minimum state-change guard, except
   the STOP path which bypasses the guard.
7. Commands are idempotent: repeated `command_id` values are ignored.
8. Commands expire after 120 seconds; stale commands are not executed.
9. A flyback diode is required across the DC pump terminals.
10. Pump power must be separate from ESP32 USB power so starting the pump
    cannot brown out or reset the controller.
11. No mains-voltage work in the student prototype; use a low-voltage DC pump.
12. Flow-sensor signals above 3.3 V must be divided before reaching the ESP32.

## Fault reporting

- Disconnected/invalid soil sensor: `raw_adc` and `soil_moisture_pct` are `null`.
- Failed DHT22 read: `temperature_c` and `humidity_pct` are `null`.
- Missing flow sensor: flow fields are `null`; when present but idle,
  `flow_rate_lpm` is `0`.
- Repeated telemetry failures set `comms_fault: true`.
