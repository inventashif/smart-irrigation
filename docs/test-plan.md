# Hardware Test Plan

Complete before backend integration, then run the end-to-end acceptance test.

| # | Test | Expected | Result |
| --- | --- | --- | --- |
| 1 | ESP32 boots and connects to Wi-Fi | Connects reliably | ☐ |
| 2 | Soil-moisture raw ADC dry vs wet | Changes consistently | ☐ |
| 3 | Calibrated moisture % direction | Responds in expected direction | ☐ |
| 4 | DHT22 stability | Stable readings; invalid reads detected, not fabricated | ☐ |
| 5 | Relay switching | Repeats without unintended startup activation | ☐ |
| 6 | Pump start/stop | Starts/stops without ESP32 reset | ☐ |
| 7 | Flow pulses | Count increases only while water moves | ☐ |
| 8 | Known-volume flow test | Cumulative litres reasonable | ☐ |
| 9 | ESP32 reboot | Pump goes to safe OFF state | ☐ |
| 10 | Backend telemetry | Backend receives real sensor telemetry | ☐ |
| 11 | START command | Physical pump activation | ☐ |
| 12 | STOP command | Physical pump shutdown | ☐ |
| 13 | EMERGENCY STOP | Immediate OFF behavior | ☐ |
| 14 | Sensor loss | No false normal data sent | ☐ |

## End-to-end acceptance

Minimum successful demonstration:

Sensor reading → FastAPI → database → web UI
AND
Web UI Start → FastAPI → ESP32 → relay/pump → flow confirmation → Stop →
irrigation event/history

Automatic irrigation is not required for this milestone.
