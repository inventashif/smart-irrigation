"""Test the firmware's actual moisture policy and automatic-start safety gates."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("g++"), "Requires g++")
class MoistureControlTest(unittest.TestCase):
    def test_hysteresis_and_safety_interlocks(self):
        source = (ROOT / "firmware/smart_irrigation_esp32.ino").read_text()
        function = source[
            source.index("void enforceMoistureControl()"):source.index("bool readDHT22(")
        ]
        harness = r"""
#include <cassert>
#include "moisture_control.h"
#define AUTO_IRRIGATION_ENABLED true
#define AUTO_START_MOISTURE_PCT 35.0f
#define AUTO_STOP_MOISTURE_PCT 68.0f
#define RELAY_INTERFACE_VERIFIED relay_verified
#define SENSOR_SAMPLE_INTERVAL_MS 2500UL
#define COMMS_LOSS_TIMEOUT_MS 60000UL
#define WL_CONNECTED 3
bool relay_verified = true, haveSample = true, pumpOn = false;
bool commsFault = false, safetyLock = false, autoIrrigationPaused = false;
bool flowFault = false;
unsigned long now_ms = 1000, lastSensorMs = 1000, lastBackendOkMs = 1000;
unsigned long millis() { return now_ms; }
struct WifiStub { int current = WL_CONNECTED; int status() { return current; } } WiFi;
struct SerialStub { void println(const char *) {} } Serial;
struct Soil { bool valid = true; float moisturePct = 20; };
struct Sample { Soil soil; } latestSample;
void setPump(bool on, bool force) {
    if (!on) assert(force);  // safety stops bypass chatter guard
    pumpOn = on;
    flowFault = false;
}
"""
        checks = r"""
int main() {
    // All boundaries and hysteresis states exercise the actual shared header.
    assert(moistureAction(true, 35, false, true, 35, 68) == MoistureAction::Start);
    assert(moistureAction(true, 35.1f, false, true, 35, 68) == MoistureAction::Hold);
    assert(moistureAction(true, 67.9f, true, true, 35, 68) == MoistureAction::Hold);
    assert(moistureAction(true, 68, true, true, 35, 68) == MoistureAction::Stop);
    assert(moistureAction(true, 50, false, true, 35, 68) == MoistureAction::Hold);
    for (float invalid : {NAN, INFINITY, -1.0f, 101.0f}) {
        assert(moistureAction(true, invalid, true, true, 35, 68) == MoistureAction::Stop);
        assert(moistureAction(true, invalid, false, true, 35, 68) == MoistureAction::Hold);
    }
    enforceMoistureControl();
    assert(pumpOn);  // low moisture starts
    latestSample.soil.moisturePct = 50;
    enforceMoistureControl();
    assert(pumpOn);
    latestSample.soil.moisturePct = 68;
    enforceMoistureControl();
    assert(!pumpOn);  // high moisture stops
    latestSample.soil.moisturePct = 50;
    enforceMoistureControl();
    assert(!pumpOn);
    latestSample.soil.moisturePct = 20;
    for (bool *gate : {&autoIrrigationPaused, &safetyLock, &commsFault}) {
        *gate = true;
        enforceMoistureControl();
        assert(!pumpOn);
        *gate = false;
    }
    relay_verified = false;
    enforceMoistureControl();
    assert(!pumpOn);
    relay_verified = true;
    WiFi.current = 0;
    enforceMoistureControl();
    assert(!pumpOn);
    WiFi.current = WL_CONNECTED;
    haveSample = false;
    enforceMoistureControl();
    assert(!pumpOn);
    haveSample = true;
    now_ms = lastSensorMs + SENSOR_SAMPLE_INTERVAL_MS * 2 + 1;
    enforceMoistureControl();
    assert(!pumpOn);  // stale readings must not start
    pumpOn = true;
    enforceMoistureControl();
    assert(!pumpOn);  // stale readings force stop
    now_ms = lastSensorMs;
    latestSample.soil.valid = false;
    pumpOn = true;
    enforceMoistureControl();
    assert(!pumpOn);
    latestSample.soil.valid = true;
    pumpOn = true;
    flowFault = true;
    enforceMoistureControl();
    assert(!pumpOn && autoIrrigationPaused);
    enforceMoistureControl();
    assert(!pumpOn);  // a safety stop cannot instantly restart on dry soil
}
"""
        with tempfile.TemporaryDirectory() as directory:
            cpp = Path(directory) / "moisture.cpp"
            binary = Path(directory) / "moisture"
            cpp.write_text("#include <initializer_list>\n" + harness + function + checks)
            compiled = subprocess.run(
                ["g++", "-std=c++17", "-I", str(ROOT / "firmware"),
                 str(cpp), "-o", str(binary)],
                capture_output=True, text=True,
            )
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            tested = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(tested.returncode, 0, tested.stderr)
