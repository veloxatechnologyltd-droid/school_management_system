import { expect, test, type Page } from '@playwright/test';

// The sign-in and register pages are the first thing a school sees: each is one screen, the form works,
// the product pictures load, and an API outage says what happened instead of "changes may not have been saved".
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const loadAllImages = async (page: Page) => {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(done => setTimeout(done, 80)); }
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => [...document.images].filter(image => !image.complete || image.naturalWidth === 0).length)).toBe(0);
};

test('sign-in is one screen with nothing to scroll to, and the password can be shown and hidden', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[1440, 900], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/#/signin');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await loadAllImages(page);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${width}x${height} fits one screen`).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/signin');
  expect(await noOverflow(page)).toBe(true);
  // The password can be shown and hidden without changing the field's name.
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('a-long-secret-phrase');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  expect(errors).toEqual([]);
});

test('register is one screen with nothing to scroll to, counts the password and moves back to sign-in', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[1440, 900], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/#/signin');
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page).toHaveURL(/#\/register$/);
    await loadAllImages(page);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${width}x${height} fits one screen`).toBe(true);
  }
  const password = page.getByLabel('Password (at least 12 characters)', { exact: true });
  await password.fill('short');
  await expect(page.getByText('5 of 12 characters')).toBeVisible();
  await password.fill('a-long-secret-phrase');
  await expect(page.getByText('Long enough')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  // The password typed on one page is not carried to the other.
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  expect(errors).toEqual([]);
});

test('an outage says what happened on the page, for sign-in and for a new account', async ({ page }) => {
  await page.route('**/api/v1/auth/login', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
  await page.route('**/api/v1/auth/register', route => route.fulfill({ status: 502, contentType: 'text/plain', body: 'bad gateway' }));
  await page.goto('/#/signin');
  await page.getByLabel('Email or phone number', { exact: true }).fill('nobody@example.test');
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'you were not signed in' })).toBeVisible();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your full name', { exact: true }).fill('Esi Owusu');
  await page.getByLabel('School name', { exact: true }).fill('Outage School');
  await page.getByLabel('Email', { exact: true }).fill('esi@example.test');
  await page.getByLabel('Password (at least 12 characters)', { exact: true }).fill('a-long-secret-phrase');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'may not have been created' })).toBeVisible();
});
