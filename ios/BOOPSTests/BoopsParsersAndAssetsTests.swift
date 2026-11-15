import CoreBluetooth
import HealthKit
import XCTest
@testable import BOOPS

final class BoopsParsersAndAssetsTests: XCTestCase {

  // MARK: - IEEE-11073 Decoders

  func testDecodeSFloatValuesAndSpecialSentinels() {
    // 120 * 10^0 => 0x0078 (LE: 0x78, 0x00)
    let sbpData = Data([0x78, 0x00])
    XCTAssertEqual(BleGattParsers.decodeSFloat(sbpData, at: 0) ?? -1, 120.0, accuracy: 0.001)

    // 986 * 10^-1 => exp = -1 (0xF), mantissa = 986 (0x3DA) => 0xF3DA (LE: 0xDA, 0xF3)
    let fData = Data([0xDA, 0xF3])
    XCTAssertEqual(BleGattParsers.decodeSFloat(fData, at: 0) ?? -1, 98.6, accuracy: 0.001)

    // Negative mantissa: -25 * 10^-1 => exp = 0xF, mantissa = 4096 - 25 = 4071 (0xFE7) => 0xFFE7
    let negData = Data([0xE7, 0xFF])
    XCTAssertEqual(BleGattParsers.decodeSFloat(negData, at: 0) ?? 0, -2.5, accuracy: 0.001)

    // Special reserved values (NaN, NRes, +INF, -INF, RFU)
    XCTAssertNil(BleGattParsers.decodeSFloat(Data([0xFF, 0x07]), at: 0))
    XCTAssertNil(BleGattParsers.decodeSFloat(Data([0x00, 0x08]), at: 0))
    XCTAssertNil(BleGattParsers.decodeSFloat(Data([0xFE, 0x07]), at: 0))
    XCTAssertNil(BleGattParsers.decodeSFloat(Data([0x02, 0x08]), at: 0))
    XCTAssertNil(BleGattParsers.decodeSFloat(Data([0x01, 0x08]), at: 0))
  }

  func testDecodeFloatValuesAndSpecialSentinels() {
    // 36.8 C => 368 * 10^-1 => exp = -1 (0xFF), mantissa = 368 (0x000170) => 0xFF000170
    let cData = Data([0x70, 0x01, 0x00, 0xFF])
    XCTAssertEqual(BleGattParsers.decodeFloat(cData, at: 0) ?? -1, 36.8, accuracy: 0.001)

    // Special NaN (0x007FFFFF) & NRes (0x00800000)
    XCTAssertNil(BleGattParsers.decodeFloat(Data([0xFF, 0xFF, 0x7F, 0x00]), at: 0))
    XCTAssertNil(BleGattParsers.decodeFloat(Data([0x00, 0x00, 0x80, 0x00]), at: 0))
  }

  // MARK: - GATT Characteristic Parsers

  func testParseHeartRateMeasurement8BitAnd16BitWithRRIntervals() {
    // Flags 0x10 (8-bit HR + RR present), HR=72, RR1=819 (799.804ms), RR2=840 (820.3125ms)
    let rr1: UInt16 = 819
    let rr2: UInt16 = 840
    let packet8 = Data([
      0x10,
      72,
      UInt8(rr1 & 0xFF), UInt8(rr1 >> 8),
      UInt8(rr2 & 0xFF), UInt8(rr2 >> 8),
    ])
    let parsed8 = BleGattParsers.parseHeartRateMeasurement(packet8)
    XCTAssertEqual(parsed8?.bpm, 72)
    XCTAssertEqual(parsed8?.rrIntervalsMs.count, 2)
    XCTAssertEqual(parsed8?.rrIntervalsMs[0] ?? 0, 819.0 * 1000.0 / 1024.0, accuracy: 0.01)
    XCTAssertEqual(parsed8?.rrIntervalsMs[1] ?? 0, 840.0 * 1000.0 / 1024.0, accuracy: 0.01)

    // Flags 0x19 (16-bit HR + Energy Expended + RR present), HR=260 (0x0104), Energy=500, RR=1024 (1000.0ms)
    let packet16 = Data([
      0x19,
      0x04, 0x01,
      0xF4, 0x01,
      0x00, 0x04,
    ])
    let parsed16 = BleGattParsers.parseHeartRateMeasurement(packet16)
    XCTAssertEqual(parsed16?.bpm, 260)
    XCTAssertEqual(parsed16?.rrIntervalsMs.count, 1)
    XCTAssertEqual(parsed16?.rrIntervalsMs[0] ?? 0, 1000.0, accuracy: 0.001)

    XCTAssertNil(BleGattParsers.parseHeartRateMeasurement(Data([0x00])))
  }

  func testParsePulseOximeterMeasurement() {
    // Flags=0x00, SpO2=98 (0x0062), PR=68 (0x0044)
    let plxPacket = Data([0x00, 0x62, 0x00, 0x44, 0x00])
    let parsed = BleGattParsers.parsePulseOximeterMeasurement(plxPacket)
    XCTAssertEqual(parsed?.spo2Pct ?? -1, 98.0, accuracy: 0.01)
    XCTAssertEqual(parsed?.pulseRateBpm ?? -1, 68.0, accuracy: 0.01)

    // Out-of-range SpO2 (105%) should be rejected
    let invalidPacket = Data([0x00, 0x69, 0x00, 0x44, 0x00])
    XCTAssertNil(BleGattParsers.parsePulseOximeterMeasurement(invalidPacket))
  }

  func testParseBloodPressureMeasurementMmHgAndKpa() {
    // Flags=0x04 (mmHg + pulse rate present), SBP=120 (0x0078), DBP=80 (0x0050), MAP=93 (0x005D), PR=65 (0x0041)
    let mmHgPacket = Data([
      0x04,
      0x78, 0x00,
      0x50, 0x00,
      0x5D, 0x00,
      0x41, 0x00,
    ])
    let parsedMmHg = BleGattParsers.parseBloodPressureMeasurement(mmHgPacket)
    XCTAssertEqual(parsedMmHg?.sbpMmHg ?? -1, 120.0, accuracy: 0.01)
    XCTAssertEqual(parsedMmHg?.dbpMmHg ?? -1, 80.0, accuracy: 0.01)
    XCTAssertEqual(parsedMmHg?.mapMmHg ?? -1, 93.0, accuracy: 0.01)
    XCTAssertEqual(parsedMmHg?.pulseRateBpm ?? -1, 65.0, accuracy: 0.01)

    // Flags=0x01 (kPa), SBP=16.0 kPa (160*10^-1 = 0xF0A0), DBP=10.6 kPa (106*10^-1 = 0xF06A), MAP=12.4 kPa (0xF07C)
    let kpaPacket = Data([
      0x01,
      0xA0, 0xF0,
      0x6A, 0xF0,
      0x7C, 0xF0,
    ])
    let parsedKpa = BleGattParsers.parseBloodPressureMeasurement(kpaPacket)
    XCTAssertEqual(parsedKpa?.sbpMmHg ?? -1, 16.0 * 7.50061683, accuracy: 0.05)
    XCTAssertEqual(parsedKpa?.dbpMmHg ?? -1, 10.6 * 7.50061683, accuracy: 0.05)
  }

  func testParseTemperatureMeasurementCelsiusAndFahrenheit() {
    // 36.8 C => flags 0x00, FLOAT 368 * 10^-1 (0xFF000170)
    let celsiusData = Data([0x00, 0x70, 0x01, 0x00, 0xFF])
    XCTAssertEqual(BleGattParsers.parseTemperatureMeasurement(celsiusData) ?? -1, 36.8, accuracy: 0.001)

    // 98.6 F => flags 0x01, FLOAT 986 * 10^-1 (0xFF0003DA) => 37.0 C
    let fahrenheitData = Data([0x01, 0xDA, 0x03, 0x00, 0xFF])
    XCTAssertEqual(BleGattParsers.parseTemperatureMeasurement(fahrenheitData) ?? -1, 37.0, accuracy: 0.001)
  }

  func testParseBatteryLevel() {
    XCTAssertEqual(BleGattParsers.parseBatteryLevel(Data([87])), 87)
    XCTAssertEqual(BleGattParsers.parseBatteryLevel(Data([120])), 100)
    XCTAssertNil(BleGattParsers.parseBatteryLevel(Data()))
  }

  // MARK: - RMSSD & Health Aggregation Math

  func testRMSSDFromHeartbeatSeriesAndGapExclusion() {
    // Beats at 0.0, 0.80, 1.62, 2.40, 3.20 -> RR = [800, 820, 780, 800] ms
    // Diffs = [20, -40, 20] -> mean(sq) = (400 + 1600 + 400)/3 = 800 -> sqrt(800) ≈ 28.28427
    let beats: [(TimeInterval, Bool)] = [
      (0.00, false),
      (0.80, false),
      (1.62, false),
      (2.40, false),
      (3.20, false),
    ]
    let rmssd = HealthMetricsMath.computeRMSSD(fromHeartbeatSeries: beats)
    XCTAssertEqual(rmssd ?? -1, sqrt(800.0), accuracy: 0.001)

    // With a > 2000ms gap and a precededByGap flag separating two runs:
    // Run 1 RR: [800, 820] -> diff = +20
    // Gap of 2500ms & precededByGap=true
    // Run 2 RR: [780, 800] -> diff = +20
    // sqrt((400 + 400) / 2) = 20.0 (cross-gap diff must NOT be computed!)
    let gappedBeats: [(TimeInterval, Bool)] = [
      (0.00, false),
      (0.80, false),
      (1.62, false),
      (4.12, true),
      (4.90, false),
      (5.70, false),
    ]
    let gappedRmssd = HealthMetricsMath.computeRMSSD(fromHeartbeatSeries: gappedBeats)
    XCTAssertEqual(gappedRmssd ?? -1, 20.0, accuracy: 0.001)

    // Too few beats
    XCTAssertNil(HealthMetricsMath.computeRMSSD(fromHeartbeatSeries: [(0.0, false), (0.8, false)]))
  }

  func testRMSSDFromRRIntervalsExcludingOutliers() {
    // [800, 820, 2400, 780, 800] -> excludes 2400ms gap -> diffs = [20, 20] -> RMSSD = 20.0
    let rmssd = HealthMetricsMath.computeRMSSD(fromRRIntervalsMs: [800, 820, 2400, 780, 800])
    XCTAssertEqual(rmssd ?? -1, 20.0, accuracy: 0.001)
  }

  func testMergedSleepHoursAndAsleepCategoryFilter() {
    let base = Date(timeIntervalSince1970: 1_760_000_000)
    let segments: [(Date, Date)] = [
      (base, base.addingTimeInterval(6 * 3600)),                       // 0h -> 6h
      (base.addingTimeInterval(2 * 3600), base.addingTimeInterval(7 * 3600)), // overlaps 2h -> 7h (merged 0..7 = 7h)
      (base.addingTimeInterval(12 * 3600), base.addingTimeInterval(12.5 * 3600)), // 30m afternoon nap
    ]
    XCTAssertEqual(HealthMetricsMath.mergedSleepHours(from: segments), 7.5, accuracy: 0.0001)

    XCTAssertTrue(HealthMetricsMath.isAsleepCategoryValue(HKCategoryValueSleepAnalysis.asleepCore.rawValue))
    XCTAssertTrue(HealthMetricsMath.isAsleepCategoryValue(HKCategoryValueSleepAnalysis.asleepDeep.rawValue))
    XCTAssertTrue(HealthMetricsMath.isAsleepCategoryValue(HKCategoryValueSleepAnalysis.asleepREM.rawValue))
    XCTAssertTrue(HealthMetricsMath.isAsleepCategoryValue(HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue))
    XCTAssertFalse(HealthMetricsMath.isAsleepCategoryValue(HKCategoryValueSleepAnalysis.inBed.rawValue))
    XCTAssertFalse(HealthMetricsMath.isAsleepCategoryValue(HKCategoryValueSleepAnalysis.awake.rawValue))
  }

  // MARK: - BoopsSchemeHandler Path Safety, Bundle Resolution & MIME Types

  func testSchemeHandlerResolvesDirectoryPathsAndRejectsTraversal() {
    XCTAssertEqual(BoopsSchemeHandler.candidateAssetPaths(for: "/"), ["index.html"])
    XCTAssertEqual(BoopsSchemeHandler.candidateAssetPaths(for: ""), ["index.html"])
    XCTAssertEqual(BoopsSchemeHandler.candidateAssetPaths(for: "/camera/"), ["camera/index.html"])
    XCTAssertEqual(BoopsSchemeHandler.candidateAssetPaths(for: "/camera"), ["camera", "camera/index.html"])

    XCTAssertTrue(BoopsSchemeHandler.candidateAssetPaths(for: "../secret.txt").isEmpty())
    XCTAssertTrue(BoopsSchemeHandler.candidateAssetPaths(for: "web/../../etc/passwd").isEmpty())
    XCTAssertTrue(BoopsSchemeHandler.candidateAssetPaths(for: "/%2e%2e/Info.plist").isEmpty())
    XCTAssertTrue(BoopsSchemeHandler.candidateAssetPaths(for: "/./index.html").isEmpty())
    XCTAssertTrue(BoopsSchemeHandler.candidateAssetPaths(for: "/camera\\..\\secret").isEmpty())
  }

  func testSchemeHandlerMapsCriticalMimeTypesAndCharsets() {
    XCTAssertEqual(BoopsSchemeHandler.mimeType(forPath: "index.html"), "text/html")
    XCTAssertEqual(BoopsSchemeHandler.mimeType(forPath: "camera/camera-check.js?v=1"), "application/javascript")
    XCTAssertEqual(BoopsSchemeHandler.mimeType(forPath: "vendor/mediapipe/vision_bundle.mjs"), "application/javascript")
    XCTAssertEqual(BoopsSchemeHandler.mimeType(forPath: "boops-space-ui.css"), "text/css")
    XCTAssertEqual(BoopsSchemeHandler.mimeType(forPath: "data/boops_bundle.json"), "application/json")
    XCTAssertEqual(BoopsSchemeHandler.mimeType(forPath: "vendor/mediapipe/wasm/vision_wasm_internal.wasm"), "application/wasm")
    XCTAssertEqual(BoopsSchemeHandler.mimeType(forPath: "assets/figma/imgIconHome.svg"), "image/svg+xml")
    XCTAssertEqual(BoopsSchemeHandler.mimeType(forPath: "vendor/mediapipe/face_landmarker.task"), "application/octet-stream")

    XCTAssertEqual(BoopsSchemeHandler.charset(forMimeType: "text/html"), "utf-8")
    XCTAssertEqual(BoopsSchemeHandler.charset(forMimeType: "application/javascript"), "utf-8")
    XCTAssertNil(BoopsSchemeHandler.charset(forMimeType: "application/wasm"))
    XCTAssertNil(BoopsSchemeHandler.charset(forMimeType: "application/octet-stream"))
  }

  func testBundledOfflineWebAssetsExistAndResolveInAppBundle() {
    let handler = BoopsSchemeHandler()
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/index.html"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/app.js"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/data_bundle.js"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/data/boops_bundle.json"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/camera/"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/camera/camera-check.js"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/vendor/mediapipe/vision_bundle.mjs"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/vendor/mediapipe/wasm/vision_wasm_internal.wasm"))
    XCTAssertNotNil(handler.resolveAssetURL(forRequestPath: "/vendor/mediapipe/face_landmarker.task"))
    XCTAssertNil(handler.resolveAssetURL(forRequestPath: "/../Info.plist"))
  }
}
