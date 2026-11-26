#pragma once

// Smart Irrigation ESP32 configuration.
// Network settings come from your private config.local.h. Empty defaults
// allow USB sensor diagnostics with the network and remote commands disabled.

// --- Network / backend ---
#if __has_include("config.local.h")
#include "config.local.h"
#else
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define BACKEND_BASE_URL ""
#define DEVICE_CODE "ESP32-REAL-001"
#endif

// --- Timing & pump safety watchdogs ---
#define SENSOR_SAMPLE_INTERVAL_MS 2500UL  // DHT22 requires at least 2 seconds
#define BACKEND_IO_TIMEOUT_MS 1500       // TCP connect and stream read timeout, each
#define TELEMETRY_INTERVAL_MS 15000UL
#define COMMAND_POLL_INTERVAL_MS 2000UL
#define WIFI_RETRY_INTERVAL_MS 30000UL
#define MIN_PUMP_STATE_CHANGE_MS 800UL   // relay chatter guard
#define MAX_PUMP_RUN_MS 900000UL         // 15 min max continuous run cutoff
#define COMMS_LOSS_TIMEOUT_MS 60000UL    // stop pump if Wi-Fi/backend lost >60 s

// --- Soil moisture calibration ---
// Record these from the real sensor. Direction is handled in firmware:
// percentage is computed from dry -> wet whether dry ADC is higher or lower
// than wet ADC. These defaults are placeholders and must be replaced.
#define SOIL_DRY_ADC 3000
#define SOIL_WET_ADC 1200
#define SOIL_SAMPLES 10
// Raw ADC outside this window is treated as sensor fault, not moisture.
#define SOIL_ADC_FAULT_LOW 40
#define SOIL_ADC_FAULT_HIGH 4055

// --- Automatic irrigation ---
#define AUTO_IRRIGATION_ENABLED true
#define AUTO_START_MOISTURE_PCT 35.0f
#define AUTO_STOP_MOISTURE_PCT 68.0f
// Do not arm unattended operation until actual START/STOP relay behavior and
// the soil dry/wet calibration have been physically verified.
#define RELAY_INTERFACE_VERIFIED false

// --- Flow sensor ---
#define FLOW_SENSOR_PRESENT true
#define FLOW_PULSES_PER_LITRE 450.0f  // replace with measured calibration
// Pump running with zero pulses for this long is reported as flow_fault:
// the sensor is not wired/level-shifted correctly, or no water is moving.
#define FLOW_NO_PULSE_TIMEOUT_MS 10000UL

// --- DHT22 ---
#define DHT22_PRESENT true

// --- Explicit bench-test simulation ---
// When true, sensor values are simulated and telemetry is marked
// "simulated": true. Never enable this for field/demo-evidence runs.
#define SIMULATE_SENSORS false

// --- Relay wiring ---
// User-requested LOW as the configured OFF signal.
// Physical relay polarity remains unverified: disconnect pump power for testing.
// true: direct, verified 3.3V-compatible active-LOW input.
// false: verified active-HIGH input, or NPN driver into an active-LOW input.
// A 5V input that cannot release at 3.3V needs a hardware interface;
// flipping polarity alone does not fix that electrical incompatibility.
// VCC/JD-VCC split wiring depends on the module schematic, not just labels.
#define RELAY_ACTIVE_LOW false

// --- Safe GPIO map (ESP32 DevKit; avoids boot-strapping pins) ---
#define SOIL_ADC_PIN 32      // ADC1, safe with Wi-Fi on
#define DHT_DATA_PIN 33
#define FLOW_PULSE_PIN 25    // interrupt-capable digital input
#define RELAY_PUMP_PIN 27
#define STATUS_LED_PIN 13
