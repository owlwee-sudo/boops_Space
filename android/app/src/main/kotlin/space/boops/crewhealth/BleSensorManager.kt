package space.boops.crewhealth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Manages native Android BLE GATT scanning, connection, notification subscription, and binary
 * telemetry decoding for standard wearable health sensors (`0x180D`, `0x1822`, `0x1810`, `0x1809`, `0x180F`).
 */
class BleSensorManager(
  private val activity: ComponentActivity,
  private val emitEvent: (type: String, json: String) -> Unit,
  private val onCapabilitiesChanged: () -> Unit,
) {

  private enum class PendingActionType { NONE, SCAN, CONNECT }

  private sealed interface GattOp {
    data class EnableNotify(val characteristic: BluetoothGattCharacteristic, val cccdValue: ByteArray) : GattOp
    data class ReadChar(val characteristic: BluetoothGattCharacteristic) : GattOp
  }

  private data class MutableBleDevice(
    val id: String,
    var name: String,
    var rssi: Int,
    var services: List<String>,
    var kind: String,
    var connected: Boolean = false,
    var batteryPct: Int? = null,
  ) {
    fun toInfo(): BleDeviceInfo = BleDeviceInfo(
      id = id,
      name = name,
      rssi = rssi,
      services = services,
      kind = kind,
      connected = connected,
      batteryPct = batteryPct,
    )
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val discovered = ConcurrentHashMap<String, MutableBleDevice>()
  private val gattQueue = ArrayDeque<GattOp>()
  private val rrBufferMs = ArrayDeque<Double>()

  @Volatile private var scanning: Boolean = false
  @Volatile private var activeGatt: BluetoothGatt? = null
  @Volatile private var connectedDeviceId: String? = null
  @Volatile private var connectedDeviceName: String? = null
  @Volatile private var lastBatteryPct: Int? = null
  @Volatile private var gattOpInFlight: Boolean = false
  @Volatile private var receiverRegistered: Boolean = false
  @Volatile private var pendingAction: PendingActionType = PendingActionType.NONE
  @Volatile private var pendingConnectId: String? = null
  @Volatile private var lastScanEmitElapsedMs: Long = 0L

  private val scanTimeoutRunnable = Runnable { stopScan(reason = "BLE scan finished.") }
  private val deferredScanEmitRunnable = Runnable { emitScanResultsNow() }

  private val permissionLauncher = activity.registerForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions(),
  ) { results ->
    val granted = requiredRuntimePermissions().all { perm ->
      results[perm] == true || hasPermission(perm)
    }
    val action = pendingAction
    val targetId = pendingConnectId
    pendingAction = PendingActionType.NONE
    pendingConnectId = null

    if (granted) {
      onCapabilitiesChanged()
      when (action) {
        PendingActionType.SCAN -> startScan()
        PendingActionType.CONNECT -> if (!targetId.isNullOrBlank()) connectDevice(targetId)
        PendingActionType.NONE -> emitStatus(message = "Bluetooth permissions granted.")
      }
    } else {
      emitStatus(
        error = "permission_denied",
        message = "Bluetooth / Nearby Devices permission is required to scan and connect BLE sensors.",
      )
      onCapabilitiesChanged()
    }
  }

  private val bluetoothStateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
      val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
      when (state) {
        BluetoothAdapter.STATE_OFF, BluetoothAdapter.STATE_TURNING_OFF -> {
          stopScanInternal(emit = false, reason = "Bluetooth turned off.")
          closeGattInternal(emit = false)
          emitStatus(error = "bluetooth_off", message = "Bluetooth is turned off.")
          onCapabilitiesChanged()
        }

        BluetoothAdapter.STATE_ON -> {
          emitStatus(message = "Bluetooth is powered on.")
          onCapabilitiesChanged()
        }
      }
    }
  }

  /** Registers the Bluetooth adapter state receiver. Call during Activity creation. */
  fun register() {
    if (receiverRegistered) return
    val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    ContextCompat.registerReceiver(activity, bluetoothStateReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
    receiverRegistered = true
  }

  /** Returns the current BLE availability, permission, power, and scanning snapshot. */
  fun getCapabilities(): BluetoothCapabilities {
    val adapter = bluetoothAdapterOrNull()
    val available = isBleHardwareSupported() && adapter != null
    val authorized = hasRequiredPermissions()
    val poweredOn = adapter?.isEnabled == true
    return BluetoothCapabilities(
      available = available,
      authorized = authorized,
      poweredOn = poweredOn,
      scanning = scanning,
    )
  }

  /** Starts a BLE scan for wearable/vital sensors, requesting runtime permissions if needed. */
  fun startScan(): Boolean {
    val adapter = bluetoothAdapterOrNull()
    if (!isBleHardwareSupported() || adapter == null) {
      emitStatus(error = "ble_unavailable", message = "Bluetooth Low Energy is unavailable on this device.")
      return false
    }
    if (!hasRequiredPermissions()) {
      pendingAction = PendingActionType.SCAN
      pendingConnectId = null
      permissionLauncher.launch(requiredRuntimePermissions())
      emitStatus(message = "Requesting Bluetooth permission for BLE sensor scan.")
      return true
    }
    if (!adapter.isEnabled) {
      emitStatus(error = "bluetooth_off", message = "Enable Bluetooth to scan for BLE sensors.")
      onCapabilitiesChanged()
      return false
    }

    val scanner = adapter.bluetoothLeScanner
    if (scanner == null) {
      emitStatus(error = "scanner_unavailable", message = "BLE scanner is unavailable.")
      return false
    }

    if (scanning) {
      emitStatus(message = "BLE sensor scan already running.")
      return true
    }

    return startScanWithScanner(scanner)
  }

  @SuppressLint("MissingPermission")
  private fun startScanWithScanner(scanner: BluetoothLeScanner): Boolean {
    return try {
      val settings = ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .build()
      scanner.startScan(null, settings, scanCallback)
      scanning = true
      mainHandler.removeCallbacks(scanTimeoutRunnable)
      mainHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
      emitStatus(message = "Scanning for nearby BLE health sensors...")
      emitScanResultsNow()
      onCapabilitiesChanged()
      true
    } catch (sec: SecurityException) {
      Log.w(TAG, "BLE startScan denied", sec)
      scanning = false
      emitStatus(error = "permission_denied", message = "Bluetooth scan permission denied.")
      onCapabilitiesChanged()
      false
    } catch (err: Exception) {
      Log.e(TAG, "BLE startScan failed", err)
      scanning = false
      emitStatus(error = "scan_failed", message = "Failed to start BLE scan: ${err.message ?: "error"}")
      onCapabilitiesChanged()
      false
    }
  }

  /** Stops an active BLE scan. */
  fun stopScan(reason: String = "BLE scan stopped."): Boolean {
    val wasScanning = scanning
    stopScanInternal(emit = true, reason = reason)
    if (wasScanning) {
      onCapabilitiesChanged()
    }
    return true
  }

  @SuppressLint("MissingPermission")
  private fun stopScanInternal(emit: Boolean, reason: String) {
    mainHandler.removeCallbacks(scanTimeoutRunnable)
    mainHandler.removeCallbacks(deferredScanEmitRunnable)
    val scanner = bluetoothAdapterOrNull()?.bluetoothLeScanner
    if (scanning && scanner != null && hasScanPermission()) {
      try {
        scanner.stopScan(scanCallback)
      } catch (sec: SecurityException) {
        Log.w(TAG, "BLE stopScan SecurityException", sec)
      } catch (err: Exception) {
        Log.w(TAG, "BLE stopScan failed", err)
      }
    }
    scanning = false
    if (emit) {
      emitStatus(message = reason)
    }
  }

  /** Connects to a discovered or paired BLE GATT device by MAC address (`deviceId`). */
  fun connectDevice(deviceId: String): Boolean {
    val cleanId = deviceId.trim()
    if (cleanId.isEmpty()) {
      emitStatus(error = "invalid_device", message = "Device ID is required to connect.")
      return false
    }

    val adapter = bluetoothAdapterOrNull()
    if (!isBleHardwareSupported() || adapter == null) {
      emitStatus(error = "ble_unavailable", message = "Bluetooth Low Energy is unavailable.")
      return false
    }
    if (!hasRequiredPermissions()) {
      pendingAction = PendingActionType.CONNECT
      pendingConnectId = cleanId
      permissionLauncher.launch(requiredRuntimePermissions())
      emitStatus(message = "Requesting Bluetooth permission before connecting.")
      return true
    }
    if (!adapter.isEnabled) {
      emitStatus(error = "bluetooth_off", message = "Enable Bluetooth before connecting.")
      return false
    }

    if (connectedDeviceId == cleanId && activeGatt != null) {
      emitStatus(message = "Already connected to ${connectedDeviceName ?: cleanId}.")
      return true
    }

    return connectGattInternal(adapter, cleanId)
  }

  @SuppressLint("MissingPermission")
  private fun connectGattInternal(adapter: BluetoothAdapter, deviceId: String): Boolean {
    val device: BluetoothDevice = try {
      adapter.getRemoteDevice(deviceId)
    } catch (iae: IllegalArgumentException) {
      Log.w(TAG, "Invalid BLE address: $deviceId", iae)
      emitStatus(error = "invalid_device", message = "Invalid BLE device address.")
      return false
    }

    stopScanInternal(emit = false, reason = "Scan paused for GATT connection.")
    closeGattInternal(emit = false)
    synchronized(rrBufferMs) { rrBufferMs.clear() }
    lastBatteryPct = discovered[deviceId]?.batteryPct

    val targetName = safeDeviceName(device) ?: discovered[deviceId]?.name ?: "BLE Sensor"
    emitStatus(message = "Connecting to $targetName...")

    return try {
      val gatt = device.connectGatt(activity, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
      if (gatt == null) {
        emitStatus(error = "connect_failed", message = "Could not open GATT client for $targetName.")
        false
      } else {
        activeGatt = gatt
        onCapabilitiesChanged()
        true
      }
    } catch (sec: SecurityException) {
      Log.w(TAG, "connectGatt denied", sec)
      emitStatus(error = "permission_denied", message = "Bluetooth connect permission denied.")
      false
    } catch (err: Exception) {
      Log.e(TAG, "connectGatt failed", err)
      emitStatus(error = "connect_failed", message = "BLE connection error: ${err.message ?: "error"}")
      false
    }
  }

  /** Disconnects the active BLE GATT device cleanly. */
  fun disconnectDevice(deviceId: String): Boolean {
    val target = deviceId.trim()
    if (target.isNotEmpty() && connectedDeviceId != null && connectedDeviceId != target) {
      return false
    }
    closeGattInternal(emit = true)
    onCapabilitiesChanged()
    return true
  }

  /** Stops scanning, closes active GATT resources, and unregisters receivers. */
  fun destroy() {
    stopScanInternal(emit = false, reason = "Destroyed")
    closeGattInternal(emit = false)
    if (receiverRegistered) {
      try {
        activity.unregisterReceiver(bluetoothStateReceiver)
      } catch (_: IllegalArgumentException) {
        // Receiver already unregistered.
      }
      receiverRegistered = false
    }
  }

  @SuppressLint("MissingPermission")
  private fun closeGattInternal(emit: Boolean) {
    val gatt = activeGatt
    activeGatt = null
    val prevId = connectedDeviceId
    connectedDeviceId = null
    connectedDeviceName = null
    lastBatteryPct = null
    synchronized(gattQueue) {
      gattQueue.clear()
      gattOpInFlight = false
    }
    synchronized(rrBufferMs) {
      rrBufferMs.clear()
    }
    if (prevId != null) {
      discovered[prevId]?.connected = false
    }
    if (gatt != null) {
      try {
        if (hasConnectPermission()) {
          gatt.disconnect()
        }
      } catch (_: Exception) {
      }
      try {
        gatt.close()
      } catch (_: Exception) {
      }
    }
    if (emit) {
      emitStatus(message = "Disconnected from BLE sensor.")
      emitScanResultsNow()
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      handleScanResult(result)
    }

    override fun onBatchScanResults(results: MutableList<ScanResult>) {
      for (result in results) {
        handleScanResult(result)
      }
    }

    override fun onScanFailed(errorCode: Int) {
      scanning = false
      mainHandler.removeCallbacks(scanTimeoutRunnable)
      emitStatus(
        error = "scan_error_$errorCode",
        message = "BLE scan failed (code $errorCode).",
      )
      onCapabilitiesChanged()
    }
  }

  @SuppressLint("MissingPermission")
  private fun handleScanResult(result: ScanResult) {
    val device = result.device ?: return
    val id = device.address ?: return
    val record = result.scanRecord
    val advertisedName = safeDeviceName(device) ?: record?.deviceName?.trim()?.takeIf { it.isNotEmpty() }
    val advertisedServices = record?.serviceUuids
      ?.map { GattUuids.shortUuid(it.uuid.toString()) }
      ?.distinct()
      .orEmpty()

    val hasRelevantService = advertisedServices.any {
      it in GattUuids.VITAL_SERVICE_SHORT_UUIDS || it == GattUuids.BATTERY_SERVICE
    }
    if (advertisedName == null && !hasRelevantService && id != connectedDeviceId) {
      return
    }

    val existing = discovered[id]
    val mergedServices = ((existing?.services.orEmpty()) + advertisedServices).distinct()
    val displayName = advertisedName ?: existing?.name ?: "BLE Sensor (${id.takeLast(5)})"
    val kind = GattUuids.classifyDeviceKind(mergedServices)

    val isNew = existing == null
    if (existing != null) {
      existing.name = displayName
      existing.rssi = result.rssi
      existing.services = mergedServices
      existing.kind = kind
      existing.connected = (id == connectedDeviceId)
    } else {
      discovered[id] = MutableBleDevice(
        id = id,
        name = displayName,
        rssi = result.rssi,
        services = mergedServices,
        kind = kind,
        connected = (id == connectedDeviceId),
      )
    }

    scheduleScanResultsEmit(immediate = isNew)
  }

  private fun scheduleScanResultsEmit(immediate: Boolean) {
    val now = System.currentTimeMillis()
    val elapsed = now - lastScanEmitElapsedMs
    if (immediate || elapsed >= SCAN_EMIT_THROTTLE_MS) {
      mainHandler.removeCallbacks(deferredScanEmitRunnable)
      emitScanResultsNow()
    } else {
      mainHandler.removeCallbacks(deferredScanEmitRunnable)
      mainHandler.postDelayed(deferredScanEmitRunnable, SCAN_EMIT_THROTTLE_MS - elapsed)
    }
  }

  private fun emitScanResultsNow() {
    lastScanEmitElapsedMs = System.currentTimeMillis()
    val sorted = discovered.values
      .map { it.toInfo() }
      .sortedWith(
        compareByDescending<BleDeviceInfo> { it.connected }
          .thenByDescending { it.services.any { uuid -> uuid in GattUuids.VITAL_SERVICE_SHORT_UUIDS } }
          .thenByDescending { it.rssi },
      )
      .take(MAX_SCAN_DEVICES)
    emitEvent("ble_scan_result", BoopsBridgePayloads.bleScanResultJson(sorted))
  }

  private val gattCallback = object : BluetoothGattCallback() {
    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val address = gatt.device?.address ?: return
      val name = safeDeviceName(gatt.device) ?: discovered[address]?.name ?: "BLE Sensor"

      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        activeGatt = gatt
        connectedDeviceId = address
        connectedDeviceName = name
        val entry = discovered[address]
        if (entry != null) {
          entry.connected = true
          entry.name = name
        } else {
          discovered[address] = MutableBleDevice(
            id = address,
            name = name,
            rssi = 0,
            services = emptyList(),
            kind = "wearable",
            connected = true,
          )
        }
        emitStatus(message = "Connected to $name. Discovering GATT services...")
        emitScanResultsNow()
        onCapabilitiesChanged()
        if (hasConnectPermission()) {
          try {
            gatt.discoverServices()
          } catch (sec: SecurityException) {
            Log.w(TAG, "discoverServices denied", sec)
          }
        }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
        if (activeGatt == gatt) {
          closeGattInternal(emit = false)
        } else {
          try {
            gatt.close()
          } catch (_: Exception) {
          }
        }
        val errCode = if (status != BluetoothGatt.GATT_SUCCESS) "gatt_status_$status" else null
        val msg = if (errCode != null) {
          "Disconnected from $name (GATT status $status)."
        } else {
          "Disconnected from $name."
        }
        emitStatus(error = errCode, message = msg)
        emitScanResultsNow()
        onCapabilitiesChanged()
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val address = gatt.device?.address ?: return
      if (status != BluetoothGatt.GATT_SUCCESS) {
        emitStatus(error = "service_discovery_$status", message = "GATT service discovery failed ($status).")
        return
      }

      val serviceShortUuids = gatt.services.map { GattUuids.shortUuid(it.uuid.toString()) }.distinct()
      discovered[address]?.let {
        it.services = (it.services + serviceShortUuids).distinct()
        it.kind = GattUuids.classifyDeviceKind(it.services)
      }
      emitScanResultsNow()

      val ops = mutableListOf<GattOp>()
      for (service in gatt.services) {
        for (characteristic in service.characteristics) {
          val charShort = GattUuids.shortUuid(characteristic.uuid.toString())
          when (charShort) {
            GattUuids.HEART_RATE_MEASUREMENT,
            GattUuids.PLX_SPOT_CHECK,
            GattUuids.PLX_CONTINUOUS,
            GattUuids.BLOOD_PRESSURE_MEASUREMENT,
            GattUuids.TEMPERATURE_MEASUREMENT -> {
              cccdEnableValueFor(characteristic)?.let { value ->
                ops.add(GattOp.EnableNotify(characteristic, value))
              }
            }

            GattUuids.BATTERY_LEVEL -> {
              if ((characteristic.properties and BluetoothGattCharacteristic.PROPERTY_READ) != 0) {
                ops.add(GattOp.ReadChar(characteristic))
              }
              if ((characteristic.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) {
                ops.add(GattOp.EnableNotify(characteristic, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE))
              }
            }
          }
        }
      }

      synchronized(gattQueue) {
        gattQueue.clear()
        gattQueue.addAll(ops)
        gattOpInFlight = false
      }
      emitStatus(
        message = if (ops.isEmpty()) {
          "Connected to ${connectedDeviceName ?: address}; no standard vital services found."
        } else {
          "Subscribed to ${ops.size} vital stream(s) on ${connectedDeviceName ?: address}."
        },
      )
      drainGattQueue(gatt)
    }

    override fun onDescriptorWrite(
      gatt: BluetoothGatt,
      descriptor: BluetoothGattDescriptor,
      status: Int,
    ) {
      synchronized(gattQueue) { gattOpInFlight = false }
      drainGattQueue(gatt)
    }

    @Deprecated("Deprecated in Android 13; kept for API 26-32 compatibility.")
    @Suppress("DEPRECATION")
    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      synchronized(gattQueue) { gattOpInFlight = false }
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && status == BluetoothGatt.GATT_SUCCESS) {
        characteristic.value?.let { handleCharacteristicData(gatt, characteristic, it) }
      }
      drainGattQueue(gatt)
    }

    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
      status: Int,
    ) {
      synchronized(gattQueue) { gattOpInFlight = false }
      if (status == BluetoothGatt.GATT_SUCCESS) {
        handleCharacteristicData(gatt, characteristic, value)
      }
      drainGattQueue(gatt)
    }

    @Deprecated("Deprecated in Android 13; kept for API 26-32 compatibility.")
    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
    ) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        characteristic.value?.let { handleCharacteristicData(gatt, characteristic, it) }
      }
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      handleCharacteristicData(gatt, characteristic, value)
    }
  }

  @SuppressLint("MissingPermission")
  private fun drainGattQueue(gatt: BluetoothGatt) {
    if (gatt != activeGatt || !hasConnectPermission()) return
    val nextOp = synchronized(gattQueue) {
      if (gattOpInFlight || gattQueue.isEmpty()) return
      gattOpInFlight = true
      gattQueue.removeFirst()
    }

    val started = try {
      when (nextOp) {
        is GattOp.ReadChar -> gatt.readCharacteristic(nextOp.characteristic)
        is GattOp.EnableNotify -> enableCharacteristicSubscription(gatt, nextOp.characteristic, nextOp.cccdValue)
      }
    } catch (sec: SecurityException) {
      Log.w(TAG, "GATT op SecurityException", sec)
      false
    } catch (err: Exception) {
      Log.w(TAG, "GATT op failed", err)
      false
    }

    if (!started) {
      synchronized(gattQueue) { gattOpInFlight = false }
      drainGattQueue(gatt)
    }
  }

  @SuppressLint("MissingPermission")
  private fun enableCharacteristicSubscription(
    gatt: BluetoothGatt,
    characteristic: BluetoothGattCharacteristic,
    cccdValue: ByteArray,
  ): Boolean {
    if (!gatt.setCharacteristicNotification(characteristic, true)) return false
    val cccd = characteristic.getDescriptor(CCCD_UUID) ?: return false
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      gatt.writeDescriptor(cccd, cccdValue) == BluetoothStatusCodesCompat.SUCCESS
    } else {
      @Suppress("DEPRECATION")
      cccd.value = cccdValue
      @Suppress("DEPRECATION")
      gatt.writeDescriptor(cccd)
    }
  }

  private fun cccdEnableValueFor(characteristic: BluetoothGattCharacteristic): ByteArray? {
    val props = characteristic.properties
    return when {
      (props and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0 ->
        BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
      (props and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0 ->
        BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
      else -> null
    }
  }

  private fun handleCharacteristicData(
    gatt: BluetoothGatt,
    characteristic: BluetoothGattCharacteristic,
    bytes: ByteArray,
  ) {
    val deviceId = gatt.device?.address ?: connectedDeviceId ?: return
    val deviceName = connectedDeviceName ?: discovered[deviceId]?.name ?: "BLE Sensor"
    val charUuid = GattUuids.shortUuid(characteristic.uuid.toString())

    val reading: BleReadingPayload? = when (charUuid) {
      GattUuids.HEART_RATE_MEASUREMENT -> {
        val decoded = BoopsGattDecoders.decodeHeartRateMeasurement(bytes) ?: return
        val rmssd = synchronized(rrBufferMs) {
          for (rr in decoded.rrIntervalsMs) {
            if (rr in 250.0..2500.0) {
              if (rrBufferMs.size >= MAX_RR_WINDOW) rrBufferMs.removeFirst()
              rrBufferMs.addLast(rr)
            }
          }
          BoopsGattDecoders.computeRmssdMs(rrBufferMs.toList())
        }
        val quality = if (decoded.sensorContactDetected == false) 0.40 else 0.95
        BleReadingPayload(
          deviceId = deviceId,
          deviceName = deviceName,
          metric = "heart_rate",
          rhrBpm = decoded.bpm.toDouble(),
          hrvRmssdMs = rmssd,
          batteryPct = lastBatteryPct,
          signalQuality = quality,
        )
      }

      GattUuids.PLX_SPOT_CHECK, GattUuids.PLX_CONTINUOUS -> {
        val decoded = BoopsGattDecoders.decodePulseOximeter(bytes) ?: return
        BleReadingPayload(
          deviceId = deviceId,
          deviceName = deviceName,
          metric = "pulse_oximeter",
          rhrBpm = decoded.pulseRateBpm,
          spo2Pct = decoded.spo2Pct,
          batteryPct = lastBatteryPct,
          signalQuality = 0.95,
        )
      }

      GattUuids.BLOOD_PRESSURE_MEASUREMENT -> {
        val decoded = BoopsGattDecoders.decodeBloodPressureMeasurement(bytes) ?: return
        BleReadingPayload(
          deviceId = deviceId,
          deviceName = deviceName,
          metric = "blood_pressure",
          rhrBpm = decoded.pulseRateBpm,
          sbpMmHg = decoded.systolicMmHg,
          dbpMmHg = decoded.diastolicMmHg,
          batteryPct = lastBatteryPct,
          signalQuality = 0.95,
        )
      }

      GattUuids.TEMPERATURE_MEASUREMENT -> {
        val decoded = BoopsGattDecoders.decodeTemperatureMeasurement(bytes) ?: return
        BleReadingPayload(
          deviceId = deviceId,
          deviceName = deviceName,
          metric = "temperature",
          tempC = decoded.tempC,
          batteryPct = lastBatteryPct,
          signalQuality = 0.95,
        )
      }

      GattUuids.BATTERY_LEVEL -> {
        val pct = BoopsGattDecoders.decodeBatteryLevel(bytes) ?: return
        lastBatteryPct = pct
        discovered[deviceId]?.batteryPct = pct
        emitScanResultsNow()
        BleReadingPayload(
          deviceId = deviceId,
          deviceName = deviceName,
          metric = "battery",
          batteryPct = pct,
          signalQuality = 1.0,
        )
      }

      else -> null
    }

    if (reading != null) {
      emitEvent("ble_reading", BoopsBridgePayloads.bleReadingJson(reading))
    }
  }

  private fun emitStatus(error: String? = null, message: String) {
    val adapter = bluetoothAdapterOrNull()
    val payload = BoopsBridgePayloads.bleStatusJson(
      scanning = scanning,
      poweredOn = adapter?.isEnabled == true,
      authorized = hasRequiredPermissions(),
      connectedDeviceId = connectedDeviceId,
      connectedDeviceName = connectedDeviceName,
      error = error,
      message = message,
    )
    emitEvent("ble_status", payload)
  }

  private fun bluetoothAdapterOrNull(): BluetoothAdapter? {
    val manager = activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return manager?.adapter
  }

  private fun isBleHardwareSupported(): Boolean =
    activity.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)

  private fun requiredRuntimePermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  private fun hasRequiredPermissions(): Boolean = requiredRuntimePermissions().all(::hasPermission)

  private fun hasScanPermission(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      hasPermission(Manifest.permission.BLUETOOTH_SCAN)
    } else {
      hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  private fun hasConnectPermission(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      true
    }

  private fun hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED

  @SuppressLint("MissingPermission")
  private fun safeDeviceName(device: BluetoothDevice): String? {
    if (!hasConnectPermission()) return null
    return try {
      device.name?.trim()?.takeIf { it.isNotEmpty() }
    } catch (_: SecurityException) {
      null
    }
  }

  private object BluetoothStatusCodesCompat {
    const val SUCCESS = 0
  }

  companion object {
    private const val TAG = "BOOPS-BLE"
    private const val SCAN_TIMEOUT_MS = 30_000L
    private const val SCAN_EMIT_THROTTLE_MS = 350L
    private const val MAX_SCAN_DEVICES = 25
    private const val MAX_RR_WINDOW = 60
    private val CCCD_UUID = UUID.fromString(GattUuids.CLIENT_CHARACTERISTIC_CONFIG)
  }
}
