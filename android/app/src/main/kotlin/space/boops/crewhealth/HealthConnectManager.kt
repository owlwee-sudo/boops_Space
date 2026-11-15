package space.boops.crewhealth

import android.util.Log
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.reflect.KClass
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Manages offline Android Health Connect availability, read permissions, and daily vitals sync
 * across the 7 BOOPS physiological record types.
 */
class HealthConnectManager(
  private val activity: ComponentActivity,
  private val emitEvent: (type: String, json: String) -> Unit,
  private val onCapabilitiesChanged: () -> Unit,
) {

  @Volatile
  private var cachedAuthorized: Boolean = false

  private val permissionLauncher = activity.registerForActivityResult(
    PermissionController.createRequestPermissionResultContract(),
  ) { grantedPermissions ->
    val missing = requiredPermissions.filterNot { it in grantedPermissions }.sorted()
    val allGranted = missing.isEmpty()
    val anyGranted = grantedPermissions.any { it in requiredPermissions }
    cachedAuthorized = anyGranted

    val message = when {
      allGranted -> "All Health Connect permissions granted."
      anyGranted -> "Partial Health Connect permissions granted (${requiredPermissions.size - missing.size}/${requiredPermissions.size})."
      else -> "Health Connect read permissions were not granted."
    }
    emitEvent("health_permissions", BoopsBridgePayloads.healthPermissionsJson(allGranted, missing, message))
    onCapabilitiesChanged()
  }

  /** Returns the current Health Connect availability and cached authorization snapshot. */
  fun getCapabilities(): HealthCapabilities {
    val sdkStatus = safeGetSdkStatus()
    return when (sdkStatus) {
      HealthConnectClient.SDK_AVAILABLE -> HealthCapabilities(
        available = true,
        authorized = cachedAuthorized,
        status = "available",
        detail = if (cachedAuthorized) {
          "Health Connect ready on-device"
        } else {
          "Health Connect available; permission required"
        },
      )

      HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> HealthCapabilities(
        available = false,
        authorized = false,
        status = "provider_update_required",
        detail = "Health Connect app installation or update required",
      )

      else -> HealthCapabilities(
        available = false,
        authorized = false,
        status = "unavailable",
        detail = "Health Connect is unavailable on this Android device",
      )
    }
  }

  /** Refreshes cached permission authorization state asynchronously. */
  fun refreshAuthorization() {
    if (safeGetSdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
      if (cachedAuthorized) {
        cachedAuthorized = false
        onCapabilitiesChanged()
      }
      return
    }
    activity.lifecycleScope.launch {
      try {
        val client = HealthConnectClient.getOrCreate(activity)
        val granted = withContext(Dispatchers.IO) {
          client.permissionController.getGrantedPermissions()
        }
        val authorized = granted.any { it in requiredPermissions }
        if (authorized != cachedAuthorized) {
          cachedAuthorized = authorized
          onCapabilitiesChanged()
        }
      } catch (err: Exception) {
        Log.w(TAG, "Unable to query Health Connect granted permissions", err)
      }
    }
  }

  /** Checks current grants and launches the Health Connect permissions screen if needed. */
  fun requestPermissions(): Boolean {
    val sdkStatus = safeGetSdkStatus()
    if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
      val detail = getCapabilities().detail
      emitEvent(
        "health_permissions",
        BoopsBridgePayloads.healthPermissionsJson(
          granted = false,
          missing = requiredPermissions.sorted(),
          message = detail,
        ),
      )
      return false
    }

    activity.lifecycleScope.launch {
      try {
        val client = HealthConnectClient.getOrCreate(activity)
        val granted = withContext(Dispatchers.IO) {
          client.permissionController.getGrantedPermissions()
        }
        val missing = requiredPermissions.filterNot { it in granted }.sorted()
        if (missing.isEmpty()) {
          cachedAuthorized = true
          emitEvent(
            "health_permissions",
            BoopsBridgePayloads.healthPermissionsJson(
              granted = true,
              missing = emptyList(),
              message = "All Health Connect permissions are already granted.",
            ),
          )
          onCapabilitiesChanged()
        } else {
          permissionLauncher.launch(requiredPermissions)
        }
      } catch (err: Exception) {
        Log.e(TAG, "Failed requesting Health Connect permissions", err)
        emitEvent(
          "health_permissions",
          BoopsBridgePayloads.healthPermissionsJson(
            granted = false,
            missing = requiredPermissions.sorted(),
            message = "Health Connect permission request failed: ${err.message ?: "unknown error"}",
          ),
        )
      }
    }
    return true
  }

  /** Queries the last [daysBack] (clamped 1..30) calendar days and emits `"health_sync"`. */
  fun syncData(daysBack: Int): Boolean {
    val sdkStatus = safeGetSdkStatus()
    if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
      emitEvent(
        "health_sync",
        BoopsBridgePayloads.healthSyncJson(
          ok = false,
          records = emptyList(),
          message = getCapabilities().detail,
        ),
      )
      return false
    }

    val clampedDays = daysBack.coerceIn(1, 30)
    activity.lifecycleScope.launch {
      try {
        val client = HealthConnectClient.getOrCreate(activity)
        val granted = withContext(Dispatchers.IO) {
          client.permissionController.getGrantedPermissions()
        }
        val permitted = granted.intersect(requiredPermissions)
        cachedAuthorized = permitted.isNotEmpty()
        onCapabilitiesChanged()

        if (permitted.isEmpty()) {
          emitEvent(
            "health_sync",
            BoopsBridgePayloads.healthSyncJson(
              ok = false,
              records = emptyList(),
              message = "Health Connect read permissions are not granted.",
            ),
          )
          return@launch
        }

        val summaries = withContext(Dispatchers.IO) {
          readAndAggregate(client, granted, clampedDays)
        }
        emitEvent(
          "health_sync",
          BoopsBridgePayloads.healthSyncJson(
            ok = true,
            records = summaries,
            message = "Synced ${summaries.size} day(s) across last $clampedDays day(s) from Health Connect.",
          ),
        )
      } catch (sec: SecurityException) {
        Log.w(TAG, "Health Connect read denied by security policy", sec)
        cachedAuthorized = false
        onCapabilitiesChanged()
        emitEvent(
          "health_sync",
          BoopsBridgePayloads.healthSyncJson(
            ok = false,
            records = emptyList(),
            message = "Health Connect permission denied. Re-authorize read access.",
          ),
        )
      } catch (err: Exception) {
        Log.e(TAG, "Health Connect sync failed", err)
        emitEvent(
          "health_sync",
          BoopsBridgePayloads.healthSyncJson(
            ok = false,
            records = emptyList(),
            message = "Health Connect sync error: ${err.message ?: "unavailable"}",
          ),
        )
      }
    }
    return true
  }

  private suspend fun readAndAggregate(
    client: HealthConnectClient,
    granted: Set<String>,
    daysBack: Int,
  ): List<DailyHealthSummary> {
    val systemZone = ZoneId.systemDefault()
    val endTime = Instant.now()
    val startTime = LocalDate.now(systemZone)
      .minusDays((daysBack - 1).toLong())
      .atStartOfDay(systemZone)
      .toInstant()
    val filter = TimeRangeFilter.between(startTime, endTime)

    val hrPoints = mutableListOf<HeartRateSamplePoint>()
    if (PERM_HEART_RATE in granted) {
      for (record in readAllRecords(client, HeartRateRecord::class, filter)) {
        for (sample in record.samples) {
          val day = toLocalDate(sample.time, record.startZoneOffset, systemZone)
          hrPoints.add(HeartRateSamplePoint(day, sample.beatsPerMinute.toDouble()))
        }
      }
    }

    val hrvPoints = mutableListOf<HrvSamplePoint>()
    if (PERM_HRV in granted) {
      for (record in readAllRecords(client, HeartRateVariabilityRmssdRecord::class, filter)) {
        val day = toLocalDate(record.time, record.zoneOffset, systemZone)
        hrvPoints.add(HrvSamplePoint(day, record.heartRateVariabilityMillis))
      }
    }

    val sleepIntervals = mutableListOf<SleepInterval>()
    if (PERM_SLEEP in granted) {
      for (record in readAllRecords(client, SleepSessionRecord::class, filter)) {
        val wakeDay = toLocalDate(record.endTime, record.endZoneOffset, systemZone)
        val awakeSec = record.stages
          .filter {
            it.stage == SleepSessionRecord.STAGE_TYPE_AWAKE ||
              it.stage == SleepSessionRecord.STAGE_TYPE_OUT_OF_BED ||
              it.stage == SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED
          }
          .sumOf { (it.endTime.epochSecond - it.startTime.epochSecond).coerceAtLeast(0L) }
        sleepIntervals.add(
          SleepInterval(
            date = wakeDay,
            startEpochSec = record.startTime.epochSecond,
            endEpochSec = record.endTime.epochSecond,
            awakeSeconds = awakeSec,
          ),
        )
      }
    }

    val spo2Points = mutableListOf<Spo2SamplePoint>()
    if (PERM_SPO2 in granted) {
      for (record in readAllRecords(client, OxygenSaturationRecord::class, filter)) {
        val day = toLocalDate(record.time, record.zoneOffset, systemZone)
        spo2Points.add(Spo2SamplePoint(day, record.percentage.value))
      }
    }

    val bpPoints = mutableListOf<BloodPressureSamplePoint>()
    if (PERM_BLOOD_PRESSURE in granted) {
      for (record in readAllRecords(client, BloodPressureRecord::class, filter)) {
        val day = toLocalDate(record.time, record.zoneOffset, systemZone)
        bpPoints.add(
          BloodPressureSamplePoint(
            date = day,
            sbpMmHg = record.systolic.inMillimetersOfMercury,
            dbpMmHg = record.diastolic.inMillimetersOfMercury,
          ),
        )
      }
    }

    val tempPoints = mutableListOf<BodyTempSamplePoint>()
    if (PERM_BODY_TEMP in granted) {
      for (record in readAllRecords(client, BodyTemperatureRecord::class, filter)) {
        val day = toLocalDate(record.time, record.zoneOffset, systemZone)
        tempPoints.add(BodyTempSamplePoint(day, record.temperature.inCelsius))
      }
    }

    val exerciseIntervals = mutableListOf<ExerciseInterval>()
    if (PERM_EXERCISE in granted) {
      for (record in readAllRecords(client, ExerciseSessionRecord::class, filter)) {
        val day = toLocalDate(record.startTime, record.startZoneOffset, systemZone)
        exerciseIntervals.add(
          ExerciseInterval(
            date = day,
            startEpochSec = record.startTime.epochSecond,
            endEpochSec = record.endTime.epochSecond,
          ),
        )
      }
    }

    return HealthDailyAggregator.aggregate(
      heartRateSamples = hrPoints,
      hrvSamples = hrvPoints,
      sleepIntervals = sleepIntervals,
      spo2Samples = spo2Points,
      bloodPressureSamples = bpPoints,
      bodyTempSamples = tempPoints,
      exerciseIntervals = exerciseIntervals,
    )
  }

  private suspend fun <T : Record> readAllRecords(
    client: HealthConnectClient,
    recordClass: KClass<T>,
    timeRangeFilter: TimeRangeFilter,
  ): List<T> {
    val all = mutableListOf<T>()
    var pageToken: String? = null
    do {
      val response = client.readRecords(
        ReadRecordsRequest(
          recordType = recordClass,
          timeRangeFilter = timeRangeFilter,
          pageToken = pageToken,
        ),
      )
      all.addAll(response.records)
      pageToken = response.pageToken
    } while (!pageToken.isNullOrEmpty())
    return all
  }

  private fun toLocalDate(instant: Instant, offset: ZoneOffset?, fallbackZone: ZoneId): LocalDate {
    val zone: ZoneId = offset ?: fallbackZone
    return instant.atZone(zone).toLocalDate()
  }

  private fun safeGetSdkStatus(): Int {
    return try {
      HealthConnectClient.getSdkStatus(activity)
    } catch (err: Exception) {
      Log.w(TAG, "HealthConnectClient.getSdkStatus threw", err)
      HealthConnectClient.SDK_UNAVAILABLE
    }
  }

  companion object {
    private const val TAG = "BOOPS-HC"

    private val PERM_HEART_RATE = HealthPermission.getReadPermission(HeartRateRecord::class)
    private val PERM_HRV = HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class)
    private val PERM_SLEEP = HealthPermission.getReadPermission(SleepSessionRecord::class)
    private val PERM_SPO2 = HealthPermission.getReadPermission(OxygenSaturationRecord::class)
    private val PERM_BLOOD_PRESSURE = HealthPermission.getReadPermission(BloodPressureRecord::class)
    private val PERM_BODY_TEMP = HealthPermission.getReadPermission(BodyTemperatureRecord::class)
    private val PERM_EXERCISE = HealthPermission.getReadPermission(ExerciseSessionRecord::class)

    val requiredPermissions: Set<String> = setOf(
      PERM_HEART_RATE,
      PERM_HRV,
      PERM_SLEEP,
      PERM_SPO2,
      PERM_BLOOD_PRESSURE,
      PERM_BODY_TEMP,
      PERM_EXERCISE,
    )
  }
}
