#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include "config.h"

/*
 * Smart Irrigation ESP32 firmware (MVP)
 *
 * Responsibilities:
 *  - reliable sensing (soil moisture ADC + calibration, DHT22, flow pulses)
 *  - safe pump actuation through a relay/driver
 *  - timestamped telemetry upload to the FastAPI backend
 *  - command polling with acknowledgement (start/stop/emergency stop)
 *
 * Safety rules implemented here:
 *  - pump defaults to OFF at boot and after reset
 *  - STOP / EMERGENCY STOP always win over START
 *  - EMERGENCY STOP latches a safety lock; START is rejected until cleared
 *  - sensor faults are reported as null/missing, never fabricated
 *  - no agronomic irrigation thresholds live in firmware
 */

struct SoilReading {
  bool valid = false;
  int rawAdc = 0;
  float moisturePct = 0.0f;
};

struct ClimateReading {
  bool valid = false;
  float temperatureC = 0.0f;
  float humidityPct = 0.0f;
};

volatile unsigned long flowPulseCount = 0;
unsigned long lastFlowPulseSnapshot = 0;
float cumulativeWaterLitres = 0.0f;

bool pumpOn = false;
bool safetyLock = false;
bool commsFault = false;
bool timeSynced = false;
String lastCommandId = "";
unsigned long lastStateChangeMs = 0;
unsigned long pumpStartedMs = 0;
unsigned long lastBackendOkMs = 0;
unsigned long lastTelemetryMs = 0;
unsigned long lastCommandPollMs = 0;
unsigned long lastWifiRetryMs = 0;
int telemetryFailStreak = 0;

void IRAM_ATTR onFlowPulse() {
  flowPulseCount++;
}

int relayLevelFor(bool on) {
  if (RELAY_ACTIVE_LOW) return on ? LOW : HIGH;
  return on ? HIGH : LOW;
}

void setPump(bool on, bool force = false) {
  unsigned long now = millis();
  if (!force && on == pumpOn) return;
  if (!force && (now - lastStateChangeMs) < MIN_PUMP_STATE_CHANGE_MS) return;  // chatter guard
  if (on && safetyLock) return;  // emergency stop latch wins

  digitalWrite(RELAY_PUMP_PIN, relayLevelFor(on));
  digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
  pumpOn = on;
  lastStateChangeMs = now;
  if (on) {
    pumpStartedMs = now;
  }
}

void enforcePumpWatchdogs(unsigned long now, bool wifiConnected) {
  if (!pumpOn) return;
  if (MAX_PUMP_RUN_MS > 0 && (now - pumpStartedMs) >= MAX_PUMP_RUN_MS) {
    Serial.println("SAFE: max pump runtime reached — forcing pump OFF");
    setPump(false, true);
    return;
  }
  if (COMMS_LOSS_TIMEOUT_MS > 0 &&
      (now - lastBackendOkMs) >= COMMS_LOSS_TIMEOUT_MS) {
    Serial.println("SAFE: Wi-Fi/backend comms timeout — forcing pump OFF");
    setPump(false, true);
  }
}

bool waitForLevel(int pin, int level, unsigned long timeoutUs) {
  unsigned long start = micros();
  while (digitalRead(pin) != level) {
    if ((micros() - start) > timeoutUs) return false;
  }
  return true;
}

bool readDHT22(float &temperatureC, float &humidityPct) {
  if (!DHT22_PRESENT) return false;
  uint8_t data[5] = {0, 0, 0, 0, 0};

  noInterrupts();
  pinMode(DHT_DATA_PIN, OUTPUT);
  digitalWrite(DHT_DATA_PIN, LOW);
  // Keep the 2 ms start pulse outside the critical section; delay() needs
  // interrupts on some cores. Only the sensor response timing is critical.
  interrupts();
  delay(2);
  noInterrupts();
  digitalWrite(DHT_DATA_PIN, HIGH);
  delayMicroseconds(30);
  pinMode(DHT_DATA_PIN, INPUT_PULLUP);

  bool ok = true;
  ok &= waitForLevel(DHT_DATA_PIN, LOW, 120);   // sensor response, ~80 us low
  ok &= waitForLevel(DHT_DATA_PIN, HIGH, 120);  // ~80 us high
  ok &= waitForLevel(DHT_DATA_PIN, LOW, 120);   // first data bit low

  for (int i = 0; i < 40 && ok; i++) {
    ok &= waitForLevel(DHT_DATA_PIN, HIGH, 120);
    unsigned long start = micros();
    ok &= waitForLevel(DHT_DATA_PIN, LOW, 120);
    unsigned long highUs = micros() - start;
    if (highUs > 40) data[i / 8] |= (1 << (7 - (i % 8)));
  }
  pinMode(DHT_DATA_PIN, INPUT_PULLUP);
  interrupts();

  if (!ok) return false;
  if ((((data[0] + data[1] + data[2] + data[3]) & 0xFF) != data[4])) return false;

  humidityPct = (float)((data[0] << 8) | data[1]) / 10.0f;
  int16_t rawT = (int16_t)(((data[2] & 0x7F) << 8) | data[3]);
  temperatureC = rawT / 10.0f;
  if (data[2] & 0x80) temperatureC = -temperatureC;

  if (humidityPct < 0 || humidityPct > 100) return false;
  if (temperatureC < -40 || temperatureC > 80) return false;
  return true;
}

SoilReading readSoil() {
  SoilReading r;
  long sum = 0;
  for (int i = 0; i < SOIL_SAMPLES; i++) {
    sum += analogRead(SOIL_ADC_PIN);
    delay(5);
  }
  r.rawAdc = (int)(sum / SOIL_SAMPLES);

  if (r.rawAdc <= SOIL_ADC_FAULT_LOW || r.rawAdc >= SOIL_ADC_FAULT_HIGH) {
    r.valid = false;  // disconnected/faulted sensor: report missing, never fake
    return r;
  }

  float pct;
  if (SOIL_DRY_ADC == SOIL_WET_ADC) {
    r.valid = false;
    return r;
  } else if (SOIL_DRY_ADC > SOIL_WET_ADC) {
    pct = 100.0f * (float)(SOIL_DRY_ADC - r.rawAdc) / (float)(SOIL_DRY_ADC - SOIL_WET_ADC);
  } else {
    pct = 100.0f * (float)(r.rawAdc - SOIL_DRY_ADC) / (float)(SOIL_WET_ADC - SOIL_DRY_ADC);
  }
  r.moisturePct = constrain(pct, 0.0f, 100.0f);
  r.valid = true;
  return r;
}

String iso8601Now() {
  if (!timeSynced) return "";
  struct tm t;
  if (!getLocalTime(&t)) return "";
  if ((t.tm_year + 1900) < 2024) return "";
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

String jsonFloatOrNull(float v, bool valid, int digits = 2) {
  if (!valid) return "null";
  return String(v, digits);
}

String extractJsonString(const String &body, const String &key) {
  String needle = "\"" + key + "\"";
  int i = body.indexOf(needle);
  if (i < 0) return "";
  i += needle.length();
  i = body.indexOf(':', i);
  if (i < 0) return "";
  i++;
  while (i < body.length() && isspace((unsigned char)body[i])) i++;
  if (body[i] != '"') return "";
  i++;
  int j = body.indexOf("\"", i);
  if (j < 0) return "";
  return body.substring(i, j);
}

bool postJson(const String &url, const String &payload) {
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int code = http.POST(payload);
  http.end();
  return code >= 200 && code < 300;
}

bool sendTelemetry(const SoilReading &soil, const ClimateReading &climate,
                   bool flowValid, float flowRateLpm, unsigned long pulseCount) {
  String ts = iso8601Now();
  String payload = "{";
  payload += "\"device_code\":\"" + String(DEVICE_CODE) + "\",";
  payload += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  payload += "\"firmware_version\":\"esp32-real-1.3.0\",";
  payload += "\"recorded_at\":" + (ts.length() ? ("\"" + ts + "\"") : "null") + ",";
  payload += "\"uptime_ms\":" + String(millis()) + ",";
  payload += "\"raw_adc\":" + (soil.valid ? String(soil.rawAdc) : "null") + ",";
  payload += "\"soil_moisture_pct\":" + jsonFloatOrNull(soil.moisturePct, soil.valid, 1) + ",";
  payload += "\"temperature_c\":" + jsonFloatOrNull(climate.temperatureC, climate.valid, 1) + ",";
  payload += "\"humidity_pct\":" + jsonFloatOrNull(climate.humidityPct, climate.valid, 1) + ",";
  payload += "\"flow_rate_lpm\":" + jsonFloatOrNull(flowRateLpm, flowValid, 3) + ",";
  payload += "\"flow_pulse_count\":" + (flowValid ? String(pulseCount) : "null") + ",";
  payload += "\"cumulative_water_litres\":" + jsonFloatOrNull(cumulativeWaterLitres, flowValid, 3) + ",";
  payload += "\"pump_state\":\"" + String(pumpOn ? "on" : "off") + "\",";
  payload += "\"safety_lock\":" + String(safetyLock ? "true" : "false") + ",";
  payload += "\"comms_fault\":" + String(commsFault ? "true" : "false") + ",";
  payload += "\"simulated\":" + String(SIMULATE_SENSORS ? "true" : "false");
  payload += "}";

  String url = String(BACKEND_BASE_URL) + "/api/devices/" + DEVICE_CODE + "/telemetry";
  return postJson(url, payload);
}

bool sendAck(const String &commandId, bool accepted, const String &reason) {
  String payload = "{";
  payload += "\"device_code\":\"" + String(DEVICE_CODE) + "\",";
  payload += "\"command_id\":\"" + commandId + "\",";
  payload += "\"accepted\":" + String(accepted ? "true" : "false") + ",";
  payload += "\"pump_state\":\"" + String(pumpOn ? "on" : "off") + "\",";
  payload += "\"reason\":\"" + reason + "\"";
  payload += "}";
  String url = String(BACKEND_BASE_URL) + "/api/devices/" + DEVICE_CODE + "/ack";
  return postJson(url, payload);
}

void executeCommand(const String &commandId, const String &command) {
  if (commandId.length() == 0 || commandId == lastCommandId) return;  // idempotent
  lastCommandId = commandId;

  bool accepted = true;
  String reason = "ok";

  if (command == "start") {
    if (safetyLock) {
      accepted = false;
      reason = "safety_lock_active";
    } else {
      setPump(true);
      if (!pumpOn) {
        accepted = false;
        reason = "pump_did_not_engage";
      }
    }
  } else if (command == "stop") {
    setPump(false, true);  // stop path bypasses the chatter guard
  } else if (command == "emergency_stop") {
    safetyLock = true;
    setPump(false, true);
    reason = "emergency_stop_latched";
  } else if (command == "clear_safety") {
    if (pumpOn) {
      accepted = false;
      reason = "pump_must_be_off_before_clearing_safety";
    } else {
      safetyLock = false;
    }
  } else {
    accepted = false;
    reason = "unknown_command";
  }

  if (!sendAck(commandId, accepted, reason)) {
    Serial.println("WARN: command executed but ACK failed: " + commandId);
  }
}

void pollCommand() {
  String url = String(BACKEND_BASE_URL) + "/api/devices/" + DEVICE_CODE + "/command";
  HTTPClient http;
  http.begin(url);
  http.setTimeout(8000);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("Command poll failed: HTTP %d\n", code);
    http.end();
    return;
  }
  String body = http.getString();
  http.end();
  lastBackendOkMs = millis();
  commsFault = false;

  String command = extractJsonString(body, "command");
  if (command.length() == 0 || command == "none") return;
  String commandId = extractJsonString(body, "command_id");
  executeCommand(commandId, command);
}

void simulateSensors(SoilReading &soil, ClimateReading &climate,
                     bool &flowValid, float &flowRateLpm, unsigned long &pulseCount,
                     unsigned long intervalMs) {
  static float phase = 0.0f;
  phase += 0.05f;
  soil.valid = true;
  soil.rawAdc = (int)(2100 + 250 * sin(phase));
  soil.moisturePct = 45.0f + 5.0f * sin(phase);
  climate.valid = true;
  climate.temperatureC = 27.0f + 0.4f * sin(phase * 0.7f);
  climate.humidityPct = 62.0f + 2.0f * cos(phase * 0.5f);
  flowValid = FLOW_SENSOR_PRESENT;
  if (FLOW_SENSOR_PRESENT) {
    // Simulate ~2.5 L/min while pumping, 0 otherwise.
    float litres = pumpOn ? (2.5f * intervalMs / 60000.0f) : 0.0f;
    unsigned long pulses = (unsigned long)(litres * FLOW_PULSES_PER_LITRE);
    noInterrupts();
    flowPulseCount += pulses;
    pulseCount = flowPulseCount;
    interrupts();
    flowRateLpm = pumpOn ? 2.5f : 0.0f;
    cumulativeWaterLitres += litres;
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  digitalWrite(RELAY_PUMP_PIN, relayLevelFor(false));
  pinMode(RELAY_PUMP_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  setPump(false, true);  // mandatory safe state at boot

  analogSetAttenuation(ADC_11db);
  pinMode(SOIL_ADC_PIN, INPUT);
  pinMode(DHT_DATA_PIN, INPUT_PULLUP);

  if (FLOW_SENSOR_PRESENT) {
    pinMode(FLOW_PULSE_PIN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(FLOW_PULSE_PIN), onFlowPulse, FALLING);
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Connecting to Wi-Fi...");
  Serial.printf("Device: %s | Backend: %s\n", DEVICE_CODE, BACKEND_BASE_URL);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  lastTelemetryMs = millis();
  lastCommandPollMs = millis();
  lastBackendOkMs = millis();
}

void loop() {
  unsigned long now = millis();
  bool wifiConnected = (WiFi.status() == WL_CONNECTED);
  enforcePumpWatchdogs(now, wifiConnected);

  if (!wifiConnected) {
    if (now - lastWifiRetryMs > WIFI_RETRY_INTERVAL_MS) {
      lastWifiRetryMs = now;
      Serial.println("Wi-Fi disconnected, retrying...");
      WiFi.disconnect();
      WiFi.reconnect();
    }
    delay(200);
    return;
  }

  if (!timeSynced) {
    struct tm t;
    if (getLocalTime(&t, 10) && (t.tm_year + 1900) >= 2024) timeSynced = true;
  }

  if (now - lastCommandPollMs >= COMMAND_POLL_INTERVAL_MS) {
    lastCommandPollMs = now;
    pollCommand();
  }

  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    unsigned long intervalMs = now - lastTelemetryMs;
    lastTelemetryMs = now;

    SoilReading soil;
    ClimateReading climate;
    bool flowValid = false;
    float flowRateLpm = 0.0f;
    unsigned long pulseCount = 0;

    if (SIMULATE_SENSORS) {
      simulateSensors(soil, climate, flowValid, flowRateLpm, pulseCount, intervalMs);
    } else {
      soil = readSoil();
      float t, h;
      climate.valid = readDHT22(t, h);
      if (climate.valid) {
        climate.temperatureC = t;
        climate.humidityPct = h;
      }
      if (FLOW_SENSOR_PRESENT) {
        noInterrupts();
        unsigned long current = flowPulseCount;
        interrupts();
        unsigned long intervalPulses = current - lastFlowPulseSnapshot;
        lastFlowPulseSnapshot = current;
        pulseCount = current;
        float litres = intervalPulses / FLOW_PULSES_PER_LITRE;
        cumulativeWaterLitres += litres;
        flowRateLpm = litres / (intervalMs / 60000.0f);
        flowValid = true;
      }
    }

    bool ok = sendTelemetry(soil, climate, flowValid, flowRateLpm, pulseCount);
    Serial.printf("REAL device=%s IP=%s telemetry=%s soil_adc=%d pump=%s\n",
                  DEVICE_CODE, WiFi.localIP().toString().c_str(),
                  ok ? "OK" : "FAILED", soil.rawAdc, pumpOn ? "on" : "off");
    if (ok) {
      telemetryFailStreak = 0;
      commsFault = false;
      lastBackendOkMs = now;
    } else {
      telemetryFailStreak++;
      if (telemetryFailStreak >= 3) commsFault = true;
      Serial.println("WARN: telemetry upload failed");
    }
  }

  delay(50);
}
