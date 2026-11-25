# Bill of Materials (MVP)

This list incorporates the parts reported by the user. The classic ESP32 chip
was identified over USB; the exact board header layout and relay input circuit
still require checking against their labels. See the self-contained
`frontend/static/wiring.html` for the complete visual assembly guide.

| Qty | Component | Priority | Specified part | Notes | Actual purchased model / serial |
| --- | --- | --- | --- | --- | --- |
| 1 | ESP32 development board | Essential | Classic ESP32 with CP2102 USB bridge | Follow printed GPIO names; confirm 30-/38-pin layout | ESP32-D0WD-V3 chip confirmed |
| 1 | Capacitive soil-moisture sensor | Essential | Capacitive soil moisture sensor v1.2, analog output | Power at 3.3 V; calibrate dry/wet ADC | v1.2, user reported |
| 1 | Relay module | Essential | 1-channel 5 V relay module | Verify active-LOW and 3.3 V input compatibility before direct GPIO connection | 5 V, 1-channel, user reported |
| 1 | Small DC water pump | Essential | Mini DC submersible pump, 3–6 V | Use regulated 5 V, not 12 V; check startup/stall current | 3–6 V DC, user reported |
| 1 | ESP32 USB power supply + cable | Essential | 5 V / 1 A USB adapter + data-capable USB cable | Data cable required for flashing; charge-only cables will not work |  |
| 1 | Pump power supply | Essential | Regulated 5 V DC supply rated for pump startup current | Separate from ESP32 USB power |  |
| 1 | Tubing + reservoir | Essential | Transparent flexible tubing (6 mm ID) + container | Transparent tubing helps demo/debugging |  |
| 1 | Flow sensor | Strongly recommended | YF-S201 hall-effect flow sensor | 5 V pulse reference: 10k/15k divider to GPIO25; verify output type and minimum flow | YF-S201, user reported |
| 1 | DHT22 temperature/humidity sensor | Recommended | AM2302/DHT22 module | 3.3 V operation; check whether module already includes the pull-up | DHT22 / AM2302, user reported |
| 1 | Breadboard + jumper wires | Essential | Half-size breadboard, male/male + male/female jumpers | Secure connectors before final demo |  |
| 1 | Resistor 10 kΩ | Essential | 10 kΩ, 1/4 W | Flow-sensor divider (upper) |  |
| 1 | Resistor 15 kΩ | Essential | 15 kΩ, 1/4 W, preferably 1% | Flow-sensor divider (lower); about 3.0 V tap from 5 V |  |
| 1 | Resistor 4.7 kΩ | Essential | 4.7 kΩ, 1/4 W | DHT22 DATA pull-up to 3.3 V (omit if module includes one) |  |
| 1 | Resistor 220 Ω | Optional | 220 Ω, 1/4 W | Status LED series resistor |  |
| 1 | Flyback diode | Essential | 1N4007 reference; verify current rating for actual motor | Directly across pump; striped cathode to positive |  |
| 1 | Status LED | Optional | 5 mm LED | Firmware drives GPIO13 |  |
| 0 | Rain gauge, pH/EC, LoRa/GSM, solar, extra probes | Future/optional | — | Do not buy for MVP unless required |  |

## Purchase checks

- Pump voltage/current must match the pump adapter.
- Relay contact rating must exceed pump voltage/current with margin.
- Flow-sensor signal voltage must be verified with a multimeter before connecting GPIO25.
- Keep one spare USB data cable; charge-only cables cannot flash the ESP32.
