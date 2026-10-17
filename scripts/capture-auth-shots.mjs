// Captures the product screenshots shown on the sign-in and register pages from the hosted Sunrise demo school
// (synthetic students, read-only). Raw PNGs go to .local/auth-shots/raw; scripts/auth-shots-to-webp.py turns them
// into frontend/public/auth/*.webp. Logins are read from .local/demo-hosted/logins.txt and never printed.
// Usage: node scripts/capture-auth-shots.mjs [shot-name ...]   (no names = every shot)
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.DEMO_WEB ?? 'https://school-management-system-eta-lake-34.vercel.app';
const OUT = '.local/auth-shots/raw';
mkdirSync(OUT, { recursive: true });

const rows = readFileSync('.local/demo-hosted/logins.txt', 'utf8').split('\n');
const login = (label) => {
  const line = rows.find((l) => l.startsWith(label));
  if (!line) throw new Error(`No ${label} login in logins.txt`);
  const [, email, password] = line.trim().match(/(\S+@\S+)\s+(\S+)$/) ?? [];
  return { email, password };
};
const ACCOUNTS = { head: login('Headteacher'), teacher: login('Class teacher'), parent: login('Parent') };
// The hosted demo school has home practice switched off, so the parent's screens are captured from the local demo school
// (npm run dev:demo, or the API on school_demo behind the dev server). Its password is the public demo loader password.
const LOCAL = { base: process.env.DEMO_LOCAL_WEB ?? 'http://127.0.0.1:5178', email: 'parent@sunrise.demo', password: 'Demo-school-2026!' };

const DESKTOP = { width: 1100, height: 720 };
const PHONE = { width: 390, height: 780 };
// name, account, hash route, viewport, optional steps run after the page settles
const SHOTS = [
  ['head-home', 'head', '#/today', DESKTOP],
  ['head-attendance', 'head', '#/attendance', DESKTOP],
  ['head-fees', 'head', '#/accounts', DESKTOP],
  ['head-reportcards', 'head', '#/assessment', DESKTOP],
  ['head-ask', 'head', '#/ask', DESKTOP],
  ['head-notices', 'head', '#/notices', DESKTOP],
  ['head-learners', 'head', '#/students', DESKTOP],
  ['head-progress', 'head', '#/progress', DESKTOP],
  ['parent-home', 'localparent', '#/children', PHONE],
  ['parent-learn', 'localparent', '#/practice', PHONE],
  ['parent-progress', 'localparent', '#/my-progress', PHONE],
  ['parent-reports', 'localparent', '#/reports', PHONE],
];

// Shots that need a class picked first, so the screen shows real records instead of an empty first class.
// Options are matched by their start, because the separator characters in the labels vary.
const pick = (label, prefix) => async (page) => {
  const select = page.getByLabel(label).first();
  // The selects fill in after the page's data arrives, so wait for the option to appear.
  for (let tries = 0; tries < 30; tries++) {
    const text = await select.locator('option').evaluateAll((options, start) => options.map((o) => o.textContent ?? '').find((t) => t.startsWith(start)), prefix).catch(() => undefined);
    if (text) return select.selectOption({ label: text });
    await page.waitForTimeout(700);
  }
  throw new Error(`No "${prefix}" option in ${label}`);
};
const BASIC6 = 'Basic 6';
// The local demo parent's two children are Kwame Asante (JHS 3) and a KG 2 child; every parent screen shows Kwame, so the phones agree.
const kwame = pick('Linked child', 'Kwame');
const STEPS = {
  'head-attendance': [async (page) => { await page.getByLabel('Date', { exact: true }).fill('2026-10-15'); }, pick('Class', BASIC6)],
  'head-reportcards': [pick('Class', BASIC6), (page) => page.getByRole('tab', { name: 'Report cards' }).click()],
  // Performance opens on Term results, which the hosted demo has none of yet, so show the weekly Trends instead.
  'head-progress': [pick('Class', BASIC6), (page) => page.getByRole('tab', { name: 'Trends' }).click()],
  'parent-home': [kwame], 'parent-learn': [kwame], 'parent-progress': [kwame], 'parent-reports': [kwame],
};

// Pages load in phases and the free API plan is slow: wait until the page text stops changing.
async function settle(page, ms = 30_000) {
  const end = Date.now() + ms;
  let last = '', same = 0;
  while (Date.now() < end) {
    const text = await page.locator('main').first().innerText().catch(() => '');
    same = text === last && text.trim() && !/^\s*Loading/m.test(text) ? same + 1 : 0;
    last = text;
    if (same >= 5) return;
    await page.waitForTimeout(700);
  }
}

const accountFor = (account) => (account === 'localparent' ? LOCAL : { base: BASE, ...ACCOUNTS[account] });

async function signIn(browser, account, viewport) {
  const { base, email, password } = accountFor(account);
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'en-GH', timezoneId: 'Africa/Accra', reducedMotion: 'reduce' });
  // CAPTURE_AT=<ISO time> pins the browser clock so a re-capture keeps the day and greeting of the first one.
  if (process.env.CAPTURE_AT) await context.clock.setFixedTime(new Date(process.env.CAPTURE_AT));
  const page = await context.newPage();
  await page.goto(`${base}/#/signin`);
  await page.getByLabel('Email or phone number', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForSelector('.shell .sidebar', { timeout: 120_000 });
  return { context, page };
}

const wanted = process.argv.slice(2);
const shots = SHOTS.filter(([name]) => !wanted.length || wanted.includes(name));
const browser = await chromium.launch();
const sessions = new Map();
try {
  for (const [name, account, route, viewport] of shots) {
    const key = `${account}:${viewport.width}`;
    if (!sessions.has(key)) sessions.set(key, await signIn(browser, account, viewport));
    const { page } = sessions.get(key);
    await page.evaluate((hash) => { location.hash = hash; }, route);
    await page.waitForTimeout(600);
    await settle(page);
    for (const step of STEPS[name] ?? []) {
      try { await step(page); await page.waitForTimeout(500); await settle(page, 20_000); }
      catch (error) { console.log('step failed for', name, String(error.message).split('\n')[0]); }
    }
    // The read-only demo banner and the dev server's local note are about the setup, not the product. Hide them rather than
    // remove them: the page is React's, and a removed node breaks the next navigation.
    await page.evaluate(() => { for (const p of document.querySelectorAll('p[role=status], .local-note')) if (p.classList.contains('local-note') || p.textContent?.startsWith('Demo school')) p.style.display = 'none'; });
    await page.evaluate(() => { window.scrollTo(0, 0); (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('captured', name);
  }
} finally {
  for (const { context } of sessions.values()) await context.close();
  await browser.close();
}
