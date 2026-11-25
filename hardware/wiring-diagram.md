# Wiring Diagram (MVP Prototype)

Low-voltage DC prototype only. No mains-voltage wiring.

## Visual guide for the purchased parts

Open `frontend/static/wiring.html` directly, or
`http://127.0.0.1:8000/static/wiring.html` with the backend running.
It contains every wire, selectable 30-/38-pin reference layouts and enlarged
circuits. Physical header and terminal order must be checked against the
module labels; USB identifies the ESP32 chip, not the development-board layout.

The purchased mini pump is **3–6 V DC**. Use a separate regulated **5 V** supply
rated for its startup current. Do not use the old 12 V pump example.

## Power architecture

Use two separate power domains with one common logic ground:

- Domain A: ESP32 via USB 5 V (programming + logic + 3.3 V sensors).
- Domain B: separate regulated 5 V supply for the purchased 3–6 V DC pump.
- Relay coil supply: relay module 5 V from ESP32 VIN/USB 5 V is acceptable for a
  single small relay module; the pump itself must use Domain B.

Common ground: ESP32 GND = sensor GND = relay module GND = flow divider GND.
The pump power loop is switched by the relay contacts and stays isolated from
ESP32 logic except through the relay.
Pump negative goes directly to its supply negative, not to the logic ground.
Only use VIN/5V as a USB-derived output if the board's pinout confirms it.
Do not connect an external 5 V positive supply to VIN while USB is connected.

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
Flow SIG -[10k]-+> | GPIO25              |
                |  |                     |
              [15k]|                     |
                +-------> GND            |
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
Flyback diode across pump: striped cathode (K) to pump (+), anode (A) to pump (-).
Use NO (normally open) so pump is OFF when the relay is de-energized.
```

## Flow-sensor level shifting

Many flow sensors output 5 V pulses. ESP32 GPIO25 must never see 5 V.

Use a divider:

```text
Flow signal ---[10k]---+---[15k]--- GND
                       |
                        +---> GPIO25 (about 3.0 V HIGH with 5.0 V input)
```

Verify with a multimeter before connecting the ESP32.
Use 1% resistors where possible. This pair provides more voltage margin than
the older 10k/20k reference. This drawing assumes a verified 5 V pulse output.
If the sensor is verified open-collector without a built-in 5 V pull-up,
use a suitable 3.3 V pull-up instead; see the visual guide for details.

A typical YF-S201 operates around 1–30 L/min. The small pump may not reach the
minimum measurable flow. Zero pulses alone do not establish that no water flows.
The firmware reports `flow_fault: true` when the pump has been on for 10 s with
no pulses, so a disconnected sensor is not mistaken for a valid 0 L/min reading.

## DHT22

```text
DHT22 VCC ---> ESP32 3V3
DHT22 GND ---> ESP32 GND
DHT22 DATA --> GPIO33, plus 4.7k resistor from DATA to 3V3
```

Some DHT22 modules already include the pull-up resistor; do not double-fit
without checking the module.

## Relay and pump

- Relay module IN: GPIO27 only for a verified 3.3 V-compatible active-LOW input.
  A 5 V coil rating alone does not establish input compatibility. For an
  active-LOW 5 V-only input, the visual guide shows an NPN interface and the
  required `RELAY_ACTIVE_LOW false` firmware change.
- Relay module VCC: 5 V; relay module GND: common ESP32 GND.
- Pump positive supply: relay COM.
- Pump positive terminal: relay NO.
- Pump negative terminal: pump supply negative.
- Fit a flyback diode directly across the DC pump terminals.
- Keep pump/supply wires physically separated from sensor/ADC wiring.
- Leave NC empty. Use the actual COM/NO/NC labels, not an assumed terminal order.
