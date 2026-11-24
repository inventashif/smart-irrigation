# Software-Hardware Handoff Checklist

| Item | Owner | Status |
| --- | --- | --- |
| Confirm device_code used by backend | Software + Hardware | ☐ |
| Confirm telemetry endpoint and JSON schema | Software + Hardware | ☐ |
| Confirm sensor upload interval | Software + Hardware | ☐ |
| Confirm pump command transport/endpoint | Software + Hardware | ☐ |
| Confirm acknowledgement/pump-state representation | Software + Hardware | ☐ |
| Confirm emergency-stop behaviour | Software + Hardware | ☐ |
| Confirm moisture calibration record | Hardware | ☐ |
| Confirm flow calibration record | Hardware | ☐ |
| Run full manual irrigation cycle | Both teams | ☐ |
| Record demo evidence/logs | Both teams | ☐ |

## Deliverables checklist

- Final component list with actual model/serial numbers: `hardware/bom.md`
- Wiring diagram/schematic: `hardware/wiring-diagram.md`
- Final ESP32 GPIO pin map: `firmware/pin_map.md`
- Power-supply requirements: `hardware/power-notes.md`
- ESP32 firmware source: `firmware/smart_irrigation_esp32.ino`, `firmware/config.h`
- Soil-moisture calibration record: `docs/soil-moisture-calibration.md`
- Flow-sensor calibration record: `docs/flow-sensor-calibration.md`
- Sample telemetry payload: `sample/telemetry_sample.json`
- Command/ack format: `docs/integration-contract.md`, `sample/command_ack_sample.json`
- Pump start/stop/emergency-stop test results: `docs/test-plan.md`
- Known limitations: see README “Limitations”
