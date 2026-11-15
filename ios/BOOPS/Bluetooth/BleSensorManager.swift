import CoreBluetooth
import Foundation

/// Offline CoreBluetooth GATT manager supporting Heart Rate (180D), SpO₂ (1822),
/// Blood Pressure (1810), Thermometer (1809), and Battery (180F) peripherals.
final class BleSensorManager: NSObject {

  struct StatusSnapshot {
    let available: Bool
    let authorized: Bool
    let poweredOn: Bool
    let scanning: Bool
    let state: String
    let connectedDeviceIds: [String]
    let message: String
  }

  private let queue = DispatchQueue(label: "space.boops.ble", qos: .userInitiated)
  private let onEvent: (String, [String: Any]) -> Void
  private let isoFormatter: ISO8601DateFormatter

  private var centralManager: CBCentralManager?
  private var wantScanWhenPoweredOn = false
  private var isScanning = false

  private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
  private var connectedPeripherals: [UUID: CBPeripheral] = [:]
  private var rssiByDevice: [UUID: Int] = [:]
  private var serviceUUIDsByDevice: [UUID: [String]] = [:]
  private var batteryByDevice: [UUID: Int] = [:]
  private var rrBuffersByDevice: [UUID: [Double]] = [:]

  init(onEvent: @escaping (String, [String: Any]) -> Void) {
    self.onEvent = onEvent
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    self.isoFormatter = formatter
    super.init()
  }

  // MARK: - Public Controls

  func currentCapabilities() -> StatusSnapshot {
    let auth = CBCentralManager.authorization
    let authorized = (auth == .allowedAlways)

    guard let central = centralManager else {
      let authBlocked = (auth == .denied || auth == .restricted)
      return StatusSnapshot(
        available: !authBlocked,
        authorized: authorized,
        poweredOn: false,
        scanning: false,
        state: authBlocked ? "unauthorized" : "idle",
        connectedDeviceIds: [],
        message: authBlocked
          ? "Bluetooth permission denied in iOS Settings."
          : "Ready to scan offline BLE health sensors."
      )
    }

    return buildSnapshot(for: central)
  }

  func startScan() {
    queue.async { [weak self] in
      guard let self else { return }
      self.wantScanWhenPoweredOn = true
      if self.centralManager == nil {
        self.centralManager = CBCentralManager(
          delegate: self,
          queue: self.queue,
          options: [CBCentralManagerOptionShowPowerAlertKey: false]
        )
      }
      self.beginScanIfReady()
      self.emitStatus()
    }
  }

  func stopScan() {
    queue.async { [weak self] in
      guard let self else { return }
      self.wantScanWhenPoweredOn = false
      if let central = self.centralManager, central.isScanning {
        central.stopScan()
      }
      self.isScanning = false
      self.emitStatus()
    }
  }

  func connect(deviceId: String) {
    queue.async { [weak self] in
      guard let self else { return }
      guard let uuid = UUID(uuidString: deviceId),
            let peripheral = self.discoveredPeripherals[uuid] ?? self.connectedPeripherals[uuid],
            let central = self.centralManager else {
        self.emitStatus(customMessage: "BLE device not found for connect: \(deviceId)")
        return
      }
      if self.isScanning {
        central.stopScan()
        self.isScanning = false
      }
      self.wantScanWhenPoweredOn = false
      peripheral.delegate = self
      central.connect(peripheral, options: nil)
      self.emitStatus(customMessage: "Connecting to \(peripheral.name ?? deviceId)…")
    }
  }

  func disconnect(deviceId: String) {
    queue.async { [weak self] in
      guard let self else { return }
      guard let uuid = UUID(uuidString: deviceId),
            let peripheral = self.connectedPeripherals[uuid] ?? self.discoveredPeripherals[uuid],
            let central = self.centralManager else {
        self.emitStatus(customMessage: "BLE device not connected: \(deviceId)")
        return
      }
      central.cancelPeripheralConnection(peripheral)
      self.emitStatus(customMessage: "Disconnecting \(peripheral.name ?? deviceId)…")
    }
  }

  // MARK: - Internal Helpers

  private func beginScanIfReady() {
    guard let central = centralManager, wantScanWhenPoweredOn else { return }
    guard central.state == .poweredOn else { return }
    if !central.isScanning {
      central.scanForPeripherals(
        withServices: BleGattParsers.supportedServiceUUIDs,
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
      )
    }
    isScanning = true
  }

  private func buildSnapshot(for central: CBCentralManager, customMessage: String? = nil) -> StatusSnapshot {
    let auth = CBCentralManager.authorization
    let authorized = (auth == .allowedAlways)
    let stateName: String
    let defaultMessage: String
    let available: Bool

    switch central.state {
    case .poweredOn:
      stateName = isScanning ? "scanning" : "powered_on"
      defaultMessage = isScanning ? "Scanning offline for BLE medical sensors…" : "Bluetooth powered on."
      available = true
    case .poweredOff:
      stateName = "powered_off"
      defaultMessage = "Bluetooth is turned off."
      available = true
    case .unauthorized:
      stateName = "unauthorized"
      defaultMessage = "Bluetooth permission is required to scan BLE sensors."
      available = false
    case .unsupported:
      stateName = "unsupported"
      defaultMessage = "Bluetooth Low Energy is unsupported on this hardware/simulator."
      available = false
    case .resetting:
      stateName = "resetting"
      defaultMessage = "Bluetooth stack resetting…"
      available = true
    case .unknown:
      stateName = "initializing"
      defaultMessage = "Initializing Bluetooth Low Energy…"
      available = true
    @unknown default:
      stateName = "unknown"
      defaultMessage = "Bluetooth state unavailable."
      available = false
    }

    return StatusSnapshot(
      available: available,
      authorized: authorized,
      poweredOn: central.state == .poweredOn,
      scanning: isScanning,
      state: stateName,
      connectedDeviceIds: connectedPeripherals.keys.map(\.uuidString).sorted(),
      message: customMessage ?? defaultMessage
    )
  }

  private func emitStatus(customMessage: String? = nil, errorMessage: String? = nil) {
    let snap: StatusSnapshot
    if let central = centralManager {
      snap = buildSnapshot(for: central, customMessage: customMessage)
    } else {
      let base = currentCapabilities()
      snap = StatusSnapshot(
        available: base.available,
        authorized: base.authorized,
        poweredOn: base.poweredOn,
        scanning: base.scanning,
        state: base.state,
        connectedDeviceIds: base.connectedDeviceIds,
        message: customMessage ?? base.message
      )
    }

    let primaryConnected = connectedPeripherals.values.sorted { $0.identifier.uuidString < $1.identifier.uuidString }.first
    let resolvedError: Any
    if let errorMessage {
      resolvedError = errorMessage
    } else if !snap.available {
      resolvedError = snap.message
    } else {
      resolvedError = NSNull()
    }
    let connectedDeviceIdValue: Any = primaryConnected.map { $0.identifier.uuidString as Any } ?? NSNull()
    let connectedDeviceNameValue: Any = primaryConnected.map { ($0.name ?? "BLE Sensor") as Any } ?? NSNull()

    let payload: [String: Any] = [
      "available": snap.available,
      "authorized": snap.authorized,
      "poweredOn": snap.poweredOn,
      "scanning": snap.scanning,
      "connectedDeviceId": connectedDeviceIdValue,
      "connectedDeviceName": connectedDeviceNameValue,
      "error": resolvedError,
      "mode": "native_ble",
      "state": snap.state,
      "connectedDeviceIds": snap.connectedDeviceIds,
      "message": snap.message,
    ]
    emit("ble_status", payload)
  }

  private func emitScanResult(for peripheral: CBPeripheral? = nil) {
    let devices: [[String: Any]] = discoveredPeripherals.values
      .sorted { ($0.name ?? $0.identifier.uuidString) < ($1.name ?? $1.identifier.uuidString) }
      .map { device in
        let id = device.identifier
        let services = (serviceUUIDsByDevice[id] ?? []).map(BleGattParsers.shortUuid)
        let batteryValue: Any = batteryByDevice[id].map { $0 as Any } ?? NSNull()
        return [
          "id": id.uuidString,
          "name": device.name ?? "BLE Sensor",
          "rssi": rssiByDevice[id] ?? 0,
          "services": services,
          "kind": BleGattParsers.classifyDeviceKind(services),
          "connected": connectedPeripherals[id] != nil,
          "batteryPct": batteryValue,
        ]
      }
    emit("ble_scan_result", ["devices": devices])
  }

  private func emit(_ type: String, _ payload: [String: Any]) {
    DispatchQueue.main.async { [onEvent] in
      onEvent(type, payload)
    }
  }
}

// MARK: - CBCentralManagerDelegate

extension BleSensorManager: CBCentralManagerDelegate {

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn {
      beginScanIfReady()
    } else {
      isScanning = false
      if central.state != .resetting && central.state != .unknown {
        connectedPeripherals.removeAll()
      }
    }
    emitStatus()
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    let id = peripheral.identifier
    discoveredPeripherals[id] = peripheral
    rssiByDevice[id] = RSSI.intValue
    if let advServices = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] {
      serviceUUIDsByDevice[id] = advServices.map(\.uuidString)
    }
    emitScanResult(for: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let id = peripheral.identifier
    connectedPeripherals[id] = peripheral
    peripheral.delegate = self
    peripheral.discoverServices(BleGattParsers.supportedServiceUUIDs)
    emitScanResult(for: peripheral)
    emitStatus(customMessage: "Connected to \(peripheral.name ?? id.uuidString)")
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    let id = peripheral.identifier
    connectedPeripherals.removeValue(forKey: id)
    emitScanResult(for: peripheral)
    emitStatus(customMessage: "Failed to connect: \(error?.localizedDescription ?? "Unknown error")")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let id = peripheral.identifier
    connectedPeripherals.removeValue(forKey: id)
    rrBuffersByDevice.removeValue(forKey: id)
    emitScanResult(for: peripheral)
    emitStatus(customMessage: "Disconnected from \(peripheral.name ?? id.uuidString)")
  }
}

// MARK: - CBPeripheralDelegate

extension BleSensorManager: CBPeripheralDelegate {

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil, let services = peripheral.services else { return }
    let id = peripheral.identifier
    serviceUUIDsByDevice[id] = services.map { $0.uuid.uuidString }
    emitScanResult(for: peripheral)
    for service in services {
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard error == nil, let characteristics = service.characteristics else { return }
    let targetUUIDs: Set<CBUUID> = [
      BleGattParsers.heartRateMeasurementUUID,
      BleGattParsers.plxSpotCheckMeasurementUUID,
      BleGattParsers.plxContinuousMeasurementUUID,
      BleGattParsers.bloodPressureMeasurementUUID,
      BleGattParsers.temperatureMeasurementUUID,
      BleGattParsers.batteryLevelUUID,
    ]

    for characteristic in characteristics where targetUUIDs.contains(characteristic.uuid) {
      if characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) {
        peripheral.setNotifyValue(true, for: characteristic)
      }
      if characteristic.properties.contains(.read) {
        peripheral.readValue(for: characteristic)
      }
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard error == nil, let data = characteristic.value else { return }
    let deviceId = peripheral.identifier
    var reading: [String: Any] = [
      "deviceId": deviceId.uuidString,
      "deviceName": peripheral.name ?? "BLE Sensor",
      "signal_quality": 0.95,
      "source": "wearable",
      "timestamp": isoFormatter.string(from: Date()),
    ]
    if let battery = batteryByDevice[deviceId] {
      reading["batteryPct"] = battery
    }

    var parsedAny = false

    switch characteristic.uuid {
    case BleGattParsers.heartRateMeasurementUUID:
      if let hr = BleGattParsers.parseHeartRateMeasurement(data) {
        reading["metric"] = "rhr_bpm"
        reading["rhr_bpm"] = hr.bpm
        if !hr.rrIntervalsMs.isEmpty {
          var buffer = rrBuffersByDevice[deviceId] ?? []
          buffer.append(contentsOf: hr.rrIntervalsMs)
          if buffer.count > 40 {
            buffer.removeFirst(buffer.count - 40)
          }
          rrBuffersByDevice[deviceId] = buffer
          if let rmssd = HealthMetricsMath.computeRMSSD(fromRRIntervalsMs: buffer) {
            reading["hrv_rmssd_ms"] = HealthMetricsMath.round(rmssd, decimals: 1)
          }
        }
        parsedAny = true
      }

    case BleGattParsers.plxSpotCheckMeasurementUUID, BleGattParsers.plxContinuousMeasurementUUID:
      if let plx = BleGattParsers.parsePulseOximeterMeasurement(data) {
        reading["metric"] = "spo2_pct"
        reading["spo2_pct"] = HealthMetricsMath.round(plx.spo2Pct, decimals: 1)
        if let pr = plx.pulseRateBpm {
          reading["rhr_bpm"] = Int(pr.rounded())
        }
        parsedAny = true
      }

    case BleGattParsers.bloodPressureMeasurementUUID:
      if let bp = BleGattParsers.parseBloodPressureMeasurement(data) {
        reading["metric"] = "blood_pressure"
        reading["sbp_mmhg"] = HealthMetricsMath.round(bp.sbpMmHg, decimals: 1)
        reading["dbp_mmhg"] = HealthMetricsMath.round(bp.dbpMmHg, decimals: 1)
        if let pr = bp.pulseRateBpm {
          reading["rhr_bpm"] = Int(pr.rounded())
        }
        parsedAny = true
      }

    case BleGattParsers.temperatureMeasurementUUID:
      if let tempC = BleGattParsers.parseTemperatureMeasurement(data) {
        reading["metric"] = "temp_c"
        reading["temp_c"] = HealthMetricsMath.round(tempC, decimals: 2)
        parsedAny = true
      }

    case BleGattParsers.batteryLevelUUID:
      if let battery = BleGattParsers.parseBatteryLevel(data) {
        batteryByDevice[deviceId] = battery
        reading["metric"] = "battery"
        reading["batteryPct"] = battery
        emitScanResult()
        parsedAny = true
      }

    default:
      break
    }

    if parsedAny {
      emit("ble_reading", reading)
    }
  }
}
