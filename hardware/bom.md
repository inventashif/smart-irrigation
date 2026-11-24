# Bill of Materials (MVP)

These are the specified parts for the build: the wiring diagram
(`hardware/wiring-diagram.md`), pin map (`firmware/pin_map.md`), and firmware
defaults were designed around exactly these parts. Record the actual purchased
model/serial in the last column before the demo.

| Qty | Component | Priority | Specified part | Notes | Actual purchased model / serial |
| --- | --- | --- | --- | --- | --- |
| 1 | ESP32 development board | Essential | ESP32-DevKitC V4 (ESP32-WROOM-32) | Wi-Fi capable; one board is enough for MVP |  |
| 1 | Capacitive soil-moisture sensor | Essential | Capacitive soil moisture sensor v1.2, analog output | Store raw ADC + calibrated %; do not use raw ADC as % |  |
| 1 | Relay module | Essential | 1-channel 5 V relay module, active-LOW, opto-isolated | Firmware assumes active-LOW (`RELAY_ACTIVE_LOW`); contacts must exceed pump V/A with margin |  |
| 1 | Small DC water pump | Essential | Mini DC submersible pump, 12 V, ≤ 1 A | Low-voltage DC only for MVP; adapter must match pump label |  |
| 1 | ESP32 USB power supply + cable | Essential | 5 V / 1 A USB adapter + data-capable USB cable | Data cable required for flashing; charge-only cables will not work |  |
| 1 | Pump power supply | Essential | 12 V DC adapter, ≥ 1.5 A, matched to pump | Separate from ESP32 USB power |  |
| 1 | Tubing + reservoir | Essential | Transparent flexible tubing (6 mm ID) + container | Transparent tubing helps demo/debugging |  |
| 1 | Flow sensor | Strongly recommended | YF-S201 hall-effect flow sensor | 5 V logic: must go through the 10k/20k divider to GPIO25 |  |
| 1 | DHT22 temperature/humidity sensor | Recommended | AM2302/DHT22 module | 3.3 V operation; check whether module already includes the pull-up |  |
| 1 | Breadboard + jumper wires | Essential | Half-size breadboard, male/male + male/female jumpers | Secure connectors before final demo |  |
| 1 | Resistor 10 kΩ | Essential | 10 kΩ, 1/4 W | Flow-sensor divider (upper) |  |
| 1 | Resistor 20 kΩ | Essential | 20 kΩ, 1/4 W | Flow-sensor divider (lower) |  |
| 1 | Resistor 4.7 kΩ | Essential | 4.7 kΩ, 1/4 W | DHT22 DATA pull-up to 3.3 V (omit if module includes one) |  |
| 1 | Resistor 220 Ω | Optional | 220 Ω, 1/4 W | Status LED series resistor |  |
| 1 | Flyback diode | Essential | 1N4007 | Directly across DC pump terminals |  |
| 1 | Status LED | Optional | 5 mm LED | Firmware drives GPIO13 |  |
| 0 | Rain gauge, pH/EC, LoRa/GSM, solar, extra probes | Future/optional | — | Do not buy for MVP unless required |  |

## Purchase checks

- Pump voltage/current must match the pump adapter.
- Relay contact rating must exceed pump voltage/current with margin.
- Flow-sensor signal voltage must be verified with a multimeter before connecting GPIO25.
- Keep one spare USB data cable; charge-only cables cannot flash the ESP32.
