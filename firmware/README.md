# ESP32 firmware

Install dependencies before compiling:

```sh
./bin/arduino-cli lib install "DHT sensor library@1.4.7"
./bin/arduino-cli lib install "ArduinoJson@7.4.2"
```

This also installs Adafruit Unified Sensor. The driver uses DHT22 on GPIO33.
Soil uses ADC1 GPIO32 with explicit 12-bit resolution; flow uses GPIO25.
Keep credentials and the reachable backend LAN URL in ignored `config.local.h`.

## Interpreting sensor diagnostics

- `soil_adc_diagnostic` preserves the measured ADC even when moisture is null.
  A sustained 0 or 4095 is a rail reading, not usable soil moisture.
- `climate_sensor_valid: false` means the driver did not obtain a valid
  temperature/humidity frame. Nulls are intentional, not zero readings.
- `dht_idle_level` samples the data line after reading. A sustained LOW is
  abnormal for an idle pulled-up DHT bus; HIGH alone does not prove a sensor
  responded.
- Zero flow pulses with the pump off cannot distinguish a connected sensor
  from a disconnected sensor. A controlled water-flow test is required.
- GPIO readback confirms the MCU signal, not relay contact or pump state.

Verify GPIO32 analog voltage and sensor supply with a meter if ADC stays zero.
For DHT failures verify GPIO33, common ground, supply, and the required data
pull-up to 3.3 V (typically 4.7–10 kΩ). Never put 5 V on an ESP32 GPIO.
Disconnect pump power before board resets or relay diagnosis.

## Automatic soil-moisture control

The prepared 1.8.0 firmware starts at or below 35% and stops at or above 68%.
Between these limits it retains the pump state to avoid relay chatter. Edit
`AUTO_START_MOISTURE_PCT` and `AUTO_STOP_MOISTURE_PCT` in `config.h`.
Invalid, nonfinite, or stale soil readings stop an active pump. Manual START
cannot bypass wet-soil or missing-sensor protection.

**Automatic starting is hardware-gated OFF:** `RELAY_INTERFACE_VERIFIED` is false.
Do not set it true until the actual pump stops on the configured OFF level,
starts on ON, and the soil calibration has been measured. The previously
requested LOW=OFF setting may energize an active-LOW relay.

Manual STOP pauses automatic starts. Emergency STOP also latches the safety
lock. A `clear_safety` command explicitly re-arms automatic control; all sensor,
communications, and hardware gates still apply. Communications/runtime/no-flow
safety stops pause automatic restart. Reboot clears the in-memory pause/lock;
the compile-time hardware gate stays in effect.

Sensing is scheduled every 2.5 seconds, but synchronous HTTP operations can
delay decisions. This is not a hard real-time physical safety cutoff.
