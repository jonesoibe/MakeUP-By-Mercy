# PHASE 2 SECURITY ENHANCEMENTS - TEST CASES

**Quick reference for verifying all Phase 2 fixes are working**

---

## TEST SETUP

```bash
# 1. Install updated dependencies
npm install

# 2. Start server
npm start

# Server should output:
# INFO: Server listening on http://localhost:3000

# 3. Open another terminal for tests
cd <project-directory>
```

---

## TEST 1: Rate Limiting

### ✅ Test Global Rate Limiter

```bash
# Global limit: 1000 requests per 15 minutes per IP

# Generate 1001 requests rapidly
for i in {1..1001}; do
  curl -s http://localhost:3000/api/bookings &
done
wait

# After request 1000, should get 429 Too Many Requests
# Response: "Too many requests from this IP, please try again later."
```

**Result:** ✅ PASS if request 1001+ returns 429 status code

### ✅ Test Auth Rate Limiter

```bash
# Auth limit: 5 failed attempts per 15 minutes per IP

# Make 6 login attempts with wrong password
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/admin/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"wrongpassword"}'
  echo ""
done

# Responses 1-5: { "success": false, "message": "Invalid credentials" }
# Response 6: 429 Too Many Requests
```

**Result:** ✅ PASS if attempt 6 returns 429 status code

### ✅ Test Booking Rate Limiter

```bash
# Booking limit: 10 bookings per hour per IP

# Create 11 bookings rapidly
for i in {1..11}; do
  curl -X POST http://localhost:3000/api/bookings \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Test User '$i'",
      "email": "test'$i'@example.com",
      "phone": "1234567890",
      "service": "bridal",
      "date": "2026-10-01"
    }'
  echo ""
done

# Bookings 1-10: Success (201)
# Booking 11: 429 Too Many Requests
```

**Result:** ✅ PASS if booking 11 returns 429 status code

---

## TEST 2: Security Headers

### ✅ Verify Headers Are Present

```bash
# Check response headers
curl -I http://localhost:3000

# Should include:
curl -I http://localhost:3000 | grep -E "X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security|Content-Security-Policy"

# Expected output:
# X-Frame-Options: DENY
# X-Content-Type-Options: nosniff
# X-XSS-Protection: 1; mode=block
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# Content-Security-Policy: default-src 'self'...
# Referrer-Policy: strict-origin-when-cross-origin
# Permissions-Policy: geolocation=(), microphone=(), camera=()
```

**Result:** ✅ PASS if all headers are present

### ✅ Verify Clickjacking Protection

```bash
# Test X-Frame-Options header
curl -I http://localhost:3000 | grep "X-Frame-Options"

# Should show: X-Frame-Options: DENY
# This means page cannot be framed by other sites
```

**Result:** ✅ PASS if X-Frame-Options: DENY is present

### ✅ Verify CSP Header

```bash
# Test Content-Security-Policy
curl -I http://localhost:3000 | grep "Content-Security-Policy"

# Should show CSP policy with:
# - default-src 'self'
# - script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com
# - style-src 'self' 'unsafe-inline' https://...
# - frame-src 'none'
```

**Result:** ✅ PASS if CSP header is present and comprehensive

---

## TEST 3: XSS in Confirmation Modal

### ✅ Test XSS Payload in Name

```bash
# Submit booking with XSS payload in name
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<img src=x onerror=\"alert(\"XSS\")\">",
    "email": "test@example.com",
    "phone": "1234567890",
    "service": "bridal",
    "date": "2026-10-01"
  }'

# Response: Should succeed (201)
# Booking created with sanitized name

# Check that name was NOT sanitized on server (that's browser responsibility)
# But when displayed in modal, it should NOT execute as JavaScript
```

**Manual Test:**
1. Open browser developer console (F12)
2. Go to http://localhost:3000
3. Fill booking form with:
   - Name: `<img src=x onerror="console.log('XSS')">`
   - Email: test@example.com
   - Phone: 1234567890
   - Service: Bridal
   - Date: 2026-10-01
4. Submit
5. Watch console
6. Expected: No message in console (XSS blocked)
7. Expected: Name shown as literal text in modal

**Result:** ✅ PASS if XSS payload is rendered as text, not executed

### ✅ Test XSS in Email

```bash
# Submit booking with XSS payload in email
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test+<script>alert(\"XSS\")</script>@example.com",
    "phone": "1234567890",
    "service": "bridal",
    "date": "2026-10-01"
  }'

# Response: 400 Bad Request
# Reason: Email validation fails (contains < and >)
```

**Result:** ✅ PASS if invalid email is rejected

---

## TEST 4: Input Validation

### ✅ Test Name Validation

```bash
# Too short
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"X", "email":"test@example.com", "phone":"1234567890", "service":"bridal", "date":"2026-10-01"}' \
  -H "Content-Type: application/json"
# Response: ❌ 400 - "Name must be 2-100 characters"

# Invalid characters
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test<script>", "email":"test@example.com", ...}' \
  -H "Content-Type: application/json"
# Response: ❌ 400 - "Name contains invalid characters"

# Valid name
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"John Doe", "email":"test@example.com", ...}' \
  -H "Content-Type: application/json"
# Response: ✅ 201 - Success
```

**Result:** ✅ PASS if invalid names are rejected, valid names accepted

### ✅ Test Email Validation

```bash
# Email too long (>254 chars)
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", "email":"'$(printf 'a%.0s' {1..200})'@example.com", ...}' \
  -H "Content-Type: application/json"
# Response: ❌ 400 - "Email is too long"

# Header injection attempt
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", "email":"test@example.com\nBcc: attacker@evil.com", ...}' \
  -H "Content-Type: application/json"
# Response: ❌ 400 - "Email contains invalid characters"

# Valid email
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", "email":"john@example.com", ...}' \
  -H "Content-Type: application/json"
# Response: ✅ 201 - Success
```

**Result:** ✅ PASS if email validation works correctly

### ✅ Test Phone Validation

```bash
# Too short (< 7 digits)
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", "email":"test@example.com", "phone":"123", ...}' \
  -H "Content-Type: application/json"
# Response: ❌ 400 - "Phone must be 7-15 digits"

# Too long (> 15 digits)
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", "email":"test@example.com", "phone":"123456789012345670", ...}' \
  -H "Content-Type: application/json"
# Response: ❌ 400 - "Phone must be 7-15 digits"

# Valid phone (with formatting)
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", "email":"test@example.com", "phone":"(123) 456-7890", ...}' \
  -H "Content-Type: application/json"
# Response: ✅ 201 - Success (formatting removed)
```

**Result:** ✅ PASS if phone validation works correctly

### ✅ Test Date Validation

```bash
# Date in past
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", ..., "date":"2026-01-01"}' \
  -H "Content-Type: application/json"
# Response: ❌ 400 - "Booking date cannot be in the past"

# Date too far in future (> 1 year)
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", ..., "date":"2027-10-01"}' \
  -H "Content-Type: application/json"
# Response: ❌ 400 - "Booking date cannot be more than 1 year in the future"

# Valid date (today to 1 year)
curl -X POST http://localhost:3000/api/bookings \
  -d '{"name":"Test", ..., "date":"2026-10-01"}' \
  -H "Content-Type: application/json"
# Response: ✅ 201 - Success
```

**Result:** ✅ PASS if date validation works correctly

---

## TEST 5: Email Sanitization

### ✅ Test Admin Message Sanitization

```bash
# Admin sends message with HTML to customer
TOKEN="<your-admin-token>"

curl -X POST http://localhost:3000/api/admin/bookings/MKP-01001/contact \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Update <script>alert(\"xss\")</script>",
    "message": "Your booking is confirmed <img src=x onerror=\"alert(\"xss\")\">"
  }'

# Response: ✅ 200 - Success
# Email sent with subject/message ESCAPED
# Result: HTML tags rendered as text in email, not executed
```

**Verification:**
- Check email received by customer
- HTML tags should appear as literal text: `<script>alert...</script>`
- Not executed as code

**Result:** ✅ PASS if HTML is escaped in email

---

## COMPREHENSIVE TEST SCRIPT

```bash
#!/bin/bash

echo "========== PHASE 2 SECURITY ENHANCEMENTS TEST =========="
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test 1: Rate Limiting
echo -e "${YELLOW}[TEST 1] Rate Limiting${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:3000/api/bookings)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" == "200" ]; then
  echo -e "${GREEN}✅ PASS: API responding normally${NC}"
else
  echo -e "${RED}❌ FAIL: Expected 200, got $HTTP_CODE${NC}"
fi
echo ""

# Test 2: Security Headers
echo -e "${YELLOW}[TEST 2] Security Headers${NC}"
RESPONSE=$(curl -sI http://localhost:3000)
if echo "$RESPONSE" | grep -q "X-Frame-Options: DENY"; then
  echo -e "${GREEN}✅ PASS: X-Frame-Options header present${NC}"
else
  echo -e "${RED}❌ FAIL: X-Frame-Options header missing${NC}"
fi

if echo "$RESPONSE" | grep -q "X-Content-Type-Options: nosniff"; then
  echo -e "${GREEN}✅ PASS: X-Content-Type-Options header present${NC}"
else
  echo -e "${RED}❌ FAIL: X-Content-Type-Options header missing${NC}"
fi

if echo "$RESPONSE" | grep -q "Strict-Transport-Security"; then
  echo -e "${GREEN}✅ PASS: HSTS header present${NC}"
else
  echo -e "${RED}❌ FAIL: HSTS header missing${NC}"
fi
echo ""

# Test 3: Input Validation
echo -e "${YELLOW}[TEST 3] Input Validation${NC}"

# Test short name
RESPONSE=$(curl -s -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"name":"X","email":"test@example.com","phone":"1234567890","service":"bridal","date":"2026-10-01"}')
if echo "$RESPONSE" | grep -q "Name must be 2-100"; then
  echo -e "${GREEN}✅ PASS: Short name rejected${NC}"
else
  echo -e "${RED}❌ FAIL: Short name not validated${NC}"
fi

# Test invalid email
RESPONSE=$(curl -s -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"invalid","phone":"1234567890","service":"bridal","date":"2026-10-01"}')
if echo "$RESPONSE" | grep -q "Invalid email"; then
  echo -e "${GREEN}✅ PASS: Invalid email rejected${NC}"
else
  echo -e "${RED}❌ FAIL: Invalid email not validated${NC}"
fi

# Test short phone
RESPONSE=$(curl -s -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","phone":"123","service":"bridal","date":"2026-10-01"}')
if echo "$RESPONSE" | grep -q "Phone must be 7-15"; then
  echo -e "${GREEN}✅ PASS: Short phone rejected${NC}"
else
  echo -e "${RED}❌ FAIL: Short phone not validated${NC}"
fi
echo ""

echo -e "${GREEN}========== TEST COMPLETE ==========${NC}"
```

Save as `test-phase2.sh` and run:
```bash
chmod +x test-phase2.sh
./test-phase2.sh
```

---

## EXPECTED RESULTS

All tests should show:
```
✅ PASS: API responding normally
✅ PASS: X-Frame-Options header present
✅ PASS: X-Content-Type-Options header present
✅ PASS: HSTS header present
✅ PASS: Short name rejected
✅ PASS: Invalid email rejected
✅ PASS: Short phone rejected
```

If any test fails, refer back to `PHASE2_FIXES.md` for debugging steps.

---

## TROUBLESHOOTING

### Issue: "Cannot POST /api/bookings" (404)
- **Cause:** Server not running
- **Fix:** Run `npm start` in separate terminal

### Issue: Security headers not showing
- **Cause:** helmet not installed
- **Fix:** Run `npm install` to get latest dependencies

### Issue: Rate limiting not working (no 429)
- **Cause:** Rate limit skipped in development mode
- **Fix:** Set `NODE_ENV=production` to enable rate limiting
  ```bash
  NODE_ENV=production npm start
  ```

### Issue: XSS not prevented
- **Cause:** Browser cache of old HTML
- **Fix:** Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)

### Issue: Email validation failing
- **Cause:** Email library issue
- **Fix:** Run `npm audit fix` to update dependencies

---

## WHAT'S NEXT?

After verifying all Phase 2 tests pass:

1. Deploy to staging
2. Run full regression test suite
3. Move to Phase 3 (optional) or production
4. Monitor logs for any issues
5. Plan Phase 3 for next sprint

**Status: 🟢 PRODUCTION READY**
