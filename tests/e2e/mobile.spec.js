const { test, expect } = require('./helpers');
const { isoDate } = require('./helpers');

// Runs in the "mobile" project (Pixel 7 viewport, touch).

test.describe('mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('the page does not scroll sideways', async ({ page }) => {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });

  test('the desktop links are replaced by a menu button', async ({ page }) => {
    await expect(page.locator('.nav-links')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  });

  test('the menu opens, and its button stays reachable so it can be closed', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Menu' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#mobilePanel')).toHaveClass(/open/);
    await expect(page.locator('#mobilePanel').getByRole('link', { name: 'Services' })).toBeVisible();

    // Regression: the full-screen panel once covered the button, trapping the
    // user in the menu. Wait for the slide-down to finish (that's when it would
    // cover the button); Playwright only clicks if the button receives the tap.
    await expect(page.locator('#mobilePanel')).toHaveCSS('clip-path', 'inset(0px)');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#mobilePanel')).not.toHaveClass(/open/);
  });

  test('Escape closes the menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('#mobilePanel')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#mobilePanel')).not.toHaveClass(/open/);
  });

  test('choosing a link closes the menu and goes to that section', async ({ page }) => {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.locator('#mobilePanel').getByRole('link', { name: 'Pricing' }).click();
    await expect(page.locator('#mobilePanel')).not.toHaveClass(/open/);
    await expect(page.locator('#pricing')).toBeInViewport({ ratio: 0.1 });
    // Page scrolling is restored after the menu closes
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('a customer can complete a booking on a phone', async ({ page }) => {
    await page.fill('#name', 'Phone Customer');
    await page.fill('#email', 'phone@example.com');
    await page.fill('#phone', '08012345678');
    await page.selectOption('#service', 'casual');
    await page.fill('#date', isoDate(14));
    await page.selectOption('#time', '13:30');
    await page.getByRole('button', { name: /book appointment/i }).click();

    await expect(page.locator('#confirmationModal')).toHaveClass(/show/);
    await expect(page.locator('#bookingNumber')).toHaveText(/^[A-Z]{3}-\d{8}-\d{4}-\d{2}$/);
    // The confirmation fits the screen and its buttons can be reached
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#confirmationModal')).not.toHaveClass(/show/);
  });

  test('touch targets for the main controls are at least 44px', async ({ page }) => {
    const small = await page.evaluate(() => {
      const selectors = ['#menuToggle', '.circle-cta i', '.form-submit'];
      return selectors
        .map((s) => ({ s, r: document.querySelector(s).getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ s, r }) => `${s} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    expect(small).toEqual([]);
  });
});
