#pragma once

#include <math.h>

enum class MoistureAction { Hold, Start, Stop };

// Two thresholds prevent oscillation around a single moisture setpoint.
inline MoistureAction moistureAction(bool valid, float moisture, bool pumpOn,
                                     bool allowStart, float startPct, float stopPct) {
  if (!valid || !isfinite(moisture) || moisture < 0 || moisture > 100 ||
      startPct < 0 || stopPct > 100 || !(startPct < stopPct)) {
    return pumpOn ? MoistureAction::Stop : MoistureAction::Hold;
  }
  if (moisture >= stopPct) {
    return pumpOn ? MoistureAction::Stop : MoistureAction::Hold;
  }
  if (!pumpOn && allowStart && moisture <= startPct) return MoistureAction::Start;
  return MoistureAction::Hold;
}
