const request = require('supertest');
const { loadApp, authHeader, isoDate, validBooking, uniqueIp } = require('./helpers/app');

let app;
const book = (overrides) =>
  request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp()).send(validBooking(overrides));

beforeEach(() => { ({ app } = loadApp()); });

describe('dashboard', () => {
  const dashboard = async () => (await request(app).get('/api/admin/dashboard').set(authHeader())).body;
  const thisMonthDate = () => isoDate(0); // today is always in the current month

  test('counts bookings by status', async () => {
    await book({ date: thisMonthDate() });
    await book({ date: thisMonthDate() });
    const d = await dashboard();
    expect(d.totalBookings).toBe(2);
    expect(d.confirmedBookings).toBe(2);
    expect(d.pendingBookings).toBe(0);
  });

  test('monthly revenue uses the admin-set prices, not hard-coded ones', async () => {
    await book({ service: 'bridal', date: thisMonthDate() });
    expect((await dashboard()).monthlyRevenue).toBe(25000); // default bridal price

    await request(app).patch('/api/admin/pricing/bridal').set(authHeader()).send({ price: 40000 });
    expect((await dashboard()).monthlyRevenue).toBe(40000);
  });

  test('cancelled bookings earn no revenue', async () => {
    const a = (await request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp())
      .send(validBooking({ service: 'party', date: thisMonthDate(), email: 'a@example.com' }))).body.booking;
    await book({ service: 'casual', date: thisMonthDate(), email: 'b@example.com' });
    expect((await dashboard()).monthlyRevenue).toBe(25000); // 15000 + 10000

    const all = (await request(app).get('/api/admin/bookings').set(authHeader())).body.bookings;
    const partyId = all.find((b) => b.bookingNumber === a.bookingNumber)._id;
    await request(app).patch(`/api/admin/bookings/${partyId}/cancel`).set(authHeader());

    const d = await dashboard();
    expect(d.monthlyRevenue).toBe(10000);
    expect(d.confirmedBookings).toBe(1);
  });

  test('repeat customers are distinct people with more than one booking', async () => {
    await book({ email: 'regular@example.com', date: thisMonthDate() });
    await book({ email: 'REGULAR@example.com', date: thisMonthDate() });
    await book({ email: 'regular@example.com', date: thisMonthDate() });
    await book({ email: 'once@example.com', date: thisMonthDate() });
    expect((await dashboard()).repeatCustomers).toBe(1);
  });

  test('bookings in other months do not count towards this month\'s revenue', async () => {
    // 60 days ahead is never the current month
    await book({ date: isoDate(60) });
    expect((await dashboard()).monthlyRevenue).toBe(0);
  });
});

describe('analytics', () => {
  test('peak day is read in UTC', async () => {
    // 2030-01-01 is a Tuesday; local-time parsing in a negative-offset zone would say Monday
    await book({ date: '2030-01-01' });
    await book({ date: '2030-01-08' });
    const res = await request(app).get('/api/admin/analytics').set(authHeader());
    expect(res.body.peakDay).toBe('Tuesday');
    expect(res.body.serviceBreakdown.bridal).toBe(2);
  });
});

describe('bulk pricing', () => {
  const post = (body, options) => request(app).post('/api/admin/pricing').set(authHeader(options)).send(body);

  test('updates several services at once', async () => {
    const res = await post({ bridal: { price: 30000, duration: '2 hours' }, party: { price: 18000 } });
    expect(res.status).toBe(200);
    expect(res.body.pricing.map((p) => [p.service, p.price])).toEqual([['bridal', 30000], ['party', 18000]]);

    const check = await request(app).get('/api/admin/pricing').set(authHeader());
    expect(check.body.pricing.find((p) => p.service === 'bridal').duration).toBe('2 hours');
  });

  test('only whitelisted fields are written', async () => {
    const res = await post({ bridal: { price: 30000, updatedBy: 'hacker', service: 'party', evil: 1 } }, { username: 'owner' });
    const bridal = res.body.pricing[0];
    expect(bridal.service).toBe('bridal');
    expect(bridal.updatedBy).toBe('owner');
    expect(bridal.evil).toBeUndefined();
  });

  test.each([
    ['a negative price', { bridal: { price: -1 } }],
    ['a missing price', { bridal: { duration: '1h' } }],
    ['an empty body', {}],
    ['an unknown service only', { facial: { price: 100 } }]
  ])('%s -> 400', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
  });
});

describe('public pricing without a database', () => {
  test('shows the price an admin has set', async () => {
    await request(app).patch('/api/admin/pricing/bridal').set(authHeader()).send({ price: 33000, duration: '3 hours' }).expect(200);
    const res = await request(app).get('/api/pricing/bridal');
    expect(res.status).toBe(200);
    expect(res.body.pricing).toMatchObject({ service: 'bridal', price: 33000, duration: '3 hours' });
  });

  test('an unknown service -> 404', async () => {
    expect((await request(app).get('/api/pricing/facial')).status).toBe(404);
  });
});

describe('single-service pricing', () => {
  test('rejects an unknown service', async () => {
    const res = await request(app).patch('/api/admin/pricing/facial').set(authHeader()).send({ price: 100 });
    expect(res.status).toBe(400);
  });

  test('rejects a negative price', async () => {
    const res = await request(app).patch('/api/admin/pricing/bridal').set(authHeader()).send({ price: -5 });
    expect(res.status).toBe(400);
  });
});

describe('admin message to a customer', () => {
  let id;
  let sent;
  beforeEach(async () => {
    ({ app, sent } = loadApp());
    await book({ email: 'target@example.com' });
    id = (await request(app).get('/api/admin/bookings').set(authHeader())).body.bookings[0]._id;
    sent.length = 0;
  });

  const message = (body, options) => request(app).post(`/api/admin/bookings/${id}/message`).set(authHeader(options)).send(body);

  test('sends an escaped message and keeps line breaks', async () => {
    const res = await message({ message: 'Hello <script>alert(1)</script>\nSecond line' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const mail = sent.find((m) => m.to === 'target@example.com');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('<br>Second line');
  });

  test('requires a message', async () => {
    expect((await message({})).status).toBe(400);
    expect((await message({ message: '' })).status).toBe(400);
  });

  test('unknown booking -> 404', async () => {
    const res = await request(app).post('/api/admin/bookings/does-not-exist/message').set(authHeader()).send({ message: 'hi' });
    expect(res.status).toBe(404);
  });
});

describe('booking management', () => {
  test('admin can confirm and cancel by id; unknown id -> 404', async () => {
    await book();
    const id = (await request(app).get('/api/admin/bookings').set(authHeader())).body.bookings[0]._id;

    const cancel = await request(app).patch(`/api/admin/bookings/${id}/cancel`).set(authHeader());
    expect(cancel.body.booking.status).toBe('cancelled');
    const confirm = await request(app).patch(`/api/admin/bookings/${id}/confirm`).set(authHeader());
    expect(confirm.body.booking.status).toBe('confirmed');

    expect((await request(app).patch('/api/admin/bookings/nope/confirm').set(authHeader())).status).toBe(404);
  });

  test('status endpoint accepts only valid statuses', async () => {
    const { bookingNumber } = (await book()).body.booking;
    const ok = await request(app).patch(`/api/admin/bookings/${bookingNumber}/status`).set(authHeader()).send({ status: 'completed' });
    expect(ok.status).toBe(200);
    const bad = await request(app).patch(`/api/admin/bookings/${bookingNumber}/status`).set(authHeader()).send({ status: 'banana' });
    expect(bad.status).toBe(400);
  });

  test('deleting a booking removes it', async () => {
    const { id } = (await book()).body.booking;
    expect((await request(app).delete(`/api/bookings/${id}`).set(authHeader())).status).toBe(200);
    expect((await request(app).delete(`/api/bookings/${id}`).set(authHeader())).status).toBe(404);
  });
});

describe('public endpoints', () => {
  test('health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('Server is running');
  });

  test('the confirmation email template is readable without logging in', async () => {
    const res = await request(app).get('/api/email-templates/confirmation');
    expect(res.status).toBe(200);
    expect(res.body.template.subject).toContain('{bookingNumber}');
  });

  test('unknown API routes return a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('malformed JSON returns a JSON error rather than crashing', async () => {
    const res = await request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp())
      .set('Content-Type', 'application/json').send('{"name": ');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
