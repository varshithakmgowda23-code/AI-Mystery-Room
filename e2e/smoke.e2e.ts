import { expect, test } from '@playwright/test';

test('guest opens a case and reaches the case board', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every story');

  await page
    .getByLabel('SET THE SCENE')
    .fill('A priceless painting vanished from a small-town art gallery during a charity gala.');
  await page.getByRole('button', { name: /OPEN THE CASE/ }).click();

  await expect(page).toHaveURL(/\/cases\/[a-f\d]{24}\/generating$/);
  await expect(page).toHaveURL(/\/cases\/[a-f\d]{24}$/, { timeout: 30_000 });
  await expect(page.getByText(/evidence is in/i)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('play as guest lands directly on the case archive', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /PLAY AS GUEST/ }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByText(/SIGNED IN AS GUEST/)).toBeVisible();
});
