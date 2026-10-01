// Tests that run the app against a real MongoDB (an in-memory instance), so the
// database-backed code paths get exercised: admin accounts, permissions,
// persistence, the booking counter and settings storage.
//
// The first run downloads a MongoDB binary (cached afterwards).

const request = require('supertest');
const bcrypt = require('bcryptjs');
const realMongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { loadApp, tokenFor, isoDate, validBooking, uniqueIp, waitFor } = require('./helpers/app');

jest.setTimeout(60000);

let mongod;
const openConnections = [];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
});

afterAll(async () => {
  await Promise.all(openConnections.map((c) => c.close().catch(() => {})));
  await mongod.stop();
});

const PASSWORD = 'Passw0rd!long';

// A raw connection for seeding data *before* the app boots (the app's startup
// routines run once, on connect, so some scenarios need pre-existing data).
async function seedConnection(dbName) {
  const conn = await realMongoose.createConnection(mongod.getUri(dbName)).asPromise();
  openConnections.push(conn);
  return conn;
}

// Boot the app against `dbName` and wait for the database connection.
async function bootApp(dbName, env = {}) {
  const ctx = loadApp({ mongoUri: mongod.getUri(dbName), env });
  await waitFor(() => ctx.mongoose.connection.readyState === 1, { timeout: 15000 });
  openConnections.push({ close: () => ctx.mongoose.disconnect() });
  return ctx;
}

const login = (app, username, password) => request(app).post('/api/admin/login').send({ username, password });

async function createAdmin(mongoose, { username, role = 'manager', email = `${username}@example.com`, password = PASSWORD, active = true }) {
  const Admin = mongoose.model('Admin');
  return Admin.create({ username, email, role, active, password: await bcrypt.hash(password, 4) });
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe('first admin account', () => {
  test('nothing is created when no initial password is configured', async () => {
    const { app, mongoose } = await bootApp('first_none');
    await new Promise((r) => setTimeout(r, 500)); // let startup routines finish
    expect(await mongoose.model('Admin').countDocuments()).toBe(0);
    expect((await login(app, 'admin', 'admin123')).status).toBe(401);
  });

  test('is created from ADMIN_INITIAL_PASSWORD, and only that password works', async () => {
    const { app, mongoose } = await bootApp('first_env', { ADMIN_INITIAL_PASSWORD: 'a-long-initial-secret' });
    await waitFor(async () => mongoose.model('Admin').findOne({ username: 'admin' }));

    const ok = await login(app, 'admin', 'a-long-initial-secret');
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe('admin');
    expect((await login(app, 'admin', 'admin123')).status).toBe(401);
  });

  test('a too-short initial password is ignored', async () => {
    const { mongoose } = await bootApp('first_short', { ADMIN_INITIAL_PASSWORD: 'short' });
    await new Promise((r) => setTimeout(r, 500));
    expect(await mongoose.model('Admin').countDocuments()).toBe(0);
  });

  describe('an existing account that still uses the old default password', () => {
    const seedLegacyAdmin = async (dbName) => {
      const conn = await seedConnection(dbName);
      await conn.collection('admins').insertOne({
        username: 'admin', email: 'admin@example.com', role: 'admin', active: true,
        password: await bcrypt.hash('admin123', 4), createdAt: new Date()
      });
    };

    test('is reset to ADMIN_INITIAL_PASSWORD at startup', async () => {
      await seedLegacyAdmin('legacy_reset');
      const { app } = await bootApp('legacy_reset', { ADMIN_INITIAL_PASSWORD: 'a-long-initial-secret' });
      await waitFor(async () => (await login(app, 'admin', 'a-long-initial-secret')).status === 200, { timeout: 15000, interval: 100 });
      expect((await login(app, 'admin', 'admin123')).status).toBe(401);
    });

    test('cannot log in with the default password and is told how to fix it', async () => {
      await seedLegacyAdmin('legacy_blocked');
      const { app } = await bootApp('legacy_blocked');
      await new Promise((r) => setTimeout(r, 500));
      const res = await login(app, 'admin', 'admin123');
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/ADMIN_INITIAL_PASSWORD/);
      expect(res.body.token).toBeUndefined();
    });
  });
});

describe('accounts and permissions', () => {
  let app, mongoose, ids, tokens;

  beforeAll(async () => {
    ({ app, mongoose } = await bootApp('accounts'));
    const boss = await createAdmin(mongoose, { username: 'boss', role: 'admin' });
    const mgr = await createAdmin(mongoose, { username: 'mgr', role: 'manager' });
    const view = await createAdmin(mongoose, { username: 'view', role: 'viewer' });
    ids = { boss: String(boss._id), mgr: String(mgr._id), view: String(view._id) };
    tokens = {};
    for (const name of ['boss', 'mgr', 'view']) {
      tokens[name] = (await login(app, name, PASSWORD)).body.token;
    }
  });

  test('real logins produce working tokens with the right role', async () => {
    const res = await request(app).get('/api/admin/users').set(bearer(tokens.boss));
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username).sort()).toEqual(expect.arrayContaining(['boss', 'mgr', 'view']));
    res.body.users.forEach((u) => expect(u.password).toBeUndefined());
  });

  test('a wrong password and an unknown user both give 401', async () => {
    expect((await login(app, 'boss', 'wrong-password')).status).toBe(401);
    expect((await login(app, 'nobody', PASSWORD)).status).toBe(401);
  });

  test('a viewer cannot change the admin\'s password (and it stays unchanged)', async () => {
    const res = await request(app).patch(`/api/admin/users/${ids.boss}`).set(bearer(tokens.view)).send({ password: 'Takeover1!x' });
    expect(res.status).toBe(403);
    expect((await login(app, 'boss', PASSWORD)).status).toBe(200);
    expect((await login(app, 'boss', 'Takeover1!x')).status).toBe(401);
  });

  test('a user can change their own email and password', async () => {
    const res = await request(app).patch(`/api/admin/users/${ids.view}`).set(bearer(tokens.view)).send({ email: 'view.new@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.admin.email).toBe('view.new@example.com');

    await request(app).patch(`/api/admin/users/${ids.view}`).set(bearer(tokens.view)).send({ password: 'Fresh1!pass' }).expect(200);
    expect((await login(app, 'view', 'Fresh1!pass')).status).toBe(200);
    expect((await login(app, 'view', PASSWORD)).status).toBe(401);
    // restore for later tests
    await request(app).patch(`/api/admin/users/${ids.view}`).set(bearer(tokens.view)).send({ password: PASSWORD }).expect(200);
  });

  test('a user cannot change their own role', async () => {
    const res = await request(app).patch(`/api/admin/users/${ids.view}`).set(bearer(tokens.view)).send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  test('an email that is already taken -> 409', async () => {
    const res = await request(app).patch(`/api/admin/users/${ids.mgr}`).set(bearer(tokens.mgr)).send({ email: 'boss@example.com' });
    expect(res.status).toBe(409);
  });

  test('an admin can update other users; bad and unknown ids are handled', async () => {
    await request(app).patch(`/api/admin/users/${ids.mgr}`).set(bearer(tokens.boss)).send({ email: 'mgr.changed@example.com' }).expect(200);
    expect((await request(app).patch('/api/admin/users/not-an-id').set(bearer(tokens.boss)).send({ email: 'a@b.co' })).status).toBe(400);
    expect((await request(app).patch('/api/admin/users/507f1f77bcf86cd799439099').set(bearer(tokens.boss)).send({ email: 'a@b.co' })).status).toBe(404);
  });

  test('an admin can create a user, and the new user can log in', async () => {
    const res = await request(app).post('/api/admin/users').set(bearer(tokens.boss))
      .send({ username: 'newstaff', email: 'newstaff@example.com', password: 'Str0ng!pass', role: 'viewer' });
    expect(res.status).toBe(200);
    expect((await login(app, 'newstaff', 'Str0ng!pass')).status).toBe(200);
  });

  test('a token for an account that does not exist is rejected', async () => {
    const res = await request(app).get('/api/admin/bookings').set(bearer(tokenFor({ id: '507f1f77bcf86cd799439055' })));
    expect(res.status).toBe(401);
  });

  test('a deactivated account\'s token is rejected', async () => {
    const ghost = await createAdmin(mongoose, { username: 'ghost', role: 'admin', active: false });
    const res = await request(app).get('/api/admin/bookings').set(bearer(tokenFor({ id: String(ghost._id), role: 'admin' })));
    expect(res.status).toBe(401);
  });

  test('a role change takes effect on the very next request', async () => {
    const temp = await createAdmin(mongoose, { username: 'temp', role: 'manager' });
    const token = (await login(app, 'temp', PASSWORD)).body.token;

    // Managers may delete bookings (404 = allowed, booking simply doesn't exist)
    expect((await request(app).delete('/api/bookings/1').set(bearer(token))).status).toBe(404);

    await request(app).patch(`/api/admin/users/${temp._id}`).set(bearer(tokens.boss)).send({ role: 'viewer' }).expect(200);
    expect((await request(app).delete('/api/bookings/1').set(bearer(token))).status).toBe(403);
  });

  test('deleting a user revokes their token immediately', async () => {
    const doomed = await createAdmin(mongoose, { username: 'doomed', role: 'admin' });
    const token = (await login(app, 'doomed', PASSWORD)).body.token;
    expect((await request(app).get('/api/admin/bookings').set(bearer(token))).status).toBe(200);

    await request(app).delete(`/api/admin/users/${doomed._id}`).set(bearer(tokens.boss)).expect(200);
    expect((await request(app).get('/api/admin/bookings').set(bearer(token))).status).toBe(401);
  });
});

describe('bookings in the database', () => {
  let app, mongoose, sent, token;
  const book = (overrides) => request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp()).send(validBooking(overrides));

  beforeAll(async () => {
    const seed = await seedConnection('bookings');
    // Existing bookings with a high number: the counter must resume after them
    await seed.collection('bookings').insertMany([
      { id: 1, bookingNumber: 'MKP-01050', name: 'Old One', email: 'old1@example.com', phone: '+2348000000001', service: 'bridal', date: isoDate(30), status: 'confirmed', bookedAt: new Date() },
      { id: 2, bookingNumber: 'MKP-01007', name: 'Old Two', email: 'old2@example.com', phone: '+2348000000002', service: 'party', date: isoDate(30), status: 'confirmed', bookedAt: new Date() },
      { id: 4, bookingNumber: `BRD-${isoDate(5).replace(/-/g, '')}-1000-07`, name: 'Slot Seven', email: 'old4@example.com', phone: '+2348000000004', service: 'bridal', date: isoDate(5), time: '10:00', status: 'confirmed', bookedAt: new Date() },
      { id: 3, bookingNumber: 'undefined', name: 'Legacy', email: 'old3@example.com', phone: '+2348000000003', service: 'casual', date: isoDate(30), status: 'confirmed', bookedAt: new Date() }
    ]);
    ({ app, mongoose, sent } = await bootApp('bookings'));
    await waitFor(async () => mongoose.model('Pricing').countDocuments()); // startup routines done
    await new Promise((r) => setTimeout(r, 300));
    const admin = await createAdmin(mongoose, { username: 'boss', role: 'admin' });
    token = (await login(app, 'boss', PASSWORD)).body.token;
    expect(admin).toBeTruthy();
  });

  test('the sequence for a slot continues from what is stored in the database', async () => {
    // The seeded data holds ...-1000-07 for this slot, so the next booking is 08
    const res = await book();
    expect(res.status).toBe(201);
    expect(res.body.booking.bookingNumber).toBe(`BRD-${isoDate(5).replace(/-/g, '')}-1000-08`);
    expect(res.body.booking.time).toBe('10:00');
  });

  test('a restart does not repeat a number: a fresh app on the same database carries on', async () => {
    const before = (await book({ email: 'restart1@example.com', time: '10:30' })).body.booking.bookingNumber;
    ({ app, mongoose, sent } = await bootApp('bookings')); // "restart": new process, same database
    await waitFor(async () => mongoose.model('Pricing').countDocuments());
    const after = (await book({ email: 'restart2@example.com', time: '10:30' })).body.booking.bookingNumber;
    expect(after).not.toBe(before);
    expect(parseInt(after.slice(-2), 10)).toBe(parseInt(before.slice(-2), 10) + 1);
    // log the admin back in on the new instance for the tests that follow
    token = (await login(app, 'boss', PASSWORD)).body.token;
  });

  test('the stored booking keeps the appointment time and its number', async () => {
    const created = (await book({ email: 'stored-time@example.com', time: '15:30' })).body.booking;
    const doc = await mongoose.model('Booking').findOne({ bookingNumber: created.bookingNumber }).lean();
    expect(doc.time).toBe('15:30');
    expect(doc.service).toBe('bridal');
  });

  test('concurrent bookings all get distinct numbers', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => book({ email: `c${i}@example.com`, time: '12:00' })));
    results.forEach((r) => expect(r.status).toBe(201));
    const numbers = results.map((r) => r.body.booking.bookingNumber);
    expect(new Set(numbers).size).toBe(5);
  });

  test('a booking is stored with its receipt token and appears in the admin list with an _id', async () => {
    const created = (await book({ email: 'stored@example.com' })).body.booking;
    const doc = await mongoose.model('Booking').findOne({ bookingNumber: created.bookingNumber }).lean();
    expect(doc.email).toBe('stored@example.com');
    expect(doc.receiptToken).toBe(created.receiptToken);

    const list = await request(app).get('/api/admin/bookings').set(bearer(token));
    const row = list.body.bookings.find((b) => b.bookingNumber === created.bookingNumber);
    expect(row._id).toEqual(expect.any(String));
  });

  test('receipts work from the database for the customer and for admins', async () => {
    const created = (await book({ email: 'receipt@example.com' })).body.booking;
    const url = `/api/bookings/${created.bookingNumber}/receipt/pdf`;

    expect((await request(app).get(url).query({ token: created.receiptToken })).status).toBe(200);
    expect((await request(app).get(url).query({ token: 'f'.repeat(32) })).status).toBe(403);
    expect((await request(app).get(url).set(bearer(token))).status).toBe(200);
  });

  test('bookings created before receipt tokens existed are admin-only', async () => {
    const url = '/api/bookings/MKP-01050/receipt/pdf';
    expect((await request(app).get(url)).status).toBe(403);
    expect((await request(app).get(url).query({ token: 'null' })).status).toBe(403);
    expect((await request(app).get(url).set(bearer(token))).status).toBe(200);
  });

  test('default pricing and email templates are seeded', async () => {
    const pricing = await request(app).get('/api/pricing/bridal');
    expect(pricing.body.pricing.price).toBe(25000);
    expect((await mongoose.model('EmailTemplate').countDocuments())).toBe(3);
  });

  test('bulk pricing persists and shows on the public endpoint', async () => {
    const res = await request(app).post('/api/admin/pricing').set(bearer(token)).send({ party: { price: 19000, duration: '2 hours' } });
    expect(res.status).toBe(200);
    const pub = await request(app).get('/api/pricing/party');
    expect(pub.body.pricing).toMatchObject({ price: 19000, duration: '2 hours' });
  });

  test('dashboard revenue follows stored prices and ignores cancelled bookings', async () => {
    await mongoose.model('Booking').deleteMany({});
    await request(app).post('/api/admin/pricing').set(bearer(token)).send({ bridal: { price: 30000 }, party: { price: 20000 } });
    await book({ service: 'bridal', date: isoDate(0), email: 'r1@example.com' });
    const party = (await book({ service: 'party', date: isoDate(0), email: 'r2@example.com' })).body.booking;

    expect((await request(app).get('/api/admin/dashboard').set(bearer(token))).body.monthlyRevenue).toBe(50000);

    const doc = await mongoose.model('Booking').findOne({ bookingNumber: party.bookingNumber });
    await request(app).patch(`/api/admin/bookings/${doc._id}/cancel`).set(bearer(token)).expect(200);
    expect((await request(app).get('/api/admin/dashboard').set(bearer(token))).body.monthlyRevenue).toBe(30000);
  });

  test('opening the settings does not create a record; saving does, and then it is enforced', async () => {
    const Availability = mongoose.model('Availability');
    await Availability.deleteMany({});

    await request(app).get('/api/admin/availability').set(bearer(token)).expect(200);
    expect(await Availability.countDocuments()).toBe(0);
    expect((await request(app).get('/api/availability')).body.availability.configured).toBe(false);
    expect((await book({ date: isoDate(0) })).status).toBe(201);

    await request(app).patch('/api/admin/availability').set(bearer(token)).send({
      weekdayStart: '08:00', weekdayEnd: '19:00', weekendStart: '10:00', weekendEnd: '16:00', leadTimeDays: 4
    }).expect(200);
    expect(await Availability.countDocuments()).toBe(1);

    const pub = (await request(app).get('/api/availability')).body.availability;
    expect(pub).toMatchObject({ configured: true, weekdayStart: '08:00', leadTimeDays: 4 });
    expect((await book({ date: isoDate(3) })).status).toBe(400);
    expect((await book({ date: isoDate(4) })).status).toBe(201);
  });

  test('an edited email template is stored and used', async () => {
    await request(app).put('/api/admin/email-templates/confirmation').set(bearer(token))
      .send({ subject: 'DB template for {name}', body: 'Stored template body for {bookingNumber}.' }).expect(200);
    const stored = await mongoose.model('EmailTemplate').findOne({ type: 'confirmation' }).lean();
    expect(stored.subject).toBe('DB template for {name}');

    sent.length = 0;
    await book({ name: 'Db Person', email: 'dbtemplate@example.com' });
    await waitFor(() => sent.some((m) => m.to === 'dbtemplate@example.com'));
    expect(sent.find((m) => m.to === 'dbtemplate@example.com').subject).toBe('DB template for Db Person');
  });
});

describe('customer photos in the database', () => {
  let app, mongoose, token, booking;
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF'), Buffer.from(Array.from({ length: 400 }, (_, i) => i % 251))]);

  const uploadPhoto = (bytes = JPEG, tok = booking.receiptToken) =>
    request(app).post(`/api/bookings/${booking.bookingNumber}/photo`).set('X-Forwarded-For', uniqueIp())
      .set('Content-Type', 'image/jpeg').query({ token: tok }).send(bytes);

  beforeAll(async () => {
    ({ app, mongoose } = await bootApp('photos'));
    await createAdmin(mongoose, { username: 'boss', role: 'admin' });
    token = (await login(app, 'boss', PASSWORD)).body.token;
  });

  beforeEach(async () => {
    booking = (await request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp()).send(validBooking())).body.booking;
  });

  test('the photo is stored as binary in its own collection, not inside the booking', async () => {
    expect((await uploadPhoto()).status).toBe(201);

    const photo = await mongoose.model('BookingPhoto').findOne({ bookingNumber: booking.bookingNumber });
    expect(photo.contentType).toBe('image/jpeg');
    expect(photo.size).toBe(JPEG.length);
    expect(Buffer.compare(Buffer.from(photo.data), JPEG)).toBe(0);

    const stored = await mongoose.model('Booking').findOne({ bookingNumber: booking.bookingNumber }).lean();
    expect(stored.hasPhoto).toBe(true);
    expect(stored.photo).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('JFIF');
  });

  test('an admin gets exactly the bytes that were uploaded', async () => {
    await uploadPhoto();
    const res = await request(app).get(`/api/admin/bookings/${booking.bookingNumber}/photo`).set(bearer(token));
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, JPEG)).toBe(0);
  });

  test('re-uploading replaces rather than adds', async () => {
    await uploadPhoto();
    const second = Buffer.concat([JPEG, Buffer.from('second')]);
    await uploadPhoto(second);
    expect(await mongoose.model('BookingPhoto').countDocuments({ bookingNumber: booking.bookingNumber })).toBe(1);
    const res = await request(app).get(`/api/admin/bookings/${booking.bookingNumber}/photo`).set(bearer(token));
    expect(Buffer.compare(res.body, second)).toBe(0);
  });

  test('photos expire automatically after 90 days (TTL index) and booking numbers are unique', async () => {
    const indexes = await mongoose.model('BookingPhoto').collection.indexes();
    const ttl = indexes.find((i) => i.key && i.key.createdAt === 1);
    expect(ttl.expireAfterSeconds).toBe(90 * 24 * 60 * 60);
    const unique = indexes.find((i) => i.key && i.key.bookingNumber === 1);
    expect(unique.unique).toBe(true);
  });

  test('a customer can delete their photo, and the flag clears', async () => {
    await uploadPhoto();
    await request(app).delete(`/api/bookings/${booking.bookingNumber}/photo`).query({ token: booking.receiptToken }).expect(200);
    expect(await mongoose.model('BookingPhoto').countDocuments({ bookingNumber: booking.bookingNumber })).toBe(0);
    expect((await mongoose.model('Booking').findOne({ bookingNumber: booking.bookingNumber })).hasPhoto).toBe(false);
  });

  test('deleting a booking removes its photo from the database', async () => {
    await uploadPhoto();
    await request(app).delete(`/api/bookings/${booking.id}`).set(bearer(token)).expect(200);
    expect(await mongoose.model('BookingPhoto').countDocuments({ bookingNumber: booking.bookingNumber })).toBe(0);
  });

  test('the wrong token stores nothing', async () => {
    expect((await uploadPhoto(JPEG, 'f'.repeat(32))).status).toBe(403);
    expect(await mongoose.model('BookingPhoto').countDocuments({ bookingNumber: booking.bookingNumber })).toBe(0);
  });

  test('booking lists stay light: no image bytes in the admin list', async () => {
    await uploadPhoto();
    const res = await request(app).get('/api/admin/bookings').set(bearer(token));
    expect(JSON.stringify(res.body)).not.toContain('JFIF');
  });
});

