import { defineConfig, devices } from "@playwright/test";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres@localhost:54329/visitas_e2e";
const PORT = 3200;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // macOS 12 não tem Chromium do Playwright; usa o Chrome instalado. Em CI Linux, remova "channel".
    channel: process.env.PW_CHANNEL === undefined ? "chrome" : process.env.PW_CHANNEL || undefined,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], channel: process.env.PW_CHANNEL === undefined ? "chrome" : process.env.PW_CHANNEL || undefined } },
    { name: "desktop", use: { viewport: { width: 1366, height: 900 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: E2E_DB,
      APP_URL: `http://localhost:${PORT}`,
      TOKEN_ENCRYPTION_KEY: "ZTJlLWtleS1lMmUta2V5LWUyZS1rZXktMTIzNDU2Nzg=",
      LOG_SILENT: "1",
    },
  },
});
