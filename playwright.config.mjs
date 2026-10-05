import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  workers: 2,
  globalTeardown: './tests/browser/stop-server.mjs',
  reporter: [['list'], ['json', { outputFile: '.security-qa-browser-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      ...(process.env.QA_BROWSER_PATH ? { executablePath: process.env.QA_BROWSER_PATH }
        : fs.existsSync(installedChrome) ? { executablePath: installedChrome } : {}),
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/qa-server.mjs',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
