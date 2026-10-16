import { expect, test } from '@playwright/test';

test('signed-out visitors get the landing page; its demos work and lead to sign-up and sign-in', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Run the whole school.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'How did JHS 3 do in the mocks?' }).click();
  await expect(page.locator('.lp-msg.ai')).toContainText('68.6%');
  // An evening at home: study the real lesson step by step, check it, then practise fractions and level up.
  await page.getByRole('button', { name: /Reading tables and graphs/ }).click();
  for (let step = 0; step < 7; step++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.lp-phone')).toContainText('Remember');
  await page.getByRole('button', { name: 'Check what you learned' }).click();
  await expect(page.locator('.lp-phone')).toContainText('Question 1 of 5');
  await page.getByRole('button', { name: 'Back to topics' }).click();
  await page.getByRole('button', { name: /Fractions/ }).click();
  for (const [answer, typed] of [['3/4', false], ['2/4', false], ['5', false], ['5', true], ['1/2', false]] as const) {
    if (typed) await page.getByLabel('Your answer').fill(answer);
    else await page.locator('.lp-options button', { hasText: new RegExp(`^${answer.replace('/', '\\/')}$`) }).click();
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await page.locator('.lp-phone .lp-btn').click();
  }
  await expect(page.locator('.lp-result')).toContainText('Level 2 unlocked.');
  await page.getByRole('link', { name: 'Start free' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the home page' }).click();
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(errors).toEqual([]);
});
