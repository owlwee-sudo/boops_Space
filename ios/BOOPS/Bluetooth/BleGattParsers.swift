import CoreBluetooth
import Foundation

/// Standard Bluetooth SIG GATT UUIDs and binary characteristic parsers (100% pure & unit-testable).
enum BleGattParsers {

  // MARK: - Standard Service & Characteristic UUIDs

  static let heartRateServiceUUID = CBUUID(string: "180D")
  static let pulseOximeterServiceUUID = CBUUID(string: "1822")
  static let bloodPressureServiceUUID = CBUUID(string: "1810")
  static let healthThermometerServiceUUID = CBUUID(string: "1809")
  static let batteryServiceUUID = CBUUID(string: "180F")

  static let supportedServiceUUIDs: [CBUUID] = [
    heartRateServiceUUID,
    pulseOximeterServiceUUID,
    bloodPressureServiceUUID,
    healthThermometerServiceUUID,
    batteryServiceUUID,
  ]

  static let heartRateMeasurementUUID = CBUUID(string: "2A37")
  static let plxSpotCheckMeasurementUUID = CBUUID(string: "2A5E")
  static let plxContinuousMeasurementUUID = CBUUID(string: "2A5F")
  static let bloodPressureMeasurementUUID = CBUUID(string: "2A35")
  static let temperatureMeasurementUUID = CBUUID(string: "2A1C")
  static let batteryLevelUUID = CBUUID(string: "2A19")

  /// Normalizes a 128-bit Bluetooth SIG base UUID string to its 4-character short hex form.
  static func shortUuid(_ uuid: String) -> String {
    let upper = uuid.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let prefix = "0000"
    let suffix = "-0000-1000-8000-00805F9B34FB"
    if upper.count == 36, upper.hasPrefix(prefix), upper.hasSuffix(suffix) {
      let start = upper.index(upper.startIndex, offsetBy: 4)
      let end = upper.index(upper.startIndex, offsetBy: 8)
      return String(upper[start..<end])
    }
    return upper
  }

  /// Maps advertised GATT service UUIDs into `BleDeviceInfo.kind` values expected by the web UI.
  static func classifyDeviceKind(_ serviceUuids: [String]) -> String {
    let normalized = Set(serviceUuids.map(shortUuid))
    let vitalServices: Set<String> = ["180D", "1822", "1810", "1809"]
    let matches = normalized.intersection(vitalServices)
    if matches.count > 1 { return "wearable" }
    if normalized.contains("180D") { return "hr_strap" }
    if normalized.contains("1822") { return "pulse_ox" }
    if normalized.contains("1810") { return "bp_cuff" }
    if normalized.contains("1809") { return "thermometer" }
    return "wearable"
  }

  struct HeartRateReading: Equatable {
    let bpm: Int
    let rrIntervalsMs: [Double]
  }

  struct PulseOximeterReading: Equatable {
    let spo2Pct: Double
    let pulseRateBpm: Double?
  }

  struct BloodPressureReading: Equatable {
    let sbpMmHg: Double
    let dbpMmHg: Double
    let mapMmHg: Double?
    let pulseRateBpm: Double?
  }

  // MARK: - IEEE-11073 Binary Decoders

  /// Decodes a little-endian IEEE-11073 16-bit SFLOAT (4-bit signed exponent, 12-bit signed mantissa).
  static func decodeSFloat(_ data: Data, at offset: Int) -> Double? {
    guard offset >= 0, offset + 2 <= data.count else { return nil }
    let b0 = UInt16(data[data.startIndex + offset])
    let b1 = UInt16(data[data.startIndex + offset + 1])
    let raw = b0 | (b1 << 8)

    // Reserved sentinel values in IEEE-11073 16-bit SFLOAT
    switch raw {
    case 0x07FF, 0x0800, 0x07FE, 0x0802, 0x0801:
      return nil
    default:
      break
    }

    var exponent = Int((raw >> 12) & 0x0F)
    if exponent >= 8 {
      exponent -= 16
    }

    var mantissa = Int(raw & 0x0FFF)
    if mantissa >= 2048 {
      mantissa -= 4096
    }

    return Double(mantissa) * pow(10.0, Double(exponent))
  }

  /// Decodes a little-endian IEEE-11073 32-bit FLOAT (8-bit signed exponent, 24-bit signed mantissa).
  static func decodeFloat(_ data: Data, at offset: Int) -> Double? {
    guard offset >= 0, offset + 4 <= data.count else { return nil }
    let idx = data.startIndex + offset
    let b0 = UInt32(data[idx])
    let b1 = UInt32(data[idx + 1])
    let b2 = UInt32(data[idx + 2])
    let b3 = UInt32(data[idx + 3])
    let raw = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)

    // Reserved sentinel values in IEEE-11073 32-bit FLOAT
    switch raw {
    case 0x007FFFFF, 0x00800000, 0x007FFFFE, 0x00800002, 0x00800001:
      return nil
    default:
      break
    }

    let exponent = Int(Int8(bitPattern: UInt8((raw >> 24) & 0xFF)))
    var mantissa = Int(raw & 0x00FFFFFF)
    if mantissa >= 0x00800000 {
      mantissa -= 0x01000000
    }

    return Double(mantissa) * pow(10.0, Double(exponent))
  }

  // MARK: - Characteristic Parsers

  /// Parses GATT `0x2A37` Heart Rate Measurement (8/16-bit HR, optional Energy Expended, 1/1024s RR intervals).
  // Physiological ranges: outside them the sensor is mis-reading, not the body.
  static let hrRangeBpm = 25...240
  static let spo2RangePct = 50.0...100.0
  static let sbpRangeMmHg = 50.0...260.0
  static let dbpRangeMmHg = 30.0...180.0
  static let tempRangeC = 30.0...43.0

  static func parseHeartRateMeasurement(_ data: Data) -> HeartRateReading? {
    guard data.count >= 2 else { return nil }
    let base = data.startIndex
    let flags = data[base]
    let isUInt16HR = (flags & 0x01) != 0
    let hasEnergyExpended = (flags & 0x08) != 0
    let hasRRIntervals = (flags & 0x10) != 0

    var offset = 1
    let bpm: Int
    if isUInt16HR {
      guard offset + 2 <= data.count else { return nil }
      let raw = UInt16(data[base + offset]) | (UInt16(data[base + offset + 1]) << 8)
      bpm = Int(raw)
      offset += 2
    } else {
      bpm = Int(data[base + offset])
      offset += 1
    }

    guard hrRangeBpm.contains(bpm) else { return nil }

    if hasEnergyExpended {
      guard offset + 2 <= data.count else { return nil }
      offset += 2
    }

    var rrIntervalsMs: [Double] = []
    if hasRRIntervals {
      while offset + 2 <= data.count {
        let rawRR = UInt16(data[base + offset]) | (UInt16(data[base + offset + 1]) << 8)
        let ms = Double(rawRR) * (1000.0 / 1024.0)
        rrIntervalsMs.append(ms)
        offset += 2
      }
    }

    return HeartRateReading(bpm: bpm, rrIntervalsMs: rrIntervalsMs)
  }

  /// Parses GATT `0x2A5E` (PLX Spot-Check) and `0x2A5F` (PLX Continuous) Pulse Oximeter Measurement.
  static func parsePulseOximeterMeasurement(_ data: Data) -> PulseOximeterReading? {
    guard data.count >= 5 else { return nil }
    guard let spo2 = decodeSFloat(data, at: 1), spo2.isFinite, spo2RangePct.contains(spo2) else {
      return nil
    }
    let pulseRate: Double?
    if let pr = decodeSFloat(data, at: 3), pr.isFinite, pr >= 20.0, pr <= 250.0 {
      pulseRate = pr
    } else {
      pulseRate = nil
    }
    return PulseOximeterReading(spo2Pct: spo2, pulseRateBpm: pulseRate)
  }

  /// Parses GATT `0x2A35` Blood Pressure Measurement (SBP, DBP, MAP in mmHg or kPa + optional Timestamp/Pulse Rate).
  static func parseBloodPressureMeasurement(_ data: Data) -> BloodPressureReading? {
    guard data.count >= 7 else { return nil }
    let flags = data[data.startIndex]
    let isKpa = (flags & 0x01) != 0
    let hasTimestamp = (flags & 0x02) != 0
    let hasPulseRate = (flags & 0x04) != 0
    let kpaToMmHg = 7.50061683

    guard let rawSbp = decodeSFloat(data, at: 1),
          let rawDbp = decodeSFloat(data, at: 3) else {
      return nil
    }
    let rawMap = decodeSFloat(data, at: 5)

    let scale = isKpa ? kpaToMmHg : 1.0
    let sbp = rawSbp * scale
    let dbp = rawDbp * scale
    let map = rawMap.map { $0 * scale }

    var offset = 7
    if hasTimestamp {
      offset += 7
    }

    guard sbp.isFinite, dbp.isFinite,
          sbpRangeMmHg.contains(sbp), dbpRangeMmHg.contains(dbp), sbp > dbp else {
      return nil
    }

    var pulseRate: Double?
    if hasPulseRate, let pr = decodeSFloat(data, at: offset), pr.isFinite, pr >= 20.0, pr <= 250.0 {
      pulseRate = pr
    }

    return BloodPressureReading(sbpMmHg: sbp, dbpMmHg: dbp, mapMmHg: map, pulseRateBpm: pulseRate)
  }

  /// Parses GATT `0x2A1C` Health Thermometer Temperature Measurement into Celsius.
  static func parseTemperatureMeasurement(_ data: Data) -> Double? {
    guard data.count >= 5 else { return nil }
    let flags = data[data.startIndex]
    let isFahrenheit = (flags & 0x01) != 0

    guard let rawTemp = decodeFloat(data, at: 1), rawTemp.isFinite else {
      return nil
    }
    let celsius = isFahrenheit ? (rawTemp - 32.0) * (5.0 / 9.0) : rawTemp
    return tempRangeC.contains(celsius) ? celsius : nil
  }

  /// Parses GATT `0x2A19` Battery Level percentage (`0...100`).
  static func parseBatteryLevel(_ data: Data) -> Int? {
    guard data.count >= 1 else { return nil }
    return min(100, max(0, Int(data[data.startIndex])))
  }
}
