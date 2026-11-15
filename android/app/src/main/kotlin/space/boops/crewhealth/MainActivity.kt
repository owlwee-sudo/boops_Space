package space.boops.crewhealth

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.io.ByteArrayInputStream

/** Hosts the 100% offline BOOPS web dashboard and on-device camera rPPG check in an Android WebView. */
class MainActivity : ComponentActivity() {

  private lateinit var webView: WebView
  private var webViewAttached: Boolean = false
  private var pendingWebPermissionRequest: PermissionRequest? = null
  private var pendingExportContent: String? = null

  private lateinit var healthConnectManager: HealthConnectManager
  private lateinit var bleSensorManager: BleSensorManager
  private lateinit var nearbyCrewManager: NearbyCrewManager

  private val cameraPermissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      val req = pendingWebPermissionRequest
      pendingWebPermissionRequest = null
      if (req != null) {
        if (granted) {
          req.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
          req.deny()
          Toast.makeText(this, "Camera permission is needed for the live pulse check.", Toast.LENGTH_LONG).show()
        }
      }
    }

  private val createDocumentLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      val content = pendingExportContent
      pendingExportContent = null
      if (result.resultCode != Activity.RESULT_OK || content == null) return@registerForActivityResult
      val uri = result.data?.data ?: return@registerForActivityResult
      try {
        contentResolver.openOutputStream(uri)?.use { out ->
          out.write(content.toByteArray(Charsets.UTF_8))
          out.flush()
        }
        Toast.makeText(this, "Saved offline BOOPS export", Toast.LENGTH_SHORT).show()
      } catch (err: Exception) {
        Log.e(TAG, "Failed writing export document", err)
        Toast.makeText(this, "Could not save export file", Toast.LENGTH_LONG).show()
      }
    }

  private lateinit var backCallback: OnBackPressedCallback

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val bgColor = Color.parseColor("#F4F5F7")
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(bgColor, bgColor),
      navigationBarStyle = SystemBarStyle.light(bgColor, bgColor),
    )

    if (BuildConfig.DEBUG) {
      WebView.setWebContentsDebuggingEnabled(true)
    }

    val container = FrameLayout(this).apply {
      setBackgroundColor(bgColor)
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
    }

    webView = WebView(this).apply {
      setBackgroundColor(bgColor)
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
    }
    container.addView(webView)
    setContentView(container)
    webViewAttached = true

    healthConnectManager = HealthConnectManager(
      activity = this,
      emitEvent = ::emitNativeEvent,
      onCapabilitiesChanged = ::emitCapabilities,
    )
    bleSensorManager = BleSensorManager(
      activity = this,
      emitEvent = ::emitNativeEvent,
      onCapabilitiesChanged = ::emitCapabilities,
    ).apply { register() }
    nearbyCrewManager = NearbyCrewManager(
      activity = this,
      emitEvent = ::emitNativeEvent,
      onCapabilitiesChanged = ::emitCapabilities,
    )

    ViewCompat.setOnApplyWindowInsetsListener(container) { view, windowInsets ->
      val insets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.ime(),
      )
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.CONSUMED
    }

    configureWebView(webView)

    backCallback = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("(window.__boopsHandleBack && window.__boopsHandleBack()) || false") { raw ->
          if (raw == "true") return@evaluateJavascript
          if (webView.canGoBack()) {
            webView.goBack()
          } else {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    }
    onBackPressedDispatcher.addCallback(this, backCallback)

    if (savedInstanceState != null) {
      webView.restoreState(savedInstanceState)
    } else {
      webView.loadUrl(ENTRY_URL)
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun configureWebView(view: WebView) {
    val assetLoader = WebViewAssetLoader.Builder()
      .addPathHandler("/assets/", BoopsAssetsPathHandler(assets))
      .build()

    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      mediaPlaybackRequiresUserGesture = false
      allowFileAccess = false
      allowContentAccess = false
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
      useWideViewPort = true
      loadWithOverviewMode = true
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    }

    view.addJavascriptInterface(BoopsJsBridge(), "BoopsAndroid")

    view.webViewClient = object : WebViewClientCompat() {
      override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
      ): WebResourceResponse? {
        val url = request.url
        if (isAppUrl(url)) {
          if (url.path == "/favicon.ico") {
            return WebResourceResponse(
              "image/x-icon",
              null,
              204,
              "No Content",
              emptyMap(),
              ByteArrayInputStream(ByteArray(0)),
            )
          }
          return assetLoader.shouldInterceptRequest(url)
        }
        // Strictly offline: block subresource requests outside the local asset host.
        return WebResourceResponse(
          "text/plain",
          "utf-8",
          403,
          "Offline Mode",
          emptyMap(),
          ByteArrayInputStream(ByteArray(0)),
        )
      }

      override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        if (url.startsWith(BoopsAssetsPathHandler.APP_ORIGIN)) {
          healthConnectManager.refreshAuthorization()
          emitCapabilities()
        }
      }

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        if (isAppUrl(uri)) {
          return false
        }
        // Only hand plain https:// links to other apps (no intent:, file:, content: …).
        if (!uri.scheme.equals("https", ignoreCase = true)) {
          Toast.makeText(this@MainActivity, "Link blocked", Toast.LENGTH_SHORT).show()
          return true
        }
        try {
          startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: Exception) {
          Toast.makeText(
            this@MainActivity,
            "External link unavailable while offline",
            Toast.LENGTH_SHORT,
          ).show()
        }
        return true
      }
    }

    view.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        val origin = request.origin?.toString().orEmpty()
        val wantsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
        if (!origin.startsWith(BoopsAssetsPathHandler.APP_ORIGIN) || !wantsCamera) {
          request.deny()
          return
        }
        runOnUiThread {
          val granted = ContextCompat.checkSelfPermission(
            this@MainActivity,
            Manifest.permission.CAMERA,
          ) == PackageManager.PERMISSION_GRANTED
          if (granted) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
          } else {
            pendingWebPermissionRequest?.deny()
            pendingWebPermissionRequest = request
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
          }
        }
      }

      override fun onPermissionRequestCanceled(request: PermissionRequest) {
        if (pendingWebPermissionRequest == request) {
          pendingWebPermissionRequest = null
        }
      }

      override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        if (BuildConfig.DEBUG) {
          Log.d(
            TAG,
            "[JS ${consoleMessage.messageLevel()}] ${consoleMessage.message()} " +
              "(${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})",
          )
        }
        return super.onConsoleMessage(consoleMessage)
      }
    }
  }

  /** The bundled app is only ever served from https://ASSET_HOST. */
  private fun isAppUrl(url: Uri): Boolean =
    url.scheme.equals("https", ignoreCase = true) && url.host == ASSET_HOST

  private inner class BoopsJsBridge {
    @JavascriptInterface
    fun saveFile(filename: String, content: String, mimeType: String): Boolean {
      val safeName = filename.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "boops_export.txt" }
      val cleanMime = mimeType.substringBefore(';').trim().ifBlank { "text/plain" }
      runOnUiThread {
        if (pendingExportContent != null) {
          // One file picker at a time: a second export must not replace the first one's content.
          Toast.makeText(this@MainActivity, "Finish the open export first", Toast.LENGTH_SHORT).show()
          return@runOnUiThread
        }
        pendingExportContent = content
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = cleanMime
          putExtra(Intent.EXTRA_TITLE, safeName)
        }
        try {
          createDocumentLauncher.launch(intent)
        } catch (_: Exception) {
          pendingExportContent = null
          Toast.makeText(this@MainActivity, "No file picker available", Toast.LENGTH_SHORT).show()
        }
      }
      return true
    }

    @JavascriptInterface
    fun printDocument(title: String): Boolean {
      val safeTitle = title.ifBlank { "BOOPS_Flight_Surgeon_Summary" }
      runOnUiThread {
        val printManager = getSystemService(Context.PRINT_SERVICE) as? PrintManager
        if (printManager == null) {
          Toast.makeText(this@MainActivity, "Printing unavailable on this device", Toast.LENGTH_SHORT).show()
          return@runOnUiThread
        }
        val adapter = webView.createPrintDocumentAdapter(safeTitle)
        printManager.print(safeTitle, adapter, PrintAttributes.Builder().build())
      }
      return true
    }

    @JavascriptInterface
    fun getCapabilitiesJson(): String = buildCapabilitiesJson()

    @JavascriptInterface
    fun requestHealthPermissions(): Boolean {
      val available = healthConnectManager.getCapabilities().available
      runOnUiThread { healthConnectManager.requestPermissions() }
      return available
    }

    @JavascriptInterface
    fun syncHealthData(daysBack: Int): Boolean {
      val caps = healthConnectManager.getCapabilities()
      runOnUiThread { healthConnectManager.syncData(daysBack) }
      return caps.available
    }

    @JavascriptInterface
    fun startBleScan(): Boolean {
      val caps = bleSensorManager.getCapabilities()
      if (!caps.available || (caps.authorized && !caps.poweredOn)) {
        runOnUiThread { bleSensorManager.startScan() }
        return false
      }
      runOnUiThread { bleSensorManager.startScan() }
      return true
    }

    @JavascriptInterface
    fun stopBleScan(): Boolean {
      runOnUiThread { bleSensorManager.stopScan() }
      return true
    }

    @JavascriptInterface
    fun connectBleDevice(deviceId: String): Boolean {
      val cleanId = deviceId.trim()
      val caps = bleSensorManager.getCapabilities()
      if (cleanId.isEmpty() || !caps.available || (caps.authorized && !caps.poweredOn)) {
        runOnUiThread { bleSensorManager.connectDevice(cleanId) }
        return false
      }
      runOnUiThread { bleSensorManager.connectDevice(cleanId) }
      return true
    }

    @JavascriptInterface
    fun disconnectBleDevice(deviceId: String): Boolean {
      runOnUiThread { bleSensorManager.disconnectDevice(deviceId) }
      return true
    }

    @JavascriptInterface
    fun startNearbyDiscovery(astronautId: String): Boolean {
      val caps = nearbyCrewManager.getCapabilities()
      runOnUiThread { nearbyCrewManager.startDiscovery(astronautId) }
      return caps.available
    }

    @JavascriptInterface
    fun stopNearbyDiscovery(): Boolean {
      runOnUiThread { nearbyCrewManager.stopDiscovery() }
      return true
    }

    @JavascriptInterface
    fun sendNearbySummary(peerId: String, payloadJson: String): Boolean {
      val caps = nearbyCrewManager.getCapabilities()
      if (!caps.available || payloadJson.isBlank()) {
        runOnUiThread { nearbyCrewManager.sendSummary(peerId, payloadJson) }
        return false
      }
      runOnUiThread { nearbyCrewManager.sendSummary(peerId, payloadJson) }
      return true
    }
  }

  private fun buildCapabilitiesJson(): String = BoopsBridgePayloads.capabilitiesJson(
    health = healthConnectManager.getCapabilities(),
    bluetooth = bleSensorManager.getCapabilities(),
    nearby = nearbyCrewManager.getCapabilities(),
  )

  private fun emitCapabilities() {
    if (!::healthConnectManager.isInitialized ||
      !::bleSensorManager.isInitialized ||
      !::nearbyCrewManager.isInitialized
    ) {
      return
    }
    emitNativeEvent("capabilities", buildCapabilitiesJson())
  }

  private fun emitNativeEvent(type: String, jsonString: String) {
    val script = BoopsBridgePayloads.buildNativeEventScript(type, jsonString)
    runOnUiThread {
      if (!isDestroyed && !isFinishing && webViewAttached && ::webView.isInitialized) {
        webView.evaluateJavascript(script, null)
      }
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    webView.saveState(outState)
  }

  override fun onPause() {
    webView.onPause()
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    webView.onResume()
    if (::healthConnectManager.isInitialized) {
      healthConnectManager.refreshAuthorization()
    }
  }

  override fun onDestroy() {
    webViewAttached = false
    if (::bleSensorManager.isInitialized) {
      bleSensorManager.destroy()
    }
    if (::nearbyCrewManager.isInitialized) {
      nearbyCrewManager.destroy()
    }
    pendingWebPermissionRequest?.deny()
    pendingWebPermissionRequest = null
    webView.destroy()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "BOOPS"
    private const val ASSET_HOST = "appassets.androidplatform.net"
    private const val ENTRY_URL = "https://$ASSET_HOST/assets/web/index.html"
  }
}
