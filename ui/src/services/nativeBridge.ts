/**
 * Unified offline bridge for BOOPS native shells (Android Health Connect + BLE + Wi-Fi Direct,
 * Apple HealthKit + CoreBluetooth + MultipeerConnectivity) and desktop Web Bluetooth fallback.
 */

export interface NativeCapabilities {
  platform: "android" | "ios" | "web";
  healthApi: {
    name: string;
    available: boolean;
    authorized: boolean;
    status:
      | "ready"
      | "authorized"
      | "available"
      | "needs_permission"
      | "install_required"
      | "provider_update_required"
      | "unknown"
      | "error"
      | "unavailable";
    detail: string;
  };
  bluetooth: {
    available: boolean;
    authorized: boolean;
    poweredOn: boolean;
    scanning: boolean;
    mode: "native_ble" | "web_bluetooth" | "unavailable";
  };
  nearby: {
    available: boolean;
    authorized: boolean;
    active: boolean;
    transport: string;
  };
}

export interface HealthSyncRecord {
  date: string;
  rhr_bpm?: number | null;
  hrv_rmssd_ms?: number | null;
  hrv_metric?: "rmssd" | "sdnn";
  sleep_hours?: number | null;
  spo2_pct?: number | null;
  sbp_mmhg?: number | null;
  dbp_mmhg?: number | null;
  temp_c?: number | null;
  exercise_min?: number | null;
  signal_quality?: number | null;
  source?: string;
  samples_count?: number;
}

export interface HealthSyncResult {
  ok: boolean;
  provider: string;
  records: HealthSyncRecord[];
  message: string;
}

export interface BleDeviceInfo {
  id: string;
  name: string;
  rssi?: number;
  services: string[];
  kind: "hr_strap" | "pulse_ox" | "bp_cuff" | "thermometer" | "wearable";
  connected: boolean;
  batteryPct?: number | null;
}

export interface BleStatus {
  scanning: boolean;
  poweredOn: boolean;
  authorized: boolean;
  connectedDeviceId: string | null;
  connectedDeviceName: string | null;
  error: string | null;
  message?: string;
}

export interface BleReading {
  deviceId: string;
  deviceName: string;
  metric: "rhr_bpm" | "hrv_rmssd_ms" | "spo2_pct" | "blood_pressure" | "temp_c" | "battery";
  rhr_bpm?: number | null;
  hrv_rmssd_ms?: number | null;
  spo2_pct?: number | null;
  sbp_mmhg?: number | null;
  dbp_mmhg?: number | null;
  temp_c?: number | null;
  batteryPct?: number | null;
  signal_quality?: number | null;
  source?: string;
  timestamp: string;
}

export interface NearbyPeer {
  id: string;
  name: string;
  transport: string;
  status: "discovered" | "connecting" | "connected";
}

export interface NearbyStatus {
  active: boolean;
  authorized: boolean;
  transport: string;
  message: string;
  error?: string | null;
}

export interface NearbyReceivedPacket {
  peerId: string;
  peerName: string;
  payloadJson: string;
  receivedAt: string;
}

export interface NearbySentResult {
  ok: boolean;
  peerId: string;
  bytes: number;
  message: string;
}

export type NativeEventType =
  | "capabilities"
  | "health_permissions"
  | "health_sync"
  | "ble_status"
  | "ble_scan_result"
  | "ble_reading"
  | "nearby_status"
  | "nearby_peers"
  | "nearby_received"
  | "nearby_sent";

export interface NativeBridgeState {
  capabilities: NativeCapabilities;
  healthSync: HealthSyncResult | null;
  bleStatus: BleStatus;
  bleDevices: BleDeviceInfo[];
  latestBleReading: BleReading | null;
  bleReadingsHistory: BleReading[];
  nearbyStatus: NearbyStatus;
  nearbyPeers: NearbyPeer[];
  nearbyReceived: NearbyReceivedPacket[];
  lastMessage: string;
}

interface BoopsAndroidInterface {
  saveFile?: (name: string, body: string, mime: string) => boolean;
  printDocument?: (title: string) => boolean;
  getCapabilitiesJson?: () => string;
  requestHealthPermissions?: () => boolean;
  syncHealthData?: (daysBack: number) => boolean;
  startBleScan?: () => boolean;
  stopBleScan?: () => boolean;
  connectBleDevice?: (deviceId: string) => boolean;
  disconnectBleDevice?: (deviceId: string) => boolean;
  startNearbyDiscovery?: (astronautId: string) => boolean;
  stopNearbyDiscovery?: () => boolean;
  sendNearbySummary?: (peerId: string, payloadJson: string) => boolean;
}

interface BoopsAppleInterface {
  platform?: string;
  saveFile?: (name: string, body: string, mime: string) => boolean;
  printDocument?: (title: string) => boolean;
  getCapabilitiesJson?: () => string;
  requestHealthPermissions?: () => boolean;
  syncHealthData?: (daysBack: number) => boolean;
  startBleScan?: () => boolean;
  stopBleScan?: () => boolean;
  connectBleDevice?: (deviceId: string) => boolean;
  disconnectBleDevice?: (deviceId: string) => boolean;
  startNearbyDiscovery?: (astronautId: string) => boolean;
  stopNearbyDiscovery?: () => boolean;
  sendNearbySummary?: (peerId: string, payloadJson: string) => boolean;
}

interface WebkitNativeHandler {
  postMessage: (msg: { action: string; args?: Record<string, unknown> }) => void;
}

type BridgeWindow = Window & {
  BoopsAndroid?: BoopsAndroidInterface;
  BoopsApple?: BoopsAppleInterface;
  webkit?: {
    messageHandlers?: {
      boopsNative?: WebkitNativeHandler;
    };
  };
  __boopsNativeEvent?: (eventType: string, payload: unknown) => void;
  __boopsPendingNativeEvents?: Array<{ type: string; payload: unknown }>;
};

type WebBluetoothDevice = {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<WebBluetoothServer>;
    disconnect: () => void;
  };
  addEventListener: (ev: string, fn: () => void) => void;
};

type WebBluetoothServer = {
  getPrimaryService: (uuid: number | string) => Promise<{
    getCharacteristic: (uuid: number | string) => Promise<{
      readValue: () => Promise<DataView>;
      startNotifications: () => Promise<unknown>;
      addEventListener: (ev: string, fn: (e: { target: { value: DataView } }) => void) => void;
    }>;
  }>;
};

type WebBluetoothNavigator = Navigator & {
  bluetooth?: {
    requestDevice: (opts: {
      filters?: Array<{ services: Array<number | string> }>;
      acceptAllDevices?: boolean;
      optionalServices?: Array<number | string>;
    }) => Promise<WebBluetoothDevice>;
  };
};

function getBridgeWindow(): BridgeWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as BridgeWindow);
}

function hasAndroidBridge(): boolean {
  const win = getBridgeWindow();
  return Boolean(win?.BoopsAndroid?.getCapabilitiesJson || win?.BoopsAndroid?.saveFile);
}

function hasAppleBridge(): boolean {
  const win = getBridgeWindow();
  return Boolean(
    win?.webkit?.messageHandlers?.boopsNative ||
      win?.BoopsApple ||
      (typeof window !== "undefined" && window.location.protocol === "boops-app:"),
  );
}

function hasWebBluetooth(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const nav = navigator as WebBluetoothNavigator;
  return Boolean(nav.bluetooth && window.isSecureContext);
}

function buildWebFallbackCapabilities(): NativeCapabilities {
  const webBle = hasWebBluetooth();
  return {
    platform: "web",
    healthApi: {
      name: "OS Health App",
      available: false,
      authorized: false,
      status: "unavailable",
      detail: "Health Connect (Android) and Apple HealthKit (iOS) require the native mobile app wrapper.",
    },
    bluetooth: {
      available: webBle,
      authorized: webBle,
      poweredOn: webBle,
      scanning: false,
      mode: webBle ? "web_bluetooth" : "unavailable",
    },
    nearby: {
      available: false,
      authorized: false,
      active: false,
      transport: "unavailable",
    },
  };
}

function readInitialCapabilities(): NativeCapabilities {
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.getCapabilitiesJson) {
    try {
      const parsed = JSON.parse(win.BoopsAndroid.getCapabilitiesJson()) as NativeCapabilities;
      if (parsed && parsed.platform) return parsed;
    } catch {
      // Fall back to default shell capabilities if JSON parsing fails.
    }
  }
  if (win?.BoopsApple?.getCapabilitiesJson) {
    try {
      const parsed = JSON.parse(win.BoopsApple.getCapabilitiesJson()) as NativeCapabilities;
      if (parsed && parsed.platform) return parsed;
    } catch {
      // Fall back to async iOS capability refresh.
    }
  }
  if (hasAppleBridge()) {
    return {
      platform: "ios",
      healthApi: {
        name: "Apple HealthKit",
        available: true,
        authorized: false,
        status: "needs_permission",
        detail: "Initializing Apple HealthKit status…",
      },
      bluetooth: {
        available: true,
        authorized: false,
        poweredOn: false,
        scanning: false,
        mode: "native_ble",
      },
      nearby: {
        available: true,
        authorized: true,
        active: false,
        transport: "multipeer_connectivity",
      },
    };
  }
  return buildWebFallbackCapabilities();
}

const state: NativeBridgeState = {
  capabilities: readInitialCapabilities(),
  healthSync: null,
  bleStatus: {
    scanning: false,
    poweredOn: false,
    authorized: false,
    connectedDeviceId: null,
    connectedDeviceName: null,
    error: null,
  },
  bleDevices: [],
  latestBleReading: null,
  bleReadingsHistory: [],
  nearbyStatus: {
    active: false,
    authorized: false,
    transport: "unavailable",
    message: "Idle",
    error: null,
  },
  nearbyPeers: [],
  nearbyReceived: [],
  lastMessage: "",
};

const listeners = new Set<(next: NativeBridgeState, eventType?: NativeEventType, payload?: unknown) => void>();
let activeWebBleDevice: WebBluetoothDevice | null = null;
const webBleRrHistory: number[] = [];

function notifyListeners(eventType?: NativeEventType, payload?: unknown): void {
  const snapshot = getNativeBridgeState();
  for (const fn of listeners) {
    try {
      fn(snapshot, eventType, payload);
    } catch {
      // Keep other subscribers healthy if one view handler fails.
    }
  }
}

function inferBleKind(services: string[], rawKind?: unknown): BleDeviceInfo["kind"] {
  const kind = String(rawKind ?? "").toLowerCase();
  if (kind === "hr_strap" || kind === "heart_rate") return "hr_strap";
  if (kind === "pulse_ox" || kind === "pulse_oximeter") return "pulse_ox";
  if (kind === "bp_cuff" || kind === "blood_pressure") return "bp_cuff";
  if (kind === "thermometer") return "thermometer";
  const upper = services.map((s) => s.toUpperCase());
  if (upper.some((s) => s.includes("180D"))) return "hr_strap";
  if (upper.some((s) => s.includes("1822"))) return "pulse_ox";
  if (upper.some((s) => s.includes("1810"))) return "bp_cuff";
  if (upper.some((s) => s.includes("1809"))) return "thermometer";
  return "wearable";
}

function normalizeBleDevice(raw: unknown): BleDeviceInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id ?? obj.deviceId ?? "").trim();
  if (!id) return null;
  const services = Array.isArray(obj.services) ? obj.services.map(String) : [];
  return {
    id,
    name: String(obj.name ?? obj.deviceName ?? "BLE Sensor"),
    rssi: typeof obj.rssi === "number" ? obj.rssi : undefined,
    services,
    kind: inferBleKind(services, obj.kind),
    connected: Boolean(obj.connected),
    batteryPct: typeof obj.batteryPct === "number" ? obj.batteryPct : null,
  };
}

function inferBleMetric(obj: Record<string, unknown>): BleReading["metric"] {
  const m = String(obj.metric ?? "").toLowerCase();
  if (m === "rhr_bpm" || m === "heart_rate") return "rhr_bpm";
  if (m === "hrv_rmssd_ms") return "hrv_rmssd_ms";
  if (m === "spo2_pct" || m === "pulse_oximeter") return "spo2_pct";
  if (m === "blood_pressure") return "blood_pressure";
  if (m === "temp_c" || m === "temperature") return "temp_c";
  if (m === "battery") return "battery";
  if (typeof obj.rhr_bpm === "number") return "rhr_bpm";
  if (typeof obj.hrv_rmssd_ms === "number") return "hrv_rmssd_ms";
  if (typeof obj.spo2_pct === "number") return "spo2_pct";
  if (typeof obj.sbp_mmhg === "number") return "blood_pressure";
  if (typeof obj.temp_c === "number") return "temp_c";
  return "battery";
}

function normalizeNearbyPeer(raw: unknown): NearbyPeer | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id ?? obj.peerId ?? "").trim();
  if (!id) return null;
  const rawStatus = String(obj.status ?? obj.state ?? "discovered").toLowerCase();
  const status: NearbyPeer["status"] =
    rawStatus === "connected" ? "connected" : rawStatus === "connecting" || rawStatus === "invited" ? "connecting" : "discovered";
  return {
    id,
    name: String(obj.name ?? obj.displayName ?? obj.astronautId ?? id),
    transport: String(obj.transport ?? state.capabilities.nearby.transport ?? "wifi_p2p"),
    status,
  };
}

function handleNativeEvent(rawType: string, payload: unknown): void {
  const type = rawType as NativeEventType;
  const obj = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  if (type === "capabilities" && obj.platform) {
    state.capabilities = obj as unknown as NativeCapabilities;
  } else if (type === "health_permissions") {
    const granted = Boolean(obj.granted);
    state.capabilities = {
      ...state.capabilities,
      healthApi: {
        ...state.capabilities.healthApi,
        authorized: granted,
        status: granted ? "ready" : state.capabilities.healthApi.status,
      },
    };
    state.lastMessage = String(obj.message ?? (granted ? "Health permissions granted" : "Health permissions denied"));
  } else if (type === "health_sync") {
    state.healthSync = obj as unknown as HealthSyncResult;
    state.lastMessage = String(obj.message ?? "Health sync finished");
  } else if (type === "ble_status") {
    const connectedIds = Array.isArray(obj.connectedDeviceIds) ? obj.connectedDeviceIds.map(String) : [];
    const connectedId =
      typeof obj.connectedDeviceId === "string" && obj.connectedDeviceId
        ? obj.connectedDeviceId
        : connectedIds[0] ?? null;
    const matched = connectedId ? state.bleDevices.find((d) => d.id === connectedId) : undefined;
    state.bleStatus = {
      scanning: Boolean(obj.scanning),
      poweredOn: Boolean(obj.poweredOn),
      authorized: Boolean(obj.authorized),
      connectedDeviceId: connectedId,
      connectedDeviceName:
        typeof obj.connectedDeviceName === "string" && obj.connectedDeviceName
          ? obj.connectedDeviceName
          : matched?.name ?? null,
      error: obj.error != null ? String(obj.error) : null,
      message: obj.message != null ? String(obj.message) : undefined,
    };
    if (connectedId) {
      state.bleDevices = state.bleDevices.map((d) => ({ ...d, connected: d.id === connectedId || connectedIds.includes(d.id) }));
    } else if (Array.isArray(obj.connectedDeviceIds)) {
      state.bleDevices = state.bleDevices.map((d) => ({ ...d, connected: connectedIds.includes(d.id) }));
    }
    state.capabilities = {
      ...state.capabilities,
      bluetooth: {
        ...state.capabilities.bluetooth,
        scanning: Boolean(obj.scanning),
        poweredOn: Boolean(obj.poweredOn),
        authorized: Boolean(obj.authorized),
      },
    };
    if (obj.message || obj.error) {
      state.lastMessage = String(obj.error || obj.message);
    }
  } else if (type === "ble_scan_result") {
    if (Array.isArray(obj.devices)) {
      state.bleDevices = obj.devices.map(normalizeBleDevice).filter((d): d is BleDeviceInfo => Boolean(d));
    } else {
      const single = normalizeBleDevice(obj);
      if (single) {
        const idx = state.bleDevices.findIndex((d) => d.id === single.id);
        if (idx >= 0) {
          const next = [...state.bleDevices];
          next[idx] = { ...next[idx], ...single };
          state.bleDevices = next;
        } else {
          state.bleDevices = [...state.bleDevices, single];
        }
      }
    }
  } else if (type === "ble_reading") {
    const reading: BleReading = {
      ...(obj as unknown as BleReading),
      deviceId: String(obj.deviceId ?? "ble"),
      deviceName: String(obj.deviceName ?? "BLE Sensor"),
      metric: inferBleMetric(obj),
      timestamp: String(obj.timestamp ?? new Date().toISOString()),
    };
    state.latestBleReading = reading;
    state.bleReadingsHistory = [reading, ...state.bleReadingsHistory].slice(0, 20);
  } else if (type === "nearby_status") {
    state.nearbyStatus = obj as unknown as NearbyStatus;
    state.capabilities = {
      ...state.capabilities,
      nearby: {
        ...state.capabilities.nearby,
        active: Boolean(obj.active),
        authorized: Boolean(obj.authorized),
      },
    };
    if (obj.message || obj.error) {
      state.lastMessage = String(obj.error || obj.message);
    }
  } else if (type === "nearby_peers" && Array.isArray(obj.peers)) {
    state.nearbyPeers = obj.peers.map(normalizeNearbyPeer).filter((p): p is NearbyPeer => Boolean(p));
  } else if (type === "nearby_received") {
    const peerId = String(obj.peerId ?? "peer");
    const pkt: NearbyReceivedPacket = {
      peerId,
      peerName: String(obj.peerName ?? obj.displayName ?? obj.astronautId ?? peerId),
      payloadJson: String(obj.payloadJson ?? "{}"),
      receivedAt: String(obj.receivedAt ?? obj.timestamp ?? new Date().toISOString()),
    };
    state.nearbyReceived = [pkt, ...state.nearbyReceived].slice(0, 20);
    state.lastMessage = `Received crew packet from ${pkt.peerName || pkt.peerId}`;
  } else if (type === "nearby_sent") {
    state.lastMessage = String(obj.message ?? (obj.ok ? "Nearby packet sent" : "Nearby send failed"));
  }

  notifyListeners(type, payload);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("boops:native-event", { detail: { type, payload } }));
  }
}

function ensureGlobalReceiver(): void {
  const win = getBridgeWindow();
  if (!win) return;
  win.__boopsNativeEvent = handleNativeEvent;
  if (Array.isArray(win.__boopsPendingNativeEvents) && win.__boopsPendingNativeEvents.length > 0) {
    const queued = win.__boopsPendingNativeEvents.splice(0, win.__boopsPendingNativeEvents.length);
    for (const item of queued) {
      if (item && typeof item.type === "string") {
        handleNativeEvent(item.type, item.payload);
      }
    }
  }
}

ensureGlobalReceiver();

function postAppleMessage(action: string, args?: Record<string, unknown>): boolean {
  const win = getBridgeWindow();
  const handler = win?.webkit?.messageHandlers?.boopsNative;
  if (!handler) return false;
  try {
    handler.postMessage(args ? { action, args } : { action });
    return true;
  } catch {
    return false;
  }
}

/** Returns whether BOOPS is running inside the native Android or iOS shell. */
export function isNativeMobileShell(): boolean {
  return hasAndroidBridge() || hasAppleBridge();
}

/** Returns a shallow copy of the current native capabilities & live sensor state. */
export function getNativeBridgeState(): NativeBridgeState {
  return {
    ...state,
    bleDevices: [...state.bleDevices],
    bleReadingsHistory: [...state.bleReadingsHistory],
    nearbyPeers: [...state.nearbyPeers],
    nearbyReceived: [...state.nearbyReceived],
  };
}

/** Subscribes to native health, BLE, and nearby events. Returns an unsubscribe function. */
export function subscribeNativeBridge(
  listener: (next: NativeBridgeState, eventType?: NativeEventType, payload?: unknown) => void,
): () => void {
  ensureGlobalReceiver();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Queries fresh capabilities from Android, Apple iOS, or desktop Web Bluetooth. */
export function refreshCapabilities(): NativeCapabilities {
  ensureGlobalReceiver();
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.getCapabilitiesJson) {
    try {
      const parsed = JSON.parse(win.BoopsAndroid.getCapabilitiesJson()) as NativeCapabilities;
      state.capabilities = parsed;
      notifyListeners("capabilities", parsed);
      return parsed;
    } catch {
      // Keep prior state on parse error.
    }
  }
  if (postAppleMessage("getCapabilities")) {
    return state.capabilities;
  }
  state.capabilities = buildWebFallbackCapabilities();
  notifyListeners("capabilities", state.capabilities);
  return state.capabilities;
}

/** Triggers native Health Connect / Apple HealthKit permission authorization. */
export function requestHealthPermissions(): boolean {
  ensureGlobalReceiver();
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.requestHealthPermissions) {
    return Boolean(win.BoopsAndroid.requestHealthPermissions());
  }
  if (win?.BoopsApple?.requestHealthPermissions) {
    return Boolean(win.BoopsApple.requestHealthPermissions());
  }
  return postAppleMessage("requestHealthPermissions");
}

/** Queries local Health Connect / Apple HealthKit records for the last `daysBack` days. */
export function syncHealthData(daysBack = 7): boolean {
  ensureGlobalReceiver();
  const days = Math.max(1, Math.min(30, Math.round(daysBack)));
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.syncHealthData) {
    return Boolean(win.BoopsAndroid.syncHealthData(days));
  }
  if (win?.BoopsApple?.syncHealthData) {
    return Boolean(win.BoopsApple.syncHealthData(days));
  }
  return postAppleMessage("syncHealthData", { daysBack: days });
}

/** Starts native BLE scan on Android/iOS or Web Bluetooth pairing on supported desktop browsers. */
export async function startBleScan(): Promise<boolean> {
  ensureGlobalReceiver();
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.startBleScan) {
    return Boolean(win.BoopsAndroid.startBleScan());
  }
  if (win?.BoopsApple?.startBleScan) {
    return Boolean(win.BoopsApple.startBleScan());
  }
  if (postAppleMessage("startBleScan")) {
    return true;
  }
  if (hasWebBluetooth()) {
    return pairWebBluetoothDevice();
  }
  handleNativeEvent("ble_status", {
    scanning: false,
    poweredOn: false,
    authorized: false,
    connectedDeviceId: null,
    connectedDeviceName: null,
    error: "Bluetooth GATT requires the BOOPS Android/iOS app or desktop Chrome/Edge over localhost/HTTPS.",
  });
  return false;
}

export function stopBleScan(): boolean {
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.stopBleScan) return Boolean(win.BoopsAndroid.stopBleScan());
  if (win?.BoopsApple?.stopBleScan) return Boolean(win.BoopsApple.stopBleScan());
  return postAppleMessage("stopBleScan");
}

export function connectBleDevice(deviceId: string): boolean {
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.connectBleDevice) return Boolean(win.BoopsAndroid.connectBleDevice(deviceId));
  if (win?.BoopsApple?.connectBleDevice) return Boolean(win.BoopsApple.connectBleDevice(deviceId));
  return postAppleMessage("connectBleDevice", { deviceId });
}

export function disconnectBleDevice(deviceId: string): boolean {
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.disconnectBleDevice) return Boolean(win.BoopsAndroid.disconnectBleDevice(deviceId));
  if (win?.BoopsApple?.disconnectBleDevice) return Boolean(win.BoopsApple.disconnectBleDevice(deviceId));
  if (postAppleMessage("disconnectBleDevice", { deviceId })) return true;
  if (activeWebBleDevice?.gatt?.connected) {
    activeWebBleDevice.gatt.disconnect();
    activeWebBleDevice = null;
    handleNativeEvent("ble_status", {
      scanning: false,
      poweredOn: true,
      authorized: true,
      connectedDeviceId: null,
      connectedDeviceName: null,
      error: null,
      message: "Disconnected Web Bluetooth sensor",
    });
    return true;
  }
  return false;
}

export function startNearbyDiscovery(astronautId: string): boolean {
  ensureGlobalReceiver();
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.startNearbyDiscovery) return Boolean(win.BoopsAndroid.startNearbyDiscovery(astronautId));
  if (win?.BoopsApple?.startNearbyDiscovery) return Boolean(win.BoopsApple.startNearbyDiscovery(astronautId));
  if (postAppleMessage("startNearbyDiscovery", { astronautId })) return true;
  handleNativeEvent("nearby_status", {
    active: false,
    authorized: false,
    transport: "unavailable",
    message: "Nearby crew sync requires the native Android (Wi-Fi Direct) or iOS (MultipeerConnectivity) app.",
    error: "Unavailable in desktop browser",
  });
  return false;
}

export function stopNearbyDiscovery(): boolean {
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.stopNearbyDiscovery) return Boolean(win.BoopsAndroid.stopNearbyDiscovery());
  if (win?.BoopsApple?.stopNearbyDiscovery) return Boolean(win.BoopsApple.stopNearbyDiscovery());
  return postAppleMessage("stopNearbyDiscovery");
}

export function sendNearbySummary(peerId: string, payloadJson: string): boolean {
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.sendNearbySummary) return Boolean(win.BoopsAndroid.sendNearbySummary(peerId, payloadJson));
  if (win?.BoopsApple?.sendNearbySummary) return Boolean(win.BoopsApple.sendNearbySummary(peerId, payloadJson));
  return postAppleMessage("sendNearbySummary", { peerId, payloadJson });
}

/** Saves text files using Android/iOS native export sheet when available. Returns null if not in native shell. */
export function saveFileWithNativeBridge(filename: string, content: string, mimeType: string): boolean | null {
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.saveFile) {
    try {
      return Boolean(win.BoopsAndroid.saveFile(filename, content, mimeType));
    } catch {
      return false;
    }
  }
  if (win?.BoopsApple?.saveFile) {
    try {
      return Boolean(win.BoopsApple.saveFile(filename, content, mimeType));
    } catch {
      return false;
    }
  }
  if (postAppleMessage("saveFile", { filename, content, mimeType })) {
    return true;
  }
  return null;
}

/** Triggers Android/iOS native print sheet when available. Returns null if not in native shell. */
export function printDocumentWithNativeBridge(title: string): boolean | null {
  const win = getBridgeWindow();
  if (win?.BoopsAndroid?.printDocument) {
    try {
      return Boolean(win.BoopsAndroid.printDocument(title));
    } catch {
      return false;
    }
  }
  if (win?.BoopsApple?.printDocument) {
    try {
      return Boolean(win.BoopsApple.printDocument(title));
    } catch {
      return false;
    }
  }
  if (postAppleMessage("printDocument", { title })) {
    return true;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Desktop Web Bluetooth fallback (Chromium over HTTPS or localhost)
// ---------------------------------------------------------------------------
function decodeSfloat16(raw: number): number | null {
  if (raw === 0x07ff || raw === 0x0800 || raw === 0x07fe || raw === 0x0802) return null;
  let mantissa = raw & 0x0fff;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  let exp = (raw >> 12) & 0x0f;
  if (exp >= 0x08) exp -= 0x10;
  return mantissa * Math.pow(10, exp);
}

function decodeFloat32(raw: number): number | null {
  const mantissaRaw = raw & 0x00ffffff;
  if (mantissaRaw === 0x007fffff || mantissaRaw === 0x00800000 || mantissaRaw === 0x007ffffe || mantissaRaw === 0x00800002) {
    return null;
  }
  const mantissa = mantissaRaw >= 0x00800000 ? mantissaRaw - 0x01000000 : mantissaRaw;
  let exp = (raw >> 24) & 0xff;
  if (exp >= 0x80) exp -= 0x100;
  return mantissa * Math.pow(10, exp);
}

function computeRmssdFromRr(rrMs: number[]): number | null {
  const valid = rrMs.filter((ms) => ms >= 300 && ms <= 2000);
  if (valid.length < 3) return null;
  let sqDiffSum = 0;
  let count = 0;
  for (let i = 1; i < valid.length; i++) {
    const diff = valid[i] - valid[i - 1];
    sqDiffSum += diff * diff;
    count += 1;
  }
  return count > 0 ? Number(Math.sqrt(sqDiffSum / count).toFixed(1)) : null;
}

async function pairWebBluetoothDevice(): Promise<boolean> {
  const nav = navigator as WebBluetoothNavigator;
  if (!nav.bluetooth) return false;
  try {
    handleNativeEvent("ble_status", {
      scanning: true,
      poweredOn: true,
      authorized: true,
      connectedDeviceId: activeWebBleDevice?.id ?? null,
      connectedDeviceName: activeWebBleDevice?.name ?? null,
      error: null,
      message: "Select a standard BLE sensor in the browser picker…",
    });

    const device = await nav.bluetooth.requestDevice({
      filters: [{ services: [0x180d] }, { services: [0x1822] }, { services: [0x1810] }, { services: [0x1809] }],
      optionalServices: [0x180d, 0x1822, 0x1810, 0x1809, 0x180f],
    });
    activeWebBleDevice = device;
    const devName = device.name || "BLE Sensor";

    handleNativeEvent("ble_scan_result", {
      devices: [
        {
          id: device.id,
          name: devName,
          services: ["180d", "1822", "1810", "1809"],
          kind: "wearable",
          connected: true,
        },
      ],
    });

    device.addEventListener("gattserverdisconnected", () => {
      activeWebBleDevice = null;
      handleNativeEvent("ble_status", {
        scanning: false,
        poweredOn: true,
        authorized: true,
        connectedDeviceId: null,
        connectedDeviceName: null,
        error: null,
        message: `${devName} disconnected`,
      });
    });

    const server = await device.gatt?.connect();
    if (!server) throw new Error("GATT server unavailable");

    handleNativeEvent("ble_status", {
      scanning: false,
      poweredOn: true,
      authorized: true,
      connectedDeviceId: device.id,
      connectedDeviceName: devName,
      error: null,
      message: `Connected to ${devName}`,
    });

    // Subscribe to standard GATT health characteristics that exist on the device.
    try {
      const hrSvc = await server.getPrimaryService(0x180d);
      const hrChar = await hrSvc.getCharacteristic(0x2a37);
      await hrChar.startNotifications();
      hrChar.addEventListener("characteristicvaluechanged", (ev) => {
        const dv = ev.target.value;
        const flags = dv.getUint8(0);
        const is16Bit = (flags & 0x01) !== 0;
        let offset = 1;
        const hr = is16Bit ? dv.getUint16(offset, true) : dv.getUint8(offset);
        offset += is16Bit ? 2 : 1;
        if ((flags & 0x08) !== 0) offset += 2; // energy expended
        if ((flags & 0x10) !== 0) {
          while (offset + 1 < dv.byteLength) {
            const rrRaw = dv.getUint16(offset, true);
            webBleRrHistory.push((rrRaw / 1024) * 1000);
            if (webBleRrHistory.length > 32) webBleRrHistory.shift();
            offset += 2;
          }
        }
        const rmssd = computeRmssdFromRr(webBleRrHistory);
        handleNativeEvent("ble_reading", {
          deviceId: device.id,
          deviceName: devName,
          metric: "rhr_bpm",
          rhr_bpm: hr,
          hrv_rmssd_ms: rmssd,
          signal_quality: 0.94,
          source: "wearable",
          timestamp: new Date().toISOString(),
        });
      });
    } catch {
      // Service not present on this sensor.
    }

    try {
      const spo2Svc = await server.getPrimaryService(0x1822);
      const plxChar = await spo2Svc.getCharacteristic(0x2a5f);
      await plxChar.startNotifications();
      plxChar.addEventListener("characteristicvaluechanged", (ev) => {
        const dv = ev.target.value;
        const spo2 = decodeSfloat16(dv.getUint16(1, true));
        const pr = decodeSfloat16(dv.getUint16(3, true));
        if (spo2 != null) {
          handleNativeEvent("ble_reading", {
            deviceId: device.id,
            deviceName: devName,
            metric: "spo2_pct",
            spo2_pct: Number(spo2.toFixed(1)),
            rhr_bpm: pr != null ? Math.round(pr) : null,
            signal_quality: 0.94,
            source: "wearable",
            timestamp: new Date().toISOString(),
          });
        }
      });
    } catch {
      // Service not present on this sensor.
    }

    try {
      const bpSvc = await server.getPrimaryService(0x1810);
      const bpChar = await bpSvc.getCharacteristic(0x2a35);
      await bpChar.startNotifications();
      bpChar.addEventListener("characteristicvaluechanged", (ev) => {
        const dv = ev.target.value;
        const sbp = decodeSfloat16(dv.getUint16(1, true));
        const dbp = decodeSfloat16(dv.getUint16(3, true));
        if (sbp != null && dbp != null) {
          handleNativeEvent("ble_reading", {
            deviceId: device.id,
            deviceName: devName,
            metric: "blood_pressure",
            sbp_mmhg: Math.round(sbp),
            dbp_mmhg: Math.round(dbp),
            signal_quality: 0.94,
            source: "wearable",
            timestamp: new Date().toISOString(),
          });
        }
      });
    } catch {
      // Service not present on this sensor.
    }

    try {
      const tempSvc = await server.getPrimaryService(0x1809);
      const tempChar = await tempSvc.getCharacteristic(0x2a1c);
      await tempChar.startNotifications();
      tempChar.addEventListener("characteristicvaluechanged", (ev) => {
        const dv = ev.target.value;
        const flags = dv.getUint8(0);
        const raw = dv.getUint32(1, true);
        const val = decodeFloat32(raw);
        if (val != null) {
          const tempC = (flags & 0x01) !== 0 ? ((val - 32) * 5) / 9 : val;
          handleNativeEvent("ble_reading", {
            deviceId: device.id,
            deviceName: devName,
            metric: "temp_c",
            temp_c: Number(tempC.toFixed(1)),
            signal_quality: 0.95,
            source: "wearable",
            timestamp: new Date().toISOString(),
          });
        }
      });
    } catch {
      // Service not present on this sensor.
    }

    try {
      const batSvc = await server.getPrimaryService(0x180f);
      const batChar = await batSvc.getCharacteristic(0x2a19);
      const val = await batChar.readValue();
      handleNativeEvent("ble_reading", {
        deviceId: device.id,
        deviceName: devName,
        metric: "battery",
        batteryPct: val.getUint8(0),
        source: "wearable",
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Battery service optional.
    }

    return true;
  } catch (err) {
    handleNativeEvent("ble_status", {
      scanning: false,
      poweredOn: true,
      authorized: false,
      connectedDeviceId: null,
      connectedDeviceName: null,
      error: err instanceof Error ? err.message : "Bluetooth pairing cancelled",
    });
    return false;
  }
}
