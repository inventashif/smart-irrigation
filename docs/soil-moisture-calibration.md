# Soil-Moisture Calibration Record

Do not copy calibration values from another sensor unless the team explicitly
treats them as temporary experimental values. Keep raw ADC in telemetry even
after calibration.

## Method

1. Insert the sensor in a documented dry/reference condition.
2. Record at least 10 raw ADC readings and note the sensor unit.
3. Insert the sensor in a documented wet/reference condition.
4. Record at least 10 raw ADC readings.
5. Confirm the ADC direction before converting to percentage.
6. Enter the dry/wet values in `firmware/config.h`.

## Record

| Item | Value |
| --- | --- |
| Date |  |
| Sensor unit / serial |  |
| ESP32 board |  |
| Firmware config used |  |
| Dry condition description |  |
| Dry raw ADC readings |  |
| Dry raw ADC mean |  |
| Wet condition description |  |
| Wet raw ADC readings |  |
| Wet raw ADC mean |  |
| ADC direction observed |  |
| `SOIL_DRY_ADC` entered |  |
| `SOIL_WET_ADC` entered |  |
| Checked by |  |

## Example only (not a real calibration)

Dry mean: 3000, wet mean: 1200. Replace with measured values.
