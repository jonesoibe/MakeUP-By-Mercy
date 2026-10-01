const { test, expect } = require('./helpers');
const { ADMIN_PASSWORD, seedBooking, adminLogin, adminToken, isoDate } = require('./helpers');

test.describe('admin sign-in', () => {
  test('visiting the console without signing in sends you to the login page', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL('**/admin-login.html');
  });

  test('a wrong password shows an error and does not sign in', async ({ page }) => {
    await page.goto('/admin-login.html');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'definitely-wrong');
    await page.click('#login-btn');
    await expect(page.locator('#error-message')).toHaveClass(/show/);
    await expect(page).toHaveURL(/admin-login/);
    expect(await page.evaluate(() => localStorage.getItem('adminToken'))).toBeNull();
  });

  test('the old default password is refused', async ({ page }) => {
    await page.goto('/admin-login.html');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'admin123');
    await page.click('#login-btn');
    await expect(page.locator('#error-message')).toHaveClass(/show/);
    await expect(page).toHaveURL(/admin-login/);
  });

  test('signing in opens the dashboard, and logging out returns to the login page', async ({ page }) => {
    await adminLogin(page);
    await expect(page.locator('#page-title')).toHaveText('Dashboard');
    await expect(page.locator('#admin-username-display')).toHaveText('admin');

    await page.getByRole('button', { name: /logout/i }).click();
    await page.waitForURL('**/admin-login.html');
    expect(await page.evaluate(() => localStorage.getItem('adminToken'))).toBeNull();

    // And the console is closed again
    await page.goto('/admin');
    await page.waitForURL('**/admin-login.html');
  });
});

test.describe('login page explains why sign-in failed', () => {
  const failWith = (page, status, body) => page.route('**/api/admin/login', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));

  async function trySignIn(page) {
    await page.goto('/admin-login.html');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'some-password-123');
    await page.click('#login-btn');
  }

  test('a default-password account is told why, not just "invalid"', async ({ page }) => {
    await failWith(page, 403, { success: false, message: 'This account still uses the default password. Set ADMIN_INITIAL_PASSWORD on the server and restart to reset it.' });
    await trySignIn(page);
    await expect(page.locator('#error-message')).toContainText('cannot sign in yet');
    await expect(page.locator('#error-message')).toContainText('ADMIN_INITIAL_PASSWORD');
  });

  test('a database outage is reported as an outage, not a wrong password', async ({ page }) => {
    await failWith(page, 503, { success: false, message: 'Admin login is temporarily unavailable. Please try again shortly.' });
    await trySignIn(page);
    await expect(page.locator('#error-message')).toContainText('temporarily unavailable');
    await expect(page.locator('#error-message')).not.toContainText('Invalid username or password');
  });

  test('a rate-limit lockout is explained', async ({ page }) => {
    await failWith(page, 429, { message: 'Too many login attempts, please try again later.' });
    await trySignIn(page);
    await expect(page.locator('#error-message')).toContainText('Too many login attempts');
  });

  test('a genuinely wrong password still says so, and never hints at a default password', async ({ page }) => {
    await trySignIn(page);
    await expect(page.locator('#error-message')).toContainText('Invalid username or password');
    await expect(page.locator('#error-message')).not.toContainText('admin123');
  });

  test('server-supplied text is shown as text, never as HTML', async ({ page }) => {
    await failWith(page, 403, { success: false, message: '<img src=x onerror="window.__loginXss = true">' });
    await trySignIn(page);
    await expect(page.locator('#error-message')).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__loginXss)).toBeUndefined();
  });
});

test.describe('managing bookings', () => {
  test('the dashboard counts new bookings', async ({ page, request }) => {
    await seedBooking(request, { email: 'dash1@example.com' });
    await seedBooking(request, { email: 'dash2@example.com' });
    await adminLogin(page);

    await expect.poll(async () => Number(await page.locator('#total-bookings').textContent())).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => Number(await page.locator('#confirmed-bookings').textContent())).toBeGreaterThanOrEqual(2);
  });

  test('an admin can open a booking, then cancel and re-confirm it', async ({ page, request }) => {
    const booking = await seedBooking(request, { name: 'Manage Me', email: 'manage@example.com' });
    await adminLogin(page);
    await page.getByRole('link', { name: 'Bookings' }).click();

    const row = page.locator('#bookings-table-container tr', { hasText: booking.bookingNumber });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'View' }).click();

    const modal = page.locator('#booking-modal');
    await expect(modal).toHaveClass(/show/);
    await expect(modal).toContainText('Manage Me');
    await expect(modal).toContainText('manage@example.com');

    // Cancel (the app asks for confirmation first)
    page.once('dialog', (dialog) => dialog.accept());
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#success-message')).toContainText(/cancelled successfully/i);
    await expect(modal).not.toHaveClass(/show/);
    await expect(row.locator('.status-badge')).toHaveText('cancelled');

    // Re-confirm
    await row.getByRole('button', { name: 'View' }).click();
    await modal.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('#success-message')).toContainText(/confirmed successfully/i);
    await expect(row.locator('.status-badge')).toHaveText('confirmed');
  });

  test('Escape closes the booking details', async ({ page, request }) => {
    const booking = await seedBooking(request, { email: 'esc-admin@example.com' });
    await adminLogin(page);
    await page.getByRole('link', { name: 'Bookings' }).click();
    await page.locator('#bookings-table-container tr', { hasText: booking.bookingNumber }).getByRole('button', { name: 'View' }).click();
    await expect(page.locator('#booking-modal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#booking-modal')).not.toHaveClass(/show/);
  });

  test('customer-entered HTML is shown as text and never runs in the admin console', async ({ page, request }) => {
    const payload = '<img src=x onerror="window.__xss = true">';
    const booking = await seedBooking(request, { name: payload, email: 'xss@example.com' });
    await adminLogin(page);
    await page.getByRole('link', { name: 'Bookings' }).click();

    const row = page.locator('#bookings-table-container tr', { hasText: booking.bookingNumber });
    await expect(row).toBeVisible();
    await expect(row).toContainText('<img src=x');            // shown literally
    await row.getByRole('button', { name: 'View' }).click();
    await expect(page.locator('#booking-modal')).toContainText('<img src=x');

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator('#bookings-table-container img[src="x"], #booking-details img[src="x"]').count()).toBe(0);
  });

  test('the Manage tab finds a booking by number or name', async ({ page, request }) => {
    const booking = await seedBooking(request, { name: 'Searchable Person', email: 'search@example.com' });
    await adminLogin(page);
    await page.getByRole('link', { name: 'Bookings' }).click();
    await page.getByRole('button', { name: 'Manage' }).click();

    await page.fill('#search-booking', 'Searchable');
    await expect(page.locator('#manage-content')).toContainText(booking.bookingNumber);
    await page.fill('#search-booking', 'no-such-customer-xyz');
    await expect(page.locator('#manage-content')).toContainText(/no bookings match/i);
  });
});

test.describe('settings', () => {
  test('a price changed in the admin console appears on the public site', async ({ page, browser }) => {
    await adminLogin(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Pricing', exact: true }).click();
    await expect(page.locator('#pricing-content')).toBeVisible();

    await page.fill('#price-bridal', '31000');
    await page.fill('#duration-bridal', '2 hours');
    await page.click('#save-pricing-btn');
    await expect(page.locator('#success-message')).toContainText(/pricing updated/i);

    const visitor = await browser.newPage();
    await visitor.goto('http://localhost:3210/');
    await expect(visitor.locator('#pricing-price-bridal')).toHaveText('₦31,000');
    await expect(visitor.locator('#pricing-duration-bridal')).toHaveText('2 hours');
    await visitor.close();
  });

  test('invalid pricing is rejected with a message', async ({ page }) => {
    await adminLogin(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Pricing', exact: true }).click();
    await page.fill('#price-party', '');
    await page.click('#save-pricing-btn');
    await expect(page.locator('#success-message')).toContainText(/invalid price/i);
  });

  test('saved opening hours and notice period reach the public booking page', async ({ page, browser, request }) => {
    await adminLogin(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.locator('#availability-tab')).toBeVisible();

    await page.fill('#weekday-start', '08:00');
    await page.fill('#weekday-end', '19:00');
    await page.fill('#weekend-start', '11:00');
    await page.fill('#weekend-end', '15:00');
    await page.fill('#lead-time', '2');
    await page.getByRole('button', { name: /save availability/i }).click();
    await expect(page.locator('#success-message')).toContainText(/availability updated/i);

    const visitor = await browser.newPage();
    await visitor.goto('http://localhost:3210/');
    await expect(visitor.locator('#contactHours')).toContainText('Mon–Fri 8AM to 7PM');
    await expect(visitor.locator('#contactHours')).toContainText('Sat–Sun 11AM to 3PM');
    await expect(visitor.locator('#date')).toHaveAttribute('min', isoDate(2));

    // A too-early date is blocked in the form...
    await visitor.fill('#name', 'Too Early');
    await visitor.fill('#email', 'early@example.com');
    await visitor.fill('#phone', '08012345678');
    await visitor.selectOption('#service', 'casual');
    await visitor.fill('#date', isoDate(1));
    await visitor.selectOption('#time', { index: 1 });
    await visitor.getByRole('button', { name: /book appointment/i }).click();
    await expect(visitor.locator('#dateError')).toContainText(/2 days notice/);
    await visitor.close();

    // ...and by the server, for anyone bypassing the form
    const direct = await request.post('/api/bookings', {
      data: { name: 'Direct Post', email: 'direct@example.com', phone: '+2348012345678', service: 'casual', date: isoDate(1), time: '10:00' }
    });
    expect(direct.status()).toBe(400);

    // Put things back so later tests aren't affected
    const token = await adminToken(request);
    await request.patch('/api/admin/availability', {
      headers: { Authorization: `Bearer ${token}` },
      data: { weekdayStart: '09:00', weekdayEnd: '20:00', weekendStart: '09:00', weekendEnd: '20:00', leadTimeDays: 0 }
    });
  });

  test('the email template tab loads and saves the confirmation template', async ({ page }) => {
    await adminLogin(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Email Templates' }).click();
    await expect(page.locator('#confirm-subject')).toHaveValue(/\{bookingNumber\}/);

    await page.fill('#confirm-subject', 'E2E subject for {name}');
    await page.fill('#confirm-body', 'E2E template body for booking {bookingNumber}.');
    await page.click('#save-email-template-btn');
    await expect(page.locator('#success-message')).toContainText(/saved/i);

    const res = await page.request.get('/api/email-templates/confirmation');
    expect((await res.json()).template.subject).toBe('E2E subject for {name}');
  });
});

test.describe('system status and email check', () => {
  test('Settings > System says where bookings are stored and which email providers are on', async ({ page }) => {
    await adminLogin(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'System', exact: true }).click();

    const status = page.locator('#system-status');
    // the test server has no database and no email provider
    await expect(status).toContainText('Database: ✕ Not configured');
    await expect(status).toContainText(/lost on restart/i);
    await expect(status).toContainText('SendGrid: ✕ Not configured');
    await expect(status).toContainText('Gmail fallback: ✕ Not configured');
    await expect(status).toContainText(/EMAIL_PASSWORD/);
  });

  test('"Send test email" explains why when no provider is set up', async ({ page }) => {
    await adminLogin(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'System', exact: true }).click();
    await page.getByRole('button', { name: /send test email/i }).click();
    await expect(page.locator('#test-email-result')).toContainText(/no email provider configured/i);
    await expect(page.getByRole('button', { name: /send test email/i })).toBeEnabled();
  });
});

test('the admin password used by these tests is not the old default', () => {
  expect(ADMIN_PASSWORD).not.toBe('admin123');
});
