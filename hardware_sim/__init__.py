"""Full hardware simulation for the Smart Irrigation MVP.

Simulates every physical component in the loop — soil moisture dynamics,
DHT22, flow sensor, relay + DC pump — plus a virtual ESP32 that runs the same
control logic as firmware/smart_irrigation_esp32.ino (safe boot state,
telemetry upload, command polling, acknowledgement, emergency-stop latch).

The backend cannot distinguish this from real hardware.
"""

from .soil import SoilMoistureSensor
from .dht22 import DHT22
from .flow import FlowSensor
from .pump import PumpRelay
from .esp32 import VirtualESP32

__all__ = ["SoilMoistureSensor", "DHT22", "FlowSensor", "PumpRelay", "VirtualESP32"]
