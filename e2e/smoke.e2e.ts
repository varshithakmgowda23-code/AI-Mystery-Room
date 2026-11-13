import { expect, test, type Page } from '@playwright/test';

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openNewCase(page: Page) {
  await page.goto('/');
  await page
    .getByLabel('SET THE SCENE')
    .fill('A priceless painting vanished from a small-town art gallery during a charity gala.');
  await page.getByRole('button', { name: /OPEN THE CASE/ }).click();
  await expect(page).toHaveURL(/\/cases\/[a-f\d]{24}\/generating$/);
  await expect(page).toHaveURL(/\/cases\/[a-f\d]{24}$/, { timeout: 30_000 });
}

test('guest opens a case, examines evidence, tags a suspect and takes notes', async ({ page, isMobile }) => {
  const errors = trackConsoleErrors(page);
  await openNewCase(page);
  await expect(page.getByRole('heading', { level: 1, name: 'The Bellweather Gallery Case' })).toBeVisible();

  if (isMobile) await page.getByRole('button', { name: /^Evidence/ }).click();
  await page.getByRole('button', { name: /Planning chat: Mara & Theo/ }).click();
  await expect(page.getByRole('group', { name: /Chat between/ })).toBeVisible();
  await expect(page.getByText('1/11 examined')).toBeVisible();

  if (isMobile) await page.getByRole('button', { name: 'All evidence' }).click();
  await page.getByRole('button', { name: /CCTV: East Corridor/ }).click();
  await page.getByRole('button', { name: 'Next frame' }).click();
  await expect(page.getByText('2/3')).toBeVisible();

  if (isMobile) await page.getByRole('button', { name: /^Suspects/ }).click();
  await page.getByRole('group', { name: 'Your view of Mara Ellis' }).getByRole('button', { name: 'Cleared' }).click();
  await expect(page.locator('.stamp--cleared')).toHaveCount(1);

  if (isMobile) await page.getByRole('button', { name: /^Notebook/ }).click();
  await page.getByRole('textbox', { name: 'Notebook' }).fill('Theo contradicts the cart record.');
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 5000 });

  // Everything above must survive a reload (FR-16, FR-18, FR-19).
  await page.reload();
  if (isMobile) await page.getByRole('button', { name: /^Notebook/ }).click();
  await expect(page.getByRole('textbox', { name: 'Notebook' })).toHaveValue('Theo contradicts the cart record.');
  if (isMobile) await page.getByRole('button', { name: /^Suspects/ }).click();
  await expect(page.locator('.stamp--cleared')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('hints are revealed one at a time after confirmation', async ({ page, isMobile }) => {
  await openNewCase(page);
  if (isMobile) await page.getByRole('button', { name: /^Notebook/ }).click();
  await page.getByRole('button', { name: 'Ask for a hint' }).click();
  await page.getByRole('button', { name: 'Reveal hint' }).click();
  await expect(page.locator('.hints__list li')).toHaveCount(1);
  await expect(page.getByText('2 left')).toBeVisible();
});

test('play as guest lands directly on the case archive', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /PLAY AS GUEST/ }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByText(/SIGNED IN AS GUEST/)).toBeVisible();
});
