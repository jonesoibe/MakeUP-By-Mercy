const request = require('supertest');
const { loadApp, authHeader, validBooking, uniqueIp, waitFor } = require('./helpers/app');

const GMAIL = { EMAIL_USER: 'mercy@gmail.com', EMAIL_PASSWORD: 'app-password-for-tests' };

const book = (app, overrides) =>
  request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp()).send(validBooking(overrides));

describe('email delivery with a Gmail fallback', () => {
  test('SendGrid is used first when both are configured', async () => {
    const { app, sent, gmailSent } = loadApp({ env: GMAIL });
    await book(app, { email: 'first@example.com' });
    await waitFor(() => sent.length >= 2);
    expect(sent.map((m) => m.to).sort()).toEqual(['first@example.com', 'owner@example.com']);
    expect(gmailSent).toEqual([]);
  });

  test('when SendGrid fails the message goes out through Gmail instead', async () => {
    const { app, sendgrid, gmailSent } = loadApp({ env: GMAIL });
    sendgrid.send.mockRejectedValue(new Error('SendGrid is down'));

    const res = await book(app, { email: 'fallback@example.com' });
    expect(res.status).toBe(201);

    await waitFor(() => gmailSent.length >= 2);
    expect(gmailSent.map((m) => m.to).sort()).toEqual(['fallback@example.com', 'owner@example.com']);
    const mail = gmailSent.find((m) => m.to === 'fallback@example.com');
    expect(mail.from).toBe('"MakeUP By Mercy" <mercy@gmail.com>');
    expect(mail.subject).toMatch(/Booking Confirmed/);
    expect(mail.html).toContain('Test Customer');
  });

  test('Gmail alone is enough when SendGrid is not configured', async () => {
    const { app, sendgrid, gmailSent } = loadApp({ env: { ...GMAIL, SENDGRID_API_KEY: '' } });
    await book(app, { email: 'gmail-only@example.com' });
    await waitFor(() => gmailSent.length >= 2);
    expect(sendgrid.send).not.toHaveBeenCalled();
    expect(gmailSent.some((m) => m.to === 'gmail-only@example.com')).toBe(true);
  });

  test('a failing SendGrid with no Gmail configured never tries Gmail, and the booking still succeeds', async () => {
    const { app, sendgrid, gmail } = loadApp();
    sendgrid.send.mockRejectedValue(new Error('SendGrid is down'));
    const res = await book(app);
    expect(res.status).toBe(201);
    await waitFor(() => sendgrid.send.mock.calls.length >= 2);
    expect(gmail.sendMail).not.toHaveBeenCalled();
  });

  test('if both providers fail the booking is still confirmed to the customer', async () => {
    const { app, sendgrid, gmail } = loadApp({ env: GMAIL });
    sendgrid.send.mockRejectedValue(new Error('SendGrid is down'));
    gmail.sendMail.mockRejectedValue(new Error('Gmail rejected the login'));
    const res = await book(app);
    expect(res.status).toBe(201);
    await waitFor(() => gmail.sendMail.mock.calls.length >= 2);
  });

  test('with no provider configured nothing is sent and booking still works', async () => {
    const { app, sendgrid, gmail } = loadApp({ env: { SENDGRID_API_KEY: '' } });
    const res = await book(app);
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 100));
    expect(sendgrid.send).not.toHaveBeenCalled();
    expect(gmail.sendMail).not.toHaveBeenCalled();
  });

  test('an admin message to a customer also uses the fallback', async () => {
    const { app, sendgrid, gmailSent } = loadApp({ env: GMAIL });
    await book(app, { email: 'msg@example.com' });
    const id = (await request(app).get('/api/admin/bookings').set(authHeader())).body.bookings[0]._id;
    sendgrid.send.mockRejectedValue(new Error('SendGrid is down'));
    gmailSent.length = 0;

    await request(app).post(`/api/admin/bookings/${id}/message`).set(authHeader()).send({ message: 'See you soon' }).expect(200);
    await waitFor(() => gmailSent.length === 1);
    expect(gmailSent[0].to).toBe('msg@example.com');
  });
});

describe('email status and test send (admin)', () => {
  test('system status shows which providers are configured without revealing any secret', async () => {
    const { app } = loadApp({ env: GMAIL });
    const res = await request(app).get('/api/admin/system-status').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.email).toMatchObject({ sendgrid: true, gmailFallback: true, order: ['sendgrid', 'gmail'] });
    expect(res.body.email.ownerNotifications).toBe('o***@example.com');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('app-password-for-tests');
    expect(text).not.toContain('SG.test-key');
    expect(text).not.toContain('owner@example.com');
  });

  test('status reports a missing Gmail fallback', async () => {
    const { app } = loadApp();
    const res = await request(app).get('/api/admin/system-status').set(authHeader());
    expect(res.body.email).toMatchObject({ sendgrid: true, gmailFallback: false, order: ['sendgrid'] });
  });

  test('status needs an admin login', async () => {
    const { app } = loadApp();
    expect((await request(app).get('/api/admin/system-status')).status).toBe(401);
  });

  test('status says plainly that, without a database, bookings live in server memory', async () => {
    const { app } = loadApp();
    const res = await request(app).get('/api/admin/system-status').set(authHeader());
    expect(res.body.database).toMatchObject({ configured: false, state: 'memory' });
    expect(res.body.database.note).toMatch(/lost on restart/);
  });

  test('the test email goes to the owner and reports the provider that delivered it', async () => {
    const { app, sent } = loadApp({ env: GMAIL });
    const res = await request(app).post('/api/admin/email/test').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, provider: 'sendgrid', sentTo: 'o***@example.com' });
    expect(sent[0].to).toBe('owner@example.com');
  });

  test('the test email reports Gmail when SendGrid is failing', async () => {
    const { app, sendgrid, gmailSent } = loadApp({ env: GMAIL });
    sendgrid.send.mockRejectedValue(new Error('SendGrid is down'));
    const res = await request(app).post('/api/admin/email/test').set(authHeader());
    expect(res.body.provider).toBe('gmail');
    expect(gmailSent[0].to).toBe('owner@example.com');
  });

  test('when everything fails the error is explained', async () => {
    const { app, sendgrid, gmail } = loadApp({ env: GMAIL });
    sendgrid.send.mockRejectedValue(new Error('Invalid API key'));
    gmail.sendMail.mockRejectedValue(new Error('Invalid login'));
    const res = await request(app).post('/api/admin/email/test').set(authHeader());
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/SendGrid: Invalid API key/);
    expect(res.body.message).toMatch(/Gmail: Invalid login/);
  });

  test('with no provider configured the test says so', async () => {
    const { app } = loadApp({ env: { SENDGRID_API_KEY: '' } });
    const res = await request(app).post('/api/admin/email/test').set(authHeader());
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/No email provider configured/);
  });

  test('only an admin may send a test email', async () => {
    const { app } = loadApp();
    expect((await request(app).post('/api/admin/email/test').set(authHeader({ role: 'manager' }))).status).toBe(403);
    expect((await request(app).post('/api/admin/email/test')).status).toBe(401);
  });
});

describe('database in use', () => {
  const unreachable = 'mongodb://127.0.0.1:1/unreachable?serverSelectionTimeoutMS=300';

  test('health reports where bookings are being kept', async () => {
    const { app } = loadApp();
    const res = await request(app).get('/api/health');
    expect(res.body).toEqual({ status: 'Server is running', database: 'memory' });
  });

  test('a database that is configured but down refuses bookings instead of keeping them in memory', async () => {
    const { app, mongoose } = loadApp({ mongoUri: unreachable });
    const health = await request(app).get('/api/health');
    expect(health.body.database).toBe('disconnected');

    const res = await book(app);
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/temporarily unavailable/i);
    expect(res.body.booking).toBeUndefined();
    await mongoose.disconnect().catch(() => {});
  });
});
