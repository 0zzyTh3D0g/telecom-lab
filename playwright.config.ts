import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: false, timeout: 60_000,
    env: { VITE_BASE_PATH:'/',VITE_SUPABASE_URL:process.env.E2E_SUPABASE_URL||'http://127.0.0.1:54321',VITE_SUPABASE_PUBLISHABLE_KEY:process.env.E2E_SUPABASE_PUBLISHABLE_KEY||'e2e-public-key' } },
})
