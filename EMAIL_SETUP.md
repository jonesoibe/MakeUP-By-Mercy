# Email Setup Guide - Dual Email Notifications

## Overview

Your website now sends **two automated emails** on every booking:

1. **Client Email** - Confirmation to the person booking
2. **Owner Email** - Notification to Mercy about new bookings

## Configuration

### Step 1: Gmail Setup (Recommended)

#### For CLIENT CONFIRMATIONS:
1. Go to: https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer" (or your device)
3. Google generates a 16-character password
4. Copy this password

#### For OWNER NOTIFICATIONS:
You have two options:

**Option A: Same Email (Simple)**
- Use the same Gmail account for both client confirmations and owner notifications
- Just set `EMAIL_USER` - the `OWNER_EMAIL` will default to this

**Option B: Separate Emails (Recommended for Business)**
- Use a business email for sending (`EMAIL_USER`)
- Use Mercy's personal email for receiving notifications (`OWNER_EMAIL`)
- This way Mercy gets booking notifications separately

### Step 2: Update Your `.env` File

Create a `.env` file in the root directory with:

```env
# Email Service (gmail or outlook)
EMAIL_SERVICE=gmail

# Email account for SENDING emails (should be a business/automated account)
EMAIL_USER=bookings@makeupbymercy.com
EMAIL_PASSWORD=xxxx xxxx xxxx xxxx

# Email to RECEIVE booking notifications (Mercy's personal email)
OWNER_EMAIL=mercy@gmail.com

# Server Configuration
PORT=3000
NODE_ENV=production
```

### Step 3: Restart the Server

```bash
npm start
```

## How It Works

### When a booking is made:

1. **Client receives:**
   - Booking confirmation with their booking ID
   - Service details and date
   - What to expect from the appointment
   - Instructions for rescheduling

2. **Mercy receives:**
   - Alert about new booking
   - Client's name and contact info
   - Service type and date
   - Reminder to confirm appointment

## Email Templates

Both emails are professionally formatted with:
- Brand colors and styling
- Clear booking information
- Call-to-action items
- Professional footer

## Troubleshooting

### Emails not sending?

Check your `server.js` console logs:
```
✅ Confirmation email sent to client@email.com
✅ Booking notification sent to owner@email.com
```

**If you see errors:**

1. **"Invalid login"** - Gmail app password is incorrect
   - Generate a new one at: https://myaccount.google.com/apppasswords

2. **"Username and password not accepted"** - Wrong email/password
   - Double-check EMAIL_USER and EMAIL_PASSWORD

3. **Mercy not receiving emails** - OWNER_EMAIL might be wrong
   - Verify the email address in `.env`
   - Check spam folder

4. **Emails disabled** - No EMAIL_USER configured
   - Add EMAIL_USER and EMAIL_PASSWORD to `.env`

## Outlook/Hotmail Setup

If using Outlook instead of Gmail:

```env
EMAIL_SERVICE=outlook
EMAIL_USER=your-email@outlook.com
EMAIL_PASSWORD=your-password
OWNER_EMAIL=mercy-email@outlook.com
```

Note: Outlook app passwords work differently than Gmail

## Testing

Test your setup with the booking form:
1. Go to http://localhost:3000
2. Fill in the booking form
3. Submit with a future date
4. Check both email inboxes

You should see:
- ✅ Client confirmation email
- ✅ Mercy booking notification email

---

**Questions?** Check the main README.md for deployment and setup info.
