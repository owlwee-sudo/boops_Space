package space.boops.crewhealth

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
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
  private var pendingWebPermissionRequest: PermissionRequest? = null
  private var pendingExportContent: String? = null

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
        if (url.host == ASSET_HOST) {
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

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        if (uri.host == ASSET_HOST) {
          return false
        }
        try {
          startActivity(Intent(Intent.ACTION_VIEW, uri))
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

  private inner class BoopsJsBridge {
    @JavascriptInterface
    fun saveFile(filename: String, content: String, mimeType: String): Boolean {
      val safeName = filename.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "boops_export.txt" }
      val cleanMime = mimeType.substringBefore(';').trim().ifBlank { "text/plain" }
      runOnUiThread {
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
  }

  override fun onDestroy() {
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
