import Foundation
import WebKit

/// Serves bundled offline `/web` assets under `boops-app://app/...` with strict path-traversal protection
/// and explicit MIME types for ES modules, WebAssembly, and MediaPipe `.task` bundles.
final class BoopsSchemeHandler: NSObject, WKURLSchemeHandler {

  static let scheme = "boops-app"
  static let host = "app"
  static let appOrigin = "boops-app://app"
  static let entryURL = URL(string: "boops-app://app/index.html")!

  private static let mimeTypes: [String: String] = [
    "html": "text/html",
    "htm": "text/html",
    "js": "application/javascript",
    "mjs": "application/javascript",
    "css": "text/css",
    "json": "application/json",
    "wasm": "application/wasm",
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "ico": "image/x-icon",
    "woff2": "font/woff2",
    "woff": "font/woff",
    "ttf": "font/ttf",
    "task": "application/octet-stream",
  ]

  private static let textMimeTypes: Set<String> = [
    "text/html",
    "application/javascript",
    "text/css",
    "application/json",
    "image/svg+xml",
  ]

  let webRootURL: URL?
  private let ioQueue = DispatchQueue(label: "space.boops.scheme-io", qos: .userInitiated)
  private var activeTaskIDs: Set<ObjectIdentifier> = []

  init(webRootURL: URL? = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true)) {
    self.webRootURL = webRootURL
    super.init()
  }

  // MARK: - WKURLSchemeHandler

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    let taskID = ObjectIdentifier(urlSchemeTask)
    activeTaskIDs.insert(taskID)

    guard let url = urlSchemeTask.request.url else {
      respondText(to: urlSchemeTask, taskID: taskID, statusCode: 400, body: "Invalid URL")
      return
    }

    let requestScheme = url.scheme?.lowercased() ?? ""
    let requestHost = url.host?.lowercased() ?? ""
    guard requestScheme == Self.scheme, requestHost == Self.host else {
      respondText(to: urlSchemeTask, taskID: taskID, statusCode: 403, body: "Offline Mode: Forbidden Origin")
      return
    }

    let method = (urlSchemeTask.request.httpMethod ?? "GET").uppercased()
    let requestPath = url.path

    ioQueue.async { [weak self] in
      guard let self else { return }

      if let assetURL = self.resolveAssetURL(forRequestPath: requestPath),
         let data = try? Data(contentsOf: assetURL) {
        let mimeType = Self.mimeType(forPath: assetURL.lastPathComponent)
        let charset = Self.charset(forMimeType: mimeType)
        var headers: [String: String] = [
          "Content-Type": charset.map { "\(mimeType); charset=\($0)" } ?? mimeType,
          "Content-Length": "\(data.count)",
          "Access-Control-Allow-Origin": Self.appOrigin,
          "Cross-Origin-Resource-Policy": "same-origin",
          "Cache-Control": "no-cache",
        ]
        if headers["Content-Type"] == nil {
          headers["Content-Type"] = mimeType
        }
        DispatchQueue.main.async {
          guard self.activeTaskIDs.remove(taskID) != nil else { return }
          guard let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
          ) else {
            urlSchemeTask.didFailWithError(URLError(.cannotLoadFromNetwork))
            return
          }
          urlSchemeTask.didReceive(response)
          if method != "HEAD" && !data.isEmpty {
            urlSchemeTask.didReceive(data)
          }
          urlSchemeTask.didFinish()
        }
        return
      }

      if requestPath == "/favicon.ico" {
        DispatchQueue.main.async {
          guard self.activeTaskIDs.remove(taskID) != nil else { return }
          let headers: [String: String] = [
            "Content-Type": "image/x-icon",
            "Content-Length": "0",
            "Access-Control-Allow-Origin": Self.appOrigin,
          ]
          if let response = HTTPURLResponse(
            url: url,
            statusCode: 204,
            httpVersion: "HTTP/1.1",
            headerFields: headers
          ) {
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
          } else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
          }
        }
        return
      }

      DispatchQueue.main.async {
        self.respondText(to: urlSchemeTask, taskID: taskID, statusCode: 404, body: "Not Found")
      }
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
    activeTaskIDs.remove(ObjectIdentifier(urlSchemeTask))
  }

  private func respondText(
    to task: WKURLSchemeTask,
    taskID: ObjectIdentifier,
    statusCode: Int,
    body: String
  ) {
    guard activeTaskIDs.remove(taskID) != nil else { return }
    let url = task.request.url ?? Self.entryURL
    let data = Data(body.utf8)
    let headers: [String: String] = [
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": "\(data.count)",
      "Access-Control-Allow-Origin": Self.appOrigin,
      "Cache-Control": "no-cache",
    ]
    guard let response = HTTPURLResponse(
      url: url,
      statusCode: statusCode,
      httpVersion: "HTTP/1.1",
      headerFields: headers
    ) else {
      task.didFailWithError(URLError(.unknown))
      return
    }
    task.didReceive(response)
    if (task.request.httpMethod ?? "GET").uppercased() != "HEAD" {
      task.didReceive(data)
    }
    task.didFinish()
  }

  // MARK: - Path Normalization, Traversal Guard & MIME Helpers

  /// Resolves a URL path to a regular file inside `webRootURL`, rejecting traversal or symlink escapes.
  func resolveAssetURL(forRequestPath rawPath: String) -> URL? {
    guard let webRootURL else { return nil }
    let canonicalRoot = webRootURL.standardizedFileURL.resolvingSymlinksInPath()
    let rootPrefix = canonicalRoot.path.hasSuffix("/") ? canonicalRoot.path : canonicalRoot.path + "/"

    let candidates = Self.candidateAssetPaths(for: rawPath)
    let fm = FileManager.default
    for candidate in candidates {
      let candidateURL = canonicalRoot
        .appendingPathComponent(candidate, isDirectory: false)
        .standardizedFileURL
        .resolvingSymlinksInPath()
      guard candidateURL.path.hasPrefix(rootPrefix) else { continue }
      var isDirectory: ObjCBool = false
      if fm.fileExists(atPath: candidateURL.path, isDirectory: &isDirectory), !isDirectory.boolValue {
        return candidateURL
      }
    }
    return nil
  }

  /// Normalizes a request path into safe candidate relative paths inside `web/`, rejecting traversal.
  static func candidateAssetPaths(for rawPath: String) -> [String] {
    let decoded = rawPath.removingPercentEncoding ?? rawPath
    if rawPath.contains("\0") || decoded.contains("\0") || rawPath.contains("\\") || decoded.contains("\\") {
      return []
    }

    for variant in [rawPath, decoded] {
      let trimmedVariant = variant.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      if trimmedVariant.isEmpty { continue }
      let segments = trimmedVariant.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
      if segments.contains("..") || segments.contains(".") {
        return []
      }
    }

    let trimmed = decoded.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if trimmed.isEmpty {
      return ["index.html"]
    }
    if decoded.hasSuffix("/") {
      return ["\(trimmed)/index.html"]
    }
    return [trimmed, "\(trimmed)/index.html"]
  }

  /// Returns an explicit MIME type so ES modules (.mjs) and WebAssembly (.wasm) load strictly.
  static func mimeType(forPath path: String) -> String {
    let beforeFragment = path.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? path
    let clean = beforeFragment.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? beforeFragment
    guard let dotIndex = clean.lastIndex(of: ".") else {
      return "application/octet-stream"
    }
    let extStart = clean.index(after: dotIndex)
    guard extStart < clean.endIndex else {
      return "application/octet-stream"
    }
    let ext = clean[extStart...].lowercased()
    return mimeTypes[ext] ?? "application/octet-stream"
  }

  /// Returns UTF-8 for text/script/SVG assets and nil for binary payloads (WASM, fonts, `.task`).
  static func charset(forMimeType mimeType: String) -> String? {
    return textMimeTypes.contains(mimeType) ? "utf-8" : nil
  }
}
