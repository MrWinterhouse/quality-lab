import { defineConfig, devices } from '@playwright/test';

const PORT = 4311;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/probes/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: 'artifacts/playwright-probes.json' }]],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node product/server/server.mjs',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), ENABLE_TEST_HOOKS: '1' },
  },
});
