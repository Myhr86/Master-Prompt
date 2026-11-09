import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-tester. Kjører mot produksjonsbygget (`next start`).
 * Uten E2E_OWNER_EMAIL/E2E_OWNER_PASSWORD testes kun det som ikke krever
 * innlogging (tilgangskontroll, sikkerhetshoder, mobilvisning av innlogging).
 * Med en ekte/lokal Supabase og eier-konto kjøres også hele flyten.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [
    { name: "mobil", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
