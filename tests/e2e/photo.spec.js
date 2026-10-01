const { test, expect, makePng, adminLogin, isoDate } = require('./helpers');

async function fillBookingForm(page, overrides = {}) {
  const data = { name: 'Photo Person', email: 'photo@example.com', phone: '08012345678', service: 'bridal', date: isoDate(12), time: '10:00', ...overrides };
  await page.fill('#name', data.name);
  await page.fill('#email', data.email);
  await page.fill('#phone', data.phone);
  await page.selectOption('#service', data.service);
  await page.fill('#date', data.date);
  await page.selectOption('#time', data.time);
  return data;
}

const png = (name, width = 400, height = 300) => ({ name, mimeType: 'image/png', buffer: makePng(width, height) });

test.describe('optional photo upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('the upload is clearly optional and explains who sees the photo', async ({ page }) => {
    const field = page.locator('#photoField');
    await expect(field).toContainText('optional');
    await expect(field).toContainText(/only mercy can see it/i);
    await expect(field).toContainText(/deleted after 90 days/i);
    // not required: the form needs no photo
    await expect(page.locator('#photoInput')).not.toHaveAttribute('required', '');
  });

  test('choosing a photo shows a preview and asks for consent; Remove clears it', async ({ page }) => {
    await page.setInputFiles('#photoInput', png('look.png'));

    await expect(page.locator('#photoPreview')).toBeVisible();
    await expect(page.locator('#photoName')).toHaveText('look.png');
    await expect(page.locator('#photoSize')).toContainText(/KB/);
    await expect(page.locator('#photoConsent')).toBeVisible();
    await expect(page.locator('#photoDrop')).toBeHidden();
    await expect.poll(() => page.locator('#photoThumb').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Remove photo' }).click();
    await expect(page.locator('#photoPreview')).toBeHidden();
    await expect(page.locator('#photoConsent')).toBeHidden();
    await expect(page.locator('#photoDrop')).toBeVisible();
  });

  test('a large photo is shrunk before upload', async ({ page }) => {
    await page.setInputFiles('#photoInput', png('big.png', 2600, 1800));
    await expect(page.locator('#photoPreview')).toBeVisible();
    const width = await page.locator('#photoThumb').evaluate((img) => img.naturalWidth);
    const height = await page.locator('#photoThumb').evaluate((img) => img.naturalHeight);
    expect(Math.max(width, height)).toBeLessThanOrEqual(1200);
    expect(Math.max(width, height)).toBeGreaterThan(1000); // resized, not thumbnail-sized
  });

  test('something that is not a photo is refused with a message', async ({ page }) => {
    await page.setInputFiles('#photoInput', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('#photoError')).toHaveClass(/show/);
    await expect(page.locator('#photoError')).toContainText(/JPG, PNG or WebP/);
    await expect(page.locator('#photoPreview')).toBeHidden();
  });

  test('a file that claims to be an image but is not is refused', async ({ page }) => {
    await page.setInputFiles('#photoInput', { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not really a png') });
    await expect(page.locator('#photoError')).toContainText(/could not read/i);
    await expect(page.locator('#photoPreview')).toBeHidden();
  });

  test('a photo cannot be sent without ticking the consent box, and nothing is booked', async ({ page }) => {
    let bookingRequests = 0;
    page.on('request', (req) => { if (req.method() === 'POST' && req.url().endsWith('/api/bookings')) bookingRequests += 1; });

    await fillBookingForm(page);
    await page.setInputFiles('#photoInput', png('look.png'));
    await page.getByRole('button', { name: /book appointment/i }).click();

    await expect(page.locator('#photoError')).toContainText(/tick the box/i);
    expect(bookingRequests).toBe(0);
    await expect(page.locator('#confirmationModal')).not.toHaveClass(/show/);

    // ticking it (or removing the photo) lets the booking through
    await page.check('#photoConsentBox');
    await page.getByRole('button', { name: /book appointment/i }).click();
    await expect(page.locator('#confirmationModal')).toHaveClass(/show/);
  });

  test('booking without a photo works exactly as before', async ({ page }) => {
    const photoRequests = [];
    page.on('request', (req) => { if (req.url().includes('/photo')) photoRequests.push(req.url()); });

    await fillBookingForm(page, { email: 'nophoto@example.com' });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await expect(page.locator('#confirmationModal')).toHaveClass(/show/);
    await expect(page.locator('#photoStatus')).toBeHidden();
    expect(photoRequests).toEqual([]);
  });

  test('a booking with a photo is confirmed and tells the customer the photo was sent', async ({ page }) => {
    await fillBookingForm(page, { email: 'withphoto@example.com' });
    await page.setInputFiles('#photoInput', png('look.png'));
    await page.check('#photoConsentBox');
    await page.getByRole('button', { name: /book appointment/i }).click();

    await expect(page.locator('#confirmationModal')).toHaveClass(/show/);
    await expect(page.locator('#photoStatus')).toHaveText('Your photo was sent to Mercy.');
    // the form, including the photo choice, is reset for the next booking
    await expect(page.locator('#photoPreview')).toBeHidden();
    await expect(page.locator('#photoDrop')).toBeVisible();
  });

  test('if the upload fails the booking still stands and the customer is told', async ({ page }) => {
    await page.route('**/api/bookings/*/photo*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false}' }));

    await fillBookingForm(page, { email: 'uploadfail@example.com' });
    await page.setInputFiles('#photoInput', png('look.png'));
    await page.check('#photoConsentBox');
    await page.getByRole('button', { name: /book appointment/i }).click();

    await expect(page.locator('#confirmationModal')).toHaveClass(/show/);
    await expect(page.locator('#bookingNumber')).toHaveText(/^[A-Z]{3}-\d{8}-\d{4}-\d{2}$/);
    await expect(page.locator('#photoStatus')).toContainText(/could not upload your photo, but your booking is confirmed/i);
  });
});

test.describe('the admin sees the photo', () => {
  test('a customer\'s photo appears in the booking details, and the admin can remove it', async ({ page, browser }) => {
    // Customer books with a photo
    const customer = await browser.newPage();
    await customer.goto('/');
    await fillBookingForm(customer, { name: 'Has Photo', email: 'admin-view@example.com' });
    await customer.setInputFiles('#photoInput', png('selfie.png', 500, 400));
    await customer.check('#photoConsentBox');
    await customer.getByRole('button', { name: /book appointment/i }).click();
    await expect(customer.locator('#photoStatus')).toHaveText('Your photo was sent to Mercy.');
    const bookingNumber = (await customer.locator('#bookingNumber').textContent()).trim();
    await customer.close();

    // Mercy opens the booking
    await adminLogin(page);
    await page.getByRole('link', { name: 'Bookings' }).click();
    const row = page.locator('#bookings-table-container tr', { hasText: bookingNumber });
    await row.getByRole('button', { name: 'View' }).click();

    const photo = page.locator('#booking-photo img');
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((img) => img.naturalWidth)).toBe(500);
    await expect(photo).toHaveAttribute('alt', /customer/i);

    // Remove it
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await expect(page.locator('#booking-photo')).toHaveText('Photo removed.');

    // Reopening shows no photo section any more
    await page.keyboard.press('Escape');
    await row.getByRole('button', { name: 'View' }).click();
    await expect(page.locator('#booking-photo')).toHaveCount(0);
  });

  test('the photo is not reachable without signing in', async ({ request }) => {
    const res = await request.get('/api/admin/bookings/MKP-01001/photo');
    expect(res.status()).toBe(401);
  });

  test('a booking without a photo shows no photo section', async ({ page, request }) => {
    const res = await request.post('/api/bookings', { data: { name: 'No Photo', email: 'np@example.com', phone: '+2348012345678', service: 'casual', date: isoDate(15), time: '10:00' } });
    const { bookingNumber } = (await res.json()).booking;
    await adminLogin(page);
    await page.getByRole('link', { name: 'Bookings' }).click();
    await page.locator('#bookings-table-container tr', { hasText: bookingNumber }).getByRole('button', { name: 'View' }).click();
    await expect(page.locator('#booking-modal')).toHaveClass(/show/);
    await expect(page.locator('#booking-photo')).toHaveCount(0);
  });
});
