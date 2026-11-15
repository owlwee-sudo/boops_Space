#!/usr/bin/env node
/**
 * Assemble the standalone Cloudflare-ready static bundle in `dist-site/`.
 *
 * Keeps `web/` untouched (required by Android APK asset sync and pytest checks)
 * while mounting:
 *   /            -> site/index.html (Landing page with GitHub & Download CTAs)
 *   /legal.html  -> site/legal.html (Disclaimers, privacy, citations, licenses)
 *   /downloads/  -> Bundled Android APK, Flight Surgeon Summary PDF, Simulated CSV
 *   /knowledge/  -> knowledge/web/index.html (Interactive evidence map)
 *   /app/        -> a copy of web/ (the crew app) plus pwa/ (manifest, service worker), so the
 *                   hosted app installs and keeps working offline after the first visit
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SITE_DIR = path.join(ROOT, "site");
const WEB_DIR = path.join(ROOT, "web");
const PWA_DIR = path.join(ROOT, "pwa");

// Web app (/app/) settings
const APP_SKIP_NAMES = new Set([".DS_Store", "debug.html", "README.md"]); // dev-only files
const APP_VENDOR_DIR = "vendor"; // MediaPipe: cached on first camera use, not on install
const APP_HTML_PAGES = ["index.html", "camera/index.html"]; // pages that get the PWA tags
const KNOWLEDGE_HTML = path.join(ROOT, "knowledge", "web", "index.html");
const DIST_DIR = path.join(ROOT, "dist-site");

const DOWNLOAD_ARTIFACTS = [
  {
    src: path.join(ROOT, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    destName: "boops-android.apk",
  },
  {
    src: path.join(ROOT, "data", "flight_surgeon_summary_A1.pdf"),
    destName: "flight_surgeon_summary_A1.pdf",
  },
  {
    src: path.join(ROOT, "data", "daily_records.csv"),
    destName: "daily_records.csv",
  },
];

const CLOUDFLARE_MAX_FILE_BYTES = 25 * 1024 * 1024;
const CLOUDFLARE_MAX_FILES = 20000;

function copyTree(srcDir, dstDir, options = {}) {
  const { skipNames = new Set([".DS_Store"]), skipExtensions = new Set() } = options;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(srcPath, dstPath, options);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (skipExtensions.has(ext)) continue;
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (entry.isFile()) {
      const stat = fs.statSync(full);
      results.push({ path: full, size: stat.size });
    }
  }
  return results;
}

function hashFiles(baseDir, relPaths) {
  const hash = crypto.createHash("sha256");
  for (const rel of [...relPaths].sort()) {
    hash.update(rel);
    hash.update(fs.readFileSync(path.join(baseDir, rel)));
  }
  return hash.digest("hex").slice(0, 12);
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

/** Copies web/ to dist-site/app/ and turns it into an installable, offline-first PWA. */
function buildWebApp() {
  const appDir = path.join(DIST_DIR, "app");
  copyTree(WEB_DIR, appDir, { skipNames: APP_SKIP_NAMES });

  // PWA files that live only in the hosted copy (web/ and the native apps stay unchanged).
  fs.copyFileSync(path.join(PWA_DIR, "manifest.webmanifest"), path.join(appDir, "manifest.webmanifest"));
  fs.copyFileSync(path.join(PWA_DIR, "pwa.js"), path.join(appDir, "pwa.js"));
  copyTree(path.join(PWA_DIR, "icons"), path.join(appDir, "icons"));

  // Add the manifest, iOS icon and service-worker script to each page.
  for (const page of APP_HTML_PAGES) {
    const file = path.join(appDir, page);
    const up = "../".repeat(page.split("/").length - 1) || "./";
    let html = fs.readFileSync(file, "utf8");
    html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/, "");
    const tags = [
      `<link rel="manifest" href="${up}manifest.webmanifest" />`,
      `<link rel="apple-touch-icon" href="${up}icons/apple-touch-icon.png" />`,
      `<meta name="apple-mobile-web-app-title" content="BOOPS" />`,
      `<script src="${up}pwa.js" defer></script>`,
    ];
    if (!html.includes("</head>")) throw new Error(`No </head> in app/${page}`);
    html = html.replace(/[ \t]*<\/head>/, `    ${tags.join("\n    ")}\n  </head>`);
    fs.writeFileSync(file, html, "utf8");
  }

  // Precache list: every file except MediaPipe. Pages are stored under their folder URL
  // ("./", "camera/") because hosts often redirect ".../index.html" to ".../".
  const all = walkFiles(appDir).map((f) => toPosix(path.relative(appDir, f.path)));
  const vendorFiles = all.filter((p) => p.startsWith(`${APP_VENDOR_DIR}/`));
  const shellFiles = all.filter((p) => !p.startsWith(`${APP_VENDOR_DIR}/`));
  const precache = shellFiles.map((p) =>
    p === "index.html" ? "./" : p.endsWith("/index.html") ? p.slice(0, -"index.html".length) : p
  );

  const swTemplate = fs.readFileSync(path.join(PWA_DIR, "sw.js"), "utf8");
  const shellVersion = hashFiles(appDir, shellFiles) + "-" + crypto.createHash("sha256").update(swTemplate).digest("hex").slice(0, 6);
  const vendorVersion = hashFiles(appDir, vendorFiles);
  const sw = swTemplate
    .replace("__BOOPS_SHELL_VERSION__", shellVersion)
    .replace("__BOOPS_VENDOR_VERSION__", vendorVersion)
    .replace("__BOOPS_PRECACHE__", JSON.stringify(precache, null, 2));
  if (sw.includes("__BOOPS_")) throw new Error("Unfilled placeholder left in pwa/sw.js");
  fs.writeFileSync(path.join(appDir, "sw.js"), sw, "utf8");

  const shellBytes = shellFiles.reduce((s, p) => s + fs.statSync(path.join(appDir, p)).size, 0);
  return { precacheCount: precache.length, shellBytes, shellVersion, vendorVersion };
}

function validateLocalRefs(htmlFile) {
  const html = fs.readFileSync(htmlFile, "utf8");
  const baseDir = path.dirname(htmlFile);
  const attrRe = /\b(?:href|src)="([^"]+)"/g;
  const missing = [];
  for (const match of html.matchAll(attrRe)) {
    const raw = match[1];
    if (
      !raw ||
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("mailto:") ||
      raw.startsWith("#") ||
      raw.startsWith("data:")
    ) {
      continue;
    }
    const cleanRef = raw.split("#")[0].split("?")[0];
    if (!cleanRef) continue;
    const candidate = cleanRef.endsWith("/")
      ? path.join(baseDir, cleanRef, "index.html")
      : path.join(baseDir, cleanRef);
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(DIST_DIR) || !fs.existsSync(resolved)) {
      missing.push(`${path.relative(DIST_DIR, htmlFile)} -> ${raw}`);
    }
  }
  return missing;
}

function main() {
  for (const required of [
    path.join(SITE_DIR, "index.html"),
    path.join(SITE_DIR, "legal.html"),
    path.join(SITE_DIR, "styles.css"),
    path.join(WEB_DIR, "boops-logo.svg"),
    path.join(WEB_DIR, "index.html"),
    path.join(WEB_DIR, "app.js"),
    path.join(PWA_DIR, "sw.js"),
    path.join(PWA_DIR, "pwa.js"),
    path.join(PWA_DIR, "manifest.webmanifest"),
    KNOWLEDGE_HTML,
    ...DOWNLOAD_ARTIFACTS.map((item) => item.src),
  ]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Missing required source file: ${path.relative(ROOT, required)}`);
    }
  }

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 1. Landing & legal pages
  copyTree(SITE_DIR, DIST_DIR, {
    skipNames: new Set([".DS_Store"]),
    skipExtensions: new Set([".md"]),
  });

  // Ensure brand logo stays identical to web/boops-logo.svg
  fs.mkdirSync(path.join(DIST_DIR, "assets"), { recursive: true });
  fs.copyFileSync(
    path.join(WEB_DIR, "boops-logo.svg"),
    path.join(DIST_DIR, "assets", "boops-logo.svg")
  );

  // 2. Downloadable artifacts under /downloads/
  const downloadsDir = path.join(DIST_DIR, "downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });
  for (const artifact of DOWNLOAD_ARTIFACTS) {
    fs.copyFileSync(artifact.src, path.join(downloadsDir, artifact.destName));
  }

  // 3. Standalone evidence map under /knowledge/
  fs.mkdirSync(path.join(DIST_DIR, "knowledge"), { recursive: true });
  fs.copyFileSync(KNOWLEDGE_HTML, path.join(DIST_DIR, "knowledge", "index.html"));

  // 4. Crew web app under /app/ (offline PWA)
  const app = buildWebApp();

  // 5. Cloudflare Workers Static Assets ignore file
  fs.writeFileSync(
    path.join(DIST_DIR, ".assetsignore"),
    [
      "**/.DS_Store",
      ".cloudflare",
      "cloudflare.config.ts",
      "wrangler.config.ts",
      "package.json",
      "package-lock.json",
      "node_modules",
      "",
    ].join("\n"),
    "utf8"
  );

  // Validate local links/assets
  const missing = [
    ...validateLocalRefs(path.join(DIST_DIR, "index.html")),
    ...validateLocalRefs(path.join(DIST_DIR, "legal.html")),
    ...APP_HTML_PAGES.flatMap((page) => validateLocalRefs(path.join(DIST_DIR, "app", page))),
  ];
  if (missing.length > 0) {
    throw new Error(`Broken local links/assets detected:\n- ${missing.join("\n- ")}`);
  }

  // Check Cloudflare static asset constraints
  const files = walkFiles(DIST_DIR);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const largest = files.reduce((max, f) => (f.size > max.size ? f : max), files[0]);

  if (files.length > CLOUDFLARE_MAX_FILES) {
    throw new Error(`File count ${files.length} exceeds Cloudflare limit (${CLOUDFLARE_MAX_FILES}).`);
  }
  if (largest.size > CLOUDFLARE_MAX_FILE_BYTES) {
    throw new Error(
      `Largest file ${path.relative(DIST_DIR, largest.path)} (${largest.size} B) exceeds 25 MiB Cloudflare limit.`
    );
  }

  console.log(`Built dist-site/ successfully.`);
  console.log(`- Files: ${files.length} (limit ${CLOUDFLARE_MAX_FILES})`);
  console.log(`- Total size: ${(totalBytes / (1024 * 1024)).toFixed(2)} MiB`);
  console.log(
    `- Web app (/app/): ${app.precacheCount} files precached (${(app.shellBytes / (1024 * 1024)).toFixed(2)} MiB), shell ${app.shellVersion}, vendor ${app.vendorVersion}`
  );
  console.log(
    `- Largest file:${path.relative(DIST_DIR, largest.path)} (${(largest.size / (1024 * 1024)).toFixed(2)} MiB, limit 25.00 MiB)`
  );
}

main();
