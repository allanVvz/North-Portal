import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Loads real Supabase credentials (anon + service-role) the same way the app
// does locally — the e2e test seeds/asserts DB state directly via the
// service-role key, since it exercises the REAL backend, not a mock.
try {
  process.loadEnvFile(path.resolve(__dirname, ".env.local"));
} catch {
  // No .env.local (e.g. CI providing the vars directly) — ignore.
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
