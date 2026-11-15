package space.boops.crewhealth

import java.time.LocalDate
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoopsHealthAndPayloadsTest {

  @Test
  fun estimatesRestingHeartRateFromLowestTwentyPercent() {
    val samples = listOf(56.0, 58.0, 62.0, 66.0, 74.0, 88.0, 110.0, 130.0, 145.0, 160.0)
    // 20% of 10 = 2 lowest samples -> (56 + 58) / 2 = 57.0
    assertEquals(57.0, HealthDailyAggregator.estimateRestingHeartRate(samples)!!, 0.01)

    // Single valid sample
    assertEquals(63.0, HealthDailyAggregator.estimateRestingHeartRate(listOf(63.0))!!, 0.01)

    // Out-of-range samples ignored
    assertNull(HealthDailyAggregator.estimateRestingHeartRate(listOf(5.0, 350.0)))
  }

  @Test
  fun mergesOverlappingIntervalsWithoutDoubleCounting() {
    val total = HealthDailyAggregator.mergedDurationSeconds(
      listOf(
        1000L to 4600L, // 3600s
        2800L to 6400L, // overlaps by 1800s -> merged 1000..6400 = 5400s
        8000L to 8900L, // disjoint 900s
      ),
    )
    assertEquals(6300L, total)
  }

  @Test
  fun aggregatesHealthConnectMetricsByLocalCalendarDay() {
    val day1 = LocalDate.of(2026, 11, 14)
    val day2 = LocalDate.of(2026, 11, 15)

    val summaries = HealthDailyAggregator.aggregate(
      heartRateSamples = listOf(
        HeartRateSamplePoint(day2, 60.0),
        HeartRateSamplePoint(day2, 64.0),
        HeartRateSamplePoint(day2, 140.0),
        HeartRateSamplePoint(day2, 150.0),
        HeartRateSamplePoint(day2, 95.0),
        HeartRateSamplePoint(day1, 58.0),
      ),
      hrvSamples = listOf(
        HrvSamplePoint(day1, 44.0),
        HrvSamplePoint(day1, 48.0),
      ),
      sleepIntervals = listOf(
        // 8h session minus 0.5h awake -> 7.50 hours
        SleepInterval(day1, startEpochSec = 0L, endEpochSec = 8 * 3600L, awakeSeconds = 1800L),
      ),
      spo2Samples = listOf(
        Spo2SamplePoint(day1, 98.0),
        Spo2SamplePoint(day1, 99.0),
      ),
      bloodPressureSamples = listOf(
        BloodPressureSamplePoint(day1, 116.0, 74.0),
        BloodPressureSamplePoint(day1, 120.0, 78.0),
      ),
      bodyTempSamples = listOf(
        BodyTempSamplePoint(day2, 36.68),
      ),
      exerciseIntervals = listOf(
        ExerciseInterval(day2, startEpochSec = 1000L, endEpochSec = 3700L), // 45.0 min
      ),
    )

    assertEquals(2, summaries.size)

    val first = summaries[0]
    assertEquals("2026-11-14", first.date)
    assertEquals(58.0, first.rhrBpm!!, 0.01)
    assertEquals(46.0, first.hrvRmssdMs!!, 0.01)
    assertEquals(7.5, first.sleepHours!!, 0.01)
    assertEquals(98.5, first.spo2Pct!!, 0.01)
    assertEquals(118.0, first.sbpMmHg!!, 0.01)
    assertEquals(76.0, first.dbpMmHg!!, 0.01)
    assertNull(first.tempC)
    assertNull(first.exerciseMin)
    assertEquals(8, first.samplesCount) // 1 HR + 2 HRV + 1 sleep + 2 spo2 + 2 bp

    val firstJson = first.toJson()
    assertEquals("rmssd", firstJson.getString("hrv_metric"))
    assertEquals("wearable", firstJson.getString("source"))
    assertEquals(0.95, firstJson.getDouble("signal_quality"), 0.001)
    assertTrue(firstJson.isNull("temp_c"))

    val second = summaries[1]
    assertEquals("2026-11-15", second.date)
    assertEquals(60.0, second.rhrBpm!!, 0.01) // 20% of 5 = 1 sample -> 60.0
    assertEquals(36.68, second.tempC!!, 0.01)
    assertEquals(45.0, second.exerciseMin!!, 0.01)
    assertEquals(7, second.samplesCount) // 5 HR + 1 temp + 1 exercise
  }

  @Test
  fun serializesCapabilitiesAndEventsWithExactContractFields() {
    val capJson = BoopsBridgePayloads.capabilitiesJson(
      health = HealthCapabilities(available = true, authorized = false, status = "available", detail = "Ready"),
      bluetooth = BluetoothCapabilities(available = true, authorized = true, poweredOn = true, scanning = false),
      nearby = NearbyCapabilities(available = true, authorized = true, active = false),
    )
    val capObj = JSONObject(capJson)
    assertEquals("android", capObj.getString("platform"))
    assertEquals("Health Connect", capObj.getJSONObject("healthApi").getString("name"))
    assertEquals("native_ble", capObj.getJSONObject("bluetooth").getString("mode"))
    assertEquals("wifi_p2p", capObj.getJSONObject("nearby").getString("transport"))

    val syncJson = BoopsBridgePayloads.healthSyncJson(
      ok = true,
      records = emptyList(),
      message = "Synced 0 days",
    )
    val syncObj = JSONObject(syncJson)
    assertTrue(syncObj.getBoolean("ok"))
    assertEquals("health_connect", syncObj.getString("provider"))
    assertEquals(0, syncObj.getJSONArray("records").length())

    val bleStatus = JSONObject(
      BoopsBridgePayloads.bleStatusJson(
        scanning = true,
        poweredOn = true,
        authorized = true,
        connectedDeviceId = null,
        connectedDeviceName = null,
        error = null,
        message = "Scanning",
      ),
    )
    assertTrue(bleStatus.getBoolean("scanning"))
    assertTrue(bleStatus.isNull("connectedDeviceId"))

    val script = BoopsBridgePayloads.buildNativeEventScript("ble_status", "{\"ok\":true}\u2028")
    assertFalse(script.contains("\u2028"))
    assertTrue(script.startsWith("window.__boopsNativeEvent && window.__boopsNativeEvent(\"ble_status\","))
  }

  @Test
  fun roundTripsNearbyWireProtocolFramesAndRejectsOversized() {
    val payload = "{\"astronaut_id\":\"A1\",\"mission_day\":96}"
    val frame = NearbyWireProtocol.encodeFrame("02:00:00:00:00:01", "Crew Tablet A1", payload)
    assertNotNull(frame)
    val len = ((frame!![0].toInt() and 0xFF) shl 24) or
      ((frame[1].toInt() and 0xFF) shl 16) or
      ((frame[2].toInt() and 0xFF) shl 8) or
      (frame[3].toInt() and 0xFF)
    assertEquals(frame.size - 4, len)

    val body = frame.copyOfRange(4, frame.size)
    val decoded = NearbyWireProtocol.decodeEnvelope(body)!!
    assertEquals("02:00:00:00:00:01", decoded.senderId)
    assertEquals("Crew Tablet A1", decoded.senderName)
    assertEquals(payload, decoded.payloadJson)

    assertNull(NearbyWireProtocol.decodeEnvelope(ByteArray(0)))
    assertNull(NearbyWireProtocol.decodeEnvelope("{\"senderId\":\"x\"}".toByteArray(Charsets.UTF_8)))
  }
}
