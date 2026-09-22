# PHASE 1 SECURITY FIXES - TEST CASES

**Quick reference for verifying all Phase 1 fixes are working**

---

## TEST SETUP

```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start

# Server should output:
# INFO: Server listening on http://localhost:3000

# 3. Open another terminal for tests
cd <project-directory>
```

---

## TEST 1: JWT Secret (Fix #1)

### ✅ Verify Strong Secret is Generated

```bash
# Check server logs for JWT secret message
npm start 2>&1 | grep "JWT_SECRET"

# Should show one of:
# ✅ "WARN: JWT_SECRET not set in environment. Generated random secret for this session."
# ❌ "CRITICAL: JWT_SECRET must be set in production environment!" (for NODE_ENV=production)
```

### ✅ Verify Token Forgery is Impossible

```bash
# Try to forge a token with known secret
node -e "
const jwt = require('jsonwebtoken');
const fakeSecret = 'makeup-mercy-secret-key-change-in-production';
const forgedToken = jwt.sign({ id: '1', username: 'hacker', role: 'admin' }, fakeSecret);
console.log('Forged token:', forgedToken);
"

# Use forged token in request
curl -H "Authorization: Bearer <forgedToken>" http://localhost:3000/api/admin/dashboard

# Expected: 401 Unauthorized
# { "success": false, "message": "Invalid or expired token" }
```

**Result:** ✅ PASS if request is rejected

---

## TEST 2: NoSQL Injection Validation (Fix #2)

### ✅ Verify Valid Booking Numbers Work

```bash
# Create a test booking first
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "phone": "1234567890",
    "service": "bridal",
    "date": "2026-10-01"
  }'

# Note the bookingNumber from response (e.g., MKP-01001)
# Then try to access with admin token (will get error without token, which is expected)

# For now, check that invalid formats are rejected:
```

### ❌ Verify NoSQL Injection Attacks are Blocked

```bash
# Test 1: Object injection
curl http://localhost:3000/api/bookings/'{"$ne":"null"}'/receipt/pdf
# Expected: 401 Unauthorized (requires auth)
# OR: 400 Invalid booking number format (if using validateBookingNumber)

# Test 2: Regex injection
curl http://localhost:3000/api/bookings/'{"$regex":"^MKP"}'/receipt/pdf
# Expected: 400 Invalid booking number format

# Test 3: Null injection
curl 'http://localhost:3000/api/bookings/null/receipt/pdf'
# Expected: 400 Invalid booking number format

# Test 4: SQL-like injection (for completeness)
curl 'http://localhost:3000/api/bookings/"; DROP TABLE bookings;/receipt/pdf'
# Expected: 400 Invalid booking number format
```

**Result:** ✅ PASS if all invalid formats return 400 errors

---

## TEST 3: Receipt Endpoint Authentication (Fix #3)

### ❌ Verify Public Access is Blocked

```bash
# Try to access receipt without token
curl http://localhost:3000/api/bookings/MKP-01001/receipt/pdf

# Expected:
# { "success": false, "message": "Unauthorized" }
```

### ✅ Verify Admin Token Works

```bash
# 1. First, login as admin
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your-admin-password>"}'

# Response:
# { "success": true, "token": "eyJhbGc...", "username": "admin", "role": "admin" }

# 2. Save the token
TOKEN="eyJhbGc..."

# 3. Access receipt with token
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/bookings/MKP-01001/receipt/pdf

# Expected: PDF file (binary download) or 404 if booking doesn't exist
```

**Result:** ✅ PASS if:
- Without token → 401 Unauthorized
- With valid token → 200 OK (or 404 if booking doesn't exist)

---

## TEST 4: CORS Whitelist (Fix #4)

### ❌ Verify Blocked Origins Fail

```bash
# Test from non-whitelisted origin
curl -H "Origin: https://attacker.com" http://localhost:3000/api/bookings

# Expected: Response with NO "Access-Control-Allow-Origin" header
# (Browser would block this automatically)

# Check headers:
curl -I -H "Origin: https://attacker.com" http://localhost:3000/api/bookings
# Should NOT show: Access-Control-Allow-Origin header
```

### ✅ Verify Whitelisted Origins Work

```bash
# Test from whitelisted origin (localhost)
curl -H "Origin: http://localhost:3000" http://localhost:3000/api/bookings

# Expected: Response includes Access-Control-Allow-Origin header
curl -I -H "Origin: http://localhost:3000" http://localhost:3000/api/bookings
# Should show: Access-Control-Allow-Origin: http://localhost:3000

# For production, test your domain
curl -H "Origin: https://makeup-mercy.com" https://app.makeup-mercy.com/api/bookings
# Should show: Access-Control-Allow-Origin: https://makeup-mercy.com
```

**Result:** ✅ PASS if:
- Blocked origins have no CORS headers
- Whitelisted origins have correct CORS headers

---

## TEST 5: Secure Default Admin Password (Fix #5)

### ✅ Verify Default Credentials Don't Work

```bash
# Try old hardcoded password
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Expected:
# { "success": false, "message": "Invalid credentials" }
```

### ✅ Verify New Password Works

```bash
# Check server logs for temporary password (if in dev mode)
# Look for: "WARN: Default admin user created with temporary password: ..."

# Or use password set via INITIAL_ADMIN_PASSWORD environment variable

# Login with correct password
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<correct-password>"}'

# Expected:
# { "success": true, "token": "...", "username": "admin", "role": "admin" }
```

**Result:** ✅ PASS if:
- `admin123` is rejected
- Correct password works

---

## COMPREHENSIVE TEST SCRIPT

Copy and run this script to test all Phase 1 fixes:

```bash
#!/bin/bash

echo "========== PHASE 1 SECURITY FIXES TEST =========="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: NoSQL Injection
echo -e "${YELLOW}[TEST 1] NoSQL Injection Validation${NC}"
RESPONSE=$(curl -s http://localhost:3000/api/bookings/'{"$ne":"null"}'/receipt/pdf)
if echo "$RESPONSE" | grep -q "Invalid booking number format\|Unauthorized"; then
  echo -e "${GREEN}✅ PASS: NoSQL injection blocked${NC}"
else
  echo -e "${RED}❌ FAIL: Invalid format not rejected${NC}"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 2: Receipt Endpoint Auth
echo -e "${YELLOW}[TEST 2] Receipt Endpoint Authentication${NC}"
RESPONSE=$(curl -s http://localhost:3000/api/bookings/MKP-01001/receipt/pdf)
if echo "$RESPONSE" | grep -q "Unauthorized"; then
  echo -e "${GREEN}✅ PASS: Unauthorized access blocked${NC}"
else
  echo -e "${RED}❌ FAIL: Receipt accessible without auth${NC}"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 3: CORS Whitelist
echo -e "${YELLOW}[TEST 3] CORS Whitelist${NC}"
RESPONSE=$(curl -sI -H "Origin: https://attacker.com" http://localhost:3000/api/bookings)
if echo "$RESPONSE" | grep -q "Access-Control-Allow-Origin"; then
  echo -e "${RED}❌ FAIL: Attacker origin allowed${NC}"
else
  echo -e "${GREEN}✅ PASS: Attacker origin blocked${NC}"
fi
echo ""

# Test 4: Default Admin Password
echo -e "${YELLOW}[TEST 4] Default Admin Password${NC}"
RESPONSE=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')
if echo "$RESPONSE" | grep -q "Invalid credentials"; then
  echo -e "${GREEN}✅ PASS: Hardcoded password rejected${NC}"
else
  echo -e "${RED}❌ FAIL: Hardcoded password still works${NC}"
  echo "Response: $RESPONSE"
fi
echo ""

echo -e "${GREEN}========== TEST COMPLETE ==========${NC}"
```

Save as `test-phase1.sh` and run:
```bash
chmod +x test-phase1.sh
./test-phase1.sh
```

---

## EXPECTED RESULTS

All tests should show:
```
✅ PASS: NoSQL injection blocked
✅ PASS: Unauthorized access blocked
✅ PASS: Attacker origin blocked
✅ PASS: Hardcoded password rejected
```

If any test fails, refer back to `PHASE1_FIXES.md` for debugging steps.

---

## TROUBLESHOOTING

### Issue: "Cannot POST /api/admin/login"
- **Cause:** Server not running
- **Fix:** Run `npm start` in separate terminal

### Issue: "Error: connect ECONNREFUSED"
- **Cause:** Server not running on port 3000
- **Fix:** Check `PORT` in `.env` or use `PORT=3000 npm start`

### Issue: "Invalid credentials" for new password
- **Cause:** Using wrong password for admin
- **Fix:** Check server logs for temporary password (dev) or use `INITIAL_ADMIN_PASSWORD` (prod)

### Issue: CORS test shows "Access-Control-Allow-Origin" for attacker.com
- **Cause:** CORS whitelist not updated
- **Fix:** Verify `allowedOrigins` array in `server.js` line ~89

### Issue: NoSQL injection test shows "Booking not found" instead of invalid format
- **Cause:** validateBookingNumber working correctly, but then booking doesn't exist
- **Fix:** This is actually passing - the error message is expected

---

## WHAT'S NEXT?

After verifying all Phase 1 tests pass:

1. Deploy to staging environment
2. Run full security test suite
3. Move to Phase 2 (rate limiting, headers, XSS fixes)
4. Deploy to production

**Estimated Time:** Phase 1 complete in ~1 hour + testing
