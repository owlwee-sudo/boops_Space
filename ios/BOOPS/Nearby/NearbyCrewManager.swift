import Foundation
import MultipeerConnectivity
import UIKit

/// Offline MultipeerConnectivity crew-to-crew sync & emergency relay (`serviceType = "boops-crew"`).
final class NearbyCrewManager: NSObject {

  static let serviceType = "boops-crew"
  private static let deviceTagDefaultsKey = "space.boops.nearby.device_tag"

  private struct PeerRecord {
    let peerID: MCPeerID
    var astronautId: String
    var state: String
  }

  private let onEvent: (String, [String: Any]) -> Void
  private let isoFormatter: ISO8601DateFormatter

  private var localPeerID: MCPeerID?
  private var localAstronautId: String = "A1"
  private var session: MCSession?
  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?

  private var isActive = false
  private var localNetworkDenied = false
  private var peers: [String: PeerRecord] = [:]

  init(onEvent: @escaping (String, [String: Any]) -> Void) {
    self.onEvent = onEvent
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    self.isoFormatter = formatter
    super.init()
  }

  // MARK: - Capabilities & Controls

  func currentCapabilities() -> (available: Bool, authorized: Bool, active: Bool) {
    return (available: true, authorized: !localNetworkDenied, active: isActive)
  }

  func startDiscovery(astronautId: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let cleanId = astronautId.trimmingCharacters(in: .whitespacesAndNewlines)
      let targetId = cleanId.isEmpty ? "A1" : String(cleanId.prefix(16))

      if self.isActive && self.localAstronautId == targetId {
        self.emitStatus(message: "Nearby crew sync active as \(targetId).")
        self.emitPeers()
        return
      }

      self.teardownSession()
      self.localAstronautId = targetId
      self.localNetworkDenied = false

      let displayName = Self.makePeerDisplayName(astronautId: targetId)
      let peerID = MCPeerID(displayName: displayName)
      let session = MCSession(peer: peerID, securityIdentity: nil, encryptionPreference: .required)
      session.delegate = self

      let advertiser = MCNearbyServiceAdvertiser(
        peer: peerID,
        discoveryInfo: ["astronautId": targetId],
        serviceType: Self.serviceType
      )
      advertiser.delegate = self

      let browser = MCNearbyServiceBrowser(peer: peerID, serviceType: Self.serviceType)
      browser.delegate = self

      self.localPeerID = peerID
      self.session = session
      self.advertiser = advertiser
      self.browser = browser
      self.isActive = true

      advertiser.startAdvertisingPeer()
      browser.startBrowsingForPeers()

      self.emitStatus(message: "Scanning & advertising offline crew sync as \(targetId)…")
      self.emitPeers()
    }
  }

  func stopDiscovery() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.teardownSession()
      self.emitStatus(message: "Nearby crew sync stopped.")
      self.emitPeers()
    }
  }

  func sendSummary(peerId: String?, payloadJson: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard let session = self.session else {
        self.emit(
          "nearby_sent",
          [
            "ok": false,
            "peerId": peerId ?? "",
            "targetCount": 0,
            "bytes": 0,
            "timestamp": self.isoFormatter.string(from: Date()),
            "message": "Nearby crew sync is not active.",
          ]
        )
        return
      }

      let data = Data(payloadJson.utf8)
      let connected = session.connectedPeers
      let cleanTarget = peerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let targets: [MCPeerID]
      if cleanTarget.isEmpty || cleanTarget == "*" || cleanTarget.lowercased() == "all" {
        targets = connected
      } else {
        targets = connected.filter { $0.displayName == cleanTarget }
      }

      guard !targets.isEmpty else {
        self.emit(
          "nearby_sent",
          [
            "ok": false,
            "peerId": cleanTarget,
            "targetCount": 0,
            "bytes": data.count,
            "timestamp": self.isoFormatter.string(from: Date()),
            "message": "No connected nearby crew peers to send to.",
          ]
        )
        return
      }

      do {
        try session.send(data, toPeers: targets, with: .reliable)
        self.emit(
          "nearby_sent",
          [
            "ok": true,
            "peerId": cleanTarget.isEmpty ? "all" : cleanTarget,
            "targetCount": targets.count,
            "bytes": data.count,
            "timestamp": self.isoFormatter.string(from: Date()),
            "message": "Sent offline crew update to \(targets.count) peer(s).",
          ]
        )
      } catch {
        self.emit(
          "nearby_sent",
          [
            "ok": false,
            "peerId": cleanTarget,
            "targetCount": 0,
            "bytes": data.count,
            "timestamp": self.isoFormatter.string(from: Date()),
            "message": "Failed sending crew summary: \(error.localizedDescription)",
          ]
        )
      }
    }
  }

  // MARK: - Internal Helpers

  private func teardownSession() {
    advertiser?.stopAdvertisingPeer()
    advertiser?.delegate = nil
    advertiser = nil

    browser?.stopBrowsingForPeers()
    browser?.delegate = nil
    browser = nil

    session?.disconnect()
    session?.delegate = nil
    session = nil

    localPeerID = nil
    isActive = false
    peers.removeAll()
  }

  private static func makePeerDisplayName(astronautId: String) -> String {
    let defaults = UserDefaults.standard
    let tag: String
    if let existing = defaults.string(forKey: deviceTagDefaultsKey), !existing.isEmpty {
      tag = existing
    } else {
      let generated = String(UUID().uuidString.prefix(4)).uppercased()
      defaults.set(generated, forKey: deviceTagDefaultsKey)
      tag = generated
    }

    let raw = "\(astronautId)·\(tag)"
    // MCPeerID requires UTF-8 byte length <= 63
    var result = ""
    for ch in raw {
      let candidate = result + String(ch)
      if candidate.utf8.count <= 63 {
        result = candidate
      } else {
        break
      }
    }
    return result.isEmpty ? "BOOPS-\(tag)" : result
  }

  private func emitStatus(message: String) {
    let connectedCount = peers.values.filter { $0.state == "connected" }.count
    emit(
      "nearby_status",
      [
        "available": true,
        "authorized": !localNetworkDenied,
        "active": isActive,
        "transport": "multipeer_connectivity",
        "localAstronautId": localAstronautId,
        "localPeerName": localPeerID?.displayName ?? "",
        "connectedCount": connectedCount,
        "discoveredCount": peers.count,
        "message": message,
      ]
    )
  }

  private func emitPeers() {
    let list: [[String: Any]] = peers
      .sorted { $0.key < $1.key }
      .map { peerId, record in
        [
          "peerId": peerId,
          "displayName": record.peerID.displayName,
          "astronautId": record.astronautId,
          "state": record.state,
        ]
      }
    emit("nearby_peers", ["peers": list])
  }

  private func emit(_ type: String, _ payload: [String: Any]) {
    if Thread.isMainThread {
      onEvent(type, payload)
    } else {
      DispatchQueue.main.async { [onEvent] in
        onEvent(type, payload)
      }
    }
  }
}

// MARK: - MCNearbyServiceAdvertiserDelegate

extension NearbyCrewManager: MCNearbyServiceAdvertiserDelegate {

  func advertiser(
    _ advertiser: MCNearbyServiceAdvertiser,
    didReceiveInvitationFromPeer peerID: MCPeerID,
    withContext context: Data?,
    invitationHandler: @escaping (Bool, MCSession?) -> Void
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self, let session = self.session else {
        invitationHandler(false, nil)
        return
      }
      invitationHandler(true, session)
    }
  }

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let nsErr = error as NSError
      if nsErr.code == -72008 {
        self.localNetworkDenied = true
      }
      self.emitStatus(message: "Nearby advertiser error: \(error.localizedDescription)")
    }
  }
}

// MARK: - MCNearbyServiceBrowserDelegate

extension NearbyCrewManager: MCNearbyServiceBrowserDelegate {

  func browser(
    _ browser: MCNearbyServiceBrowser,
    foundPeer peerID: MCPeerID,
    withDiscoveryInfo info: [String: String]?
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self, let session = self.session else { return }
      let peerKey = peerID.displayName
      let astroId = info?["astronautId"] ?? String(peerKey.split(separator: "·").first ?? "")
      var record = self.peers[peerKey] ?? PeerRecord(peerID: peerID, astronautId: astroId, state: "discovered")
      if !astroId.isEmpty {
        record.astronautId = astroId
      }
      self.peers[peerKey] = record

      // Deterministic invite tie-breaker prevents dual simultaneous invitation races.
      let alreadyConnectedOrConnecting = session.connectedPeers.contains(peerID) || record.state == "connecting"
      if !alreadyConnectedOrConnecting,
         let localName = self.localPeerID?.displayName,
         localName <= peerKey {
        self.peers[peerKey]?.state = "connecting"
        browser.invitePeer(peerID, to: session, withContext: nil, timeout: 15)
      }

      self.emitPeers()
      self.emitStatus(message: "Discovered crew peer \(peerKey).")
    }
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let peerKey = peerID.displayName
      if self.peers[peerKey]?.state != "connected" {
        self.peers.removeValue(forKey: peerKey)
      }
      self.emitPeers()
      self.emitStatus(message: "Lost discovery signal for \(peerKey).")
    }
  }

  func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let nsErr = error as NSError
      if nsErr.code == -72008 {
        self.localNetworkDenied = true
      }
      self.emitStatus(message: "Nearby browser error: \(error.localizedDescription)")
    }
  }
}

// MARK: - MCSessionDelegate

extension NearbyCrewManager: MCSessionDelegate {

  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let peerKey = peerID.displayName
      let astroId = self.peers[peerKey]?.astronautId ?? String(peerKey.split(separator: "·").first ?? "")

      switch state {
      case .notConnected:
        self.peers[peerKey] = PeerRecord(peerID: peerID, astronautId: astroId, state: "discovered")
        self.emitStatus(message: "Peer disconnected: \(peerKey)")
      case .connecting:
        self.peers[peerKey] = PeerRecord(peerID: peerID, astronautId: astroId, state: "connecting")
        self.emitStatus(message: "Connecting to \(peerKey)…")
      case .connected:
        self.peers[peerKey] = PeerRecord(peerID: peerID, astronautId: astroId, state: "connected")
        self.emitStatus(message: "Connected offline to crew peer \(peerKey)")
      @unknown default:
        break
      }
      self.emitPeers()
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let peerKey = peerID.displayName
      let astroId = self.peers[peerKey]?.astronautId ?? String(peerKey.split(separator: "·").first ?? "")
      let rawText = String(data: data, encoding: .utf8) ?? ""

      var payload: [String: Any] = [
        "peerId": peerKey,
        "displayName": peerID.displayName,
        "astronautId": astroId,
        "payloadJson": rawText,
        "timestamp": self.isoFormatter.string(from: Date()),
      ]
      if let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
         JSONSerialization.isValidJSONObject(parsed) {
        payload["payload"] = parsed
      }

      self.emit("nearby_received", payload)
    }
  }

  func session(
    _ session: MCSession,
    didReceive stream: InputStream,
    withName streamName: String,
    fromPeer peerID: MCPeerID
  ) {}

  func session(
    _ session: MCSession,
    didStartReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID,
    with progress: Progress
  ) {}

  func session(
    _ session: MCSession,
    didFinishReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID,
    at localURL: URL?,
    withError error: Error?
  ) {}
}
