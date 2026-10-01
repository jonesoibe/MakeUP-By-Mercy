const { test, expect } = require('./helpers');

test.describe('page content and navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('the hero loads with the headline and a booking call to action', async ({ page }) => {
    await expect(page).toHaveTitle(/MakeUP By Mercy/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Beautiful');
    await expect(page.getByRole('link', { name: /book an appointment/i })).toBeVisible();
  });

  test('every image on the page loads', async ({ page }) => {
    // Lazy images only load near the viewport, so bring each one into view
    // (instant scrolling: the page's smooth-scroll would otherwise lag behind)
    // (the photo-upload preview <img> has no source until a photo is chosen)
    const images = page.locator('img[src]:not([src=""])');
    const count = await images.count();
    for (let i = 0; i < count; i += 1) {
      await images.nth(i).evaluate((img) => img.scrollIntoView({ behavior: 'instant', block: 'center' }));
      await expect.poll(
        () => images.nth(i).evaluate((img) => img.complete && img.naturalWidth > 0),
        { message: `image ${i} failed to load`, timeout: 10000 }
      ).toBe(true);
    }
    expect(count).toBeGreaterThanOrEqual(8);
  });

  test('the navigation bar turns solid once you scroll', async ({ page }) => {
    await expect(page.locator('#nav')).not.toHaveClass(/scrolled/);
    await page.mouse.wheel(0, 600);
    await expect(page.locator('#nav')).toHaveClass(/scrolled/);
  });

  test('nav links scroll to their section and highlight', async ({ page }) => {
    await page.locator('.nav-links').getByRole('link', { name: 'Pricing' }).click();
    await expect(page.locator('#pricing')).toBeInViewport({ ratio: 0.1 });
    await expect(page.locator('.nav-links a[href="#pricing"]')).toHaveClass(/active/);
  });

  test('the footer "Back to top" returns to the hero', async ({ page }) => {
    await page.locator('#contact').scrollIntoViewIfNeeded();
    await page.getByRole('link', { name: /back to top/i }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
  });

  test('sections reveal as they scroll into view', async ({ page }) => {
    const card = page.locator('.service-card').first();
    await expect(card).not.toHaveClass(/is-in/);
    await page.locator('#services').scrollIntoViewIfNeeded();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveClass(/is-in/);
    await expect(card).toHaveCSS('opacity', '1');
  });
});

test.describe('page health', () => {
  // The per-test X-Forwarded-For header would make the browser's cross-origin
  // font requests fail their CORS check, which is a test artefact, so this
  // check runs without it (it makes no bookings, so rate limits don't matter).
  test.use({ extraHTTPHeaders: {} });

  test('no console errors or failed requests on load', async ({ page }) => {
    const problems = [];
    page.on('console', (msg) => { if (msg.type() === 'error') problems.push(msg.text()); });
    page.on('requestfailed', (req) => problems.push(`failed: ${req.url()}`));
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Third-party font CDNs may be unreachable in a sandbox; the app's own requests must not fail
    expect(problems.filter((p) => !/fonts\.(googleapis|gstatic)\.com/.test(p))).toEqual([]);
  });
});

test.describe('FAQ', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#faq').scrollIntoViewIfNeeded();
  });

  const visibleItems = (page) => page.locator('.faq-item:not(.hidden)');

  test('questions expand and collapse', async ({ page }) => {
    const first = page.locator('.faq-item').first();
    const button = first.locator('.faq-question');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(first.locator('.faq-answer')).not.toBeInViewport();

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(first.locator('.faq-answer')).toBeInViewport();

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('the category filter narrows the list', async ({ page }) => {
    await expect(visibleItems(page)).toHaveCount(6);
    await page.getByRole('button', { name: 'Booking' }).click();
    await expect(visibleItems(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'All' }).click();
    await expect(visibleItems(page)).toHaveCount(6);
  });

  test('search matches questions and answers', async ({ page }) => {
    await page.fill('#faqSearch', 'cancellation');
    await expect(visibleItems(page)).toHaveCount(1);
    await expect(visibleItems(page).first()).toContainText(/cancellation policy/i);

    await page.fill('#faqSearch', 'hypoallergenic'); // only appears in an answer
    await expect(visibleItems(page)).toHaveCount(1);

    await page.fill('#faqSearch', 'zzzz-no-match');
    await expect(visibleItems(page)).toHaveCount(0);
  });
});

test.describe('testimonials', () => {
  test('the next and previous buttons move between quotes', async ({ page }) => {
    await page.goto('/');
    await page.locator('#testimonials').scrollIntoViewIfNeeded();

    const count = page.locator('#quoteCount');
    await expect(count).toHaveText('01 / 03');
    await expect(page.locator('.quote.is-active')).toContainText('Jennifer M.');

    await page.getByRole('button', { name: 'Next testimonial' }).click();
    await expect(count).toHaveText('02 / 03');
    await expect(page.locator('.quote.is-active')).toContainText('Amina K.');

    await page.getByRole('button', { name: 'Previous testimonial' }).click();
    await page.getByRole('button', { name: 'Previous testimonial' }).click();
    await expect(count).toHaveText('03 / 03'); // wraps around
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('all content is still visible without animations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.hero h1 .line > span').first()).toHaveCSS('transform', 'none');

    const card = page.locator('.service-card').first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveCSS('opacity', '1');
    await expect(card).toHaveCSS('filter', 'none');
  });
});
