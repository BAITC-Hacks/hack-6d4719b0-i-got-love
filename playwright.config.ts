import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localPython = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
const python = process.env.PYTHON ?? (existsSync(localPython) ? localPython : 'python');
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:8765', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: `"${python}" scripts/test_server.py`,
    url: 'http://127.0.0.1:8765/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
