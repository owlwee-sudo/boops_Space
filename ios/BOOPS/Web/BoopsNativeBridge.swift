import Foundation
import WebKit

protocol BoopsNativeBridgePresenter: AnyObject {
  func presentSaveFile(filename: String, content: String, mimeType: String)
  func presentPrintDocument(title: String)
}

/// Bridges `window.webkit.messageHandlers.boopsNative` <-> `window.__boopsNativeEvent(type, payload)`
/// for HealthKit, CoreBluetooth GATT sensors, MultipeerConnectivity crew sync, file export, and AirPrint.
final class BoopsNativeBridge: NSObject, WKScriptMessageHandler {

  static let handlerName = "boopsNative"

  weak var webView: WKWebView?
  weak var presenter: BoopsNativeBridgePresenter?

  private let healthKitManager = HealthKitManager()
  private var bleManager: BleSensorManager?
  private var nearbyManager: NearbyCrewManager?

  override init() {
    super.init()
    self.bleManager = BleSensorManager { [weak self] eventType, payload in
      self?.emitEvent(type: eventType, payload: payload)
      if eventType == "ble_status" {
        self?.emitCapabilities()
      }
    }
    self.nearbyManager = NearbyCrewManager { [weak self] eventType, payload in
      self?.emitEvent(type: eventType, payload: payload)
      if eventType == "nearby_status" {
        self?.emitCapabilities()
      }
    }
  }

  /// Injects `window.BoopsApple` wrapper around `window.webkit.messageHandlers.boopsNative` at document start.
  func makeUserScript() -> WKUserScript {
    let js = """
    (function () {
      if (window.BoopsApple && window.BoopsApple.__installed) return;
      function post(action, args) {
        try {
          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.boopsNative) {
            window.webkit.messageHandlers.boopsNative.postMessage({
              action: String(action || ""),
              args: args && typeof args === "object" ? args : {}
            });
            return true;
          }
        } catch (err) {
          return false;
        }
        return false;
      }
      window.BoopsApple = {
        __installed: true,
        platform: "ios",
        invoke: post,
        getCapabilities: function () { return post("getCapabilities", {}); },
        requestHealthPermissions: function () { return post("requestHealthPermissions", {}); },
        syncHealthData: function (daysBack) {
          return post("syncHealthData", { daysBack: Number(daysBack) || 14 });
        },
        startBleScan: function () { return post("startBleScan", {}); },
        stopBleScan: function () { return post("stopBleScan", {}); },
        connectBleDevice: function (deviceId) {
          return post("connectBleDevice", { deviceId: String(deviceId || "") });
        },
        disconnectBleDevice: function (deviceId) {
          return post("disconnectBleDevice", { deviceId: String(deviceId || "") });
        },
        startNearbyDiscovery: function (astronautId) {
          return post("startNearbyDiscovery", { astronautId: String(astronautId || "A1") });
        },
        stopNearbyDiscovery: function () { return post("stopNearbyDiscovery", {}); },
        sendNearbySummary: function (peerId, payloadJson) {
          var serialized = typeof payloadJson === "string"
            ? payloadJson
            : JSON.stringify(payloadJson == null ? {} : payloadJson);
          return post("sendNearbySummary", {
            peerId: String(peerId || ""),
            payloadJson: serialized
          });
        },
        saveFile: function (filename, content, mimeType) {
          return post("saveFile", {
            filename: String(filename || "boops_export.txt"),
            content: String(content == null ? "" : content),
            mimeType: String(mimeType || "text/plain")
          });
        },
        printDocument: function (title) {
          return post("printDocument", {
            title: String(title || "BOOPS_Flight_Surgeon_Summary")
          });
        }
      };
    })();
    """
    return WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
  }

  // MARK: - WKScriptMessageHandler

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == Self.handlerName else { return }
    guard message.frameInfo.isMainFrame else { return }

    let frameURL = message.frameInfo.request.url
    let urlAllowed = frameURL?.scheme?.lowercased() == BoopsSchemeHandler.scheme
      && frameURL?.host?.lowercased() == BoopsSchemeHandler.host

    let originProtocol = message.frameInfo.securityOrigin.protocol.lowercased()
    let originHost = message.frameInfo.securityOrigin.host.lowercased()
    let originMatches = originProtocol == BoopsSchemeHandler.scheme
      && (originHost.isEmpty || originHost == BoopsSchemeHandler.host)

    guard urlAllowed && (originMatches || originProtocol.isEmpty || originProtocol == "null") else {
      return
    }
    guard let body = message.body as? [String: Any],
          let action = body["action"] as? String else {
      return
    }
    let args = (body["args"] as? [String: Any]) ?? [:]
    handleAction(action, args: args)
  }

  // MARK: - Action Dispatch

  func handleAction(_ action: String, args: [String: Any]) {
    switch action {
    case "getCapabilities":
      emitCapabilities()

    case "requestHealthPermissions":
      healthKitManager.requestAuthorization { [weak self] result in
        self?.emitEvent(
          type: "health_permissions",
          payload: [
            "granted": result.granted,
            "missing": result.missing,
            "message": result.message,
          ]
        )
        self?.emitCapabilities()
      }

    case "syncHealthData":
      let daysBack = (args["daysBack"] as? NSNumber)?.intValue ?? 14
      healthKitManager.syncHealthData(daysBack: daysBack) { [weak self] result in
        self?.emitEvent(
          type: "health_sync",
          payload: [
            "ok": result.ok,
            "provider": result.provider,
            "records": result.records,
            "message": result.message,
          ]
        )
      }

    case "startBleScan":
      bleManager?.startScan()

    case "stopBleScan":
      bleManager?.stopScan()

    case "connectBleDevice":
      let deviceId = (args["deviceId"] as? String) ?? ""
      bleManager?.connect(deviceId: deviceId)

    case "disconnectBleDevice":
      let deviceId = (args["deviceId"] as? String) ?? ""
      bleManager?.disconnect(deviceId: deviceId)

    case "startNearbyDiscovery":
      let astronautId = (args["astronautId"] as? String) ?? "A1"
      nearbyManager?.startDiscovery(astronautId: astronautId)

    case "stopNearbyDiscovery":
      nearbyManager?.stopDiscovery()

    case "sendNearbySummary":
      let peerId = args["peerId"] as? String
      let payloadJson: String
      if let str = args["payloadJson"] as? String {
        payloadJson = str
      } else if let obj = args["payloadJson"],
                JSONSerialization.isValidJSONObject(obj),
                let data = try? JSONSerialization.data(withJSONObject: obj),
                let str = String(data: data, encoding: .utf8) {
        payloadJson = str
      } else {
        payloadJson = "{}"
      }
      nearbyManager?.sendSummary(peerId: peerId, payloadJson: payloadJson)

    case "saveFile":
      let filename = (args["filename"] as? String) ?? "boops_export.txt"
      let content = (args["content"] as? String) ?? ""
      let mimeType = (args["mimeType"] as? String) ?? "text/plain"
      DispatchQueue.main.async { [weak self] in
        self?.presenter?.presentSaveFile(filename: filename, content: content, mimeType: mimeType)
      }

    case "printDocument":
      let title = (args["title"] as? String) ?? "BOOPS_Flight_Surgeon_Summary"
      DispatchQueue.main.async { [weak self] in
        self?.presenter?.presentPrintDocument(title: title)
      }

    default:
      break
    }
  }

  func notifyPageLoaded() {
    emitCapabilities()
  }

  private func emitCapabilities() {
    healthKitManager.fetchCapabilities { [weak self] hk in
      guard let self else { return }
      let ble = self.bleManager?.currentCapabilities()
      let nearby = self.nearbyManager?.currentCapabilities()

      let payload: [String: Any] = [
        "platform": "ios",
        "healthApi": [
          "name": "Apple HealthKit",
          "available": hk.available,
          "authorized": hk.authorized,
          "status": hk.status,
          "detail": hk.detail,
        ],
        "bluetooth": [
          "available": ble?.available ?? false,
          "authorized": ble?.authorized ?? false,
          "poweredOn": ble?.poweredOn ?? false,
          "scanning": ble?.scanning ?? false,
          "mode": "native_ble",
        ],
        "nearby": [
          "available": nearby?.available ?? true,
          "authorized": nearby?.authorized ?? true,
          "active": nearby?.active ?? false,
          "transport": "multipeer_connectivity",
        ],
      ]
      self.emitEvent(type: "capabilities", payload: payload)
    }
  }

  private func emitEvent(type: String, payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let payloadJson = String(data: payloadData, encoding: .utf8),
          let typeData = try? JSONSerialization.data(withJSONObject: [type], options: []),
          let typeArrayJson = String(data: typeData, encoding: .utf8),
          typeArrayJson.count >= 2 else {
      return
    }
    let typeLiteral = String(typeArrayJson.dropFirst().dropLast())
    let safePayloadJson = payloadJson
      .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
      .replacingOccurrences(of: "\u{2029}", with: "\\u2029")

    let script = """
    (function () {
      var t = \(typeLiteral);
      var p = \(safePayloadJson);
      if (typeof window.__boopsNativeEvent === "function") {
        window.__boopsNativeEvent(t, p);
      } else {
        window.__boopsPendingNativeEvents = window.__boopsPendingNativeEvents || [];
        window.__boopsPendingNativeEvents.push({ type: t, payload: p });
      }
      window.dispatchEvent(new CustomEvent("boops:native", { detail: { type: t, payload: p } }));
    })();
    """

    DispatchQueue.main.async { [weak self] in
      self?.webView?.evaluateJavaScript(script, completionHandler: nil)
    }
  }
}

/// Weak proxy avoiding a strong retain cycle between `WKUserContentController` and `BoopsNativeBridge`.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
  private weak var delegate: WKScriptMessageHandler?

  init(delegate: WKScriptMessageHandler) {
    self.delegate = delegate
    super.init()
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    delegate?.userContentController(userContentController, didReceive: message)
  }
}
