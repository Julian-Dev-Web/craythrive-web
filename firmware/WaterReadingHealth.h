#pragma once
#include <stdint.h>

// Measurement health only. Water depth calibration and severity bands remain
// owned by the sensor sketch's existing getWaterStatusByLevel().
enum class WaterHealthState { Waiting, Fresh, Stale, Error };

struct WaterReadingHealth {
  static constexpr uint8_t WATER_FAILURES_BEFORE_ERROR = 3;
  const uint32_t maxLastGoodAgeMs;
  uint32_t lastGoodAt = 0;
  uint8_t consecutiveFailures = 0;
  bool hasEverGoodReading = false;
  WaterHealthState state = WaterHealthState::Waiting;

  constexpr explicit WaterReadingHealth(uint32_t maxAgeMs)
    : maxLastGoodAgeMs(maxAgeMs) {}

  constexpr uint32_t lastGoodAgeMs(uint32_t now) const {
    return static_cast<uint32_t>(now - lastGoodAt);
  }

  constexpr bool hasRecentGoodReading(uint32_t now) const {
    return hasEverGoodReading && lastGoodAgeMs(now) <= maxLastGoodAgeMs;
  }

  constexpr void recordSuccess(uint32_t now) {
    lastGoodAt = now;
    hasEverGoodReading = true;
    consecutiveFailures = 0;
    state = WaterHealthState::Fresh;
  }

  constexpr void recordFailure(uint32_t now) {
    // Saturate so prolonged failures cannot overflow and look like recovery.
    if (consecutiveFailures < WATER_FAILURES_BEFORE_ERROR) ++consecutiveFailures;
    if (consecutiveFailures >= WATER_FAILURES_BEFORE_ERROR) {
      state = WaterHealthState::Error;
    } else if (!hasEverGoodReading) {
      state = WaterHealthState::Waiting;
    } else {
      state = hasRecentGoodReading(now) ? WaterHealthState::Stale : WaterHealthState::Error;
    }
  }

  constexpr void expire(uint32_t now) {
    if (hasEverGoodReading && !hasRecentGoodReading(now)) state = WaterHealthState::Error;
  }

  constexpr bool hasNumericValue() const {
    return state == WaterHealthState::Fresh || state == WaterHealthState::Stale;
  }

  constexpr bool measurementFresh() const { return state == WaterHealthState::Fresh; }
  constexpr const char* valueSource() const {
    return state == WaterHealthState::Fresh ? "fresh"
      : state == WaterHealthState::Stale ? "last_good" : "unavailable";
  }
  constexpr const char* health() const {
    return state == WaterHealthState::Fresh ? "OK"
      : state == WaterHealthState::Error ? "ERROR" : "WARNING";
  }
  constexpr const char* warningFlag() const {
    return state == WaterHealthState::Stale ? "WATER_LEVEL_SENSOR_STALE"
      : state == WaterHealthState::Error ? "WATER_LEVEL_SENSOR_ERROR" : "";
  }
};
