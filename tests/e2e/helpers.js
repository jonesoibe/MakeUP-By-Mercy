const base = require('@playwright/test');

// Each test gets its own client IP (the app trusts X-Forwarded-For here, see
// playwright.config.js), so the per-visitor rate limits - 10 bookings an hour,
// 5 failed logins - apply per test instead of to the whole run, just as they
// would apply per real visitor in production. Every request a test makes, from
// the page or from `request`, carries it.
let counter = 0;
const test = base.test.extend({
  extraHTTPHeaders: async ({}, use) => {
    counter += 1;
    await use({ 'X-Forwarded-For': `10.${Math.floor(counter / 250) % 250}.${counter % 250}.${(Date.now() % 250) + 1}` });
  }
});
const { expect } = base;

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'e2e-admin-password'; // matches playwright.config.js

// YYYY-MM-DD, `offsetDays` from today (UTC, the way the app stores dates)
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function bookingData(overrides = {}) {
  return {
    name: 'E2E Customer',
    email: 'e2e@example.com',
    phone: '+2348012345678',
    country: 'Nigeria',
    service: 'bridal',
    date: isoDate(10),
    ...overrides
  };
}

// Create a booking through the public API (faster than filling the form)
async function seedBooking(request, overrides) {
  const res = await request.post('/api/bookings', { data: bookingData(overrides) });
  if (res.status() !== 201) throw new Error(`Seeding booking failed: ${res.status()} ${await res.text()}`);
  return (await res.json()).booking;
}

async function adminLogin(page) {
  await page.goto('/admin-login.html');
  await page.fill('#username', ADMIN_USER);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('#login-btn');
  await page.waitForURL('**/admin.html');
}

// Get an API token directly (for setting up state without the UI)
async function adminToken(request) {
  const res = await request.post('/api/admin/login', { data: { username: ADMIN_USER, password: ADMIN_PASSWORD } });
  return (await res.json()).token;
}

module.exports = { test, expect, ADMIN_USER, ADMIN_PASSWORD, isoDate, bookingData, seedBooking, adminLogin, adminToken };
