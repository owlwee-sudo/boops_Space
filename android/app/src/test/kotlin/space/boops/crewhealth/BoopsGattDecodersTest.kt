package space.boops.crewhealth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoopsGattDecodersTest {

  private fun sfloatBytes(mantissa: Int, exponent: Int): ByteArray {
    val raw = ((exponent and 0x0F) shl 12) or (mantissa and 0x0FFF)
    return byteArrayOf((raw and 0xFF).toByte(), ((raw ushr 8) and 0xFF).toByte())
  }

  private fun float32Bytes(mantissa: Int, exponent: Int): ByteArray {
    val raw = ((exponent and 0xFF) shl 24) or (mantissa and 0x00FFFFFF)
    return byteArrayOf(
      (raw and 0xFF).toByte(),
      ((raw ushr 8) and 0xFF).toByte(),
      ((raw ushr 16) and 0xFF).toByte(),
      ((raw ushr 24) and 0xFF).toByte(),
    )
  }

  @Test
  fun decodesHeartRate8BitWithContactDetectedAndNoRr() {
    // flags = 0x06 (UINT8 HR, contact supported & detected)
    val frame = byteArrayOf(0x06, 68)
    val decoded = BoopsGattDecoders.decodeHeartRateMeasurement(frame)!!
    assertEquals(68, decoded.bpm)
    assertEquals(true, decoded.sensorContactDetected)
    assertTrue(decoded.rrIntervalsMs.isEmpty())
  }

  @Test
  fun decodesHeartRate8BitContactNotDetected() {
    // flags = 0x04 (UINT8 HR, contact supported & NOT detected)
    val frame = byteArrayOf(0x04, 72)
    val decoded = BoopsGattDecoders.decodeHeartRateMeasurement(frame)!!
    assertEquals(72, decoded.bpm)
    assertEquals(false, decoded.sensorContactDetected)
  }

  @Test
  fun decodesHeartRate16BitWithEnergyAndRrIntervals() {
    // flags = 0x19 = 0x01 (UINT16 HR) | 0x08 (Energy Expended) | 0x10 (RR present)
    // HR = 260 (0x04, 0x01)
    // Energy = 500 (0xF4, 0x01)
    // RR1 = 1024 -> 1000.0 ms (0x00, 0x04)
    // RR2 = 768  -> 750.0 ms  (0x00, 0x03)
    val frame = byteArrayOf(
      0x19,
      0x04,
      0x01,
      0xF4.toByte(),
      0x01,
      0x00,
      0x04,
      0x00,
      0x03,
    )
    val decoded = BoopsGattDecoders.decodeHeartRateMeasurement(frame)!!
    assertEquals(260, decoded.bpm)
    assertNull(decoded.sensorContactDetected)
    assertEquals(listOf(1000.0, 750.0), decoded.rrIntervalsMs)
  }

  @Test
  fun computesRmssdFromRrIntervalsAccurately() {
    // Successive diffs: +20, -30, +20 -> squares: 400, 900, 400 -> mean = 566.6667 -> sqrt = 23.8
    val rmssd = BoopsGattDecoders.computeRmssdMs(listOf(800.0, 820.0, 790.0, 810.0))!!
    assertEquals(23.8, rmssd, 0.05)

    // Needs at least 2 valid physiological RR intervals
    assertNull(BoopsGattDecoders.computeRmssdMs(listOf(800.0)))
    assertNull(BoopsGattDecoders.computeRmssdMs(listOf(50.0, 800.0, 5000.0)))
  }

  @Test
  fun decodesSfloat16AndRejectsSpecialSentinels() {
    val val120 = sfloatBytes(120, 0)
    assertEquals(120.0, BoopsGattDecoders.decodeSfloat16(val120, 0)!!, 0.001)

    val val986 = sfloatBytes(986, -1)
    assertEquals(98.6, BoopsGattDecoders.decodeSfloat16(val986, 0)!!, 0.001)

    val neg = sfloatBytes(-125, -1)
    assertEquals(-12.5, BoopsGattDecoders.decodeSfloat16(neg, 0)!!, 0.001)

    // NaN (0x07FF), NRes (0x0800), +INF (0x07FE), -INF (0x0802)
    assertNull(BoopsGattDecoders.decodeSfloat16(byteArrayOf(0xFF.toByte(), 0x07), 0))
    assertNull(BoopsGattDecoders.decodeSfloat16(byteArrayOf(0x00, 0x08), 0))
    assertNull(BoopsGattDecoders.decodeSfloat16(byteArrayOf(0xFE.toByte(), 0x07), 0))
    assertNull(BoopsGattDecoders.decodeSfloat16(byteArrayOf(0x02, 0x08), 0))
  }

  @Test
  fun decodesPulseOximeterSpo2AndPulseRate() {
    val spo2 = sfloatBytes(98, 0)
    val pr = sfloatBytes(64, 0)
    val frame = byteArrayOf(0x00) + spo2 + pr
    val decoded = BoopsGattDecoders.decodePulseOximeter(frame)!!
    assertEquals(98.0, decoded.spo2Pct!!, 0.01)
    assertEquals(64.0, decoded.pulseRateBpm!!, 0.01)
  }

  @Test
  fun decodesBloodPressureInMmHgAndKpaWithOptionalPulseRate() {
    // mmHg with timestamp (bit 1) + pulse rate (bit 2) -> flags = 0x06
    val sbp = sfloatBytes(118, 0)
    val dbp = sfloatBytes(76, 0)
    val map = sfloatBytes(90, 0)
    val timestamp7 = ByteArray(7) { 0 }
    val pr = sfloatBytes(62, 0)
    val frameMmHg = byteArrayOf(0x06) + sbp + dbp + map + timestamp7 + pr

    val decoded = BoopsGattDecoders.decodeBloodPressureMeasurement(frameMmHg)!!
    assertEquals(118.0, decoded.systolicMmHg!!, 0.1)
    assertEquals(76.0, decoded.diastolicMmHg!!, 0.1)
    assertEquals(90.0, decoded.mapMmHg!!, 0.1)
    assertEquals(62.0, decoded.pulseRateBpm!!, 0.1)

    // kPa (bit 0 = 1 -> flags = 0x01): 16.0 kPa (~120.0 mmHg) / 10.6 kPa (~79.5 mmHg)
    val kpaFrame = byteArrayOf(0x01) + sfloatBytes(160, -1) + sfloatBytes(106, -1) + sfloatBytes(124, -1)
    val decodedKpa = BoopsGattDecoders.decodeBloodPressureMeasurement(kpaFrame)!!
    assertEquals(120.0, decodedKpa.systolicMmHg!!, 0.2)
    assertEquals(79.5, decodedKpa.diastolicMmHg!!, 0.2)
  }

  @Test
  fun decodesHealthThermometerInCelsiusAndFahrenheit() {
    // 36.75 C = 3675 * 10^-2
    val cFrame = byteArrayOf(0x00) + float32Bytes(3675, -2)
    val decodedC = BoopsGattDecoders.decodeTemperatureMeasurement(cFrame)!!
    assertEquals(36.75, decodedC.tempC, 0.01)

    // 98.6 F = 986 * 10^-1 -> 37.00 C (flags bit 0 = 1)
    val fFrame = byteArrayOf(0x01) + float32Bytes(986, -1)
    val decodedF = BoopsGattDecoders.decodeTemperatureMeasurement(fFrame)!!
    assertEquals(37.0, decodedF.tempC, 0.01)
  }

  @Test
  fun decodesBatteryLevelAndRejectsInvalidPackets() {
    assertEquals(87, BoopsGattDecoders.decodeBatteryLevel(byteArrayOf(87)))
    assertNull(BoopsGattDecoders.decodeBatteryLevel(byteArrayOf(120)))
    assertNull(BoopsGattDecoders.decodeBatteryLevel(byteArrayOf()))
    assertNull(BoopsGattDecoders.decodeHeartRateMeasurement(byteArrayOf(0x00)))
    assertFalse(BoopsGattDecoders.decodeBloodPressureMeasurement(byteArrayOf(0x00, 1, 2)) != null)
  }

  @Test
  fun normalizesGattUuidsAndClassifiesSensors() {
    assertEquals("180D", GattUuids.shortUuid("0000180d-0000-1000-8000-00805f9b34fb"))
    assertEquals("0000180D-0000-1000-8000-00805F9B34FB", GattUuids.fullUuid("180d"))
    assertEquals("heart_rate", GattUuids.classifyDeviceKind(listOf("180D", "180F")))
    assertEquals("pulse_oximeter", GattUuids.classifyDeviceKind(listOf("1822")))
    assertEquals("blood_pressure", GattUuids.classifyDeviceKind(listOf("1810")))
    assertEquals("thermometer", GattUuids.classifyDeviceKind(listOf("1809")))
    assertEquals("multi_sensor", GattUuids.classifyDeviceKind(listOf("180D", "1822")))
    assertEquals("wearable", GattUuids.classifyDeviceKind(listOf("180F")))
  }
}
