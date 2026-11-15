package space.boops.crewhealth

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.wifi.WpsInfo
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Looper
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.lifecycle.lifecycleScope
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.EOFException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Manages AOSP Wi-Fi Direct (`WifiP2pManager`) crew-to-crew discovery and local TCP socket
 * summary synchronization on port `48721` with zero Google Play Services or cloud dependency.
 */
class NearbyCrewManager(
  private val activity: ComponentActivity,
  private val emitEvent: (type: String, json: String) -> Unit,
  private val onCapabilitiesChanged: () -> Unit,
) {

  private data class PendingSend(
    val peerId: String,
    val payloadJson: String,
  )

  private val wifiP2pManager: WifiP2pManager? =
    activity.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager

  private var channel: WifiP2pManager.Channel? = null
  private val activeSockets = CopyOnWriteArrayList<Socket>()

  @Volatile private var active: Boolean = false
  @Volatile private var receiverRegistered: Boolean = false
  @Volatile private var localAstronautId: String = "CREW"
  @Volatile private var localDeviceName: String = "BOOPS Crew Device"
  @Volatile private var localDeviceAddress: String = ""
  @Volatile private var pendingStartAstronautId: String? = null
  @Volatile private var pendingSend: PendingSend? = null
  @Volatile private var knownPeers: List<NearbyPeerInfo> = emptyList()
  @Volatile private var serverSocket: ServerSocket? = null
  @Volatile private var serverJob: Job? = null
  @Volatile private var clientConnectJob: Job? = null
  @Volatile private var connectedHostAddress: String? = null

  private val permissionLauncher = activity.registerForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions(),
  ) { results ->
    val granted = requiredPermissions().all { perm ->
      results[perm] == true || hasPermission(perm)
    }
    val pendingId = pendingStartAstronautId
    pendingStartAstronautId = null

    if (granted) {
      onCapabilitiesChanged()
      if (pendingId != null) {
        startDiscovery(pendingId)
      } else {
        emitStatus(message = "Nearby Wi-Fi Direct permission granted.")
      }
    } else {
      emitStatus(
        error = "permission_denied",
        message = "Nearby Wi-Fi Devices permission is required for crew peer-to-peer sync.",
      )
      onCapabilitiesChanged()
    }
  }

  private val p2pReceiver = object : BroadcastReceiver() {
    @SuppressLint("MissingPermission")
    override fun onReceive(context: Context, intent: Intent) {
      val manager = wifiP2pManager ?: return
      val ch = channel ?: return

      when (intent.action) {
        WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
          val state = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, WifiP2pManager.WIFI_P2P_STATE_DISABLED)
          if (state != WifiP2pManager.WIFI_P2P_STATE_ENABLED && active) {
            emitStatus(
              error = "wifi_p2p_disabled",
              message = "Enable Wi-Fi to discover nearby BOOPS crew devices.",
            )
          }
        }

        WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
          if (hasRequiredPermissions()) {
            try {
              manager.requestPeers(ch, peerListListener)
            } catch (sec: SecurityException) {
              Log.w(TAG, "requestPeers denied", sec)
            }
          }
        }

        WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
          val p2pInfo = IntentCompat.getParcelableExtra(
            intent,
            WifiP2pManager.EXTRA_WIFI_P2P_INFO,
            WifiP2pInfo::class.java,
          )
          if (p2pInfo == null || p2pInfo.groupFormed) {
            try {
              manager.requestConnectionInfo(ch, connectionInfoListener)
            } catch (sec: SecurityException) {
              Log.w(TAG, "requestConnectionInfo denied", sec)
            }
          } else {
            closeTransportOnly()
            if (active) {
              emitStatus(message = "Wi-Fi Direct peer link closed.")
            }
          }
        }

        WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION -> {
          val selfDevice = IntentCompat.getParcelableExtra(
            intent,
            WifiP2pManager.EXTRA_WIFI_P2P_DEVICE,
            WifiP2pDevice::class.java,
          )
          if (selfDevice != null) {
            localDeviceName = selfDevice.deviceName?.takeIf { it.isNotBlank() } ?: localDeviceName
            localDeviceAddress = selfDevice.deviceAddress.orEmpty()
          }
        }
      }
    }
  }

  private val peerListListener = WifiP2pManager.PeerListListener { peerList ->
    val mapped = peerList.deviceList.map { device ->
      NearbyPeerInfo(
        id = device.deviceAddress ?: "",
        name = device.deviceName?.takeIf { it.isNotBlank() } ?: (device.deviceAddress ?: "Crew Device"),
        transport = TRANSPORT_WIFI_P2P,
        status = mapPeerStatus(device.status),
      )
    }.filter { it.id.isNotBlank() }

    knownPeers = mapped
    emitEvent("nearby_peers", BoopsBridgePayloads.nearbyPeersJson(mapped))
  }

  private val connectionInfoListener = WifiP2pManager.ConnectionInfoListener { info ->
    if (!info.groupFormed) {
      closeTransportOnly()
      return@ConnectionInfoListener
    }
    if (info.isGroupOwner) {
      startServerLoopIfNeeded()
      emitStatus(message = "Wi-Fi Direct group owner ready on local port $PORT.")
    } else {
      val host = info.groupOwnerAddress?.hostAddress
      if (!host.isNullOrBlank()) {
        connectClientSocket(host)
      }
    }
  }

  /** Returns current Wi-Fi Direct availability, permission authorization, and active state. */
  fun getCapabilities(): NearbyCapabilities = NearbyCapabilities(
    available = isWifiP2pAvailable(),
    authorized = hasRequiredPermissions(),
    active = active,
  )

  /** Starts Wi-Fi Direct peer discovery for nearby BOOPS crew devices. */
  @SuppressLint("MissingPermission")
  fun startDiscovery(astronautId: String): Boolean {
    localAstronautId = astronautId.trim().ifEmpty { "CREW" }

    val manager = wifiP2pManager
    if (!isWifiP2pAvailable() || manager == null) {
      emitStatus(
        error = "wifi_p2p_unavailable",
        message = "Wi-Fi Direct is unavailable on this Android device.",
      )
      return false
    }

    if (!hasRequiredPermissions()) {
      pendingStartAstronautId = localAstronautId
      permissionLauncher.launch(requiredPermissions())
      emitStatus(message = "Requesting Nearby Wi-Fi permission for crew sync.")
      return true
    }

    ensureChannelAndReceiver(manager)
    val ch = channel
    if (ch == null) {
      emitStatus(
        error = "channel_init_failed",
        message = "Unable to initialize Wi-Fi Direct channel.",
      )
      return false
    }

    return try {
      manager.discoverPeers(
        ch,
        object : WifiP2pManager.ActionListener {
          override fun onSuccess() {
            active = true
            emitStatus(message = "Discovering nearby BOOPS crew devices via Wi-Fi Direct...")
            onCapabilitiesChanged()
            try {
              manager.requestPeers(ch, peerListListener)
              manager.requestConnectionInfo(ch, connectionInfoListener)
            } catch (_: SecurityException) {
            }
          }

          override fun onFailure(reason: Int) {
            active = false
            emitStatus(
              error = "discover_failed_$reason",
              message = "Wi-Fi Direct discovery failed (${describeP2pFailure(reason)}).",
            )
            onCapabilitiesChanged()
          }
        },
      )
      true
    } catch (sec: SecurityException) {
      Log.w(TAG, "discoverPeers denied", sec)
      active = false
      emitStatus(error = "permission_denied", message = "Nearby Wi-Fi permission denied.")
      onCapabilitiesChanged()
      false
    } catch (err: Exception) {
      Log.e(TAG, "discoverPeers failed", err)
      active = false
      emitStatus(error = "discover_error", message = "Wi-Fi Direct error: ${err.message ?: "unknown"}")
      onCapabilitiesChanged()
      false
    }
  }

  /** Stops Wi-Fi Direct discovery and closes active local P2P sockets cleanly. */
  @SuppressLint("MissingPermission")
  fun stopDiscovery(): Boolean {
    val manager = wifiP2pManager
    val ch = channel
    pendingSend = null
    active = false

    if (manager != null && ch != null) {
      try {
        manager.stopPeerDiscovery(ch, null)
      } catch (_: Exception) {
      }
      if (hasRequiredPermissions()) {
        try {
          manager.removeGroup(ch, null)
        } catch (_: Exception) {
        }
      }
    }

    closeTransportOnly()
    emitStatus(message = "Stopped nearby crew discovery.")
    onCapabilitiesChanged()
    return true
  }

  /**
   * Sends a JSON crew summary to [peerId] over the active Wi-Fi Direct TCP socket, or initiates a
   * Wi-Fi Direct P2P connection to [peerId] and flushes once the socket connects.
   */
  @SuppressLint("MissingPermission")
  fun sendSummary(peerId: String, payloadJson: String): Boolean {
    val targetPeerId = peerId.trim()
    if (payloadJson.isBlank()) {
      emitSent(ok = false, peerId = targetPeerId, bytes = 0, message = "Cannot send empty summary payload.")
      return false
    }
    if (!isWifiP2pAvailable() || wifiP2pManager == null) {
      emitSent(ok = false, peerId = targetPeerId, bytes = 0, message = "Wi-Fi Direct unavailable.")
      return false
    }
    if (!hasRequiredPermissions()) {
      emitSent(ok = false, peerId = targetPeerId, bytes = 0, message = "Nearby Wi-Fi permission required.")
      return false
    }

    val liveSocket = activeSockets.firstOrNull { !it.isClosed && it.isConnected }
    if (liveSocket != null) {
      sendOverSocketAsync(liveSocket, targetPeerId.ifEmpty { "peer" }, payloadJson)
      return true
    }

    if (targetPeerId.isEmpty()) {
      emitSent(ok = false, peerId = "", bytes = 0, message = "Select a nearby peer before sending.")
      return false
    }

    val manager = wifiP2pManager
    ensureChannelAndReceiver(manager)
    val ch = channel ?: run {
      emitSent(ok = false, peerId = targetPeerId, bytes = 0, message = "Wi-Fi Direct channel unavailable.")
      return false
    }

    pendingSend = PendingSend(targetPeerId, payloadJson)
    val config = WifiP2pConfig().apply {
      deviceAddress = targetPeerId
      wps.setup = WpsInfo.PBC
    }

    return try {
      emitStatus(message = "Connecting to crew peer $targetPeerId...")
      manager.connect(
        ch,
        config,
        object : WifiP2pManager.ActionListener {
          override fun onSuccess() {
            emitStatus(message = "Wi-Fi Direct link invited; waiting for peer socket...")
          }

          override fun onFailure(reason: Int) {
            pendingSend = null
            val msg = "P2P connect failed (${describeP2pFailure(reason)})."
            emitStatus(error = "connect_failed_$reason", message = msg)
            emitSent(ok = false, peerId = targetPeerId, bytes = 0, message = msg)
          }
        },
      )
      true
    } catch (sec: SecurityException) {
      pendingSend = null
      emitSent(ok = false, peerId = targetPeerId, bytes = 0, message = "Nearby Wi-Fi permission denied.")
      false
    } catch (err: Exception) {
      pendingSend = null
      emitSent(ok = false, peerId = targetPeerId, bytes = 0, message = "Connect error: ${err.message ?: "error"}")
      false
    }
  }

  /** Stops discovery, closes all sockets/channels, and unregisters receivers. */
  fun destroy() {
    active = false
    pendingSend = null
    closeTransportOnly()
    if (receiverRegistered) {
      try {
        activity.unregisterReceiver(p2pReceiver)
      } catch (_: IllegalArgumentException) {
      }
      receiverRegistered = false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      try {
        channel?.close()
      } catch (_: Exception) {
      }
    }
    channel = null
  }

  private fun ensureChannelAndReceiver(manager: WifiP2pManager) {
    if (channel == null) {
      channel = manager.initialize(activity, Looper.getMainLooper()) {
        active = false
        closeTransportOnly()
        emitStatus(error = "channel_lost", message = "Wi-Fi Direct channel disconnected.")
        onCapabilitiesChanged()
      }
    }
    if (!receiverRegistered) {
      val filter = IntentFilter().apply {
        addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
      }
      ContextCompat.registerReceiver(activity, p2pReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
      receiverRegistered = true
    }
  }

  private fun startServerLoopIfNeeded() {
    if (serverJob?.isActive == true) return
    serverJob = activity.lifecycleScope.launch(Dispatchers.IO) {
      var srv: ServerSocket? = null
      try {
        srv = ServerSocket().apply {
          reuseAddress = true
          bind(InetSocketAddress(PORT))
        }
        serverSocket = srv
        while (isActive && !srv.isClosed) {
          val client = srv.accept()
          registerSocketAndListen(client)
          flushPendingSend(client)
        }
      } catch (err: Exception) {
        if (isActive) {
          Log.w(TAG, "P2P server socket stopped: ${err.message}")
        }
      } finally {
        try {
          srv?.close()
        } catch (_: Exception) {
        }
        if (serverSocket === srv) serverSocket = null
      }
    }
  }

  private fun connectClientSocket(hostAddress: String) {
    if (connectedHostAddress == hostAddress && activeSockets.any { !it.isClosed && it.isConnected }) {
      return
    }
    clientConnectJob?.cancel()
    clientConnectJob = activity.lifecycleScope.launch(Dispatchers.IO) {
      try {
        val socket = Socket()
        socket.connect(InetSocketAddress(hostAddress, PORT), SOCKET_CONNECT_TIMEOUT_MS)
        connectedHostAddress = hostAddress
        registerSocketAndListen(socket)
        emitStatus(message = "Connected to nearby BOOPS group owner ($hostAddress).")
        flushPendingSend(socket)
      } catch (err: Exception) {
        Log.w(TAG, "Failed connecting to P2P group owner $hostAddress:$PORT", err)
        val pending = pendingSend
        if (pending != null) {
          pendingSend = null
          emitSent(
            ok = false,
            peerId = pending.peerId,
            bytes = 0,
            message = "Socket connection failed: ${err.message ?: "timeout"}",
          )
        }
      }
    }
  }

  private fun registerSocketAndListen(socket: Socket) {
    activeSockets.add(socket)
    activity.lifecycleScope.launch(Dispatchers.IO) {
      try {
        val input = DataInputStream(BufferedInputStream(socket.getInputStream()))
        while (isActive && !socket.isClosed) {
          val length = try {
            input.readInt()
          } catch (_: EOFException) {
            break
          }
          if (length <= 0 || length > NearbyWireProtocol.MAX_FRAME_BYTES) {
            Log.w(TAG, "Ignoring invalid P2P frame length: $length")
            break
          }
          val body = ByteArray(length)
          input.readFully(body)
          val envelope = NearbyWireProtocol.decodeEnvelope(body) ?: continue
          emitEvent(
            "nearby_received",
            BoopsBridgePayloads.nearbyReceivedJson(
              peerId = envelope.senderId,
              peerName = envelope.senderName,
              payloadJson = envelope.payloadJson,
            ),
          )
        }
      } catch (err: Exception) {
        if (isActive && !socket.isClosed) {
          Log.w(TAG, "P2P socket reader ended: ${err.message}")
        }
      } finally {
        activeSockets.remove(socket)
        try {
          socket.close()
        } catch (_: Exception) {
        }
      }
    }
  }

  private fun flushPendingSend(socket: Socket) {
    val pending = pendingSend ?: return
    pendingSend = null
    sendOverSocketAsync(socket, pending.peerId, pending.payloadJson)
  }

  private fun sendOverSocketAsync(socket: Socket, peerId: String, payloadJson: String) {
    activity.lifecycleScope.launch(Dispatchers.IO) {
      val senderName = "$localDeviceName ($localAstronautId)"
      val senderId = localDeviceAddress.ifBlank { localAstronautId }
      val frame = NearbyWireProtocol.encodeFrame(
        senderId = senderId,
        senderName = senderName,
        payloadJson = payloadJson,
      )
      if (frame == null) {
        emitSent(ok = false, peerId = peerId, bytes = 0, message = "Summary exceeds maximum frame size.")
        return@launch
      }

      try {
        synchronized(socket) {
          val out = socket.getOutputStream()
          out.write(frame)
          out.flush()
        }
        val payloadBytes = payloadJson.toByteArray(Charsets.UTF_8).size
        emitSent(
          ok = true,
          peerId = peerId,
          bytes = payloadBytes,
          message = "Sent $payloadBytes byte summary over local Wi-Fi Direct.",
        )
      } catch (err: Exception) {
        Log.w(TAG, "Failed writing summary frame", err)
        activeSockets.remove(socket)
        try {
          socket.close()
        } catch (_: Exception) {
        }
        emitSent(
          ok = false,
          peerId = peerId,
          bytes = 0,
          message = "Send failed: ${err.message ?: "socket closed"}",
        )
      }
    }
  }

  private fun closeTransportOnly() {
    connectedHostAddress = null
    serverJob?.cancel()
    serverJob = null
    clientConnectJob?.cancel()
    clientConnectJob = null
    try {
      serverSocket?.close()
    } catch (_: Exception) {
    }
    serverSocket = null
    for (socket in activeSockets) {
      try {
        socket.close()
      } catch (_: Exception) {
      }
    }
    activeSockets.clear()
  }

  private fun emitStatus(error: String? = null, message: String) {
    emitEvent(
      "nearby_status",
      BoopsBridgePayloads.nearbyStatusJson(
        active = active,
        authorized = hasRequiredPermissions(),
        message = message,
        error = error,
        transport = TRANSPORT_WIFI_P2P,
      ),
    )
  }

  private fun emitSent(ok: Boolean, peerId: String, bytes: Int, message: String) {
    emitEvent(
      "nearby_sent",
      BoopsBridgePayloads.nearbySentJson(
        ok = ok,
        peerId = peerId,
        bytes = bytes,
        message = message,
      ),
    )
  }

  private fun isWifiP2pAvailable(): Boolean =
    activity.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT) && wifiP2pManager != null

  private fun requiredPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      arrayOf(Manifest.permission.NEARBY_WIFI_DEVICES)
    } else {
      arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  private fun hasRequiredPermissions(): Boolean = requiredPermissions().all(::hasPermission)

  private fun hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED

  private fun mapPeerStatus(status: Int): String = when (status) {
    WifiP2pDevice.CONNECTED -> "connected"
    WifiP2pDevice.INVITED -> "invited"
    WifiP2pDevice.FAILED -> "failed"
    WifiP2pDevice.AVAILABLE -> "available"
    else -> "unavailable"
  }

  private fun describeP2pFailure(reason: Int): String = when (reason) {
    WifiP2pManager.P2P_UNSUPPORTED -> "Wi-Fi Direct unsupported"
    WifiP2pManager.BUSY -> "system busy, try again"
    WifiP2pManager.NO_SERVICE_REQUESTS -> "no service requests"
    else -> "error code $reason"
  }

  companion object {
    private const val TAG = "BOOPS-P2P"
    const val PORT = 48721
    private const val SOCKET_CONNECT_TIMEOUT_MS = 5000
    private const val TRANSPORT_WIFI_P2P = "wifi_p2p"
  }
}
