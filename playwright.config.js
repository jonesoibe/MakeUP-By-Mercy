// End-to-end browser tests. They start their own copy of the app (in-memory
// storage, no email) on a separate port, so they never touch real data.
//
//   npm run test:e2e
//
// First time on a machine: `npx playwright install chromium`, or point at a
// browser you already have, e.g.  PW_CHANNEL=chrome npm run test:e2e
//   (PowerShell:  $env:PW_CHANNEL = 'chrome'; npm run test:e2e)

const { defineConfig, devices } = require('@playwright/test');

const PORT = 3210;
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',

  // The app keeps state in memory and the tests share one server, so run
  // them one at a time, in file order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.js/,
      use: { ...devices['Pixel 7'] }
    }
  ],

  webServer: {
    command: 'node server.js',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      NODE_ENV: 'test', // quiet logs, never reads a real .env
      PORT: String(PORT),
      TRUST_PROXY: '1', // so each test's X-Forwarded-For counts as its own visitor
      JWT_SECRET: 'e2e-jwt-secret',
      MONGODB_URI: '',
      SENDGRID_API_KEY: '',
      DEV_ADMIN_PASSWORD: 'e2e-admin-password'
    }
  }
});
