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

const zlib = require('zlib');

// A real, decodable PNG (flat colour) of any size - for upload tests without
// needing image files in the repo.
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function makePng(width, height, [r, g, b] = [200, 120, 110]) {
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * stride + 1 + x * 3;
      raw[i] = (r + x) % 256;
      raw[i + 1] = (g + y) % 256;
      raw[i + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

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
    time: '11:00',
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

module.exports = { makePng, test, expect, ADMIN_USER, ADMIN_PASSWORD, isoDate, bookingData, seedBooking, adminLogin, adminToken };
