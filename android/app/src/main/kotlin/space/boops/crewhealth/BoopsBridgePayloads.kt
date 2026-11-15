package space.boops.crewhealth

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sqrt
import org.json.JSONArray
import org.json.JSONObject

/** Standard Bluetooth SIG GATT UUID constants and short-UUID helpers for BOOPS sensors. */
object GattUuids {
  const val HEART_RATE_SERVICE = "180D"
  const val PULSE_OXIMETER_SERVICE = "1822"
  const val BLOOD_PRESSURE_SERVICE = "1810"
  const val HEALTH_THERMOMETER_SERVICE = "1809"
  const val BATTERY_SERVICE = "180F"

  const val HEART_RATE_MEASUREMENT = "2A37"
  const val PLX_SPOT_CHECK = "2A5E"
  const val PLX_CONTINUOUS = "2A5F"
  const val BLOOD_PRESSURE_MEASUREMENT = "2A35"
  const val TEMPERATURE_MEASUREMENT = "2A1C"
  const val BATTERY_LEVEL = "2A19"

  const val CLIENT_CHARACTERISTIC_CONFIG = "00002902-0000-1000-8000-00805F9B34FB"

  val VITAL_SERVICE_SHORT_UUIDS: Set<String> = setOf(
    HEART_RATE_SERVICE,
    PULSE_OXIMETER_SERVICE,
    BLOOD_PRESSURE_SERVICE,
    HEALTH_THERMOMETER_SERVICE,
  )

  private val SIG_BASE_REGEX = Regex("^0000([0-9A-F]{4})-0000-1000-8000-00805F9B34FB$")

  /** Normalizes a standard Bluetooth SIG 128-bit UUID to its 4-character hex ID when applicable. */
  fun shortUuid(uuid: String): String {
    val upper = uuid.trim().uppercase()
    return SIG_BASE_REGEX.matchEntire(upper)?.groupValues?.get(1) ?: upper
  }

  /** Expands a 4-character SIG short UUID into the full 128-bit Bluetooth base UUID. */
  fun fullUuid(shortOrFull: String): String {
    val clean = shortOrFull.trim().uppercase()
    return if (clean.length == 4) {
      "0000$clean-0000-1000-8000-00805F9B34FB"
    } else {
      clean
    }
  }

  /** Maps advertised GATT service UUIDs to a concise BOOPS sensor category. */
  fun classifyDeviceKind(serviceUuids: Collection<String>): String {
    val normalized = serviceUuids.map { shortUuid(it) }.toSet()
    val vitalMatches = normalized.intersect(VITAL_SERVICE_SHORT_UUIDS)
    if (vitalMatches.size > 1) return "multi_sensor"
    return when {
      HEART_RATE_SERVICE in normalized -> "heart_rate"
      PULSE_OXIMETER_SERVICE in normalized -> "pulse_oximeter"
      BLOOD_PRESSURE_SERVICE in normalized -> "blood_pressure"
      HEALTH_THERMOMETER_SERVICE in normalized -> "thermometer"
      else -> "wearable"
    }
  }
}

/** Decoded Heart Rate Measurement (`0x2A37`) frame. */
data class DecodedHeartRate(
  val bpm: Int,
  val rrIntervalsMs: List<Double>,
  val sensorContactDetected: Boolean?,
)

/** Decoded Pulse Oximeter (`0x2A5E` / `0x2A5F`) frame. */
data class DecodedPulseOximeter(
  val spo2Pct: Double?,
  val pulseRateBpm: Double?,
)

/** Decoded Blood Pressure Measurement (`0x2A35`) frame in mmHg. */
data class DecodedBloodPressure(
  val systolicMmHg: Double?,
  val diastolicMmHg: Double?,
  val mapMmHg: Double?,
  val pulseRateBpm: Double?,
)

/** Decoded Health Thermometer (`0x2A1C`) frame in degrees Celsius. */
data class DecodedTemperature(
  val tempC: Double,
)

/** Pure binary GATT payload decoders and HRV RMSSD calculator (JVM unit-testable). */
object BoopsGattDecoders {
  private const val KPA_TO_MMHG = 7.50061683

  /**
   * Decodes Bluetooth SIG 16-bit IEEE-11073 SFLOAT at [offset] (little-endian).
   * Returns `null` for NaN, NRes, +/-Infinity, Reserved, or out-of-bounds input.
   */
  fun decodeSfloat16(bytes: ByteArray, offset: Int): Double? {
    if (offset < 0 || offset + 2 > bytes.size) return null
    val raw = (bytes[offset].toInt() and 0xFF) or ((bytes[offset + 1].toInt() and 0xFF) shl 8)
    // IEEE-11073 16-bit SFLOAT reserved values: +INF(0x07FE), NaN(0x07FF), NRes(0x0800), RFU(0x0801), -INF(0x0802)
    if (raw in 0x07FE..0x0802) return null

    var mantissa = raw and 0x0FFF
    if ((mantissa and 0x0800) != 0) {
      mantissa -= 0x1000
    }
    var exponent = (raw ushr 12) and 0x0F
    if ((exponent and 0x08) != 0) {
      exponent -= 0x10
    }
    val value = mantissa * 10.0.pow(exponent)
    return if (value.isFinite()) value else null
  }

  /**
   * Decodes Bluetooth SIG 32-bit IEEE-11073 FLOAT at [offset] (little-endian).
   * Returns `null` for special sentinel values or out-of-bounds input.
   */
  fun decodeFloat32(bytes: ByteArray, offset: Int): Double? {
    if (offset < 0 || offset + 4 > bytes.size) return null
    val raw = (bytes[offset].toInt() and 0xFF) or
      ((bytes[offset + 1].toInt() and 0xFF) shl 8) or
      ((bytes[offset + 2].toInt() and 0xFF) shl 16) or
      ((bytes[offset + 3].toInt() and 0xFF) shl 24)

    if (raw == 0x007FFFFE || raw == 0x007FFFFF || raw == 0x00800000 || raw == 0x00800001 || raw == 0x00800002) {
      return null
    }

    var mantissa = raw and 0x00FFFFFF
    if ((mantissa and 0x00800000) != 0) {
      mantissa -= 0x01000000
    }
    val exponent = (raw shr 24) // signed 8-bit arithmetic shift
    val value = mantissa * 10.0.pow(exponent)
    return if (value.isFinite()) value else null
  }

  /**
   * Decodes Heart Rate Measurement (`0x2A37`).
   * Supports 8-bit/16-bit HR flags, sensor contact status, optional Energy Expended,
   * and trailing RR-intervals encoded in units of 1/1024 seconds.
   */
  fun decodeHeartRateMeasurement(bytes: ByteArray): DecodedHeartRate? {
    if (bytes.size < 2) return null
    val flags = bytes[0].toInt() and 0xFF
    val isUint16 = (flags and 0x01) != 0
    val contactBits = (flags ushr 1) and 0x03
    val sensorContactDetected: Boolean? = when (contactBits) {
      0b10 -> false
      0b11 -> true
      else -> null
    }
    val hasEnergyExpended = (flags and 0x08) != 0
    val hasRrIntervals = (flags and 0x10) != 0

    var offset = 1
    val bpm = if (isUint16) {
      if (offset + 2 > bytes.size) return null
      val v = (bytes[offset].toInt() and 0xFF) or ((bytes[offset + 1].toInt() and 0xFF) shl 8)
      offset += 2
      v
    } else {
      val v = bytes[offset].toInt() and 0xFF
      offset += 1
      v
    }

    if (hasEnergyExpended) {
      if (offset + 2 > bytes.size) return DecodedHeartRate(bpm, emptyList(), sensorContactDetected)
      offset += 2
    }

    val rrList = mutableListOf<Double>()
    if (hasRrIntervals) {
      while (offset + 2 <= bytes.size) {
        val rawRr = (bytes[offset].toInt() and 0xFF) or ((bytes[offset + 1].toInt() and 0xFF) shl 8)
        offset += 2
        if (rawRr > 0) {
          val ms = (rawRr * 1000.0) / 1024.0
          rrList.add(round1(ms))
        }
      }
    }

    return DecodedHeartRate(
      bpm = bpm,
      rrIntervalsMs = rrList,
      sensorContactDetected = sensorContactDetected,
    )
  }

  /**
   * Decodes Pulse Oximeter Spot-Check (`0x2A5E`) or Continuous (`0x2A5F`) measurement.
   * Both formats start with a 1-byte flags field followed by SpO2 (SFLOAT) and PR (SFLOAT).
   */
  fun decodePulseOximeter(bytes: ByteArray): DecodedPulseOximeter? {
    if (bytes.size < 5) return null
    val rawSpo2 = decodeSfloat16(bytes, 1)
    val rawPr = decodeSfloat16(bytes, 3)
    val spo2 = rawSpo2?.takeIf { it in 50.0..100.0 }?.let(::round1)
    val pr = rawPr?.takeIf { it in 20.0..250.0 }?.let(::round1)
    if (spo2 == null && pr == null) return null
    return DecodedPulseOximeter(spo2Pct = spo2, pulseRateBpm = pr)
  }

  /**
   * Decodes Blood Pressure Measurement (`0x2A35`), converting kPa to mmHg when bit 0 is set.
   */
  fun decodeBloodPressureMeasurement(bytes: ByteArray): DecodedBloodPressure? {
    if (bytes.size < 7) return null
    val flags = bytes[0].toInt() and 0xFF
    val isKpa = (flags and 0x01) != 0
    val hasTimestamp = (flags and 0x02) != 0
    val hasPulseRate = (flags and 0x04) != 0

    val factor = if (isKpa) KPA_TO_MMHG else 1.0
    val systolic = decodeSfloat16(bytes, 1)?.let { round1(it * factor) }
    val diastolic = decodeSfloat16(bytes, 3)?.let { round1(it * factor) }
    val map = decodeSfloat16(bytes, 5)?.let { round1(it * factor) }

    var offset = 7
    if (hasTimestamp) offset += 7
    val pulseRate = if (hasPulseRate && offset + 2 <= bytes.size) {
      decodeSfloat16(bytes, offset)?.takeIf { it in 20.0..250.0 }?.let(::round1)
    } else {
      null
    }

    if (systolic == null && diastolic == null) return null
    return DecodedBloodPressure(
      systolicMmHg = systolic,
      diastolicMmHg = diastolic,
      mapMmHg = map,
      pulseRateBpm = pulseRate,
    )
  }

  /**
   * Decodes Health Thermometer Temperature Measurement (`0x2A1C`), converting Fahrenheit to Celsius
   * when bit 0 is set.
   */
  fun decodeTemperatureMeasurement(bytes: ByteArray): DecodedTemperature? {
    if (bytes.size < 5) return null
    val flags = bytes[0].toInt() and 0xFF
    val isFahrenheit = (flags and 0x01) != 0
    val rawTemp = decodeFloat32(bytes, 1) ?: return null
    val celsius = if (isFahrenheit) (rawTemp - 32.0) * 5.0 / 9.0 else rawTemp
    if (!celsius.isFinite() || celsius !in 25.0..45.0) return null
    return DecodedTemperature(tempC = round2(celsius))
  }

  /** Decodes Battery Level (`0x2A19`) as an integer percentage clamped to 0..100. */
  fun decodeBatteryLevel(bytes: ByteArray): Int? {
    if (bytes.isEmpty()) return null
    val pct = bytes[0].toInt() and 0xFF
    return if (pct in 0..100) pct else null
  }

  /**
   * Computes Root Mean Square of Successive Differences (RMSSD) in milliseconds from a series of
   * RR intervals in ms. Requires at least 2 valid physiological RR intervals (250..2500 ms).
   */
  fun computeRmssdMs(rrIntervalsMs: List<Double>): Double? {
    val valid = rrIntervalsMs.filter { it.isFinite() && it in 250.0..2500.0 }
    if (valid.size < 2) return null
    var sumSquaredDiffs = 0.0
    for (i in 1 until valid.size) {
      val diff = valid[i] - valid[i - 1]
      sumSquaredDiffs += diff * diff
    }
    val rmssd = sqrt(sumSquaredDiffs / (valid.size - 1))
    return if (rmssd.isFinite()) round1(rmssd) else null
  }

  internal fun round1(value: Double): Double = (value * 10.0).roundToLong() / 10.0
  internal fun round2(value: Double): Double = (value * 100.0).roundToLong() / 100.0
}

/** Pure Health Connect sample DTOs for testable per-day aggregation. */
data class HeartRateSamplePoint(val date: LocalDate, val bpm: Double)
data class HrvSamplePoint(val date: LocalDate, val rmssdMs: Double)
data class SleepInterval(
  val date: LocalDate,
  val startEpochSec: Long,
  val endEpochSec: Long,
  val awakeSeconds: Long = 0L,
)
data class Spo2SamplePoint(val date: LocalDate, val pct: Double)
data class BloodPressureSamplePoint(val date: LocalDate, val sbpMmHg: Double, val dbpMmHg: Double)
data class BodyTempSamplePoint(val date: LocalDate, val tempC: Double)
data class ExerciseInterval(val date: LocalDate, val startEpochSec: Long, val endEpochSec: Long)

/** Aggregated daily health record matching BOOPS's `health_sync` payload contract. */
data class DailyHealthSummary(
  val date: String,
  val rhrBpm: Double?,
  val hrvRmssdMs: Double?,
  val sleepHours: Double?,
  val spo2Pct: Double?,
  val sbpMmHg: Double?,
  val dbpMmHg: Double?,
  val tempC: Double?,
  val exerciseMin: Double?,
  val signalQuality: Double = 0.95,
  val source: String = "wearable",
  val samplesCount: Int,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("date", date)
    put("rhr_bpm", rhrBpm ?: JSONObject.NULL)
    put("hrv_rmssd_ms", hrvRmssdMs ?: JSONObject.NULL)
    put("hrv_metric", "rmssd")
    put("sleep_hours", sleepHours ?: JSONObject.NULL)
    put("spo2_pct", spo2Pct ?: JSONObject.NULL)
    put("sbp_mmhg", sbpMmHg ?: JSONObject.NULL)
    put("dbp_mmhg", dbpMmHg ?: JSONObject.NULL)
    put("temp_c", tempC ?: JSONObject.NULL)
    put("exercise_min", exerciseMin ?: JSONObject.NULL)
    put("signal_quality", signalQuality)
    put("source", source)
    put("samples_count", samplesCount)
  }
}

/** Aggregates Health Connect records by local calendar day (`YYYY-MM-DD`). */
object HealthDailyAggregator {

  /**
   * Estimates daily resting heart rate from heart rate samples by averaging the lowest 20%
   * of physiologically valid samples (30..220 bpm), reducing skew from workout peaks.
   */
  fun estimateRestingHeartRate(bpmSamples: List<Double>): Double? {
    val valid = bpmSamples.filter { it.isFinite() && it in 30.0..220.0 }.sorted()
    if (valid.isEmpty()) return null
    val takeCount = max(1, (valid.size * 0.20).roundToInt())
    val avg = valid.take(takeCount).average()
    return BoopsGattDecoders.round1(avg)
  }

  /**
   * Merges overlapping `[startEpochSec, endEpochSec]` intervals and returns total covered seconds,
   * preventing double counting across multiple fitness/sleep trackers.
   */
  fun mergedDurationSeconds(intervals: List<Pair<Long, Long>>): Long {
    val valid = intervals.filter { it.second > it.first }.sortedBy { it.first }
    if (valid.isEmpty()) return 0L
    var total = 0L
    var curStart = valid[0].first
    var curEnd = valid[0].second
    for (i in 1 until valid.size) {
      val (nextStart, nextEnd) = valid[i]
      if (nextStart <= curEnd) {
        if (nextEnd > curEnd) curEnd = nextEnd
      } else {
        total += (curEnd - curStart)
        curStart = nextStart
        curEnd = nextEnd
      }
    }
    total += (curEnd - curStart)
    return total
  }

  /** Aggregates all 7 Health Connect record streams per local calendar day, sorted ascending. */
  fun aggregate(
    heartRateSamples: List<HeartRateSamplePoint> = emptyList(),
    hrvSamples: List<HrvSamplePoint> = emptyList(),
    sleepIntervals: List<SleepInterval> = emptyList(),
    spo2Samples: List<Spo2SamplePoint> = emptyList(),
    bloodPressureSamples: List<BloodPressureSamplePoint> = emptyList(),
    bodyTempSamples: List<BodyTempSamplePoint> = emptyList(),
    exerciseIntervals: List<ExerciseInterval> = emptyList(),
  ): List<DailyHealthSummary> {
    val hrByDay = heartRateSamples.groupBy { it.date }
    val hrvByDay = hrvSamples.groupBy { it.date }
    val sleepByDay = sleepIntervals.groupBy { it.date }
    val spo2ByDay = spo2Samples.groupBy { it.date }
    val bpByDay = bloodPressureSamples.groupBy { it.date }
    val tempByDay = bodyTempSamples.groupBy { it.date }
    val exerciseByDay = exerciseIntervals.groupBy { it.date }

    val allDates = buildSet {
      addAll(hrByDay.keys)
      addAll(hrvByDay.keys)
      addAll(sleepByDay.keys)
      addAll(spo2ByDay.keys)
      addAll(bpByDay.keys)
      addAll(tempByDay.keys)
      addAll(exerciseByDay.keys)
    }.sorted()

    return allDates.mapNotNull { day ->
      val hrs = hrByDay[day].orEmpty()
      val hrvs = hrvByDay[day].orEmpty()
      val sleeps = sleepByDay[day].orEmpty()
      val spo2s = spo2ByDay[day].orEmpty()
      val bps = bpByDay[day].orEmpty()
      val temps = tempByDay[day].orEmpty()
      val exercises = exerciseByDay[day].orEmpty()

      val samplesCount = hrs.size + hrvs.size + sleeps.size + spo2s.size +
        bps.size + temps.size + exercises.size
      if (samplesCount == 0) return@mapNotNull null

      val rhrBpm = estimateRestingHeartRate(hrs.map { it.bpm })

      val validHrv = hrvs.map { it.rmssdMs }.filter { it.isFinite() && it in 1.0..500.0 }
      val hrvRmssdMs = if (validHrv.isNotEmpty()) BoopsGattDecoders.round1(validHrv.average()) else null

      val sleepHours = if (sleeps.isNotEmpty()) {
        val mergedSec = mergedDurationSeconds(sleeps.map { it.startEpochSec to it.endEpochSec })
        val awakeSec = sleeps.sumOf { it.awakeSeconds.coerceAtLeast(0L) }.coerceAtMost(mergedSec)
        val netSec = (mergedSec - awakeSec).coerceAtLeast(0L)
        if (mergedSec > 0L) BoopsGattDecoders.round2(netSec / 3600.0) else null
      } else {
        null
      }

      val validSpo2 = spo2s.map { it.pct }.filter { it.isFinite() && it in 50.0..100.0 }
      val spo2Pct = if (validSpo2.isNotEmpty()) BoopsGattDecoders.round1(validSpo2.average()) else null

      val validBp = bps.filter {
        it.sbpMmHg.isFinite() && it.dbpMmHg.isFinite() &&
          it.sbpMmHg in 50.0..260.0 && it.dbpMmHg in 30.0..180.0
      }
      val sbpMmHg = if (validBp.isNotEmpty()) BoopsGattDecoders.round1(validBp.map { it.sbpMmHg }.average()) else null
      val dbpMmHg = if (validBp.isNotEmpty()) BoopsGattDecoders.round1(validBp.map { it.dbpMmHg }.average()) else null

      val validTemp = temps.map { it.tempC }.filter { it.isFinite() && it in 25.0..45.0 }
      val tempC = if (validTemp.isNotEmpty()) BoopsGattDecoders.round2(validTemp.average()) else null

      val exerciseMin = if (exercises.isNotEmpty()) {
        val sec = mergedDurationSeconds(exercises.map { it.startEpochSec to it.endEpochSec })
        if (sec > 0L) BoopsGattDecoders.round1(sec / 60.0) else null
      } else {
        null
      }

      DailyHealthSummary(
        date = day.toString(),
        rhrBpm = rhrBpm,
        hrvRmssdMs = hrvRmssdMs,
        sleepHours = sleepHours,
        spo2Pct = spo2Pct,
        sbpMmHg = sbpMmHg,
        dbpMmHg = dbpMmHg,
        tempC = tempC,
        exerciseMin = exerciseMin,
        signalQuality = 0.95,
        source = "wearable",
        samplesCount = samplesCount,
      )
    }
  }
}

/** Snapshot DTOs for native capability & event serialization. */
data class HealthCapabilities(
  val available: Boolean,
  val authorized: Boolean,
  val status: String,
  val detail: String,
)

data class BluetoothCapabilities(
  val available: Boolean,
  val authorized: Boolean,
  val poweredOn: Boolean,
  val scanning: Boolean,
)

data class NearbyCapabilities(
  val available: Boolean,
  val authorized: Boolean,
  val active: Boolean,
)

data class BleDeviceInfo(
  val id: String,
  val name: String,
  val rssi: Int,
  val services: List<String>,
  val kind: String,
  val connected: Boolean,
  val batteryPct: Int?,
)

data class BleReadingPayload(
  val deviceId: String,
  val deviceName: String,
  val metric: String,
  val rhrBpm: Double? = null,
  val hrvRmssdMs: Double? = null,
  val spo2Pct: Double? = null,
  val sbpMmHg: Double? = null,
  val dbpMmHg: Double? = null,
  val tempC: Double? = null,
  val batteryPct: Int? = null,
  val signalQuality: Double = 0.95,
  val source: String = "wearable",
  val timestamp: String = BoopsBridgePayloads.nowIsoUtc(),
)

data class NearbyPeerInfo(
  val id: String,
  val name: String,
  val transport: String = "wifi_p2p",
  val status: String,
)

/** Exact JSON serializers matching the `BoopsAndroid` and `window.__boopsNativeEvent` contract. */
object BoopsBridgePayloads {

  fun nowIsoUtc(): String = DateTimeFormatter.ISO_INSTANT.format(
    Instant.now().atOffset(ZoneOffset.UTC),
  )

  fun capabilitiesJson(
    health: HealthCapabilities,
    bluetooth: BluetoothCapabilities,
    nearby: NearbyCapabilities,
  ): String {
    val root = JSONObject().apply {
      put("platform", "android")
      put(
        "healthApi",
        JSONObject().apply {
          put("name", "Health Connect")
          put("available", health.available)
          put("authorized", health.authorized)
          put("status", health.status)
          put("detail", health.detail)
        },
      )
      put(
        "bluetooth",
        JSONObject().apply {
          put("available", bluetooth.available)
          put("authorized", bluetooth.authorized)
          put("poweredOn", bluetooth.poweredOn)
          put("scanning", bluetooth.scanning)
          put("mode", "native_ble")
        },
      )
      put(
        "nearby",
        JSONObject().apply {
          put("available", nearby.available)
          put("authorized", nearby.authorized)
          put("active", nearby.active)
          put("transport", "wifi_p2p")
        },
      )
    }
    return root.toString()
  }

  fun healthPermissionsJson(
    granted: Boolean,
    missing: List<String>,
    message: String,
  ): String = JSONObject().apply {
    put("granted", granted)
    put("missing", JSONArray(missing))
    put("message", message)
  }.toString()

  fun healthSyncJson(
    ok: Boolean,
    records: List<DailyHealthSummary>,
    message: String,
    provider: String = "health_connect",
  ): String {
    val arr = JSONArray()
    for (record in records) {
      arr.put(record.toJson())
    }
    return JSONObject().apply {
      put("ok", ok)
      put("provider", provider)
      put("records", arr)
      put("message", message)
    }.toString()
  }

  fun bleStatusJson(
    scanning: Boolean,
    poweredOn: Boolean,
    authorized: Boolean,
    connectedDeviceId: String?,
    connectedDeviceName: String?,
    error: String?,
    message: String,
  ): String = JSONObject().apply {
    put("scanning", scanning)
    put("poweredOn", poweredOn)
    put("authorized", authorized)
    put("connectedDeviceId", connectedDeviceId ?: JSONObject.NULL)
    put("connectedDeviceName", connectedDeviceName ?: JSONObject.NULL)
    put("error", error ?: JSONObject.NULL)
    put("message", message)
  }.toString()

  fun bleScanResultJson(devices: List<BleDeviceInfo>): String {
    val arr = JSONArray()
    for (device in devices) {
      arr.put(
        JSONObject().apply {
          put("id", device.id)
          put("name", device.name)
          put("rssi", device.rssi)
          put("services", JSONArray(device.services))
          put("kind", device.kind)
          put("connected", device.connected)
          put("batteryPct", device.batteryPct ?: JSONObject.NULL)
        },
      )
    }
    return JSONObject().apply { put("devices", arr) }.toString()
  }

  fun bleReadingJson(reading: BleReadingPayload): String = JSONObject().apply {
    put("deviceId", reading.deviceId)
    put("deviceName", reading.deviceName)
    put("metric", reading.metric)
    put("rhr_bpm", reading.rhrBpm ?: JSONObject.NULL)
    put("hrv_rmssd_ms", reading.hrvRmssdMs ?: JSONObject.NULL)
    put("spo2_pct", reading.spo2Pct ?: JSONObject.NULL)
    put("sbp_mmhg", reading.sbpMmHg ?: JSONObject.NULL)
    put("dbp_mmhg", reading.dbpMmHg ?: JSONObject.NULL)
    put("temp_c", reading.tempC ?: JSONObject.NULL)
    put("batteryPct", reading.batteryPct ?: JSONObject.NULL)
    put("signal_quality", reading.signalQuality)
    put("source", reading.source)
    put("timestamp", reading.timestamp)
  }.toString()

  fun nearbyStatusJson(
    active: Boolean,
    authorized: Boolean,
    message: String,
    error: String? = null,
    transport: String = "wifi_p2p",
  ): String = JSONObject().apply {
    put("active", active)
    put("authorized", authorized)
    put("transport", transport)
    put("message", message)
    put("error", error ?: JSONObject.NULL)
  }.toString()

  fun nearbyPeersJson(peers: List<NearbyPeerInfo>): String {
    val arr = JSONArray()
    for (peer in peers) {
      arr.put(
        JSONObject().apply {
          put("id", peer.id)
          put("name", peer.name)
          put("transport", peer.transport)
          put("status", peer.status)
        },
      )
    }
    return JSONObject().apply { put("peers", arr) }.toString()
  }

  fun nearbyReceivedJson(
    peerId: String,
    peerName: String,
    payloadJson: String,
    receivedAt: String = nowIsoUtc(),
  ): String = JSONObject().apply {
    put("peerId", peerId)
    put("peerName", peerName)
    put("payloadJson", payloadJson)
    put("receivedAt", receivedAt)
  }.toString()

  fun nearbySentJson(
    ok: Boolean,
    peerId: String,
    bytes: Int,
    message: String,
  ): String = JSONObject().apply {
    put("ok", ok)
    put("peerId", peerId)
    put("bytes", bytes)
    put("message", message)
  }.toString()

  /** Builds the JS evaluation snippet for `window.__boopsNativeEvent(type, payload)`. */
  fun buildNativeEventScript(type: String, jsonString: String): String {
    val safeJson = jsonString
      .replace("\u2028", "\\u2028")
      .replace("\u2029", "\\u2029")
    return "window.__boopsNativeEvent && window.__boopsNativeEvent(${JSONObject.quote(type)}, $safeJson);"
  }
}

/** Envelope exchanged between BOOPS peers over local Wi-Fi Direct TCP sockets. */
data class NearbyEnvelope(
  val senderId: String,
  val senderName: String,
  val payloadJson: String,
)

/** Pure length-prefixed UTF-8 framing for local Wi-Fi Direct peer-to-peer JSON exchange. */
object NearbyWireProtocol {
  const val MAX_FRAME_BYTES = 2 * 1024 * 1024 // 2 MiB safety ceiling per summary frame

  /** Encodes [senderId], [senderName], and [payloadJson] into a 4-byte length-prefixed UTF-8 frame. */
  fun encodeFrame(senderId: String, senderName: String, payloadJson: String): ByteArray? {
    val json = JSONObject().apply {
      put("senderId", senderId)
      put("senderName", senderName)
      put("payloadJson", payloadJson)
    }.toString()
    val body = json.toByteArray(Charsets.UTF_8)
    if (body.isEmpty() || body.size > MAX_FRAME_BYTES) return null
    val out = ByteArray(4 + body.size)
    val len = body.size
    out[0] = ((len ushr 24) and 0xFF).toByte()
    out[1] = ((len ushr 16) and 0xFF).toByte()
    out[2] = ((len ushr 8) and 0xFF).toByte()
    out[3] = (len and 0xFF).toByte()
    System.arraycopy(body, 0, out, 4, body.size)
    return out
  }

  /** Decodes a UTF-8 JSON envelope body (without the 4-byte length prefix). */
  fun decodeEnvelope(body: ByteArray): NearbyEnvelope? {
    if (body.isEmpty() || body.size > MAX_FRAME_BYTES) return null
    return try {
      val obj = JSONObject(String(body, Charsets.UTF_8))
      val payloadJson = obj.optString("payloadJson", "")
      if (payloadJson.isEmpty()) return null
      NearbyEnvelope(
        senderId = obj.optString("senderId", "unknown"),
        senderName = obj.optString("senderName", "BOOPS Peer"),
        payloadJson = payloadJson,
      )
    } catch (_: Exception) {
      null
    }
  }
}
