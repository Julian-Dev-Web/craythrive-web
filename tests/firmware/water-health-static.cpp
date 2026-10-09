#include "WaterReadingHealth.h"

constexpr bool waterHealthScenarios() {
  WaterReadingHealth water(15000);
  if (water.hasNumericValue() || water.measurementFresh()) return false;
  // A: continuous successful HC-SR04 measurements.
  for (uint32_t now = 0; now <= 20000; now += 5000) {
    water.recordSuccess(now);
    if (!water.measurementFresh() || water.consecutiveFailures != 0) return false;
  }
  // B: one failed measurement, then immediate recovery.
  water.recordFailure(25000);
  if (water.state != WaterHealthState::Stale || !water.hasNumericValue() || water.measurementFresh()) return false;
  if (water.health()[0] != 'W' || water.valueSource()[0] != 'l') return false;
  water.recordSuccess(30000);
  if (water.state != WaterHealthState::Fresh || water.consecutiveFailures != 0) return false;
  // C: two failures remain stale, then recovery.
  water.recordFailure(35000);
  water.recordFailure(40000);
  if (water.state != WaterHealthState::Stale || water.consecutiveFailures != 2) return false;
  water.recordSuccess(45000);
  // D: third consecutive failure is confirmed, no numeric fallback.
  water.recordFailure(50000);
  water.recordFailure(55000);
  water.recordFailure(60000);
  if (water.state != WaterHealthState::Error || water.hasNumericValue() || water.health()[0] != 'E') return false;
  // E: repeated failures cannot reset or overflow the failure counter.
  for (int i = 0; i < 100000; ++i) water.recordFailure(65000);
  if (water.consecutiveFailures != 3 || water.state != WaterHealthState::Error) return false;
  // F/G: fresh success resets the episode; a later new error can be confirmed.
  water.recordSuccess(70000);
  if (water.consecutiveFailures != 0 || !water.measurementFresh() || water.warningFlag()[0] != '\0') return false;
  water.recordFailure(75000);
  water.recordFailure(80000);
  water.recordFailure(85000);
  return water.state == WaterHealthState::Error;
}

constexpr bool startupExpiryAndRollover() {
  WaterReadingHealth startup(15000);
  startup.recordFailure(5000);
  if (startup.state != WaterHealthState::Waiting || startup.hasNumericValue()) return false;
  startup.recordFailure(10000);
  if (startup.state != WaterHealthState::Waiting || startup.warningFlag()[0] != '\0') return false;
  startup.recordFailure(15000);
  if (startup.state != WaterHealthState::Error || startup.hasNumericValue()) return false;
  WaterReadingHealth expired(15000);
  expired.recordSuccess(0); // millis() == 0 is a valid measurement timestamp.
  expired.recordFailure(15001);
  if (expired.state != WaterHealthState::Error) return false;
  expired.recordSuccess(20000);
  expired.expire(35001);
  if (expired.state != WaterHealthState::Error || expired.hasNumericValue()) return false;
  WaterReadingHealth rollover(15000);
  rollover.recordSuccess(0xfffffff0U);
  rollover.recordFailure(0x00001378U); // +5000 ms across millis() rollover.
  return rollover.state == WaterHealthState::Stale && rollover.lastGoodAgeMs(0x00001378U) == 5000;
}

static_assert(waterHealthScenarios(), "Water measurement/recovery scenarios A-G must pass");
static_assert(startupExpiryAndRollover(), "Startup, cache expiry and millis rollover must be safe");
