import Foundation
import HealthKit

/// Pure deterministic physiological math & aggregation helpers shared across HealthKit, BLE, and XCTests.
enum HealthMetricsMath {

  /// Computes RMSSD (`sqrt(mean((dt_i+1 - dt_i)^2))` in ms) from heartbeat series timestamps.
  /// Excludes any gap (`precededByGap == true`) or beat-to-beat interval `<= 0` or `> maxGapMs` (default 2000ms)
  /// by breaking into contiguous beat runs so gaps never fabricate artificial differences.
  /// Shortest believable beat-to-beat interval (240 bpm).
  static let minIntervalMs = 250.0

  static func computeRMSSD(
    fromHeartbeatSeries beats: [(timeSinceStart: TimeInterval, precededByGap: Bool)],
    maxGapMs: Double = 2000.0
  ) -> Double? {
    guard beats.count >= 3 else { return nil }

    var segments: [[Double]] = []
    var currentSegment: [Double] = []
    var lastTime: TimeInterval?

    for beat in beats {
      guard beat.timeSinceStart.isFinite else {
        if !currentSegment.isEmpty {
          segments.append(currentSegment)
          currentSegment.removeAll(keepingCapacity: true)
        }
        lastTime = nil
        continue
      }

      if beat.precededByGap || lastTime == nil {
        if !currentSegment.isEmpty {
          segments.append(currentSegment)
          currentSegment.removeAll(keepingCapacity: true)
        }
        lastTime = beat.timeSinceStart
        continue
      }

      let dtMs = (beat.timeSinceStart - (lastTime ?? beat.timeSinceStart)) * 1000.0
      lastTime = beat.timeSinceStart

      // Unsorted / duplicate beats give dt <= 0 and too-short dt is a double-count:
      // both end the segment so no fake successive difference is formed.
      if dtMs >= minIntervalMs && dtMs <= maxGapMs {
        currentSegment.append(dtMs)
      } else if !currentSegment.isEmpty {
        segments.append(currentSegment)
        currentSegment.removeAll(keepingCapacity: true)
      }
    }

    if !currentSegment.isEmpty {
      segments.append(currentSegment)
    }

    return rmssdAcrossSegments(segments)
  }

  /// Computes RMSSD (`sqrt(mean((dt_i+1 - dt_i)^2))` in ms) from RR intervals in milliseconds,
  /// excluding invalid intervals or gaps `> maxValidIntervalMs` (default 2000ms).
  static func computeRMSSD(
    fromRRIntervalsMs intervals: [Double],
    maxValidIntervalMs: Double = 2000.0
  ) -> Double? {
    guard intervals.count >= 2 else { return nil }

    var segments: [[Double]] = []
    var currentSegment: [Double] = []

    for rr in intervals {
      if rr.isFinite && rr >= minIntervalMs && rr <= maxValidIntervalMs {
        currentSegment.append(rr)
      } else if !currentSegment.isEmpty {
        segments.append(currentSegment)
        currentSegment.removeAll(keepingCapacity: true)
      }
    }

    if !currentSegment.isEmpty {
      segments.append(currentSegment)
    }

    return rmssdAcrossSegments(segments)
  }

  private static func rmssdAcrossSegments(_ segments: [[Double]]) -> Double? {
    var sumSquaredDiffs = 0.0
    var diffCount = 0

    for segment in segments where segment.count >= 2 {
      for idx in 0..<(segment.count - 1) {
        let diff = segment[idx + 1] - segment[idx]
        sumSquaredDiffs += diff * diff
        diffCount += 1
      }
    }

    guard diffCount > 0 else { return nil }
    return sqrt(sumSquaredDiffs / Double(diffCount))
  }

  /// Merges overlapping asleep segments and returns total non-overlapping sleep duration in hours.
  static func mergedSleepHours(from intervals: [(start: Date, end: Date)]) -> Double {
    let valid = intervals
      .filter { $0.end > $0.start }
      .sorted { lhs, rhs in
        if lhs.start != rhs.start { return lhs.start < rhs.start }
        return lhs.end < rhs.end
      }

    guard let first = valid.first else { return 0.0 }

    var merged: [(start: Date, end: Date)] = [first]
    for item in valid.dropFirst() {
      let lastIndex = merged.count - 1
      if item.start <= merged[lastIndex].end {
        if item.end > merged[lastIndex].end {
          merged[lastIndex].end = item.end
        }
      } else {
        merged.append(item)
      }
    }

    let totalSeconds = merged.reduce(0.0) { partial, seg in
      partial + seg.end.timeIntervalSince(seg.start)
    }
    return totalSeconds / 3600.0
  }

  /// Estimates resting HR from general heart rate samples by averaging the quietest 20% of readings.
  static func quietHeartRateFallback(_ samplesBpm: [Double]) -> Double? {
    let valid = samplesBpm.filter { $0.isFinite && $0 >= 25.0 && $0 <= 240.0 }.sorted()
    guard !valid.isEmpty else { return nil }
    let quietCount = max(1, Int(ceil(Double(valid.count) * 0.2)))
    let slice = valid.prefix(quietCount)
    return slice.reduce(0.0, +) / Double(slice.count)
  }

  /// Returns true only for asleep sleep-analysis category values (excluding `.inBed` and `.awake`).
  static func isAsleepCategoryValue(_ rawValue: Int) -> Bool {
    switch rawValue {
    case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
         HKCategoryValueSleepAnalysis.asleepCore.rawValue,
         HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
         HKCategoryValueSleepAnalysis.asleepREM.rawValue:
      return true
    default:
      return false
    }
  }

  static func round(_ value: Double, decimals: Int = 1) -> Double {
    let factor = pow(10.0, Double(decimals))
    return (value * factor).rounded() / factor
  }
}

/// Offline Apple HealthKit reader aggregating daily crew vitals into the BOOPS data contract.
final class HealthKitManager {

  struct Capabilities {
    let available: Bool
    let authorized: Bool
    let status: String
    let detail: String
  }

  struct PermissionResult {
    let granted: Bool
    let missing: [String]
    let message: String
  }

  struct SyncResult {
    let ok: Bool
    let provider: String
    let records: [[String: Any]]
    let message: String
  }

  private let store: HKHealthStore?
  private let calendar: Calendar
  private let dateFormatter: DateFormatter
  private let permissionRequestedDefaultsKey = "space.boops.healthkit.requested"

  private lazy var readTypes: Set<HKObjectType> = {
    var types = Set<HKObjectType>()
    let quantityIds: [HKQuantityTypeIdentifier] = [
      .heartRate,
      .restingHeartRate,
      .heartRateVariabilitySDNN,
      .oxygenSaturation,
      .bloodPressureSystolic,
      .bloodPressureDiastolic,
      .bodyTemperature,
    ]
    for id in quantityIds {
      types.insert(HKQuantityType(id))
    }
    types.insert(HKSeriesType.heartbeat())
    types.insert(HKCategoryType(.sleepAnalysis))
    types.insert(HKObjectType.workoutType())
    return types
  }()

  init(calendar: Calendar = .current) {
    self.store = HKHealthStore.isHealthDataAvailable() ? HKHealthStore() : nil
    self.calendar = calendar
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    self.dateFormatter = formatter
  }

  func fetchCapabilities(completion: @escaping (Capabilities) -> Void) {
    guard let store else {
      completion(
        Capabilities(
          available: false,
          authorized: false,
          status: "unavailable",
          detail: "Apple HealthKit is unavailable on this device."
        )
      )
      return
    }

    let requestedBefore = UserDefaults.standard.bool(forKey: self.permissionRequestedDefaultsKey)
    let lock = NSLock()
    var didComplete = false
    let finishOnce: (Capabilities) -> Void = { caps in
      lock.lock()
      let shouldDeliver = !didComplete
      didComplete = true
      lock.unlock()
      if shouldDeliver {
        completion(caps)
      }
    }

    // Unsigned simulator runs (CODE_SIGNING_ALLOWED=NO) omit HealthKit entitlements and can stall XPC callbacks.
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 1.0) {
      finishOnce(
        Capabilities(
          available: true,
          authorized: requestedBefore,
          status: requestedBefore ? "ready" : "needs_permission",
          detail: "Apple HealthKit available on-device (authorization status fallback)."
        )
      )
    }

    store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { status, error in
      if let error {
        finishOnce(
          Capabilities(
            available: true,
            authorized: requestedBefore,
            status: requestedBefore ? "authorized" : "error",
            detail: "HealthKit status check note: \(error.localizedDescription)"
          )
        )
        return
      }

      switch status {
      case .unnecessary:
        finishOnce(
          Capabilities(
            available: true,
            authorized: true,
            status: "ready",
            detail: "Apple HealthKit read access configured on-device."
          )
        )
      case .shouldRequest:
        finishOnce(
          Capabilities(
            available: true,
            authorized: false,
            status: "needs_permission",
            detail: "Tap to authorize Apple HealthKit read access for vitals, HRV, sleep, and workouts."
          )
        )
      case .unknown:
        finishOnce(
          Capabilities(
            available: true,
            authorized: requestedBefore,
            status: requestedBefore ? "ready" : "unknown",
            detail: "Apple HealthKit authorization status pending."
          )
        )
      @unknown default:
        finishOnce(
          Capabilities(
            available: true,
            authorized: requestedBefore,
            status: "unknown",
            detail: "Apple HealthKit available."
          )
        )
      }
    }
  }

  func requestAuthorization(completion: @escaping (PermissionResult) -> Void) {
    guard let store else {
      completion(
        PermissionResult(
          granted: false,
          missing: ["healthkit_unavailable"],
          message: "Apple HealthKit is not available on this device."
        )
      )
      return
    }

    store.requestAuthorization(toShare: nil, read: readTypes) { [weak self] success, error in
      guard let self else { return }
      if let error {
        completion(
          PermissionResult(
            granted: false,
            missing: ["authorization_error"],
            message: "HealthKit authorization failed: \(error.localizedDescription)"
          )
        )
        return
      }

      if success {
        UserDefaults.standard.set(true, forKey: self.permissionRequestedDefaultsKey)
        completion(
          PermissionResult(
            granted: true,
            missing: [],
            message: "Apple HealthKit read permissions updated. (Note: iOS keeps read-only grant choices private.)"
          )
        )
      } else {
        completion(
          PermissionResult(
            granted: false,
            missing: ["healthkit_denied"],
            message: "Apple HealthKit permission request was cancelled."
          )
        )
      }
    }
  }

  func syncHealthData(daysBack: Int, completion: @escaping (SyncResult) -> Void) {
    guard let store else {
      completion(
        SyncResult(
          ok: false,
          provider: "apple_healthkit",
          records: [],
          message: "Apple HealthKit is unavailable on this device."
        )
      )
      return
    }

    let clampedDays = max(1, min(30, daysBack))
    let now = Date()
    let endOfToday = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
    let startDate = calendar.date(byAdding: .day, value: -(clampedDays - 1), to: calendar.startOfDay(for: now)) ?? now
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endOfToday, options: .strictStartDate)

    Task.detached(priority: .userInitiated) { [weak self] in
      guard let self else { return }

      async let rhrSamplesTask = self.queryQuantitySamples(
        store: store,
        identifier: .restingHeartRate,
        unit: HKUnit.count().unitDivided(by: .minute()),
        predicate: predicate
      )
      async let hrSamplesTask = self.queryQuantitySamples(
        store: store,
        identifier: .heartRate,
        unit: HKUnit.count().unitDivided(by: .minute()),
        predicate: predicate
      )
      async let sdnnSamplesTask = self.queryQuantitySamples(
        store: store,
        identifier: .heartRateVariabilitySDNN,
        unit: HKUnit.secondUnit(with: .milli),
        predicate: predicate
      )
      async let spo2SamplesTask = self.queryQuantitySamples(
        store: store,
        identifier: .oxygenSaturation,
        unit: HKUnit.percent(),
        predicate: predicate
      )
      async let sbpSamplesTask = self.queryQuantitySamples(
        store: store,
        identifier: .bloodPressureSystolic,
        unit: HKUnit.millimeterOfMercury(),
        predicate: predicate
      )
      async let dbpSamplesTask = self.queryQuantitySamples(
        store: store,
        identifier: .bloodPressureDiastolic,
        unit: HKUnit.millimeterOfMercury(),
        predicate: predicate
      )
      async let tempSamplesTask = self.queryQuantitySamples(
        store: store,
        identifier: .bodyTemperature,
        unit: HKUnit.degreeCelsius(),
        predicate: predicate
      )
      async let sleepSegmentsTask = self.querySleepSegments(store: store, predicate: predicate)
      async let workoutsTask = self.queryWorkouts(store: store, predicate: predicate)
      async let heartbeatRmssdByDateTask = self.queryHeartbeatSeriesRMSSDByDate(store: store, predicate: predicate)

      let rhrByDate = await rhrSamplesTask
      let hrByDate = await hrSamplesTask
      let sdnnByDate = await sdnnSamplesTask
      let spo2ByDate = await spo2SamplesTask
      let sbpByDate = await sbpSamplesTask
      let dbpByDate = await dbpSamplesTask
      let tempByDate = await tempSamplesTask
      let sleepByDate = await sleepSegmentsTask
      let workoutsByDate = await workoutsTask
      let rmssdByDate = await heartbeatRmssdByDateTask

      let allDates = Set<String>()
        .union(rhrByDate.keys)
        .union(hrByDate.keys)
        .union(sdnnByDate.keys)
        .union(rmssdByDate.keys)
        .union(spo2ByDate.keys)
        .union(sbpByDate.keys)
        .union(dbpByDate.keys)
        .union(tempByDate.keys)
        .union(sleepByDate.keys)
        .union(workoutsByDate.keys)
        .sorted()

      var records: [[String: Any]] = []
      records.reserveCapacity(allDates.count)

      for dateKey in allDates {
        var row: [String: Any] = [
          "date": dateKey,
          "signal_quality": 0.95,
          "source": "wearable",
        ]
        var hasMetric = false
        var samplesCount = 0

        if let rhrValues = rhrByDate[dateKey], !rhrValues.isEmpty {
          let meanRhr = rhrValues.reduce(0.0, +) / Double(rhrValues.count)
          row["rhr_bpm"] = HealthMetricsMath.round(meanRhr, decimals: 1)
          samplesCount += rhrValues.count
          hasMetric = true
        } else if let hrValues = hrByDate[dateKey], let fallbackRhr = HealthMetricsMath.quietHeartRateFallback(hrValues) {
          row["rhr_bpm"] = HealthMetricsMath.round(fallbackRhr, decimals: 1)
          samplesCount += hrValues.count
          hasMetric = true
        }

        // Prefer true beat-to-beat RMSSD from HKHeartbeatSeries; explicitly tag SDNN fallback so baselines never mislabel.
        if let rmssdValues = rmssdByDate[dateKey], !rmssdValues.isEmpty {
          let meanRmssd = rmssdValues.reduce(0.0, +) / Double(rmssdValues.count)
          row["hrv_rmssd_ms"] = HealthMetricsMath.round(meanRmssd, decimals: 1)
          row["hrv_metric"] = "rmssd"
          samplesCount += rmssdValues.count
          hasMetric = true
        } else if let sdnnValues = sdnnByDate[dateKey], !sdnnValues.isEmpty {
          let meanSdnn = sdnnValues.reduce(0.0, +) / Double(sdnnValues.count)
          row["hrv_rmssd_ms"] = HealthMetricsMath.round(meanSdnn, decimals: 1)
          row["hrv_metric"] = "sdnn"
          samplesCount += sdnnValues.count
          hasMetric = true
        }

        if let sleepIntervals = sleepByDate[dateKey], !sleepIntervals.isEmpty {
          let hours = HealthMetricsMath.mergedSleepHours(from: sleepIntervals)
          if hours > 0 {
            row["sleep_hours"] = HealthMetricsMath.round(hours, decimals: 2)
            samplesCount += sleepIntervals.count
            hasMetric = true
          }
        }

        if let spo2Values = spo2ByDate[dateKey], !spo2Values.isEmpty {
          let meanPct = (spo2Values.reduce(0.0, +) / Double(spo2Values.count)) * 100.0
          let clampedPct = max(0.0, min(100.0, meanPct))
          row["spo2_pct"] = HealthMetricsMath.round(clampedPct, decimals: 1)
          samplesCount += spo2Values.count
          hasMetric = true
        }

        if let sbpValues = sbpByDate[dateKey], !sbpValues.isEmpty {
          row["sbp_mmhg"] = HealthMetricsMath.round(sbpValues.reduce(0.0, +) / Double(sbpValues.count), decimals: 1)
          samplesCount += sbpValues.count
          hasMetric = true
        }

        if let dbpValues = dbpByDate[dateKey], !dbpValues.isEmpty {
          row["dbp_mmhg"] = HealthMetricsMath.round(dbpValues.reduce(0.0, +) / Double(dbpValues.count), decimals: 1)
          samplesCount += dbpValues.count
          hasMetric = true
        }

        if let tempValues = tempByDate[dateKey], !tempValues.isEmpty {
          row["temp_c"] = HealthMetricsMath.round(tempValues.reduce(0.0, +) / Double(tempValues.count), decimals: 2)
          samplesCount += tempValues.count
          hasMetric = true
        }

        if let workoutSummary = workoutsByDate[dateKey], workoutSummary.minutes > 0 {
          row["exercise_min"] = HealthMetricsMath.round(workoutSummary.minutes, decimals: 1)
          samplesCount += workoutSummary.count
          hasMetric = true
        }

        if hasMetric {
          row["samples_count"] = samplesCount
          records.append(row)
        }
      }

      let message = records.isEmpty
        ? "Apple HealthKit returned 0 days in the last \(clampedDays) days."
        : "Synced \(records.count) day(s) on-device from Apple HealthKit."

      completion(
        SyncResult(
          ok: true,
          provider: "apple_healthkit",
          records: records,
          message: message
        )
      )
    }
  }

  // MARK: - Private HealthKit Query Helpers

  private func dateKey(for date: Date) -> String {
    dateFormatter.string(from: date)
  }

  private func queryQuantitySamples(
    store: HKHealthStore,
    identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    predicate: NSPredicate
  ) async -> [String: [Double]] {
    let type = HKQuantityType(identifier)
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

    return await withCheckedContinuation { continuation in
      let query = HKSampleQuery(
        sampleType: type,
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: [sort]
      ) { [weak self] _, samples, _ in
        guard let self, let quantitySamples = samples as? [HKQuantitySample] else {
          continuation.resume(returning: [:])
          return
        }
        var grouped: [String: [Double]] = [:]
        for sample in quantitySamples {
          let key = self.dateKey(for: sample.startDate)
          let value = sample.quantity.doubleValue(for: unit)
          if value.isFinite {
            grouped[key, default: []].append(value)
          }
        }
        continuation.resume(returning: grouped)
      }
      store.execute(query)
    }
  }

  private func querySleepSegments(
    store: HKHealthStore,
    predicate: NSPredicate
  ) async -> [String: [(start: Date, end: Date)]] {
    let type = HKCategoryType(.sleepAnalysis)
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)

    return await withCheckedContinuation { continuation in
      let query = HKSampleQuery(
        sampleType: type,
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: [sort]
      ) { [weak self] _, samples, _ in
        guard let self, let categorySamples = samples as? [HKCategorySample] else {
          continuation.resume(returning: [:])
          return
        }
        var grouped: [String: [(start: Date, end: Date)]] = [:]
        for sample in categorySamples where HealthMetricsMath.isAsleepCategoryValue(sample.value) {
          let key = self.dateKey(for: sample.endDate)
          grouped[key, default: []].append((start: sample.startDate, end: sample.endDate))
        }
        continuation.resume(returning: grouped)
      }
      store.execute(query)
    }
  }

  private func queryWorkouts(
    store: HKHealthStore,
    predicate: NSPredicate
  ) async -> [String: (minutes: Double, count: Int)] {
    let type = HKObjectType.workoutType()
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

    return await withCheckedContinuation { continuation in
      let query = HKSampleQuery(
        sampleType: type,
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: [sort]
      ) { [weak self] _, samples, _ in
        guard let self, let workouts = samples as? [HKWorkout] else {
          continuation.resume(returning: [:])
          return
        }
        var summaryByDate: [String: (minutes: Double, count: Int)] = [:]
        for workout in workouts {
          let key = self.dateKey(for: workout.startDate)
          let prev = summaryByDate[key] ?? (0.0, 0)
          summaryByDate[key] = (prev.minutes + (workout.duration / 60.0), prev.count + 1)
        }
        continuation.resume(returning: summaryByDate)
      }
      store.execute(query)
    }
  }

  private func queryHeartbeatSeriesRMSSDByDate(
    store: HKHealthStore,
    predicate: NSPredicate
  ) async -> [String: [Double]] {
    let seriesType = HKSeriesType.heartbeat()
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

    let seriesSamples: [HKHeartbeatSeriesSample] = await withCheckedContinuation { continuation in
      let query = HKSampleQuery(
        sampleType: seriesType,
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: [sort]
      ) { _, samples, _ in
        continuation.resume(returning: (samples as? [HKHeartbeatSeriesSample]) ?? [])
      }
      store.execute(query)
    }

    var rmssdByDate: [String: [Double]] = [:]
    for sample in seriesSamples {
      var beats: [(timeSinceStart: TimeInterval, precededByGap: Bool)] = []
      let descriptor = HKHeartbeatSeriesQueryDescriptor(sample)
      do {
        for try await beat in descriptor.results(for: store) {
          beats.append((timeSinceStart: beat.timeIntervalSinceStart, precededByGap: beat.precededByGap))
        }
      } catch {
        continue
      }

      if let rmssd = HealthMetricsMath.computeRMSSD(fromHeartbeatSeries: beats) {
        let key = dateKey(for: sample.startDate)
        rmssdByDate[key, default: []].append(rmssd)
      }
    }

    return rmssdByDate
  }
}
