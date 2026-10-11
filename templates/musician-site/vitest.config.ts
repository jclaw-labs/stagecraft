import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defaultServerConditions } from "vite";

export default defineConfig({
  plugins: [react()],
  // `#lib/…`, `#components/…` and `#puck/…` resolve through the
  // `imports` field in package.json. Its `source` condition maps them to
  // `src/` so tests run against the source, not the `dist/` build.
  // Setting `conditions` replaces Vite's defaults, so keep them.
  resolve: {
    conditions: [...defaultClientConditions, "source"],
  },
  ssr: {
    resolve: {
      conditions: [...defaultServerConditions, "source"],
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright owns everything under e2e/ and capture/. Excluding them
    // (on top of vitest's built-in defaults) keeps `npm run test` from
    // picking up those `.spec.ts` files and loading the browser-driver
    // code into a node context.
    exclude: [...configDefaults.exclude, "e2e/**", "capture/**"],
  },
});
