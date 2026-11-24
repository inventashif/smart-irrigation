# Wiring Diagram (MVP Prototype)

Low-voltage DC prototype only. No mains-voltage wiring.

## Power architecture

Use two separate power domains with one common logic ground:

- Domain A: ESP32 via USB 5 V (programming + logic + 3.3 V sensors).
- Domain B: pump supply matched to the chosen DC pump (example: 12 V adapter).
- Relay coil supply: relay module 5 V from ESP32 VIN/USB 5 V is acceptable for a
  single small relay module; the pump itself must use Domain B.

Common ground: ESP32 GND = sensor GND = relay module GND = flow divider GND.
The pump power loop is switched by the relay contacts and stays isolated from
ESP32 logic except through the relay.

## Signal wiring (ASCII schematic)

```text
                        ESP32 DevKit
                   +---------------------+
                   |                     |
USB 5V ----------> | 5V/VIN          3V3 | ----> Soil VCC, DHT22 VCC
                   |                     |
Common GND ------> | GND             GND | ----> Soil GND, DHT22 GND,
                   |                     |       Relay GND, divider GND
Soil AOUT -------> | GPIO32              |
                   |                     |
DHT22 DATA ------> | GPIO33              |
                   |      4.7k pull-up    |
                   |      DATA to 3V3    |
                   |                     |
Flow SIG --+---->  | GPIO25              |
           |       |                     |
           |      [10k]                  |
           +------[20k]----> GND          |
                   |                     |
Relay IN <-------- | GPIO27              |
Relay VCC <------- | 5V/VIN              |
Relay GND <------- | GND                 |
                   |                     |
Status LED <------ | GPIO13 ---[220R]---> GND
                   +---------------------+

Relay module contacts (isolated from logic side):
                   +-------------+
Pump PSU (+) ----> | COM         |
                   | Relay       |
Pump (+) <-------  | NO          |
Pump (-) <-------  | PSU (-)     |
                   +-------------+
Flyback diode across pump: cathode (-) to pump (+), anode (-) to pump (-).
Use NO (normally open) so pump is OFF when the relay is de-energized.
```

## Flow-sensor level shifting

Many flow sensors output 5 V pulses. ESP32 GPIO25 must never see 5 V.

Use a divider:

```text
Flow signal ---[10k]---+---[20k]--- GND
                       |
                       +---> GPIO25 (about 3.3 V max)
```

Verify with a multimeter before connecting the ESP32.

## DHT22

```text
DHT22 VCC ---> ESP32 3V3
DHT22 GND ---> ESP32 GND
DHT22 DATA --> GPIO33, plus 4.7k resistor from DATA to 3V3
```

Some DHT22 modules already include the pull-up resistor; do not double-fit
without checking the module.

## Relay and pump

- Relay module IN: GPIO27.
- Relay module VCC: 5 V; relay module GND: common ESP32 GND.
- Pump positive supply: relay COM.
- Pump positive terminal: relay NO.
- Pump negative terminal: pump supply negative.
- Fit a flyback diode directly across the DC pump terminals.
- Keep pump/supply wires physically separated from sensor/ADC wiring.
