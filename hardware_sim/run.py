"""Run the full hardware simulation: soil + DHT22 + flow + pump + virtual ESP32.

Example:
    python3 -m hardware_sim.run --base-url http://127.0.0.1:8000
    python3 -m hardware_sim.run --fault soil-disconnect   # sensor fault drill
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from hardware_sim.soil import SoilMoistureSensor
from hardware_sim.dht22 import DHT22
from hardware_sim.flow import FlowSensor
from hardware_sim.pump import PumpRelay
from hardware_sim.esp32 import VirtualESP32


def main() -> None:
    ap = argparse.ArgumentParser(description="Smart Irrigation hardware simulator")
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--device-code", default="ESP32-DEMO-001")
    ap.add_argument("--interval", type=float, default=15.0, help="telemetry seconds")
    ap.add_argument("--poll-interval", type=float, default=2.0, help="command poll seconds")
    ap.add_argument("--initial-moisture", type=float, default=35.0, help="soil % at start")
    ap.add_argument(
        "--fault",
        choices=["none", "soil-disconnect", "dht-disconnect", "flow-disconnect"],
        default="none",
        help="inject a hardware fault to drill failure handling",
    )
    args = ap.parse_args()

    soil = SoilMoistureSensor(initial_pct=args.initial_moisture)
    dht22 = DHT22()
    flow = FlowSensor()
    pump = PumpRelay()
    if args.fault == "soil-disconnect":
        soil.disconnected = True
    elif args.fault == "dht-disconnect":
        dht22.disconnected = True
    elif args.fault == "flow-disconnect":
        flow.disconnected = True
    if args.fault != "none":
        print(f"[hardware-sim] FAULT INJECTED: {args.fault}")

    device = VirtualESP32(
        device_code=args.device_code,
        base_url=args.base_url,
        soil=soil,
        dht22=dht22,
        flow=flow,
        pump=pump,
        telemetry_interval_s=args.interval,
        poll_interval_s=args.poll_interval,
    )
    try:
        device.run_forever()
    except KeyboardInterrupt:
        print("\nhardware sim stopped (pump left OFF)")


if __name__ == "__main__":
    main()
