import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: 'tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    browserName: 'chromium',
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.015 } },
  webServer: [
    {
      command: 'pnpm --filter @work/api dev',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @work/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm fake:feishu',
      url: 'http://localhost:4001/health',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
