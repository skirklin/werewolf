import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * One id per build, baked into the bundle and written beside it as
 * version.json. The server reads that file and tells every connecting page
 * which build is current, so a phone still running last deploy's page reloads
 * instead of sending moves the new server no longer understands.
 */
const BUILD_ID = process.env.BUILD_ID || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function buildVersion(): Plugin {
  return {
    name: "build-version",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), buildVersion()],
  define: {
    __BUILD_ID__: JSON.stringify(command === "build" ? BUILD_ID : "dev"),
  },
  server: {
    host: true, // expose on LAN for phone testing in dev
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/api": "http://localhost:3000",
    },
  },
}));
