# Power-Supply Requirements and Connection Notes

## Domains

1. ESP32 logic domain: USB 5 V adapter into the ESP32 board.
   - Powers ESP32, 3.3 V sensors, relay module coil supply, status LED.
   - Use a data-capable USB cable for flashing; keep a spare.

2. Pump power domain: separate DC adapter matched to the pump.
   - Example: 12 V DC adapter for a 12 V pump; check pump label for voltage
     and maximum current.
   - The pump loop is switched by relay COM/NO contacts.
   - Do not power the pump from the ESP32 USB port.

## Grounding

- ESP32 GND, sensor GND, relay module GND, and flow-divider GND must be common.
- The pump supply negative returns to the pump adapter, not through ESP32 GND.
- Relay contacts provide isolation between the logic side and pump loop.

## Protection

- Fit a flyback diode directly across the DC pump terminals.
- Verify the flow-sensor signal with a multimeter before connecting GPIO25.
- Keep pump/supply wiring away from soil-sensor ADC wiring to reduce noise.
- If the ESP32 resets when the pump starts, the pump supply or wiring is
  inadequate: use a stiffer adapter, shorten pump leads, and recheck grounds.

## What to avoid

- No mains-voltage pump or relay wiring in the student MVP.
- No shared “one weak USB charger” for both ESP32 and pump.
- No 5 V signals directly into ESP32 GPIO pins.
