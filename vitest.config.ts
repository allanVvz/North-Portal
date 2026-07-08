import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    // e2e/** runs under Playwright (npm run test:e2e), not vitest.
    exclude: ["**/node_modules/**", "e2e/**"],
  },
});
