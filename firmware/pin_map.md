# ESP32 GPIO Pin Map

Chosen after checking ESP32 boot/strapping restrictions, ADC capability,
interrupt support, and Wi-Fi coexistence.

Key constraints applied:
- Boot-strapping pins (GPIO0, GPIO2, GPIO4, GPIO12, GPIO15) are avoided for
  relay/pump outputs so the board always boots with the pump OFF.
- Soil moisture uses an ADC1 pin (GPIO32) because ADC2 is unavailable while
  Wi-Fi is active.
- GPIO25/26/27 are ADC2 pins, but they are used here as digital-only
  input/output, which is unaffected by Wi-Fi.
- GPIO34-39 are input-only and were not selected for outputs.

| Function | ESP32 GPIO | Electrical notes | Tested? |
| --- | --- | --- | --- |
| Soil moisture ADC | GPIO32 | Analog input, ADC1_CH4, 0-3.3 V sensor output | ☐ |
| DHT22 data | GPIO33 | Digital input, 4.7 kΩ pull-up to 3.3 V | ☐ |
| Flow sensor pulse | GPIO25 | Digital interrupt input, FALLING edge, 3.3 V logic max | ☐ |
| Relay / pump control | GPIO27 | Digital output to relay IN pin | ☐ |
| Status LED | GPIO13 | Digital output, onboard or external LED + resistor | ☐ |

## Wiring summary

| From | To | Notes |
| --- | --- | --- |
| ESP32 3V3 | Soil sensor VCC, DHT22 VCC | Sensor-side 3.3 V only |
| ESP32 GND | Soil GND, DHT22 GND, relay module GND, flow divider GND | Single common logic ground |
| Soil AOUT | GPIO32 | Keep away from pump wiring |
| DHT22 DATA | GPIO33 | 4.7 kΩ pull-up DATA to 3.3 V |
| Flow signal | GPIO25 via divider | Flow sensors are often 5 V logic; divide to 3.3 V max |
| GPIO27 | Relay IN | Relay module ground common with ESP32 |
| Relay COM/NO | Pump + supply | Pump supply separate from ESP32 USB power |
| Flyback diode | Across DC pump terminals | Cathode to pump positive |
