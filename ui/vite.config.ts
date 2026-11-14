import { defineConfig } from "vite";

// Tauri expects a fixed port and must not have the terminal cleared under it.
// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;
const offlineWeb = process.env.BUILD_OFFLINE_WEB === "1";

export default defineConfig({
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  define: offlineWeb
    ? {
        "process.env.NODE_ENV": JSON.stringify("production"),
      }
    : undefined,
  build: offlineWeb
    ? {
        target: "safari15",
        outDir: "../web",
        emptyOutDir: false,
        lib: {
          entry: "src/boopsMain.ts",
          formats: ["iife"],
          name: "BOOPSApp",
          fileName: () => "app.js",
        },
        cssCodeSplit: false,
      }
    : {
        target: "safari15",
        outDir: "dist",
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
      },
});
