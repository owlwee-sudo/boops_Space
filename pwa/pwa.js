/* BOOPS web app: registers the service worker and shows two small notices.
 *   "Ready to use offline"  - once, the first time the app has been saved on this device.
 *   "Update ready · Reload" - when a newer version has been downloaded in the background.
 * Added to dist-site/app/ pages by tools/build-site.mjs only (not to web/ or the native apps).
 */
(function () {
  "use strict";

  const CONFIG = {
    SW_URL: "sw.js", // next to this script
    OFFLINE_NOTICE_KEY: "boops.pwa.offline_notice_shown",
    OFFLINE_NOTICE_MS: 6000,
  };

  if (!("serviceWorker" in navigator)) return;
  // Service workers need a secure page: https, or localhost while developing.
  if (!window.isSecureContext) return;

  const scriptUrl = (document.currentScript && document.currentScript.src) || location.href;
  const swUrl = new URL(CONFIG.SW_URL, scriptUrl);
  const scope = new URL("./", swUrl);

  let reloading = false;
  let userAskedForUpdate = false;

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode: the notice may show again, which is harmless */
    }
  }

  function injectStyles() {
    if (document.getElementById("boops-pwa-style")) return;
    const style = document.createElement("style");
    style.id = "boops-pwa-style";
    style.textContent = `
      .boops-pwa-notice {
        position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        z-index: 900; display: flex; align-items: center; gap: 12px;
        max-width: 360px; padding: 12px 12px 12px 16px;
        background: #ffffff; color: #111827; border: 1px solid #e5e7eb; border-radius: 16px;
        box-shadow: 0 8px 24px rgba(17, 24, 39, 0.12);
        font: 500 14px/1.4 "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .boops-pwa-notice__dot { flex: none; width: 8px; height: 8px; border-radius: 999px; background: #22c55e; }
      .boops-pwa-notice__text { flex: 1; }
      .boops-pwa-notice__text small { display: block; color: #6b7280; font-weight: 400; font-size: 12px; }
      .boops-pwa-notice__btn {
        flex: none; border: 0; border-radius: 999px; padding: 8px 14px; cursor: pointer;
        background: #111827; color: #ffffff; font: inherit; font-weight: 600;
      }
      .boops-pwa-notice__close {
        flex: none; border: 0; background: transparent; color: #6b7280; cursor: pointer;
        width: 28px; height: 28px; border-radius: 999px; font: 400 18px/1 inherit;
      }
      .boops-pwa-notice__btn:focus-visible, .boops-pwa-notice__close:focus-visible {
        outline: 2px solid #111827; outline-offset: 2px;
      }
      @media (max-width: 1023px) {
        /* Sit above the bottom tab bar, which the app shows below 1024 px. */
        .boops-pwa-notice { left: 16px; right: 16px; max-width: none; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
      }
      @media print { .boops-pwa-notice { display: none; } }
    `;
    document.head.appendChild(style);
  }

  /** Shows one notice at a time. Returns a function that removes it. */
  function showNotice({ title, detail, actionLabel, onAction, autoHideMs }) {
    injectStyles();
    document.querySelectorAll(".boops-pwa-notice").forEach((n) => n.remove());

    const box = document.createElement("div");
    box.className = "boops-pwa-notice";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");

    const dot = document.createElement("span");
    dot.className = "boops-pwa-notice__dot";
    dot.setAttribute("aria-hidden", "true");

    const text = document.createElement("div");
    text.className = "boops-pwa-notice__text";
    text.textContent = title;
    if (detail) {
      const small = document.createElement("small");
      small.textContent = detail;
      text.appendChild(small);
    }
    box.append(dot, text);

    const close = () => box.remove();
    if (actionLabel) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "boops-pwa-notice__btn";
      btn.textContent = actionLabel;
      btn.addEventListener("click", onAction);
      box.appendChild(btn);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.className = "boops-pwa-notice__close";
    x.setAttribute("aria-label", "Dismiss");
    x.textContent = "×";
    x.addEventListener("click", close);
    box.appendChild(x);

    document.body.appendChild(box);
    if (autoHideMs) setTimeout(close, autoHideMs);
    return close;
  }

  function offerUpdate(worker) {
    showNotice({
      title: "Update ready",
      detail: "A newer version has been saved on this device.",
      actionLabel: "Reload",
      onAction: () => {
        userAskedForUpdate = true;
        worker.postMessage({ type: "SKIP_WAITING" });
      },
    });
  }

  function announceOffline() {
    if (safeGet(CONFIG.OFFLINE_NOTICE_KEY)) return;
    safeSet(CONFIG.OFFLINE_NOTICE_KEY, "1");
    showNotice({
      title: "Ready to use offline",
      detail: "BOOPS is saved on this device and works with no internet.",
      autoHideMs: CONFIG.OFFLINE_NOTICE_MS,
    });
  }

  // When the new version takes over (after "Reload"), load the page from it once.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!userAskedForUpdate || reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", () => {
    const hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker
      .register(swUrl.href, { scope: scope.href })
      .then((reg) => {
        if (reg.waiting && hadController) offerUpdate(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state !== "installed") return;
            if (navigator.serviceWorker.controller) offerUpdate(worker); // an update
          });
        });

        // First visit: tell the user once the shell is saved.
        navigator.serviceWorker.ready.then(() => {
          if (!hadController) announceOffline();
        });
      })
      .catch((err) => {
        console.warn("BOOPS: offline mode is not available in this browser.", err);
      });
  });
})();
