import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import packageJson from "./package.json" with { type: "json" };

/**
 * Frontend test setup.
 *
 * `jsdom` because every view is a DOM component; `__APP_VERSION__` is stubbed
 * here as well so components that read it (sidebar, Settings → About) render
 * without the Vite build-time define.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
  },
});
