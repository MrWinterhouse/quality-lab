import { test, expect, type Page } from '@playwright/test';

async function completeScreening(page: Page) {
  await page.goto('/');
  await page.locator('#householdSize').fill('4');
  await page.locator('#monthlyIncome').fill('2000');
  await page.getByLabel('Children under 5').fill('1');
  await page.getByRole('button', { name: 'Check eligibility' }).click();
  await expect(page.getByTestId('result-medicaid')).toBeVisible();
}

test('an applicant starts an application and uploads a document', async ({ page }) => {
  await completeScreening(page);

  await page.getByRole('button', { name: 'Start an application' }).click();

  await expect(page.getByTestId('status')).toHaveText('submitted');
  await expect(page.getByTestId('deadline-date')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);

  await page.locator('#documentFile').setInputFiles({
    name: 'paystub.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake paystub'),
  });
  await page.getByRole('button', { name: 'Upload document' }).click();

  await expect(page.getByTestId('status')).toHaveText('documents pending');
  await expect(page.locator('#documentMessage')).toContainText('Uploaded');
  await expect(page.locator('#timeline li').first()).toContainText('application submitted');
});
