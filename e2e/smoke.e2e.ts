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

test('play as guest lands on an empty archive with the keep-your-cases form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /PLAY AS GUEST/ }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByText(/Signed in as guest/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keep your cases' })).toBeVisible();
  await expect(page.getByText('No cases yet.')).toBeVisible();
});

test('full playthrough: wrong guess, right guess, verdict, history and public link', async ({ page, isMobile }) => {
  const errors = trackConsoleErrors(page);
  await openNewCase(page);
  if (isMobile) await page.getByRole('button', { name: /^Evidence/ }).click();
  await page.getByRole('button', { name: /Planning chat: Mara & Theo/ }).click();

  // Wrong suspect first: generic nudge, no spoiler, one attempt left.
  await page.getByRole('button', { name: 'Make accusation' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Mara Ellis').click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText(/You have 2 attempts left/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Accuse Mara Ellis' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Not quite.');
  await expect(dialog.getByRole('alert')).toContainText('1 attempt left');
  await expect(dialog.getByText('Already accused')).toBeVisible();

  // Correct suspect.
  await dialog.getByText('Theo Venn').click();
  await dialog.getByRole('textbox', { name: /reasoning/ }).fill('The cart checkout contradicts his chat.');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Accuse Theo Venn' }).click();

  await expect(page).toHaveURL(/\/cases\/[a-f\d]{24}\/verdict$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You found the culprit.');
  await expect(page.getByText(/Theo Venn/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How the clues fit' })).toBeVisible();
  await expect(page.getByText('Points to the culprit').first()).toBeVisible();
  await expect(page.getByText('−150')).toBeVisible();

  // Public link shows the result without evidence.
  await page.getByRole('button', { name: 'Create a public link to this result' }).click();
  const link = await page.getByRole('textbox', { name: 'Public link to this result' }).inputValue();
  expect(link).toMatch(/\/s\/[\w-]{22}$/);

  // History shows the solved case with its score.
  await page.getByRole('link', { name: 'My cases' }).click();
  const row = page.locator('.case-row').first();
  await expect(row).toContainText('The Bellweather Gallery Case');
  await expect(row).toContainText('Solved');
  await expect(row).toContainText('pts');

  await page.goto(new URL(link).pathname);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Bellweather Gallery Case');
  await expect(page.getByText('Solved', { exact: true })).toBeVisible();
  await expect(page.getByText('Planning chat')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('giving up reveals the answer with zero points, and a case can be deleted', async ({ page }) => {
  await openNewCase(page);
  await page.getByRole('button', { name: 'Make accusation' }).click();
  await page.getByRole('button', { name: 'Give up and reveal the answer' }).click();
  await page.getByRole('button', { name: 'Reveal the answer' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You closed the file without an answer.');
  await expect(page.locator('.verdict__score')).toContainText('0 points');

  await page.getByRole('link', { name: 'My cases' }).click();
  const rows = page.locator('.case-row');
  await expect(rows.first()).toContainText('Closed without an answer');
  const before = await rows.count();
  await rows
    .first()
    .getByRole('button', { name: /^Delete/ })
    .click();
  await rows.first().getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows).toHaveCount(before - 1);
});
