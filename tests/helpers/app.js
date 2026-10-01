// Shared test helpers: boot a fresh copy of the app with a controlled
// environment, capture outgoing email, and mint admin tokens.
//
// Every call to loadApp() resets the module registry, so each test file (or
// describe block) gets its own app with its own in-memory stores and rate
// limiter counters.

const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-jwt-secret-for-jest-only';

let ipCounter = 0;

// A distinct client IP per call. The app trusts one proxy hop in tests
// (TRUST_PROXY=1), so sending this as X-Forwarded-For gives each test its own
// rate-limit bucket.
function uniqueIp() {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 250) + 1}`;
}

/**
 * Load a fresh app instance.
 *
 * @param {object} options
 * @param {string} [options.mongoUri] connect to this MongoDB; omit for in-memory mode
 * @param {object} [options.env] extra env vars (use undefined to unset one)
 * @returns {{ app, sent, gmailSent, sendgrid, gmail, mongoose }}
 *   `sent` collects emails handed to SendGrid, `gmailSent` those handed to the
 *   Gmail fallback; `sendgrid`/`gmail` are the mocks, so a test can make one fail.
 */
function loadApp({ mongoUri = '', env = {} } = {}) {
  jest.resetModules();

  const sent = [];
  const gmailSent = [];
  const sendgrid = { setApiKey: jest.fn(), send: jest.fn(async (message) => { sent.push(message); }) };
  const gmail = { sendMail: jest.fn(async (message) => { gmailSent.push(message); }) };
  jest.doMock('@sendgrid/mail', () => sendgrid);
  jest.doMock('nodemailer', () => ({ createTransport: jest.fn(() => gmail) }));

  const base = {
    NODE_ENV: 'test',
    JWT_SECRET,
    // Always defined (even when empty) so nothing from a real .env can leak in
    MONGODB_URI: mongoUri,
    SENDGRID_API_KEY: 'SG.test-key',
    SENDGRID_FROM_EMAIL: 'from@example.com',
    OWNER_EMAIL: 'owner@example.com',
    // Gmail fallback is off unless a test turns it on (and never read from a real .env)
    EMAIL_USER: '',
    EMAIL_PASSWORD: '',
    TRUST_PROXY: '1',
    ADMIN_INITIAL_PASSWORD: '',
    DEV_ADMIN_PASSWORD: '',
    CLIENT_URL: ''
  };

  Object.entries({ ...base, ...env }).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });

  const app = require('../../server');
  return { app, sent, gmailSent, sendgrid, gmail, mongoose: require('mongoose') };
}

// A signed admin token. `id` only needs to be a real ObjectId string when the
// test runs against a database (the app re-checks the account there).
function tokenFor({ id = 'test-admin-id', username = 'tester', role = 'admin' } = {}) {
  return jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: '1h' });
}

function authHeader(options) {
  return { Authorization: `Bearer ${tokenFor(options)}` };
}

// YYYY-MM-DD, `offsetDays` from today in UTC (the app stores dates as UTC)
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function validBooking(overrides = {}) {
  return {
    name: 'Test Customer',
    email: 'customer@example.com',
    phone: '+2348012345678',
    country: 'Nigeria',
    service: 'bridal',
    date: isoDate(5),
    time: '10:00',
    ...overrides
  };
}

// Poll until `check()` returns truthy (emails are sent in the background)
async function waitFor(check, { timeout = 3000, interval = 20 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

module.exports = { JWT_SECRET, loadApp, tokenFor, authHeader, isoDate, validBooking, uniqueIp, waitFor };
