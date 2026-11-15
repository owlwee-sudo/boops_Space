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
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SITE_DIR = path.join(ROOT, "site");
const WEB_DIR = path.join(ROOT, "web");
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

  // 4. Cloudflare Workers Static Assets ignore file
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
    `- Largest file: ${path.relative(DIST_DIR, largest.path)} (${(largest.size / (1024 * 1024)).toFixed(2)} MiB, limit 25.00 MiB)`
  );
}

main();
