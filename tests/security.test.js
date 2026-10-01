const request = require('supertest');
const { loadApp, authHeader, uniqueIp, validBooking } = require('./helpers/app');

describe('static files', () => {
  let app;
  beforeAll(() => { ({ app } = loadApp()); });

  test.each([
    '/server.js',
    '/package.json',
    '/package-lock.json',
    '/MONGODB_CREDENTIALS.md',
    '/README.md',
    '/logs/combined.log',
    '/.env',
    '/.git/config'
  ])('%s is not served', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(404);
  });

  test.each([
    '/',
    '/index.html',
    '/admin',
    '/admin-login',
    '/admin.js',
    '/admin-login.js',
    '/Pictures/web/portrait.jpg',
    '/swagger.json',
    '/api/health'
  ])('%s is served', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
  });
});

describe('authentication required', () => {
  let app;
  beforeAll(() => { ({ app } = loadApp()); });

  const protectedRoutes = [
    ['get', '/api/bookings'],
    ['get', '/api/bookings/1'],
    ['delete', '/api/bookings/1'],
    ['get', '/api/admin/dashboard'],
    ['get', '/api/admin/bookings'],
    ['get', '/api/admin/bookings/recent'],
    ['get', '/api/admin/appointments/upcoming'],
    ['get', '/api/admin/analytics'],
    ['get', '/api/admin/pricing'],
    ['post', '/api/admin/pricing'],
    ['patch', '/api/admin/pricing/bridal'],
    ['get', '/api/admin/availability'],
    ['patch', '/api/admin/availability'],
    ['get', '/api/admin/email-templates'],
    ['put', '/api/admin/email-templates/confirmation'],
    ['get', '/api/admin/users'],
    ['post', '/api/admin/users'],
    ['patch', '/api/admin/users/507f1f77bcf86cd799439011'],
    ['delete', '/api/admin/users/507f1f77bcf86cd799439011'],
    ['patch', '/api/admin/bookings/abc/confirm'],
    ['patch', '/api/admin/bookings/abc/cancel'],
    ['post', '/api/admin/bookings/abc/message']
  ];

  test.each(protectedRoutes)('%s %s without a token -> 401', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });

  test('a token with a bad signature is rejected', async () => {
    const res = await request(app).get('/api/admin/bookings').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  test('receipts reject a request with no token and no admin login', async () => {
    const res = await request(app).get('/api/bookings/MKP-01001/receipt/pdf');
    expect(res.status).toBe(403);
  });
});

describe('role permissions', () => {
  let app;
  const viewer = { id: 'viewer-1', username: 'viewer', role: 'viewer' };
  const manager = { id: 'manager-1', username: 'manager', role: 'manager' };

  beforeAll(() => { ({ app } = loadApp()); });

  test('a viewer can read bookings', async () => {
    const res = await request(app).get('/api/admin/bookings').set(authHeader(viewer));
    expect(res.status).toBe(200);
  });

  // [method, path, body]
  const adminOnly = [
    ['patch', '/api/admin/pricing/bridal', { price: 100 }],
    ['post', '/api/admin/pricing', { bridal: { price: 100 } }],
    ['patch', '/api/admin/availability', { weekdayStart: '09:00', weekdayEnd: '17:00', weekendStart: '10:00', weekendEnd: '16:00', leadTimeDays: 1 }],
    ['put', '/api/admin/email-templates/confirmation', { subject: 'Valid subject', body: 'A sufficiently long body text.' }],
    ['get', '/api/admin/users', undefined],
    ['post', '/api/admin/users', { username: 'newadmin', email: 'n@example.com', password: 'Str0ng!pass' }],
    ['delete', '/api/admin/users/507f1f77bcf86cd799439011', undefined]
  ];

  test.each(adminOnly)('manager cannot %s %s', async (method, path, body) => {
    const res = await request(app)[method](path).set(authHeader(manager)).send(body || {});
    expect(res.status).toBe(403);
  });

  test('a viewer cannot delete a booking or message a customer', async () => {
    const del = await request(app).delete('/api/bookings/1').set(authHeader(viewer));
    expect(del.status).toBe(403);
    const msg = await request(app).post('/api/admin/bookings/abc/message').set(authHeader(viewer)).send({ message: 'hi' });
    expect(msg.status).toBe(403);
  });

  test('a manager may delete a booking (404 for an unknown id, not 403)', async () => {
    const res = await request(app).delete('/api/bookings/1').set(authHeader(manager));
    expect(res.status).toBe(404);
  });

  describe('updating users', () => {
    const adminId = '507f1f77bcf86cd799439013';

    test('a viewer cannot change another user\'s password', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${adminId}`)
        .set(authHeader(viewer))
        .send({ password: 'Newpass1!x' });
      expect(res.status).toBe(403);
    });

    test('a viewer cannot promote themselves', async () => {
      const res = await request(app)
        .patch('/api/admin/users/viewer-1')
        .set(authHeader(viewer))
        .send({ role: 'admin' });
      expect(res.status).toBe(403);
    });

    test('an empty update is rejected as invalid', async () => {
      const res = await request(app).patch(`/api/admin/users/${adminId}`).set(authHeader()).send({});
      expect(res.status).toBe(400);
    });

    test('a weak password is rejected', async () => {
      const res = await request(app).patch(`/api/admin/users/${adminId}`).set(authHeader()).send({ password: 'short' });
      expect(res.status).toBe(400);
    });
  });
});

describe('admin login without a database', () => {
  const login = (app, password, username = 'admin') =>
    request(app).post('/api/admin/login').send({ username, password });

  test('the old default password is refused', async () => {
    const { app } = loadApp();
    const res = await login(app, 'admin123');
    expect(res.status).toBe(503);
    expect(res.body.token).toBeUndefined();
  });

  test('login is unavailable when no dev password is configured', async () => {
    const { app } = loadApp();
    const res = await login(app, 'anything-at-all');
    expect(res.status).toBe(503);
  });

  test('with DEV_ADMIN_PASSWORD the matching password logs in and a wrong one does not', async () => {
    const { app } = loadApp({ env: { DEV_ADMIN_PASSWORD: 'local-dev-password' } });
    const ok = await login(app, 'local-dev-password');
    expect(ok.status).toBe(200);
    expect(ok.body.token).toEqual(expect.any(String));

    const wrong = await login(app, 'admin123');
    expect(wrong.status).toBe(401);
  });

  test('DEV_ADMIN_PASSWORD is ignored in production', async () => {
    const { app } = loadApp({ env: { NODE_ENV: 'production', DEV_ADMIN_PASSWORD: 'local-dev-password' } });
    const res = await login(app, 'local-dev-password');
    expect(res.status).toBe(503);
  });

  test('DEV_ADMIN_PASSWORD is ignored when a database is configured but unreachable', async () => {
    const { app, mongoose } = loadApp({
      mongoUri: 'mongodb://127.0.0.1:1/unreachable?serverSelectionTimeoutMS=300',
      env: { DEV_ADMIN_PASSWORD: 'local-dev-password' }
    });
    const res = await login(app, 'local-dev-password');
    expect(res.status).toBe(503);
    await mongoose.disconnect().catch(() => {});
  });

  test('a valid-looking token is refused (503) when the database is configured but down', async () => {
    const { app, mongoose } = loadApp({ mongoUri: 'mongodb://127.0.0.1:1/unreachable?serverSelectionTimeoutMS=300' });
    const res = await request(app)
      .get('/api/admin/bookings')
      .set(authHeader({ id: '507f1f77bcf86cd799439011' }));
    expect(res.status).toBe(503);
    await mongoose.disconnect().catch(() => {});
  });
});

describe('CORS', () => {
  let app;
  beforeAll(() => { ({ app } = loadApp()); });

  const post = (origin, host) => {
    let req = request(app).post('/api/bookings').set('X-Forwarded-For', uniqueIp());
    if (origin) req = req.set('Origin', origin);
    if (host) req = req.set('Host', host);
    return req.send(validBooking());
  };

  test('no Origin header is allowed', async () => {
    expect((await post()).status).toBe(201);
  });

  test('a whitelisted origin is allowed', async () => {
    expect((await post('http://localhost:3000')).status).toBe(201);
  });

  test('the site\'s own host is allowed on any domain', async () => {
    expect((await post('https://shop.example.org', 'shop.example.org')).status).toBe(201);
  });

  test('a foreign origin is rejected with 403 JSON', async () => {
    const res = await post('https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('rate limiting', () => {
  test('booking attempts are limited per client IP, not globally', async () => {
    const { app } = loadApp();
    const ipA = uniqueIp();
    const ipB = uniqueIp();
    const attempt = (ip) => request(app).post('/api/bookings').set('X-Forwarded-For', ip).send({});

    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await attempt(ipA)).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);

    // A different visitor is unaffected
    expect((await attempt(ipB)).status).toBe(400);
  });

  test('page and image loads do not consume the API rate limit', async () => {
    const { app } = loadApp();
    const ip = uniqueIp();
    for (let i = 0; i < 320; i += 1) {
      await request(app).get('/').set('X-Forwarded-For', ip);
    }
    const res = await request(app).get('/api/pricing/bridal').set('X-Forwarded-For', ip);
    expect(res.status).toBe(200);
  });
});
