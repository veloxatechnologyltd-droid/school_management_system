import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1390 }, deviceScaleFactor: 1 });
  await page.goto(`file://${join(here, 'flyers.html')}`);
  await page.evaluate(() => document.fonts.ready);
  for (const [id, name] of [['free', '07-free-for-schools.png'], ['parents', '08-parents-recommend.png'], ['refer', '09-referral-20-percent.png']]) {
    await page.locator(`#${id}`).screenshot({ path: join(here, name) });
  }
} finally {
  await browser.close();
}
