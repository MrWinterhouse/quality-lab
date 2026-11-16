import { test, expect } from '@playwright/test';

test('a family completes the screener and sees every enabled program', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'See what you may qualify for' })).toBeVisible();
  await expect(page).toHaveTitle(/Benefits screener/i);

  await page.locator('#householdSize').fill('4');
  await page.locator('#monthlyIncome').fill('2000');
  await page.getByLabel('Children under 5').fill('1');
  await page.getByRole('button', { name: 'Check eligibility' }).click();

  const results = page.locator('#results');
  await expect(results).toBeVisible();
  await expect(page.locator('#resultsSummary')).toContainText('74.7% of the federal poverty level');

  for (const program of ['medicaid', 'snap', 'wic', 'chip']) {
    const card = page.getByTestId(`result-${program}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('likely eligible');
  }

  await expect(page.getByRole('button', { name: 'Start an application' })).toBeVisible();
});
