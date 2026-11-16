import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('DEFECT-12: the screener has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  const summary = blocking.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
  }));

  expect(blocking, JSON.stringify(summary, null, 2)).toEqual([]);
});
