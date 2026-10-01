const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, adminLogin } = require('./helpers');

// Automated accessibility scan (WCAG 2 A/AA rules). Automated checks catch
// only part of what matters (contrast, labels, roles, names), so treat a pass
// as "no known violations", not "fully accessible".
//
// Only serious/critical findings fail the run.

async function scan(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} element(s), e.g. ${v.nodes[0].target.join(' ')}`);
}

// Scroll animations leave content partly transparent mid-reveal, which would
// skew colour-contrast results; scan the settled page.
test.use({ reducedMotion: 'reduce' });

test('public home page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in')));
  await page.waitForTimeout(200);
  expect(await scan(page)).toEqual([]);
});

test('the booking confirmation dialog has no serious violations', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    showConfirmationModal({ bookingNumber: 'MKP-01001', name: 'A', phone: '08012345678', country: 'Nigeria', email: 'a@example.com', service: 'bridal', date: new Date().toISOString() });
  });
  await page.waitForTimeout(400);
  expect(await scan(page)).toEqual([]);
});

test('admin login page has no serious violations', async ({ page }) => {
  await page.goto('/admin-login.html');
  expect(await scan(page)).toEqual([]);
});

test('admin console has no serious violations', async ({ page }) => {
  await adminLogin(page);
  await expect(page.locator('#page-title')).toHaveText('Dashboard');
  expect(await scan(page)).toEqual([]);
});

test('form fields all have accessible names', async ({ page }) => {
  await page.goto('/');
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
      .map((el) => el.id || el.name || el.tagName));
  expect(unnamed).toEqual([]);
});
