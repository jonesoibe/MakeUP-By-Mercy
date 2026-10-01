const request = require('supertest');
const { loadApp, authHeader, isoDate, validBooking, uniqueIp, waitFor } = require('./helpers/app');

let app;
let sent;

// Each request gets its own client IP so the per-IP booking limit never interferes
const book = (body = validBooking()) =>
  request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp()).send(body);

beforeEach(() => { ({ app, sent } = loadApp()); });

describe('creating a booking', () => {
  test('returns 201 with the booking and a receipt token', async () => {
    const res = await book();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.booking).toMatchObject({
      name: 'Test Customer',
      email: 'customer@example.com',
      service: 'bridal',
      country: 'Nigeria'
    });
    expect(res.body.booking.bookingNumber).toMatch(/^[A-Z]{3}-\d{8}-\d{4}-\d{2}$/);
    expect(res.body.booking.receiptToken).toMatch(/^[0-9a-f]{32}$/);
  });

  test.each([
    ['bridal', 'BRD'],
    ['party', 'PTY'],
    ['casual', 'CSL']
  ])('a %s booking number starts with %s, then the appointment date and time', async (service, code) => {
    const res = await book(validBooking({ service, date: '2030-03-15', time: '14:30' }));
    expect(res.body.booking.bookingNumber).toBe(`${code}-20300315-1430-01`);
    expect(res.body.booking.time).toBe('14:30');
  });

  test('bookings for the same slot get 01, 02, 03... and other slots start again at 01', async () => {
    const slot = { service: 'bridal', date: '2030-03-15', time: '09:00' };
    const numbers = [];
    for (let i = 0; i < 3; i += 1) numbers.push((await book(validBooking(slot))).body.booking.bookingNumber);
    expect(numbers).toEqual(['BRD-20300315-0900-01', 'BRD-20300315-0900-02', 'BRD-20300315-0900-03']);

    expect((await book(validBooking({ ...slot, time: '09:30' }))).body.booking.bookingNumber).toBe('BRD-20300315-0930-01');
    expect((await book(validBooking({ ...slot, date: '2030-03-16' }))).body.booking.bookingNumber).toBe('BRD-20300316-0900-01');
    expect((await book(validBooking({ ...slot, service: 'party' }))).body.booking.bookingNumber).toBe('PTY-20300315-0900-01');
  });

  test('concurrent bookings for the same slot all get different numbers', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => book(validBooking({ email: `race${i}@example.com`, date: '2030-04-01', time: '11:00' }))));
    results.forEach((r) => expect(r.status).toBe(201));
    const numbers = results.map((r) => r.body.booking.bookingNumber);
    expect(new Set(numbers).size).toBe(6);
    numbers.forEach((n) => expect(n).toMatch(/^BRD-20300401-1100-0[1-6]$/));
  });

  test('normalises the email address and trims the name', async () => {
    const res = await book(validBooking({ email: 'Mixed.Case@Example.COM', name: '  Padded Name  ' }));
    expect(res.body.booking.email).toBe('mixed.case@example.com');
    expect(res.body.booking.name).toBe('Padded Name');
  });

  test('defaults the country to Nigeria', async () => {
    const body = validBooking();
    delete body.country;
    expect((await book(body)).body.booking.country).toBe('Nigeria');
  });

  test('does not leak the QR code or other internals in the response', async () => {
    const res = await book();
    expect(res.body.booking.qrCode).toBeUndefined();
    expect(res.body.booking._id).toBeUndefined();
  });
});

describe('booking validation', () => {
  const invalid = [
    ['name too short', { name: 'A' }, 'name'],
    ['name missing', { name: undefined }, 'name'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['phone too short (9 chars)', { phone: '123456789' }, 'phone'],
    ['phone too long (21 chars)', { phone: '1'.repeat(21) }, 'phone'],
    ['phone with letters', { phone: '0801234abcd' }, 'phone'],
    ['unknown service', { service: 'spa' }, 'service'],
    ['service missing', { service: undefined }, 'service'],
    ['date missing', { date: undefined }, 'date'],
    ['date not a date', { date: 'tomorrow' }, 'date'],
    ['date in the past', { date: isoDate(-1) }, 'date'],
    ['time missing', { time: undefined }, 'time'],
    ['time not a time', { time: 'noon' }, 'time'],
    ['time without a leading zero', { time: '9:00' }, 'time'],
    ['time past 23:59', { time: '25:00' }, 'time'],
    ['time with seconds', { time: '10:00:00' }, 'time']
  ];

  test.each(invalid)('%s -> 400 naming the field', async (_label, override, field) => {
    const res = await book(validBooking(override));
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toContain(field);
  });

  test.each([
    ['exactly 10 characters', '0801234567'],
    ['exactly 20 characters', '+234 801 234 5678 901'.slice(0, 20)],
    ['formatted with spaces and brackets', '(0801) 234-5678']
  ])('phone %s is accepted', async (_label, phone) => {
    expect((await book(validBooking({ phone }))).status).toBe(201);
  });

  test('today is a valid booking date (same-day bookings allowed)', async () => {
    expect((await book(validBooking({ date: isoDate(0) }))).status).toBe(201);
  });

  test('unknown fields are stripped, not stored', async () => {
    const res = await book({ ...validBooking(), status: 'completed', admin: true });
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBeUndefined();
  });
});

describe('appointment time and opening hours', () => {
  const saveHours = (hours) =>
    request(app).patch('/api/admin/availability').set(authHeader()).send({
      weekdayStart: '09:00', weekdayEnd: '17:00', weekendStart: '11:00', weekendEnd: '15:00', leadTimeDays: 0, ...hours
    });

  // 2030-03-14 is a Thursday; 2030-03-16 is a Saturday
  const WEEKDAY = '2030-03-14';
  const WEEKEND = '2030-03-16';

  test('before hours are saved, 9AM-8PM applies every day', async () => {
    expect((await book(validBooking({ date: WEEKDAY, time: '09:00' }))).status).toBe(201);
    expect((await book(validBooking({ date: WEEKEND, time: '19:30' }))).status).toBe(201);
    const early = await book(validBooking({ date: WEEKDAY, time: '08:30' }));
    expect(early.status).toBe(400);
    expect(early.body.errors[0].field).toBe('time');
    expect((await book(validBooking({ date: WEEKDAY, time: '20:00' }))).status).toBe(400);
  });

  test('saved weekday hours apply on weekdays: start included, closing time excluded', async () => {
    await saveHours();
    expect((await book(validBooking({ date: WEEKDAY, time: '09:00' }))).status).toBe(201);
    expect((await book(validBooking({ date: WEEKDAY, time: '16:30' }))).status).toBe(201);
    const late = await book(validBooking({ date: WEEKDAY, time: '17:00' }));
    expect(late.status).toBe(400);
    expect(late.body.message).toMatch(/9:00 AM and 5:00 PM on weekdays/);
    expect((await book(validBooking({ date: WEEKDAY, time: '08:59' }))).status).toBe(400);
  });

  test('saved weekend hours apply on Saturday and Sunday', async () => {
    await saveHours();
    expect((await book(validBooking({ date: WEEKEND, time: '11:00' }))).status).toBe(201);
    const early = await book(validBooking({ date: WEEKEND, time: '09:00' }));
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/11:00 AM and 3:00 PM on weekends/);
    // Sunday
    expect((await book(validBooking({ date: '2030-03-17', time: '15:00' }))).status).toBe(400);
  });

  test('the time is returned, emailed and shown on the receipt', async () => {
    const res = await book(validBooking({ date: WEEKDAY, time: '14:00', email: 'time@example.com' }));
    expect(res.body.booking.time).toBe('14:00');
    await waitFor(() => sent.some((m) => m.to === 'time@example.com'));
    expect(sent.find((m) => m.to === 'time@example.com').html).toContain('2:00 PM');
    const owner = sent.find((m) => m.to === 'owner@example.com');
    expect(owner.html).toContain('Appointment Time:');
    expect(owner.html).toContain('2:00 PM');
  });
});

describe('notice period (availability lead time)', () => {
  const saveLeadTime = (leadTimeDays) =>
    request(app).patch('/api/admin/availability').set(authHeader()).send({
      weekdayStart: '09:00', weekdayEnd: '20:00', weekendStart: '10:00', weekendEnd: '18:00', leadTimeDays
    });

  test('is not enforced until the owner has saved settings', async () => {
    expect((await request(app).get('/api/availability')).body.availability.configured).toBe(false);
    expect((await book(validBooking({ date: isoDate(0) }))).status).toBe(201);
  });

  test('opening the admin settings does not switch enforcement on', async () => {
    await request(app).get('/api/admin/availability').set(authHeader());
    expect((await request(app).get('/api/availability')).body.availability.configured).toBe(false);
    expect((await book(validBooking({ date: isoDate(0) }))).status).toBe(201);
  });

  test('rejects dates sooner than the lead time and accepts the boundary day', async () => {
    expect((await saveLeadTime(3)).status).toBe(200);

    const tooSoon = await book(validBooking({ date: isoDate(2) }));
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.body.errors[0].field).toBe('date');
    expect(tooSoon.body.message).toMatch(/3 days notice/);

    expect((await book(validBooking({ date: isoDate(3) }))).status).toBe(201);
  });

  test('a lead time of 0 allows same-day bookings', async () => {
    await saveLeadTime(0);
    expect((await book(validBooking({ date: isoDate(0) }))).status).toBe(201);
  });

  test('the public endpoint exposes the saved hours without internal fields', async () => {
    await saveLeadTime(2);
    const { availability } = (await request(app).get('/api/availability')).body;
    expect(availability).toEqual({
      configured: true,
      weekdayStart: '09:00', weekdayEnd: '20:00', weekendStart: '10:00', weekendEnd: '18:00',
      leadTimeDays: 2
    });
  });

  test('rejects invalid availability input', async () => {
    const res = await request(app).patch('/api/admin/availability').set(authHeader())
      .send({ weekdayStart: '25:00', weekdayEnd: '20:00', weekendStart: '10:00', weekendEnd: '18:00', leadTimeDays: 1 });
    expect(res.status).toBe(400);
  });
});

describe('emails', () => {
  const hasEmail = (to) => sent.some((m) => m.to === to);

  test('sends a confirmation to the customer and a notification to the owner', async () => {
    await book(validBooking({ email: 'who@example.com' }));
    await waitFor(() => hasEmail('who@example.com') && hasEmail('owner@example.com'));
    const customer = sent.find((m) => m.to === 'who@example.com');
    expect(customer.subject).toMatch(/Booking Confirmed - ID: [A-Z]{3}-\d{8}-\d{4}-\d{2}/);
    expect(customer.from).toBe('from@example.com');
  });

  test('the booking still succeeds when email delivery fails', async () => {
    const sg = require('@sendgrid/mail');
    sg.send.mockRejectedValue(new Error('SendGrid down'));
    const res = await book();
    expect(res.status).toBe(201);
  });

  test('customer-supplied HTML is escaped in both emails', async () => {
    const name = '<a href="https://evil.example">Pay now</a>';
    await book(validBooking({ name, email: 'xss@example.com' }));
    await waitFor(() => hasEmail('xss@example.com') && hasEmail('owner@example.com'));

    sent.filter((m) => /Pay now/.test(m.html)).forEach((m) => {
      expect(m.html).not.toContain('<a href="https://evil.example">');
      expect(m.html).toContain('&lt;a href=');
    });
  });

  test('the owner email links to the admin console, not a localhost API route', async () => {
    await book();
    await waitFor(() => hasEmail('owner@example.com'));
    const owner = sent.find((m) => m.to === 'owner@example.com');
    expect(owner.html).toContain('/admin"');
    expect(owner.html).not.toContain('/api/bookings');
  });

  describe('admin-edited confirmation template', () => {
    const saveTemplate = (subject, body) =>
      request(app).put('/api/admin/email-templates/confirmation').set(authHeader()).send({ subject, body });

    test('is used for the confirmation email, with placeholders filled in', async () => {
      await saveTemplate(
        'Hi {name} - {bookingNumber}',
        'Dear {name}, your {service} is on {date}.\nCall {phone} ({country}). Unknown: {nope}'
      );
      await book(validBooking({ name: 'Ada Obi', email: 'ada@example.com', service: 'party' }));
      await waitFor(() => hasEmail('ada@example.com'));

      const mail = sent.find((m) => m.to === 'ada@example.com');
      expect(mail.subject).toMatch(/^Hi Ada Obi - [A-Z]{3}-\d{8}-\d{4}-\d{2}$/);
      expect(mail.html).toContain('Dear Ada Obi, your Party is on');
      expect(mail.html).toContain('+2348012345678 (Nigeria)');
      expect(mail.html).toContain('{nope}');
      expect(mail.html).toContain('<br>');
    });

    test('is escaped, and subjects cannot contain line breaks', async () => {
      await saveTemplate('Subject line {name}', 'Body with <script>alert(1)</script> inside it');
      await book(validBooking({ name: 'Line\nBreak', email: 'lb@example.com' }));
      await waitFor(() => hasEmail('lb@example.com'));

      const mail = sent.find((m) => m.to === 'lb@example.com');
      expect(mail.html).toContain('&lt;script&gt;');
      expect(mail.html).not.toContain('<script>');
      expect(mail.subject).not.toMatch(/[\r\n]/);
    });

    test('rejects templates that are too short', async () => {
      expect((await saveTemplate('abc', 'short')).status).toBe(400);
    });
  });
});

describe('receipts', () => {
  let booking;
  beforeEach(async () => { booking = (await book()).body.booking; });

  const url = (id, kind) => `/api/bookings/${id}/receipt/${kind}`;

  test('a customer can download their PDF with the receipt token', async () => {
    const res = await request(app).get(url(booking.bookingNumber, 'pdf')).query({ token: booking.receiptToken });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(res.body).slice(0, 5).toString()).toBe('%PDF-');
  });

  test('the PDF is a single page', async () => {
    const res = await request(app).get(url(booking.bookingNumber, 'pdf')).query({ token: booking.receiptToken })
      .buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    const pages = (res.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBe(1);
  });

  test('a customer gets only the QR code, never the booking record', async () => {
    const res = await request(app).get(url(booking.bookingNumber, 'image')).query({ token: booking.receiptToken });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['qrCode', 'success']);
    expect(res.body.qrCode).toMatch(/^data:image\/png;base64,/);
  });

  test('an admin gets the QR code plus the booking, without needing a token', async () => {
    const res = await request(app).get(url(booking.bookingNumber, 'image')).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.booking.bookingNumber).toBe(booking.bookingNumber);
  });

  test.each([
    ['no token', undefined],
    ['a wrong token', 'f'.repeat(32)],
    ['a token of the wrong length', 'abc']
  ])('%s -> 403', async (_label, token) => {
    const req = request(app).get(url(booking.bookingNumber, 'pdf'));
    const res = token ? await req.query({ token }) : await req;
    expect(res.status).toBe(403);
  });

  test('a token for one booking does not open another', async () => {
    const other = (await book()).body.booking;
    const res = await request(app).get(url(other.bookingNumber, 'pdf')).query({ token: booking.receiptToken });
    expect(res.status).toBe(403);
  });

  test('a nonexistent booking looks the same as a wrong token', async () => {
    const missing = await request(app).get(url('MKP-99999', 'pdf')).query({ token: booking.receiptToken });
    const wrong = await request(app).get(url(booking.bookingNumber, 'pdf')).query({ token: 'f'.repeat(32) });
    expect(missing.status).toBe(wrong.status);
    expect(missing.body).toEqual(wrong.body);
  });

  test('a malformed booking id is rejected', async () => {
    const res = await request(app).get(url('not-an-id', 'pdf')).query({ token: booking.receiptToken });
    expect(res.status).toBe(400);
  });

  test('an admin gets a clear 404 for a missing booking', async () => {
    const res = await request(app).get(url('MKP-99999', 'pdf')).set(authHeader());
    expect(res.status).toBe(404);
  });
});
