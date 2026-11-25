#pragma once

// Smart Irrigation ESP32 configuration.
// Fill in the Wi-Fi/backend values before flashing. Do not commit real
// credentials to a shared repository.

// --- Network / backend ---
#if __has_include("config.local.h")
#include "config.local.h"
#else
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define BACKEND_BASE_URL "http://192.168.1.10:8000"
#define DEVICE_CODE "ESP32-REAL-001"
#endif

// --- Timing & pump safety watchdogs ---
#define TELEMETRY_INTERVAL_MS 15000UL
#define COMMAND_POLL_INTERVAL_MS 2000UL
#define WIFI_RETRY_INTERVAL_MS 5000UL
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
// Most common 5V relay modules are active-LOW.
#define RELAY_ACTIVE_LOW true

// --- Safe GPIO map (ESP32 DevKit; avoids boot-strapping pins) ---
#define SOIL_ADC_PIN 32      // ADC1, safe with Wi-Fi on
#define DHT_DATA_PIN 33
#define FLOW_PULSE_PIN 25    // interrupt-capable digital input
#define RELAY_PUMP_PIN 27
#define STATUS_LED_PIN 13
