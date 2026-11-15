/**
 * Connected Sensors, OS Health Sync (Health Connect / Apple HealthKit), BLE GATT,
 * and Offline Nearby Crew Sync modal for BOOPS.
 */

import { h } from "../lib/dom";
import {
  type BoopsBundle,
  type SharingSettings,
  buildExportPayload,
  getCrewProfile,
  ingestBleReading,
  ingestWearableSyncRecords,
} from "../services/boopsData";
import {
  type NativeBridgeState,
  connectBleDevice,
  disconnectBleDevice,
  getNativeBridgeState,
  refreshCapabilities,
  requestHealthPermissions,
  sendNearbySummary,
  startBleScan,
  startNearbyDiscovery,
  stopBleScan,
  stopNearbyDiscovery,
  subscribeNativeBridge,
  syncHealthData,
} from "../services/nativeBridge";

export type DeviceHubTab = "health" | "ble" | "nearby";

export interface DeviceHubOptions {
  getBundle: () => BoopsBundle | null;
  getContext: () => { astronautId: "A1" | "A2" | "A3"; missionDay: number; sharing: SharingSettings };
  onDataIngested: () => void;
  onToast: (msg: string) => void;
}

export interface DeviceHubController {
  backdrop: HTMLElement;
  open: (initialTab?: DeviceHubTab) => void;
  close: () => void;
  isOpen: () => boolean;
}

/** Creates the offline sensor, OS Health sync, BLE, and Nearby crew-sync modal. */
export function createDeviceHubModal(opts: DeviceHubOptions): DeviceHubController {
  let activeTab: DeviceHubTab = "health";
  let lastIngestedHealthKey = "";
  const modalCard = h("div", { className: "boops-modal-card boops-hub-card" });
  const backdrop = h("div", { className: "boops-modal-backdrop", hidden: true }, modalCard);

  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });

  function formatHealthRecordSummary(rec: {
    rhr_bpm?: number | null;
    hrv_rmssd_ms?: number | null;
    hrv_metric?: string;
    sleep_hours?: number | null;
    spo2_pct?: number | null;
    sbp_mmhg?: number | null;
    dbp_mmhg?: number | null;
    temp_c?: number | null;
    exercise_min?: number | null;
  }): string {
    const parts: string[] = [];
    if (rec.rhr_bpm != null) parts.push(`RHR ${Math.round(rec.rhr_bpm)} bpm`);
    if (rec.hrv_rmssd_ms != null) {
      parts.push(`${rec.hrv_metric === "sdnn" ? "HRV (SDNN)" : "HRV (RMSSD)"} ${rec.hrv_rmssd_ms.toFixed(1)} ms`);
    }
    if (rec.sleep_hours != null) parts.push(`Sleep ${rec.sleep_hours.toFixed(1)} h`);
    if (rec.spo2_pct != null) parts.push(`SpO₂ ${rec.spo2_pct.toFixed(1)}%`);
    if (rec.sbp_mmhg != null && rec.dbp_mmhg != null) {
      parts.push(`BP ${Math.round(rec.sbp_mmhg)}/${Math.round(rec.dbp_mmhg)}`);
    }
    if (rec.temp_c != null) parts.push(`Temp ${rec.temp_c.toFixed(1)} °C`);
    if (rec.exercise_min != null) parts.push(`Exercise ${Math.round(rec.exercise_min)} min`);
    return parts.length > 0 ? parts.join(" · ") : "No sample metrics on this day";
  }

  function renderHealthTab(nativeState: NativeBridgeState): HTMLElement {
    const { capabilities, healthSync } = nativeState;
    const hApi = capabilities.healthApi;
    const { astronautId, missionDay } = opts.getContext();
    const profile = getCrewProfile(astronautId);

    const isAuthorized = hApi.authorized || hApi.status === "ready" || hApi.status === "authorized";
    const needsInstallOrUpdate =
      hApi.status === "install_required" || hApi.status === "provider_update_required";
    const needsPermission =
      hApi.status === "needs_permission" ||
      hApi.status === "available" ||
      hApi.status === "unknown" ||
      hApi.status === "error" ||
      (hApi.available && !isAuthorized);

    const statusBadgeClass = isAuthorized
      ? "boops-hub-badge boops-hub-badge-ok"
      : needsInstallOrUpdate || needsPermission
        ? "boops-hub-badge boops-hub-badge-warn"
        : "boops-hub-badge";

    const statusLabel = isAuthorized
      ? "Authorized"
      : needsInstallOrUpdate
        ? "Install / Update Health Connect"
        : needsPermission
          ? "Needs permission"
          : capabilities.platform === "web"
            ? "Native mobile only"
            : "Unavailable";

    const authBtn = h(
      "button",
      {
        type: "button",
        className: "boops-btn",
        disabled: !hApi.available && !needsInstallOrUpdate,
        onClick: () => {
          const ok = requestHealthPermissions();
          if (!ok) {
            opts.onToast(
              capabilities.platform === "web"
                ? `${hApi.name} is only available inside the BOOPS Android or iOS app.`
                : hApi.detail || `${hApi.name} permission flow could not open.`,
            );
          }
        },
      },
      needsInstallOrUpdate ? "Open Health Connect Setup" : "Grant Health Access",
    );

    const syncBtn = h(
      "button",
      {
        type: "button",
        className: "boops-btn boops-btn-dark",
        disabled: !hApi.available,
        onClick: () => {
          const ok = syncHealthData(7);
          if (!ok) {
            opts.onToast(
              capabilities.platform === "web"
                ? `Cannot sync ${hApi.name} from desktop browser.`
                : hApi.detail || `${hApi.name} sync could not start.`,
            );
          } else {
            opts.onToast(`Reading local ${hApi.name} records…`);
          }
        },
      },
      "Sync Last 7 Days",
    );

    const listEl = h("div", { className: "boops-hub-list" });
    if (healthSync && healthSync.records.length > 0) {
      for (const rec of healthSync.records.slice(-7).reverse()) {
        listEl.append(
          h(
            "div",
            { className: "boops-hub-row" },
            h(
              "div",
              { className: "boops-hub-row-main" },
              h("strong", { className: "boops-hub-row-title" }, rec.date),
              h("p", { className: "boops-hub-row-sub" }, formatHealthRecordSummary(rec)),
            ),
            h(
              "span",
              { className: "boops-hub-badge boops-hub-badge-ok" },
              `${rec.samples_count ?? 1} samples`,
            ),
          ),
        );
      }
    } else {
      listEl.append(
        h(
          "p",
          { className: "boops-hub-empty" },
          healthSync?.message ||
            (hApi.available
              ? `Tap "Grant Health Access" then "Sync Last 7 Days" to import on-device vitals for ${profile.id} · ${profile.name} (Day ${missionDay}).`
              : "Health Connect (Android) and Apple HealthKit (iOS) store metrics locally on the phone. Open BOOPS inside the Android or iOS app to sync."),
        ),
      );
    }

    return h(
      "div",
      { className: "boops-hub-pane" },
      h(
        "div",
        { className: "boops-hub-status-box" },
        h(
          "div",
          { className: "boops-hub-status-head" },
          h("strong", { className: "boops-hub-status-title" }, hApi.name),
          h("span", { className: statusBadgeClass }, statusLabel),
        ),
        h("p", { className: "boops-hub-status-detail" }, hApi.detail),
        h("div", { className: "boops-hub-actions" }, authBtn, syncBtn),
      ),
      h("p", { className: "boops-hub-section-label" }, "On-device Health Records"),
      listEl,
    );
  }

  function renderBleTab(nativeState: NativeBridgeState): HTMLElement {
    const { capabilities, bleStatus, bleDevices, latestBleReading } = nativeState;
    const { astronautId, missionDay } = opts.getContext();
    const isWebBt = capabilities.bluetooth.mode === "web_bluetooth";

    const scanBtn = h(
      "button",
      {
        type: "button",
        className: "boops-btn boops-btn-dark",
        disabled: !capabilities.bluetooth.available,
        onClick: () => {
          if (bleStatus.scanning && !isWebBt) {
            stopBleScan();
          } else {
            void startBleScan();
          }
        },
      },
      bleStatus.scanning && !isWebBt
        ? "Stop Scan"
        : isWebBt
          ? "Pair Web Bluetooth Sensor"
          : "Scan Bluetooth Sensors",
    );

    const statusLine = bleStatus.error
      ? bleStatus.error
      : bleStatus.connectedDeviceName
        ? `Connected: ${bleStatus.connectedDeviceName}`
        : bleStatus.message ||
          (capabilities.bluetooth.available
            ? "Supports standard BLE GATT Heart Rate (0x180D + RR/RMSSD), SpO₂ (0x1822), BP (0x1810), and Thermometer (0x1809)."
            : "Bluetooth GATT unavailable in this browser context. Use the BOOPS Android/iOS app or Chrome/Edge on localhost.");

    const deviceList = h("div", { className: "boops-hub-list" });
    if (bleDevices.length === 0) {
      deviceList.append(
        h(
          "p",
          { className: "boops-hub-empty" },
          bleStatus.scanning ? "Scanning nearby BLE GATT peripherals…" : "No Bluetooth sensors discovered yet.",
        ),
      );
    } else {
      for (const dev of bleDevices) {
        const isConnected = dev.connected || bleStatus.connectedDeviceId === dev.id;
        deviceList.append(
          h(
            "div",
            { className: "boops-hub-row" },
            h(
              "div",
              { className: "boops-hub-row-main" },
              h("strong", { className: "boops-hub-row-title" }, dev.name || dev.id),
              h(
                "p",
                { className: "boops-hub-row-sub" },
                [
                  dev.kind.replace("_", " "),
                  dev.rssi != null ? `${dev.rssi} dBm` : null,
                  dev.batteryPct != null ? `Battery ${dev.batteryPct}%` : null,
                  dev.services.length > 0 ? `GATT: ${dev.services.join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              ),
            ),
            h(
              "button",
              {
                type: "button",
                className: isConnected ? "boops-btn" : "boops-btn boops-btn-dark",
                onClick: () => {
                  if (isConnected) disconnectBleDevice(dev.id);
                  else connectBleDevice(dev.id);
                },
              },
              isConnected ? "Disconnect" : "Connect",
            ),
          ),
        );
      }
    }

    const readingBox = h("div", { className: "boops-hub-reading-box" });
    if (latestBleReading) {
      const summary = formatHealthRecordSummary(latestBleReading);
      readingBox.append(
        h(
          "div",
          { className: "boops-hub-reading-head" },
          h("strong", { className: "boops-hub-row-title" }, `Latest from ${latestBleReading.deviceName}`),
          h("span", { className: "boops-hub-badge boops-hub-badge-ok" }, latestBleReading.metric),
        ),
        h("p", { className: "boops-hub-row-sub" }, `${summary} · ${latestBleReading.timestamp}`),
        h(
          "div",
          { className: "boops-hub-actions" },
          h(
            "button",
            {
              type: "button",
              className: "boops-btn boops-btn-dark",
              onClick: () => {
                ingestBleReading(astronautId, missionDay, latestBleReading);
                opts.onDataIngested();
                opts.onToast(`Saved BLE reading to ${astronautId} Day ${missionDay}`);
              },
            },
            `Save to ${astronautId} Day ${missionDay}`,
          ),
        ),
      );
    } else {
      readingBox.append(
        h("p", { className: "boops-hub-empty" }, "Connect a sensor to view live BLE readings."),
      );
    }

    return h(
      "div",
      { className: "boops-hub-pane" },
      h(
        "div",
        { className: "boops-hub-status-box" },
        h(
          "div",
          { className: "boops-hub-status-head" },
          h("strong", { className: "boops-hub-status-title" }, "Bluetooth Low Energy Sensors"),
          h(
            "span",
            {
              className: bleStatus.connectedDeviceId
                ? "boops-hub-badge boops-hub-badge-ok"
                : bleStatus.scanning
                  ? "boops-hub-badge boops-hub-badge-warn"
                  : "boops-hub-badge",
            },
            bleStatus.connectedDeviceId ? "Connected" : bleStatus.scanning ? "Scanning" : isWebBt ? "Web Bluetooth" : "Idle",
          ),
        ),
        h("p", { className: "boops-hub-status-detail" }, statusLine),
        h("div", { className: "boops-hub-actions" }, scanBtn),
      ),
      h("p", { className: "boops-hub-section-label" }, "Discovered Peripherals"),
      deviceList,
      h("p", { className: "boops-hub-section-label" }, "Live Telemetry"),
      readingBox,
    );
  }

  function renderNearbyTab(nativeState: NativeBridgeState): HTMLElement {
    const { capabilities, nearbyStatus, nearbyPeers, nearbyReceived } = nativeState;
    const { astronautId, missionDay, sharing } = opts.getContext();
    const bundle = opts.getBundle();

    const toggleBtn = h(
      "button",
      {
        type: "button",
        className: nearbyStatus.active ? "boops-btn" : "boops-btn boops-btn-dark",
        disabled: !capabilities.nearby.available,
        onClick: () => {
          if (nearbyStatus.active) stopNearbyDiscovery();
          else startNearbyDiscovery(astronautId);
        },
      },
      nearbyStatus.active ? "Stop Crew Discovery" : "Start Crew Discovery",
    );

    const buildPrivacyFilteredPacket = (emergencyOnly: boolean): string => {
      if (!bundle) {
        return JSON.stringify({
          astronaut_id: astronautId,
          mission_day: missionDay,
          emergency: emergencyOnly,
          sent_at: new Date().toISOString(),
        });
      }
      const effectiveSharing: SharingSettings = emergencyOnly
        ? {
            daily_summary: false,
            raw_data: false,
            emergency_events: true,
            risk_detail_share: { immune: false, musculoskeletal: false, cardio: false },
          }
        : sharing;
      const payload = buildExportPayload(bundle, astronautId, Math.max(1, missionDay - 2), missionDay, effectiveSharing);
      return JSON.stringify(payload);
    };

    const peerList = h("div", { className: "boops-hub-list" });
    if (nearbyPeers.length === 0) {
      peerList.append(
        h(
          "p",
          { className: "boops-hub-empty" },
          nearbyStatus.active
            ? "Broadcasting & scanning for nearby BOOPS crew tablets/phones…"
            : "No nearby crew devices active.",
        ),
      );
    } else {
      for (const peer of nearbyPeers) {
        peerList.append(
          h(
            "div",
            { className: "boops-hub-row" },
            h(
              "div",
              { className: "boops-hub-row-main" },
              h("strong", { className: "boops-hub-row-title" }, peer.name || peer.id),
              h("p", { className: "boops-hub-row-sub" }, `${peer.transport} · ${peer.status}`),
            ),
            h(
              "div",
              { className: "boops-hub-actions" },
              h(
                "button",
                {
                  type: "button",
                  className: "boops-btn",
                  onClick: () => {
                    sendNearbySummary(peer.id, buildPrivacyFilteredPacket(false));
                  },
                },
                "Send Summary",
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "boops-btn boops-btn-danger",
                  onClick: () => {
                    sendNearbySummary(peer.id, buildPrivacyFilteredPacket(true));
                  },
                },
                "Emergency Alert",
              ),
            ),
          ),
        );
      }
    }

    const inboxList = h("div", { className: "boops-hub-list" });
    if (nearbyReceived.length === 0) {
      inboxList.append(h("p", { className: "boops-hub-empty" }, "No nearby crew packets received yet."));
    } else {
      for (const pkt of nearbyReceived.slice(0, 5)) {
        inboxList.append(
          h(
            "div",
            { className: "boops-hub-row" },
            h(
              "div",
              { className: "boops-hub-row-main" },
              h("strong", { className: "boops-hub-row-title" }, `From ${pkt.peerName || pkt.peerId}`),
              h(
                "p",
                { className: "boops-hub-row-sub" },
                `${pkt.receivedAt} · ${pkt.payloadJson.slice(0, 140)}${pkt.payloadJson.length > 140 ? "…" : ""}`,
              ),
            ),
          ),
        );
      }
    }

    return h(
      "div",
      { className: "boops-hub-pane" },
      h(
        "div",
        { className: "boops-hub-status-box" },
        h(
          "div",
          { className: "boops-hub-status-head" },
          h("strong", { className: "boops-hub-status-title" }, "Nearby Crew Peer-to-Peer Sync"),
          h(
            "span",
            { className: nearbyStatus.active ? "boops-hub-badge boops-hub-badge-ok" : "boops-hub-badge" },
            nearbyStatus.active ? "Active" : capabilities.nearby.available ? "Ready" : "Native mobile only",
          ),
        ),
        h(
          "p",
          { className: "boops-hub-status-detail" },
          nearbyStatus.error ||
            nearbyStatus.message ||
            `Transport: ${capabilities.nearby.transport}. Crew-first privacy: ${
              sharing.raw_data
                ? "Daily summary + Raw readings + Emergency events"
                : sharing.daily_summary
                  ? "Daily summary + Emergency events (Raw OFF)"
                  : "Emergency events ONLY"
            }.`,
        ),
        h("div", { className: "boops-hub-actions" }, toggleBtn),
      ),
      h("p", { className: "boops-hub-section-label" }, "Nearby Crew Devices"),
      peerList,
      h("p", { className: "boops-hub-section-label" }, "Received Packets"),
      inboxList,
    );
  }

  function render() {
    const nativeState = getNativeBridgeState();
    const closeBtn = h("button", { type: "button", className: "boops-btn" }, "Close ✕");
    closeBtn.addEventListener("click", () => close());

    const makeTabBtn = (id: DeviceHubTab, label: string) =>
      h(
        "button",
        {
          type: "button",
          className: activeTab === id ? "boops-btn boops-btn-dark" : "boops-btn",
          onClick: () => {
            activeTab = id;
            render();
          },
        },
        label,
      );

    const body =
      activeTab === "health"
        ? renderHealthTab(nativeState)
        : activeTab === "ble"
          ? renderBleTab(nativeState)
          : renderNearbyTab(nativeState);

    modalCard.replaceChildren(
      h(
        "div",
        { className: "boops-modal-head" },
        h(
          "div",
          null,
          h("h2", { className: "boops-modal-title" }, "Connected Sensors, Health App & Nearby Sync"),
          h(
            "p",
            { className: "boops-modal-sub" },
            `Platform: ${nativeState.capabilities.platform.toUpperCase()} · 100% offline · Prototype · Not a medical device`,
          ),
        ),
        closeBtn,
      ),
      h(
        "div",
        { className: "boops-hub-tabs" },
        makeTabBtn("health", "Health App Sync"),
        makeTabBtn("ble", "Bluetooth (BLE)"),
        makeTabBtn("nearby", "Nearby Crew Sync"),
      ),
      body,
    );
  }

  subscribeNativeBridge((nextState, eventType) => {
    if (eventType === "health_sync" && nextState.healthSync?.ok && nextState.healthSync.records.length > 0) {
      const key = `${nextState.healthSync.provider}:${nextState.healthSync.records.map((r) => `${r.date}:${r.samples_count ?? 0}`).join("|")}`;
      if (key !== lastIngestedHealthKey) {
        lastIngestedHealthKey = key;
        const { astronautId, missionDay } = opts.getContext();
        const saved = ingestWearableSyncRecords(
          astronautId,
          missionDay,
          nextState.healthSync.provider,
          nextState.healthSync.records,
        );
        if (saved > 0) {
          opts.onDataIngested();
          opts.onToast(`Synced ${saved} day(s) from ${nextState.healthSync.provider === "apple_healthkit" ? "Apple HealthKit" : "Health Connect"}`);
        }
      }
    }
    if (!backdrop.hidden) {
      render();
    }
  });

  function open(initialTab: DeviceHubTab = "health") {
    activeTab = initialTab;
    refreshCapabilities();
    render();
    backdrop.hidden = false;
  }

  function close() {
    backdrop.hidden = true;
  }

  return {
    backdrop,
    open,
    close,
    isOpen: () => !backdrop.hidden,
  };
}
