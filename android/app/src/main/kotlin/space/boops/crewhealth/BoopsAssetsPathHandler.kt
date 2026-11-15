package space.boops.crewhealth

import android.content.res.AssetManager
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.IOException
import java.io.InputStream

/** Resolves bundled offline `/web` assets under `https://appassets.androidplatform.net/assets/`. */
class BoopsAssetsPathHandler(private val assets: AssetManager) : WebViewAssetLoader.PathHandler {

  override fun handle(path: String): WebResourceResponse? {
    val candidates = candidateAssetPaths(path)
    for (assetPath in candidates) {
      val stream = openAssetOrNull(assetPath) ?: continue
      val mimeType = mimeTypeForPath(assetPath)
      val encoding = charsetForMimeType(mimeType)
      val headers = mapOf(
        "Access-Control-Allow-Origin" to APP_ORIGIN,
        "Cache-Control" to "no-cache",
      )
      return WebResourceResponse(mimeType, encoding, 200, "OK", headers, stream)
    }
    return null
  }

  private fun openAssetOrNull(assetPath: String): InputStream? {
    return try {
      assets.open(assetPath)
    } catch (_: IOException) {
      null
    }
  }

  companion object {
    const val APP_ORIGIN = "https://appassets.androidplatform.net"

    private val MIME_TYPES = mapOf(
      "html" to "text/html",
      "htm" to "text/html",
      "js" to "application/javascript",
      "mjs" to "application/javascript",
      "css" to "text/css",
      "json" to "application/json",
      "wasm" to "application/wasm",
      "svg" to "image/svg+xml",
      "png" to "image/png",
      "jpg" to "image/jpeg",
      "jpeg" to "image/jpeg",
      "webp" to "image/webp",
      "ico" to "image/x-icon",
      "woff2" to "font/woff2",
      "woff" to "font/woff",
      "ttf" to "font/ttf",
      "task" to "application/octet-stream",
    )

    private val TEXT_MIME_TYPES = setOf(
      "text/html",
      "application/javascript",
      "text/css",
      "application/json",
      "image/svg+xml",
    )

    /** Normalizes a request path into safe candidate Android asset paths, rejecting traversal. */
    fun candidateAssetPaths(rawPath: String): List<String> {
      val trimmed = rawPath.trimStart('/')
      if (trimmed.isEmpty()) return listOf("index.html")
      val segments = trimmed.split('/')
      if (segments.any { it == ".." || it == "." }) return emptyList()
      if (trimmed.endsWith('/')) return listOf("${trimmed}index.html")
      return listOf(trimmed, "$trimmed/index.html")
    }

    /** Returns an explicit MIME type so ES modules (.mjs) and WebAssembly (.wasm) load strictly. */
    fun mimeTypeForPath(path: String): String {
      val clean = path.substringBefore('?').substringBefore('#')
      val dot = clean.lastIndexOf('.')
      if (dot < 0 || dot == clean.length - 1) return "application/octet-stream"
      val ext = clean.substring(dot + 1).lowercase()
      return MIME_TYPES[ext] ?: "application/octet-stream"
    }

    /** Returns UTF-8 for text/script/SVG assets and null for binary streams such as WASM or fonts. */
    fun charsetForMimeType(mimeType: String): String? {
      return if (mimeType in TEXT_MIME_TYPES) "utf-8" else null
    }
  }
}
