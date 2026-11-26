#pragma once

#include <Arduino.h>
#include <math.h>

// Shared types also need to be visible to the Arduino sketch preprocessor.
struct SoilReading {
  bool valid = false;
  int rawAdc = 0;
  float moisturePct = NAN;
};

struct ClimateReading {
  bool valid = false;
  float temperatureC = NAN;
  float humidityPct = NAN;
};

struct SensorSample {
  SoilReading soil;
  ClimateReading climate;
  int dhtIdleLevel = -1;
  bool flowValid = false;
  float flowRateLpm = 0.0f;
  unsigned long pulseCount = 0;
  unsigned long intervalPulses = 0;
  String recordedAt;
};

struct FlowSnapshot {
  unsigned long count;
  unsigned long lastEdgeMs;
  unsigned long sampledMs;
};
