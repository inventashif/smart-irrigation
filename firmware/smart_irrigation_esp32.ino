#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <cJSON.h>
#include <time.h>
#include <driver/gpio.h>
#include "config.h"
#include "sensor_readings.h"
#include "moisture_control.h"

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
 *  - local moisture hysteresis; manual STOP and safety faults pause auto-start
 */

static_assert(SOIL_SAMPLES > 0, "SOIL_SAMPLES must be positive");
static_assert(AUTO_START_MOISTURE_PCT >= 0 &&
              AUTO_START_MOISTURE_PCT < AUTO_STOP_MOISTURE_PCT &&
              AUTO_STOP_MOISTURE_PCT <= 100, "Invalid irrigation thresholds");
static_assert(!FLOW_SENSOR_PRESENT || FLOW_PULSES_PER_LITRE > 0, "Invalid flow calibration");
static_assert(SENSOR_SAMPLE_INTERVAL_MS >= 2000 || !DHT22_PRESENT || SIMULATE_SENSORS,
              "Allow at least 2000 ms between DHT22 reads");

DHT climateSensor(DHT_DATA_PIN, DHT22);

portMUX_TYPE flowMux = portMUX_INITIALIZER_UNLOCKED;
volatile unsigned long flowPulseCount = 0;
volatile unsigned long lastFlowEdgeMs = 0;
unsigned long pulseCountAtPumpStart = 0;
unsigned long lastFlowPulseSnapshot = 0;
unsigned long lastFlowSampleMs = 0;
float cumulativeWaterLitres = 0.0f;
bool flowFault = false;
SensorSample latestSample;
bool haveSample = false;
unsigned long lastSensorMs = 0;

bool pumpOn = false;
bool safetyLock = false;
bool commsFault = false;
bool timeSynced = false;
bool wifiWasConnected = false;
bool firstTelemetrySent = false;
bool autoIrrigationPaused = false;
String lastCommandIdJson = "";
String lastAckPayload = "";
unsigned long bootMs = 0;
unsigned long lastStateChangeMs = 0;
unsigned long pumpStartedMs = 0;
unsigned long lastBackendOkMs = 0;
unsigned long lastTelemetryMs = 0;
unsigned long lastCommandPollMs = 0;
unsigned long lastWifiRetryMs = 0;
int telemetryFailStreak = 0;

void IRAM_ATTR onFlowPulse() {
  portENTER_CRITICAL_ISR(&flowMux);
  flowPulseCount++;
  lastFlowEdgeMs = millis();
  portEXIT_CRITICAL_ISR(&flowMux);
}

FlowSnapshot readFlowSnapshot() {
  portENTER_CRITICAL(&flowMux);
  FlowSnapshot snapshot{flowPulseCount, lastFlowEdgeMs, millis()};
  portEXIT_CRITICAL(&flowMux);
  return snapshot;
}

int relayLevelFor(bool on) {
  if (RELAY_ACTIVE_LOW) return on ? LOW : HIGH;
  return on ? HIGH : LOW;
}

void setPump(bool on, bool force) {
  unsigned long now = millis();
  if (!force && on == pumpOn) return;
  if (!force && (now - lastStateChangeMs) < MIN_PUMP_STATE_CHANGE_MS) return;
  if (on && safetyLock) return;

  digitalWrite(RELAY_PUMP_PIN, relayLevelFor(on));
  digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
  Serial.printf("PUMP: %s  GPIO%d=%s readback=%d\n", on ? "ON" : "OFF", RELAY_PUMP_PIN,
                relayLevelFor(on) == HIGH ? "HIGH" : "LOW", digitalRead(RELAY_PUMP_PIN));
  pumpOn = on;
  lastStateChangeMs = now;
  flowFault = false;
  if (on) {
    pumpStartedMs = now;
    pulseCountAtPumpStart = readFlowSnapshot().count;
  }
}

void enforcePumpWatchdogs(bool wifiConnected) {
  unsigned long now = millis();
  bool timedOut = COMMS_LOSS_TIMEOUT_MS > 0 && (now - lastBackendOkMs) >= COMMS_LOSS_TIMEOUT_MS;
  if (timedOut) commsFault = true;

  if (!pumpOn) return;
  if (MAX_PUMP_RUN_MS > 0 && (now - pumpStartedMs) >= MAX_PUMP_RUN_MS) {
    autoIrrigationPaused = true;
    Serial.println("SAFE: max pump runtime reached — forcing pump OFF");
    setPump(false, true);
    return;
  }
  if (timedOut) {
    autoIrrigationPaused = true;
    Serial.println("SAFE: Wi-Fi/backend comms timeout — forcing pump OFF");
    setPump(false, true);
  }
}

void enforceMoistureControl() {
  if (!AUTO_IRRIGATION_ENABLED) return;
  unsigned long now = millis();
  bool fresh = haveSample && now - lastSensorMs <= SENSOR_SAMPLE_INTERVAL_MS * 2;
  bool backendHealthy = WiFi.status() == WL_CONNECTED && !commsFault &&
                        now - lastBackendOkMs < COMMS_LOSS_TIMEOUT_MS;
  bool allowStart = RELAY_INTERFACE_VERIFIED && !autoIrrigationPaused &&
                    !safetyLock && backendHealthy && !flowFault;
  MoistureAction action = moistureAction(
      fresh && latestSample.soil.valid, latestSample.soil.moisturePct,
      pumpOn, allowStart, AUTO_START_MOISTURE_PCT, AUTO_STOP_MOISTURE_PCT);
  if (action == MoistureAction::Stop || (pumpOn && flowFault)) {
    if (flowFault) autoIrrigationPaused = true;
    Serial.println("AUTO: stop (wet soil, invalid/stale sensor, or no flow)");
    setPump(false, true);
  } else if (action == MoistureAction::Start) {
    Serial.println("AUTO: start (dry soil)");
    setPump(true, false);
  }
}

bool readDHT22(float &temperatureC, float &humidityPct) {
  if (!DHT22_PRESENT) return false;
  humidityPct = climateSensor.readHumidity();
  temperatureC = climateSensor.readTemperature();
  if (isnan(humidityPct) || isnan(temperatureC)) return false;
  if (humidityPct < 0 || humidityPct > 100) return false;
  if (temperatureC < -40 || temperatureC > 80) return false;
  return true;
}

SoilReading readSoil() {
  SoilReading r;
  const int samples = SOIL_SAMPLES > 0 ? SOIL_SAMPLES : 1;
  (void)analogRead(SOIL_ADC_PIN);  // discard first ADC mux settling sample
  delay(2);
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(SOIL_ADC_PIN);
    delay(5);
  }
  r.rawAdc = (int)(sum / samples);

  if (r.rawAdc <= SOIL_ADC_FAULT_LOW || r.rawAdc >= SOIL_ADC_FAULT_HIGH) {
    r.valid = false;
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
  if (!getLocalTime(&t, 10)) return "";
  if ((t.tm_year + 1900) < 2024) return "";
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

String jsonFloatOrNull(float v, bool valid, int digits) {
  if (!valid || !isfinite(v)) return "null";
  return String(v, digits);
}

String encodeCommandId(const cJSON *id) {
  if (cJSON_IsString(id) && id->valuestring[0] != '\0') {
    char *quoted = cJSON_PrintUnformatted(id);
    if (quoted == nullptr) return "";
    String result(quoted);
    cJSON_free(quoted);
    return result;
  }
  if (cJSON_IsNumber(id)) {
    double n = id->valuedouble;
    if (n >= 0 && n <= 9007199254740991.0 && floor(n) == n) {
      char buf[24];
      snprintf(buf, sizeof(buf), "%.0f", n == 0 ? 0.0 : n);
      return String(buf);
    }
  }
  return "";
}

bool beginRequest(HTTPClient &http, const String &url) {
  if (!http.begin(url)) {
    Serial.println("HTTP client could not open the configured backend URL");
    return false;
  }
  http.setConnectTimeout(BACKEND_IO_TIMEOUT_MS);
  http.setTimeout(BACKEND_IO_TIMEOUT_MS);
  return true;
}

bool postJson(const String &url, const String &payload) {
  HTTPClient http;
  if (!beginRequest(http, url)) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  if (code < 200 || code >= 300) {
    String detail = code > 0 ? http.getString().substring(0, 256) : http.errorToString(code);
    Serial.printf("POST failed: %s HTTP %d %s\n", url.c_str(), code, detail.c_str());
  }
  http.end();
  return code >= 200 && code < 300;
}

bool sendTelemetry(const SensorSample &sample) {
  const SoilReading &soil = sample.soil;
  const ClimateReading &climate = sample.climate;
  const String &ts = sample.recordedAt;

  String payload = "{";
  payload += "\"device_code\":\"" + String(DEVICE_CODE) + "\",";
  payload += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  payload += "\"firmware_version\":\"esp32-real-1.8.0\",";
  payload += "\"recorded_at\":" + (ts.length() ? ("\"" + ts + "\"") : "null") + ",";
  payload += "\"uptime_ms\":" + String(millis()) + ",";
  payload += "\"raw_adc\":" + (soil.valid ? String(soil.rawAdc) : "null") + ",";
  payload += "\"soil_adc_diagnostic\":" + String(soil.rawAdc) + ",";
  payload += "\"soil_sensor_valid\":" + String(soil.valid ? "true" : "false") + ",";
  payload += "\"climate_sensor_valid\":" + String(climate.valid ? "true" : "false") + ",";
  payload += "\"dht_idle_level\":" + (sample.dhtIdleLevel < 0 ? String("null") : String(sample.dhtIdleLevel)) + ",";
  payload += "\"soil_moisture_pct\":" + jsonFloatOrNull(soil.moisturePct, soil.valid, 1) + ",";
  payload += "\"temperature_c\":" + jsonFloatOrNull(climate.temperatureC, climate.valid, 1) + ",";
  payload += "\"humidity_pct\":" + jsonFloatOrNull(climate.humidityPct, climate.valid, 1) + ",";
  payload += "\"flow_rate_lpm\":" + jsonFloatOrNull(sample.flowRateLpm, sample.flowValid, 3) + ",";
  payload += "\"flow_pulse_count\":" + (sample.flowValid ? String(sample.pulseCount) : "null") + ",";
  payload += "\"cumulative_water_litres\":" + jsonFloatOrNull(cumulativeWaterLitres, sample.flowValid, 3) + ",";
  payload += "\"flow_fault\":" + String(flowFault ? "true" : "false") + ",";
  payload += "\"relay_active_low\":" + String(RELAY_ACTIVE_LOW ? "true" : "false") + ",";
  payload += "\"relay_gpio_level\":" + String(digitalRead(RELAY_PUMP_PIN)) + ",";
  payload += "\"pump_state\":\"" + String(pumpOn ? "on" : "off") + "\",";
  payload += "\"auto_irrigation_enabled\":" + String(AUTO_IRRIGATION_ENABLED ? "true" : "false") + ",";
  payload += "\"auto_irrigation_paused\":" + String(autoIrrigationPaused ? "true" : "false") + ",";
  payload += "\"relay_interface_verified\":" + String(RELAY_INTERFACE_VERIFIED ? "true" : "false") + ",";
  payload += "\"safety_lock\":" + String(safetyLock ? "true" : "false") + ",";
  payload += "\"comms_fault\":" + String(commsFault ? "true" : "false") + ",";
  payload += "\"simulated\":" + String(SIMULATE_SENSORS ? "true" : "false");
  payload += "}";

  String url = String(BACKEND_BASE_URL) + "/api/devices/" + DEVICE_CODE + "/telemetry";
  return postJson(url, payload);
}

String makeAck(const String &commandIdJson, bool accepted, const String &reason) {
  String payload = "{";
  payload += "\"device_code\":\"" + String(DEVICE_CODE) + "\",";
  payload += "\"command_id\":" + commandIdJson + ",";
  payload += "\"accepted\":" + String(accepted ? "true" : "false") + ",";
  payload += "\"pump_state\":\"" + String(pumpOn ? "on" : "off") + "\",";
  payload += "\"reason\":\"" + reason + "\"";
  payload += "}";
  return payload;
}

void sendLastAck() {
  String url = String(BACKEND_BASE_URL) + "/api/devices/" + DEVICE_CODE + "/ack";
  if (!postJson(url, lastAckPayload))
    Serial.println("ACK failed; a redelivery will retry the original result");
}

void executeCommand(const String &commandIdJson, const String &command) {
  if (commandIdJson.length() == 0) {
    Serial.println("Command ignored: missing or invalid command_id");
    return;
  }
  if (commandIdJson == lastCommandIdJson) {
    sendLastAck();
    return;
  }

  bool accepted = true;
  String reason = "ok";

  if (command == "start") {
    if (safetyLock) {
      accepted = false;
      reason = "safety_lock_active";
    } else if (AUTO_IRRIGATION_ENABLED && !RELAY_INTERFACE_VERIFIED) {
      accepted = false;
      reason = "relay_interface_not_verified";
    } else if (AUTO_IRRIGATION_ENABLED &&
               (!haveSample || !latestSample.soil.valid ||
                !isfinite(latestSample.soil.moisturePct) ||
                millis() - lastSensorMs > SENSOR_SAMPLE_INTERVAL_MS * 2)) {
      accepted = false;
      reason = "soil_sensor_invalid_or_stale";
    } else if (AUTO_IRRIGATION_ENABLED &&
               latestSample.soil.moisturePct >= AUTO_STOP_MOISTURE_PCT) {
      accepted = false;
      reason = "soil_already_wet";
    } else {
      setPump(true, false);
      if (!pumpOn) {
        accepted = false;
        reason = "minimum_state_change_interval";
      }
    }
  } else if (command == "stop") {
    autoIrrigationPaused = true;
    setPump(false, true);
  } else if (command == "emergency_stop") {
    autoIrrigationPaused = true;
    safetyLock = true;
    setPump(false, true);
    reason = "emergency_stop_latched";
  } else if (command == "clear_safety") {
    if (pumpOn) {
      accepted = false;
      reason = "pump_must_be_off_before_clearing_safety";
    } else {
      safetyLock = false;
      autoIrrigationPaused = false;  // explicit operator re-arm, still hardware-gated
    }
  } else {
    accepted = false;
    reason = "unknown_command";
  }

  lastCommandIdJson = commandIdJson;
  lastAckPayload = makeAck(commandIdJson, accepted, reason);
  Serial.printf("COMMAND: %s accepted=%d reason=%s\n", command.c_str(), accepted, reason.c_str());
  sendLastAck();
}

void pollCommand() {
  String url = String(BACKEND_BASE_URL) + "/api/devices/" + DEVICE_CODE + "/command";
  HTTPClient http;
  if (!beginRequest(http, url)) return;
  int code = http.GET();
  if (code == 204) {
    http.end();
    lastBackendOkMs = millis();
    commsFault = false;
    return;
  }
  if (code != 200) {
    String detail = code > 0 ? http.getString().substring(0, 256) : http.errorToString(code);
    Serial.printf("Command poll failed: HTTP %d %s\n", code, detail.c_str());
    http.end();
    return;
  }
  String body = http.getString();
  http.end();
  cJSON *doc = cJSON_ParseWithOpts(body.c_str(), nullptr, true);
  if (!cJSON_IsObject(doc)) {
    cJSON_Delete(doc);
    Serial.println("Command poll returned invalid JSON");
    return;
  }
  const char *text = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(doc, "command"));
  String command(text == nullptr ? "" : text);
  String commandIdJson = encodeCommandId(cJSON_GetObjectItemCaseSensitive(doc, "command_id"));
  cJSON_Delete(doc);

  lastBackendOkMs = millis();
  commsFault = false;
  if (command.length() && command != "none") executeCommand(commandIdJson, command);
}

void simulateSensors(SensorSample &s, unsigned long intervalMs) {
  static float phase = 0.0f;
  static float fractionalPulse = 0.0f;
  static unsigned long totalPulses = 0;
  phase += 0.05f;
  s.soil.valid = true;
  s.soil.rawAdc = (int)(2100 + 250 * sin(phase));
  s.soil.moisturePct = 45.0f + 5.0f * sin(phase);
  s.climate.valid = true;
  s.climate.temperatureC = 27.0f + 0.4f * sin(phase * 0.7f);
  s.climate.humidityPct = 62.0f + 2.0f * cos(phase * 0.5f);
  if (FLOW_SENSOR_PRESENT) {
    s.flowValid = true;
    s.flowRateLpm = pumpOn ? 2.5f : 0.0f;
    float litres = s.flowRateLpm * intervalMs / 60000.0f;
    float pulses = litres * FLOW_PULSES_PER_LITRE + fractionalPulse;
    s.intervalPulses = (unsigned long)pulses;
    fractionalPulse = pulses - s.intervalPulses;
    totalPulses += s.intervalPulses;
    s.pulseCount = totalPulses;
    cumulativeWaterLitres += litres;
  }
}

void readFlow(SensorSample &s) {
  FlowSnapshot ticks = readFlowSnapshot();
  unsigned long elapsed = ticks.sampledMs - lastFlowSampleMs;
  if (elapsed == 0) return;
  s.flowValid = true;
  s.pulseCount = ticks.count;
  s.intervalPulses = ticks.count - lastFlowPulseSnapshot;
  float litres = static_cast<float>(s.intervalPulses) / FLOW_PULSES_PER_LITRE;
  s.flowRateLpm = litres * 60000.0f / elapsed;
  cumulativeWaterLitres += litres;
  lastFlowPulseSnapshot = ticks.count;
  lastFlowSampleMs = ticks.sampledMs;

  unsigned long referenceMs = ticks.count == pulseCountAtPumpStart ? pumpStartedMs : ticks.lastEdgeMs;
  bool noFlow = pumpOn && (ticks.sampledMs - referenceMs >= FLOW_NO_PULSE_TIMEOUT_MS);
  if (noFlow && !flowFault) Serial.println("FLOW: pump commanded ON, no new pulses detected");
  flowFault = noFlow;
}

void sampleSensors(unsigned long intervalMs) {
  SensorSample sample;
  if (SIMULATE_SENSORS) {
    simulateSensors(sample, intervalMs);
  } else {
    sample.soil = readSoil();
    if (DHT22_PRESENT) {
      sample.climate.valid = readDHT22(sample.climate.temperatureC, sample.climate.humidityPct);
      sample.dhtIdleLevel = digitalRead(DHT_DATA_PIN);
    }
    if (FLOW_SENSOR_PRESENT) readFlow(sample);
  }
  sample.recordedAt = iso8601Now();
  latestSample = sample;
  haveSample = true;
}

void printSample(const SensorSample &s, bool wifiConnected) {
  String soil = jsonFloatOrNull(s.soil.moisturePct, s.soil.valid, 1);
  String temp = jsonFloatOrNull(s.climate.temperatureC, s.climate.valid, 1);
  String humidity = jsonFloatOrNull(s.climate.humidityPct, s.climate.valid, 1);
  String rate = jsonFloatOrNull(s.flowRateLpm, s.flowValid, 3);
  String idle = s.dhtIdleLevel < 0 ? String("null") : String(s.dhtIdleLevel);
  String pulses = s.flowValid ? String(s.pulseCount) : String("null");
  String delta = s.flowValid ? String(s.intervalPulses) : String("null");
  Serial.printf("SENSORS source=%s wifi=%s pump=%s relay_target=%s relay_gpio=%d "
                "soil_adc=%d soil_valid=%d soil_pct=%s climate_valid=%d temp_c=%s "
                "humidity_pct=%s dht_idle=%s flow_pulses=%s flow_delta=%s flow_lpm=%s flow_fault=%d\n",
                SIMULATE_SENSORS ? "simulated" : "real", wifiConnected ? "up" : "down",
                pumpOn ? "on" : "off", relayLevelFor(pumpOn) == HIGH ? "HIGH" : "LOW",
                digitalRead(RELAY_PUMP_PIN), s.soil.rawAdc, s.soil.valid, soil.c_str(),
                s.climate.valid, temp.c_str(), humidity.c_str(), idle.c_str(),
                pulses.c_str(), delta.c_str(), rate.c_str(), flowFault);
}

void setup() {
  gpio_set_level(static_cast<gpio_num_t>(RELAY_PUMP_PIN), relayLevelFor(false));
  pinMode(RELAY_PUMP_PIN, OUTPUT);
  digitalWrite(RELAY_PUMP_PIN, relayLevelFor(false));
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  Serial.begin(115200);
  Serial.printf("\nRelay driver: %s, OFF=%s\n", RELAY_ACTIVE_LOW ? "active-low" : "active-high",
                relayLevelFor(false) == HIGH ? "HIGH" : "LOW");
  setPump(false, true);
  Serial.printf("Sensor pins: soil=%d DHT22=%d (enabled=%d) flow=%d (enabled=%d) simulated=%d\n",
                SOIL_ADC_PIN, DHT_DATA_PIN, DHT22_PRESENT, FLOW_PULSE_PIN,
                FLOW_SENSOR_PRESENT, SIMULATE_SENSORS);

  if (!SIMULATE_SENSORS) {
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);
    if (DHT22_PRESENT) climateSensor.begin();
    if (FLOW_SENSOR_PRESENT) {
      pinMode(FLOW_PULSE_PIN, INPUT_PULLUP);
      lastFlowSampleMs = millis();
      attachInterrupt(digitalPinToInterrupt(FLOW_PULSE_PIN), onFlowPulse, FALLING);
    }
  }

  lastSensorMs = millis();
  lastTelemetryMs = lastSensorMs;
  lastCommandPollMs = lastSensorMs;
  lastBackendOkMs = lastSensorMs;
  lastWifiRetryMs = lastSensorMs;

  if (WIFI_SSID[0] != '\0') {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    Serial.println("Connecting to Wi-Fi; local sensing is enabled");
  } else {
    Serial.println("No Wi-Fi settings. Local sensor diagnostics are enabled");
  }
}

void loop() {
  enforcePumpWatchdogs(WiFi.status() == WL_CONNECTED);
  unsigned long now = millis();
  bool connected = WiFi.status() == WL_CONNECTED;

  if (connected && !timeSynced) {
    struct tm t;
    timeSynced = getLocalTime(&t, 0) && (t.tm_year + 1900 >= 2024);
  }
  if (now - lastSensorMs >= SENSOR_SAMPLE_INTERVAL_MS) {
    unsigned long intervalMs = now - lastSensorMs;
    lastSensorMs = now;
    sampleSensors(intervalMs);
    enforceMoistureControl();
    printSample(latestSample, connected);
  }

  if (!connected) {
    if (!wifiWasConnected) {
      Serial.println("Wi-Fi disconnected");
      wifiWasConnected = false;
    }
    if (WIFI_SSID[0] != '\0' && now - lastWifiRetryMs >= WIFI_RETRY_INTERVAL_MS) {
      lastWifiRetryMs = now;
      if (WiFi.status() != WL_IDLE_STATUS) WiFi.reconnect();
    }
  } else {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.printf("Wi-Fi connected IP=%s RSSI=%d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      lastWifiRetryMs = now;
    }
    if (BACKEND_BASE_URL[0] != '\0') {
      now = millis();
      if (now - lastCommandPollMs >= COMMAND_POLL_INTERVAL_MS) {
        lastCommandPollMs = now;
        pollCommand();
        enforcePumpWatchdogs(true);
      }
      now = millis();
      if (haveSample && (firstTelemetrySent
          ? now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS
          : now - bootMs >= 3000UL)) {
        lastTelemetryMs = now;
        firstTelemetrySent = true;
        bool ok = sendTelemetry(latestSample);
        if (ok) {
          lastBackendOkMs = millis();
          commsFault = false;
          telemetryFailStreak = 0;
        } else {
          if (++telemetryFailStreak >= 3) commsFault = true;
        }
        Serial.printf("TELEMETRY: %s\n", ok ? "OK" : "FAILED");
      }
    }
  }
  enforcePumpWatchdogs(connected);
  enforceMoistureControl();
  delay(50);
}
