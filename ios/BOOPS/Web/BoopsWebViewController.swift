import AVFoundation
import UIKit
import WebKit

/// Hosts the 100% offline BOOPS `/web` dashboard and camera rPPG check inside an isolated `WKWebView`.
final class BoopsWebViewController: UIViewController {

  private let schemeHandler = BoopsSchemeHandler()
  private let nativeBridge = BoopsNativeBridge()
  private var webView: WKWebView!
  private var pendingExportTempURL: URL?

  override func viewDidLoad() {
    super.viewDidLoad()

    let bgColor = UIColor(red: 244.0 / 255.0, green: 245.0 / 255.0, blue: 247.0 / 255.0, alpha: 1.0)
    view.backgroundColor = bgColor

    let contentController = WKUserContentController()
    contentController.addUserScript(nativeBridge.makeUserScript())
    contentController.add(WeakScriptMessageHandler(delegate: nativeBridge), name: BoopsNativeBridge.handlerName)

    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(schemeHandler, forURLScheme: BoopsSchemeHandler.scheme)
    config.userContentController = contentController
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.defaultWebpagePreferences.allowsContentJavaScript = true
    config.preferences.javaScriptCanOpenWindowsAutomatically = false

    let webView = WKWebView(frame: .zero, configuration: config)
    webView.translatesAutoresizingMaskIntoConstraints = false
    webView.isOpaque = true
    webView.backgroundColor = bgColor
    webView.scrollView.backgroundColor = bgColor
    webView.navigationDelegate = self
    webView.uiDelegate = self
    #if DEBUG
    if #available(iOS 16.4, *) {
      webView.isInspectable = true
    }
    #endif

    self.webView = webView
    nativeBridge.webView = webView
    nativeBridge.presenter = self

    view.addSubview(webView)
    NSLayoutConstraint.activate([
      webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    webView.load(URLRequest(url: BoopsSchemeHandler.entryURL))
  }

  deinit {
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: BoopsNativeBridge.handlerName)
    cleanupTempExportFile()
  }

  private func cleanupTempExportFile() {
    if let url = pendingExportTempURL {
      try? FileManager.default.removeItem(at: url)
      pendingExportTempURL = nil
    }
  }
}

// MARK: - WKNavigationDelegate (Strictly Offline Policy)

extension BoopsWebViewController: WKNavigationDelegate {

  /// Strictly offline navigation policy: only `boops-app://` and `about:` URLs are allowed.
  static func isAllowedNavigationURL(_ url: URL) -> Bool {
    let scheme = url.scheme?.lowercased() ?? ""
    return scheme == BoopsSchemeHandler.scheme || scheme == "about"
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    decisionHandler(Self.isAllowedNavigationURL(url) ? .allow : .cancel)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    nativeBridge.notifyPageLoaded()
  }
}

// MARK: - WKUIDelegate (Camera rPPG Permission & Dialogs)

extension BoopsWebViewController: WKUIDelegate {

  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    let isLocalBoopsOrigin =
      origin.protocol == BoopsSchemeHandler.scheme && origin.host == BoopsSchemeHandler.host
    guard isLocalBoopsOrigin && type == .camera else {
      decisionHandler(.deny)
      return
    }

    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      decisionHandler(.grant)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          decisionHandler(granted ? .grant : .deny)
        }
      }
    case .denied, .restricted:
      decisionHandler(.deny)
    @unknown default:
      decisionHandler(.deny)
    }
  }

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if navigationAction.targetFrame == nil,
       let url = navigationAction.request.url,
       url.scheme?.lowercased() == BoopsSchemeHandler.scheme {
      webView.load(URLRequest(url: url))
    }
    return nil
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    let alert = UIAlertController(title: "BOOPS", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
    present(alert, animated: true)
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let alert = UIAlertController(title: "BOOPS", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
    alert.addAction(UIAlertAction(title: "Confirm", style: .default) { _ in completionHandler(true) })
    present(alert, animated: true)
  }
}

// MARK: - BoopsNativeBridgePresenter

extension BoopsWebViewController: BoopsNativeBridgePresenter {

  func presentSaveFile(filename: String, content: String, mimeType: String) {
    let safeChars = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")
    let mapped = filename.unicodeScalars.map { safeChars.contains($0) ? Character($0) : "_" }
    var safeName = String(mapped).trimmingCharacters(in: CharacterSet(charactersIn: "."))
    if safeName.isEmpty {
      safeName = mimeType.contains("csv") ? "boops_export.csv" : (mimeType.contains("json") ? "boops_export.json" : "boops_export.txt")
    }

    cleanupTempExportFile()
    let tempDir = FileManager.default.temporaryDirectory
    let fileURL = tempDir.appendingPathComponent(safeName, isDirectory: false)
    do {
      try Data(content.utf8).write(to: fileURL, options: .atomic)
    } catch {
      return
    }
    pendingExportTempURL = fileURL

    let activityVC = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
    activityVC.completionWithItemsHandler = { [weak self] _, _, _, _ in
      self?.cleanupTempExportFile()
    }
    if let popover = activityVC.popoverPresentationController {
      popover.sourceView = view
      popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
      popover.permittedArrowDirections = []
    }
    present(activityVC, animated: true)
  }

  func presentPrintDocument(title: String) {
    guard UIPrintInteractionController.isPrintingAvailable else { return }
    let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    let jobName = cleanTitle.isEmpty ? "BOOPS_Flight_Surgeon_Summary" : cleanTitle

    let printInfo = UIPrintInfo(dictionary: nil)
    printInfo.outputType = .general
    printInfo.jobName = jobName

    let controller = UIPrintInteractionController.shared
    controller.printInfo = printInfo
    controller.printFormatter = webView.viewPrintFormatter()

    if UIDevice.current.userInterfaceIdiom == .pad {
      let anchor = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
      controller.present(from: anchor, in: view, animated: true, completionHandler: nil)
    } else {
      controller.present(animated: true, completionHandler: nil)
    }
  }
}
