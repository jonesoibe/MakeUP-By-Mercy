const request = require('supertest');
const { loadApp, authHeader, validBooking, uniqueIp } = require('./helpers/app');

// Smallest useful samples: the server checks the file signature, not that the
// picture is renderable.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF'), Buffer.alloc(64, 7)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(32, 1)]);

let app;
let booking; // { bookingNumber, receiptToken }

const book = () => request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp()).send(validBooking());

const upload = (body, { type = 'image/jpeg', token, id, ip = uniqueIp() } = {}) => {
  let req = request(app)
    .post(`/api/bookings/${id || booking.bookingNumber}/photo`)
    .set('X-Forwarded-For', ip)
    .set('Content-Type', type);
  const t = token === undefined ? booking.receiptToken : token;
  if (t) req = req.query({ token: t });
  return req.send(body);
};

const adminGet = (bookingNumber, options) => request(app).get(`/api/admin/bookings/${bookingNumber}/photo`).set(authHeader(options));

beforeEach(async () => {
  ({ app } = loadApp());
  booking = (await book()).body.booking;
});

describe('uploading a photo', () => {
  test.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp']
  ])('a customer can upload a %s with their receipt token', async (_label, bytes, type) => {
    const res = await upload(bytes, { type });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, size: bytes.length });
  });

  test('the booking is flagged, but the photo bytes never appear in booking data', async () => {
    await upload(JPEG);
    const list = await request(app).get('/api/admin/bookings').set(authHeader());
    const row = list.body.bookings.find((b) => b.bookingNumber === booking.bookingNumber);
    expect(row.hasPhoto).toBe(true);
    // only the flag travels with the booking; the image itself is never part of it
    ['photo', 'photoData', 'image', 'data', 'contentType'].forEach((key) => expect(row).not.toHaveProperty(key));
  });

  test('a booking without a photo is flagged false', async () => {
    const list = await request(app).get('/api/admin/bookings').set(authHeader());
    expect(list.body.bookings.find((b) => b.bookingNumber === booking.bookingNumber).hasPhoto).toBe(false);
  });

  test('uploading again replaces the earlier photo', async () => {
    await upload(JPEG);
    await upload(PNG, { type: 'image/png' });
    const res = await adminGet(booking.bookingNumber);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.compare(res.body, PNG)).toBe(0);
  });
});

describe('who may upload', () => {
  test.each([
    ['no token', ''],
    ['a wrong token', 'f'.repeat(32)],
    ['a token of the wrong length', 'abc']
  ])('%s -> 403', async (_label, token) => {
    expect((await upload(JPEG, { token })).status).toBe(403);
  });

  test('another booking\'s token does not work', async () => {
    const other = (await book()).body.booking;
    expect((await upload(JPEG, { token: other.receiptToken })).status).toBe(403);
  });

  test('a missing booking looks the same as a wrong token', async () => {
    const res = await upload(JPEG, { id: 'MKP-99999' });
    expect(res.status).toBe(403);
  });

  test('a malformed booking id -> 400', async () => {
    expect((await upload(JPEG, { id: 'nope' })).status).toBe(400);
  });

  test('an admin may upload without a receipt token', async () => {
    const res = await request(app)
      .post(`/api/bookings/${booking.bookingNumber}/photo`)
      .set('X-Forwarded-For', uniqueIp())
      .set(authHeader())
      .set('Content-Type', 'image/jpeg')
      .send(JPEG);
    expect(res.status).toBe(201);
  });

  test('unauthorised callers are turned away before the file is read', async () => {
    // A 3 MB body from someone with no token must not be buffered or stored
    const big = Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024 - JPEG.length)]);
    try {
      expect((await upload(big, { token: '' })).status).toBe(403);
    } catch (error) {
      // The server may answer and close the connection without reading the body,
      // which the client sees as a reset - that is the behaviour we want.
      expect(String(error.code || error.message)).toMatch(/EPIPE|ECONNRESET|socket hang up/i);
    }
    expect((await adminGet(booking.bookingNumber)).status).toBe(404);
  });
});

describe('what is accepted', () => {
  test('a file whose bytes do not match its declared type -> 400', async () => {
    expect((await upload(PNG, { type: 'image/jpeg' })).status).toBe(400);
  });

  test('something that is not an image at all -> 400', async () => {
    const res = await upload(Buffer.from('<html><script>alert(1)</script></html> padding padding'), { type: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  test('an SVG (which can carry script) is not accepted -> 415', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(svg, { type: 'image/svg+xml' })).status).toBe(415);
  });

  test('other content types -> 415', async () => {
    expect((await upload(Buffer.from('hello'), { type: 'text/plain' })).status).toBe(415);
  });

  test('an empty upload is rejected', async () => {
    expect((await upload(Buffer.alloc(0))).status).toBe(415);
  });

  test('over 3 MB -> 413', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024)]);
    expect((await upload(big)).status).toBe(413);
  });

  test('just under 3 MB is accepted', async () => {
    const ok = Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024 - JPEG.length - 1024)]);
    expect((await upload(ok)).status).toBe(201);
  });
});

describe('viewing a photo (admin only)', () => {
  beforeEach(async () => { await upload(JPEG); });

  test('an admin gets the original bytes with safe headers', async () => {
    const res = await adminGet(booking.bookingNumber);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, JPEG)).toBe(0);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
  });

  test('viewers can see it too (they can already read bookings)', async () => {
    const res = await adminGet(booking.bookingNumber, { role: 'viewer' });
    expect(res.status).toBe(200);
  });

  test('it is never available without an admin login', async () => {
    const anon = await request(app).get(`/api/admin/bookings/${booking.bookingNumber}/photo`);
    expect(anon.status).toBe(401);
    // the customer's receipt token is for uploading, not for viewing
    const withToken = await request(app).get(`/api/admin/bookings/${booking.bookingNumber}/photo`).query({ token: booking.receiptToken });
    expect(withToken.status).toBe(401);
  });

  test('a booking with no photo -> 404', async () => {
    const other = (await book()).body.booking;
    expect((await adminGet(other.bookingNumber)).status).toBe(404);
  });

  test('a malformed id -> 400', async () => {
    expect((await adminGet('not-an-id')).status).toBe(400);
  });
});

describe('removing a photo', () => {
  beforeEach(async () => { await upload(JPEG); });

  const remove = (token, options = {}) => {
    let req = request(app).delete(`/api/bookings/${booking.bookingNumber}/photo`);
    if (token) req = req.query({ token });
    if (options.admin) req = req.set(authHeader());
    return req;
  };

  test('the customer can delete their own photo', async () => {
    expect((await remove(booking.receiptToken)).status).toBe(200);
    expect((await adminGet(booking.bookingNumber)).status).toBe(404);
    const list = await request(app).get('/api/admin/bookings').set(authHeader());
    expect(list.body.bookings.find((b) => b.bookingNumber === booking.bookingNumber).hasPhoto).toBe(false);
  });

  test('an admin can delete it', async () => {
    expect((await remove(undefined, { admin: true })).status).toBe(200);
    expect((await adminGet(booking.bookingNumber)).status).toBe(404);
  });

  test('no token or a wrong token -> 403, and the photo stays', async () => {
    expect((await remove()).status).toBe(403);
    expect((await remove('f'.repeat(32))).status).toBe(403);
    expect((await adminGet(booking.bookingNumber)).status).toBe(200);
  });

  test('deleting the whole booking deletes its photo', async () => {
    await request(app).delete(`/api/bookings/${booking.id}`).set(authHeader()).expect(200);
    expect((await adminGet(booking.bookingNumber)).status).toBe(404);
  });
});

describe('limits and headers', () => {
  test('uploads are rate-limited per client IP', async () => {
    const ip = uniqueIp();
    const statuses = [];
    for (let i = 0; i < 21; i += 1) statuses.push((await upload(JPEG, { token: 'f'.repeat(32), ip })).status);
    expect(statuses.slice(0, 20).every((s) => s === 403)).toBe(true);
    expect(statuses[20]).toBe(429);
    // someone else is unaffected
    expect((await upload(JPEG)).status).toBe(201);
  });

  test('the page may show blob: images (photo preview) but nothing else is loosened', async () => {
    const csp = (await request(app).get('/')).headers['content-security-policy'];
    expect(csp).toMatch(/img-src [^;]*blob:/);
    expect(csp).toMatch(/script-src [^;]*'self'/);
    expect(csp).not.toMatch(/script-src [^;]*blob:/);
  });
});
