#pragma once
#include <atomic>
#include <cstdint>

// Shared between the cloud monitor task and the local actuator loop. A resume
// cannot make an interrupted action's old token valid again.
class EmergencyStopGuard {
  std::atomic<bool> latched_{false};
  std::atomic<bool> verified_{false};
  std::atomic<uint32_t> generation_{0};
public:
  bool latched() const { return latched_.load(); }
  bool verified() const { return verified_.load(); }
  bool canRun() const { return verified() && !latched(); }
  uint32_t token() const { return generation_.load(); }
  bool interrupted(uint32_t token) const { return !canRun() || token != generation_.load(); }
  void verify(bool verified) {
    if (verified) verified_.store(true);
    else if (verified_.exchange(false)) generation_.fetch_add(1);
  }
  void invalidate() { generation_.fetch_add(1); }
  void latch() {
    if (!latched_.exchange(true)) generation_.fetch_add(1);
  }
  void confirmedResume() { latched_.store(false); }
};

// The main task owns normal routines; the stop monitor must not Resume an old
// automatic/interlock routine merely because a single pump pulse just ended.
class EmergencyRoutineScope {
  std::atomic<bool>& active_;
  bool previous_;
public:
  explicit EmergencyRoutineScope(std::atomic<bool>& active) : active_(active), previous_(active.exchange(true)) {}
  ~EmergencyRoutineScope() { active_.store(previous_); }
  EmergencyRoutineScope(const EmergencyRoutineScope&) = delete;
  EmergencyRoutineScope& operator=(const EmergencyRoutineScope&) = delete;
};
