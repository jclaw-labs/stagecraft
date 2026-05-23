import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // Playwright owns everything under capture/. Excluding it keeps
    // `npm run test` (vitest) from picking up `capture/*.spec.ts` and
    // loading the browser-driver code into a node context.
    exclude: [...configDefaults.exclude, "capture/**"],
  },
});
