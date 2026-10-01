const fs = require('fs');
const { test, expect } = require('./helpers');
const { isoDate } = require('./helpers');

async function fillBookingForm(page, overrides = {}) {
  const data = {
    name: 'Ada Obi',
    email: 'ada@example.com',
    phone: '08012345678',
    service: 'bridal',
    date: isoDate(12),
    ...overrides
  };
  await page.fill('#name', data.name);
  await page.fill('#email', data.email);
  await page.fill('#phone', data.phone);
  await page.selectOption('#service', data.service);
  await page.fill('#date', data.date);
  return data;
}

test.describe('booking flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('a customer can book and sees a confirmation with their details', async ({ page }) => {
    await fillBookingForm(page);
    await page.getByRole('button', { name: /book appointment/i }).click();

    const modal = page.locator('#confirmationModal');
    await expect(modal).toHaveClass(/show/);
    await expect(page.locator('#bookingNumber')).toHaveText(/^MKP-\d{5}$/);
    await expect(page.locator('#confirmationDetails')).toContainText('Ada Obi');
    await expect(page.locator('#confirmationDetails')).toContainText('ada@example.com');
    await expect(page.locator('#confirmationDetails')).toContainText('Bridal');

    // The form is cleared after a successful booking
    await expect(page.locator('#name')).toHaveValue('');
  });

  test('the confirmation lets the customer download their PDF receipt and QR code', async ({ page }) => {
    await fillBookingForm(page, { email: 'receipt@example.com' });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await expect(page.locator('#confirmationModal')).toHaveClass(/show/);

    // PDF
    const [pdf] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click()
    ]);
    expect(pdf.suggestedFilename()).toMatch(/^booking-MKP-\d{5}\.pdf$/);
    expect(fs.readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe('%PDF-');

    // QR code
    await page.getByRole('button', { name: 'Get QR code' }).click();
    await expect(page.locator('#qrCodeDisplay img')).toBeVisible();
  });

  test('Copy ID confirms it copied, and Close dismisses the confirmation', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await fillBookingForm(page, { email: 'copy@example.com' });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await expect(page.locator('#confirmationModal')).toHaveClass(/show/);

    const number = await page.locator('#bookingNumber').textContent();
    await page.getByRole('button', { name: 'Copy ID' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(number);

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#confirmationModal')).not.toHaveClass(/show/);
  });

  test('Escape closes the confirmation', async ({ page }) => {
    await fillBookingForm(page, { email: 'esc@example.com' });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await expect(page.locator('#confirmationModal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirmationModal')).not.toHaveClass(/show/);
  });

  test('submitting an empty form shows every required-field error and sends nothing', async ({ page }) => {
    let bookingRequests = 0;
    page.on('request', (req) => { if (req.method() === 'POST' && req.url().endsWith('/api/bookings')) bookingRequests += 1; });

    await page.getByRole('button', { name: /book appointment/i }).click();
    for (const id of ['nameError', 'emailError', 'phoneError', 'serviceError', 'dateError']) {
      await expect(page.locator(`#${id}`)).toHaveClass(/show/);
    }
    expect(bookingRequests).toBe(0);
    await expect(page.locator('#confirmationModal')).not.toHaveClass(/show/);
  });

  test('field errors explain what is wrong, and clear once fixed', async ({ page }) => {
    await page.fill('#email', 'not-an-email');
    await expect(page.locator('#emailError')).toContainText(/valid email/i);
    await page.fill('#email', 'ok@example.com');
    await expect(page.locator('#emailError')).not.toHaveClass(/show/);

    await page.fill('#phone', '123');
    await expect(page.locator('#phoneError')).toContainText(/10-20/);
    await page.fill('#phone', '08012345678');
    await expect(page.locator('#phoneError')).not.toHaveClass(/show/);

    await page.fill('#date', isoDate(-3));
    await page.locator('#date').blur();
    await expect(page.locator('#dateError')).toContainText(/future date/i);
  });

  test('"Book party" in the pricing list pre-selects the service in the form', async ({ page }) => {
    await page.locator('a[data-service="party"]').click();
    await expect(page.locator('#service')).toHaveValue('party');
    await expect(page).toHaveURL(/#booking$/);
  });

  test('a server-side rejection is shown to the customer instead of failing silently', async ({ page }) => {
    // Force the API to reject the booking with a field-level validation error
    await page.route('**/api/bookings', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Validation error', errors: [{ field: 'phone', message: 'Phone looks wrong' }] }) })
      : route.continue());

    await fillBookingForm(page, { email: 'reject@example.com' });
    const dialog = page.waitForEvent('dialog');
    await page.getByRole('button', { name: /book appointment/i }).click();
    expect((await dialog).message()).toContain('Phone looks wrong');
    await (await dialog).dismiss();
    // The button is usable again so the customer can retry
    await expect(page.getByRole('button', { name: /book appointment/i })).toBeEnabled();
  });
});
