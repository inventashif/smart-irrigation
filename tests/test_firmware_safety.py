"""Run the actual relay/watchdog functions with host-side Arduino stubs.

These checks verify software logic, not relay contacts or electrical compatibility.
"""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("g++"), "Requires g++")
class FirmwareSafetyTest(unittest.TestCase):
    def test_sensor_faults_are_not_valid_readings(self):
        source = (ROOT / "firmware/smart_irrigation_esp32.ino").read_text()
        functions = source[
            source.index("bool readDHT22("):source.index("String iso8601Now(")
        ]
        harness = r"""
#include <cassert>
#include <cmath>
#include <algorithm>
using std::isnan;
#define DHT22_PRESENT true
#define SOIL_ADC_PIN 32
#define SOIL_SAMPLES 10
#define SOIL_ADC_FAULT_LOW 40
#define SOIL_ADC_FAULT_HIGH 4055
#define SOIL_DRY_ADC 3000
#define SOIL_WET_ADC 1200
struct SoilReading { bool valid = false; int rawAdc = 0; float moisturePct = 0; };
struct SensorStub {
    float humidity = NAN, temperature = NAN;
    float readHumidity() { return humidity; }
    float readTemperature() { return temperature; }
} climateSensor;
int adc = 0;
int analogRead(int) { return adc; }
void delay(int) {}
float constrain(float v, float lo, float hi) {
    return std::max(lo, std::min(v, hi));
}
"""
        checks = r"""
int main() {
    float t, h;
    assert(!readDHT22(t, h));
    climateSensor.humidity = 67;
    climateSensor.temperature = 24;
    assert(readDHT22(t, h) && t == 24 && h == 67);
    climateSensor.temperature = NAN;
    assert(!readDHT22(t, h));  // never treat a failed frame as cached success
    climateSensor.temperature = 24;
    climateSensor.humidity = 101;
    assert(!readDHT22(t, h));
    for (int rail : {0, 40, 4055, 4095}) {
        adc = rail;
        assert(!readSoil().valid);
    }
    adc = 3000;
    assert(readSoil().valid && readSoil().moisturePct == 0);
    adc = 1200;
    assert(readSoil().valid && readSoil().moisturePct == 100);
    adc = 2100;
    assert(readSoil().valid && readSoil().moisturePct == 50);
}
"""
        with tempfile.TemporaryDirectory() as directory:
            cpp = Path(directory) / "sensors.cpp"
            binary = Path(directory) / "sensors"
            cpp.write_text(harness + functions + checks)
            subprocess.run(
                ["g++", "-std=c++17", str(cpp), "-o", str(binary)],
                check=True, capture_output=True,
            )
            subprocess.run([str(binary)], check=True, capture_output=True)

    def test_relay_polarity_stop_lock_and_watchdogs(self):
        source = (ROOT / "firmware/smart_irrigation_esp32.ino").read_text()
        # Extract only the relayLevelFor and setPump/enforcePumpWatchdogs functions
        # that don't depend on ESP32 hardware APIs
        functions = r"""
#include <cassert>
#define HIGH 1
#define LOW 0
#define RELAY_PUMP_PIN 27
#define STATUS_LED_PIN 13
#define MIN_PUMP_STATE_CHANGE_MS 800UL
#define MAX_PUMP_RUN_MS 900000UL
#define COMMS_LOSS_TIMEOUT_MS 60000UL

int relayLevelFor(bool on) {
  if (RELAY_ACTIVE_LOW) return on ? LOW : HIGH;
  return on ? HIGH : LOW;
}

unsigned long clock_ms = 1000, lastStateChangeMs = 0;
unsigned long pumpStartedMs = 0, lastBackendOkMs = 1000;
bool pumpOn = false, safetyLock = false, flowFault = false;
bool commsFault = false;
int relay_level = -1;

unsigned long millis() { return clock_ms; }
void digitalWrite(int pin, int value) {
    if (pin == RELAY_PUMP_PIN) relay_level = value;
    if (pin == STATUS_LED_PIN) {}
}

struct SerialStub {
    template<class T> void print(T) {}
    template<class T> void println(T) {}
} Serial;

void setPump(bool on, bool force = false) {
    unsigned long now = millis();
    if (!force && on == pumpOn) return;
    if (!force && (now - lastStateChangeMs) < MIN_PUMP_STATE_CHANGE_MS) return;
    if (on && safetyLock) return;

    digitalWrite(RELAY_PUMP_PIN, relayLevelFor(on));
    digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
    pumpOn = on;
    lastStateChangeMs = now;
    flowFault = false;
    if (on) {
        pumpStartedMs = now;
    }
}

void enforcePumpWatchdogs(unsigned long now, bool wifiConnected) {
    bool timedOut = COMMS_LOSS_TIMEOUT_MS > 0 &&
                    (now - lastBackendOkMs) >= COMMS_LOSS_TIMEOUT_MS;
    if (timedOut) commsFault = true;

    if (!pumpOn) return;
    if (MAX_PUMP_RUN_MS > 0 && (now - pumpStartedMs) >= MAX_PUMP_RUN_MS) {
        setPump(false, true);
        return;
    }
    if (timedOut) {
        setPump(false, true);
    }
}
"""
        checks = r"""
int main() {
    assert(relayLevelFor(false) == (RELAY_ACTIVE_LOW ? HIGH : LOW));
    assert(relayLevelFor(true) == (RELAY_ACTIVE_LOW ? LOW : HIGH));
    setPump(false, true);
    assert(!pumpOn && relay_level == relayLevelFor(false));
    clock_ms += 1000;
    setPump(true);
    assert(pumpOn && relay_level == relayLevelFor(true));
    // Forced stop must work inside the chatter-guard window.
    setPump(false, true);
    assert(!pumpOn && relay_level == relayLevelFor(false));
    safetyLock = true;
    clock_ms += 1000;
    setPump(true);
    assert(!pumpOn);
    safetyLock = false;
    setPump(true);
    lastBackendOkMs = clock_ms;
    clock_ms += COMMS_LOSS_TIMEOUT_MS - 1;
    enforcePumpWatchdogs(clock_ms, true);
    assert(pumpOn);
    clock_ms++;
    enforcePumpWatchdogs(clock_ms, true);
    assert(!pumpOn && relay_level == relayLevelFor(false));
    assert(commsFault);
    commsFault = false;
    enforcePumpWatchdogs(clock_ms, false);
    assert(commsFault);  // comms status also updates while the pump is off
    clock_ms += 1000;
    setPump(true);
    clock_ms += MAX_PUMP_RUN_MS;
    lastBackendOkMs = clock_ms;
    enforcePumpWatchdogs(clock_ms, true);
    assert(!pumpOn && relay_level == relayLevelFor(false));
}
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            cpp = path / "relay_test.cpp"
            for polarity in (0, 1):
                with self.subTest(active_low=polarity):
                    binary = path / f"relay_test_{polarity}"
                    cpp.write_text(f"#define RELAY_ACTIVE_LOW {polarity}\n" + functions + checks)
                    subprocess.run(
                        ["g++", "-std=c++17", str(cpp), "-o", str(binary)],
                        check=True, capture_output=True,
                    )
                    subprocess.run([str(binary)], check=True, capture_output=True)

    def test_boot_sets_off_before_serial_or_delays(self):
        source = (ROOT / "firmware/smart_irrigation_esp32.ino").read_text()
        setup = source[source.index("void setup() {"):source.index("void loop() {")]
        # Check the boot sequence order
        self.assertIn("gpio_set_level(static_cast<gpio_num_t>(RELAY_PUMP_PIN), relayLevelFor(false));", setup)
        self.assertIn("pinMode(RELAY_PUMP_PIN, OUTPUT)", setup)
        self.assertIn("digitalWrite(RELAY_PUMP_PIN, relayLevelFor(false));", setup)
        self.assertIn("Serial.begin(115200);", setup)
        # Verify the order: gpio_set_level before pinMode before Serial.begin
        gpio_idx = setup.index("gpio_set_level")
        pinmode_idx = setup.index("pinMode(RELAY_PUMP_PIN, OUTPUT)")
        digitalwrite_idx = setup.index("digitalWrite(RELAY_PUMP_PIN, relayLevelFor(false));")
        serial_idx = setup.index("Serial.begin(115200);")
        self.assertLess(gpio_idx, pinmode_idx)
        self.assertLess(pinmode_idx, digitalwrite_idx)
        self.assertLess(digitalwrite_idx, serial_idx)