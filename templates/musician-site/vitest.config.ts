import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright owns everything under e2e/ and capture/. Excluding
    // them here keeps `npm run test` (vitest) from picking up those
    // `.spec.ts` files and double-loading the browser-driver code into
    // a node context.
    exclude: [
      "node_modules/**",
      "e2e/**",
      "capture/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
});
