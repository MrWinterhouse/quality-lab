import { test, expect } from '@playwright/test';

test('the assistant answers a policy question with a citation', async ({ page }) => {
  await page.goto('/');

  await page.locator('#chatToggle').click();
  await expect(page.locator('#chatPanel')).toBeVisible();

  await page.getByLabel('Message').fill('Does Medicaid cover adults in California?');
  await page.getByRole('button', { name: 'Send' }).click();

  const log = page.locator('#chatLog');
  await expect(log).toContainText('Medicaid');
  await expect(log).toContainText('Source: policy/medicaid');
});
