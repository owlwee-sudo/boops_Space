package space.boops.crewhealth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoopsAssetsPathHandlerTest {

  @Test
  fun resolvesDirectoryPathsToIndexHtml() {
    assertEquals(listOf("index.html"), BoopsAssetsPathHandler.candidateAssetPaths("/"))
    assertEquals(listOf("web/camera/index.html"), BoopsAssetsPathHandler.candidateAssetPaths("web/camera/"))
    assertEquals(
      listOf("web/camera", "web/camera/index.html"),
      BoopsAssetsPathHandler.candidateAssetPaths("/web/camera"),
    )
  }

  @Test
  fun rejectsPathTraversalSegments() {
    assertTrue(BoopsAssetsPathHandler.candidateAssetPaths("../secret.txt").isEmpty())
    assertTrue(BoopsAssetsPathHandler.candidateAssetPaths("web/../../etc/passwd").isEmpty())
  }

  @Test
  fun mapsCriticalWebAndMediaPipeMimeTypes() {
    assertEquals("text/html", BoopsAssetsPathHandler.mimeTypeForPath("web/index.html"))
    assertEquals("application/javascript", BoopsAssetsPathHandler.mimeTypeForPath("web/camera/camera-check.js"))
    assertEquals("application/javascript", BoopsAssetsPathHandler.mimeTypeForPath("web/vendor/mediapipe/vision_bundle.mjs"))
    assertEquals("application/wasm", BoopsAssetsPathHandler.mimeTypeForPath("web/vendor/mediapipe/wasm/vision_wasm_internal.wasm"))
    assertEquals("image/svg+xml", BoopsAssetsPathHandler.mimeTypeForPath("web/assets/figma/imgIconHome.svg"))
    assertEquals("application/json", BoopsAssetsPathHandler.mimeTypeForPath("web/data/boops_bundle.json"))
    assertEquals("application/octet-stream", BoopsAssetsPathHandler.mimeTypeForPath("web/vendor/mediapipe/face_landmarker.task"))
  }

  @Test
  fun assignsCharsetOnlyToTextMimeTypes() {
    assertEquals("utf-8", BoopsAssetsPathHandler.charsetForMimeType("text/html"))
    assertEquals("utf-8", BoopsAssetsPathHandler.charsetForMimeType("application/javascript"))
    assertNull(BoopsAssetsPathHandler.charsetForMimeType("application/wasm"))
    assertNull(BoopsAssetsPathHandler.charsetForMimeType("application/octet-stream"))
  }
}
