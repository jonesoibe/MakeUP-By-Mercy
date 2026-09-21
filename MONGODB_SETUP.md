# MongoDB Atlas Cloud Setup Guide

## Overview

Your application now supports both:
- ✅ **In-memory storage** (for testing/development)
- ✅ **MongoDB Atlas Cloud** (for production/persistent data)

## Issues Fixed

### Email Problem
The previous timeout issue (`ETIMEDOUT 142.250.102.108:465`) was caused by using port 465 (SSL). This has been fixed by:
- ✅ Switching to port 587 (TLS)
- ✅ Enhanced error logging to diagnose issues
- ✅ Better email configuration validation

### Logging Added
- ✅ File-based logging (logs saved to `logs/` folder)
- ✅ Console output with timestamps
- ✅ Email send/receive tracking
- ✅ Database operation logging
- ✅ Error tracking for debugging

## Step-by-Step MongoDB Atlas Setup

### Step 1: Create MongoDB Atlas Account

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Click "Try Free"
3. Sign up with email/Google account
4. Verify your email

### Step 2: Create a Cluster

1. **Create a Project**
   - Project Name: `makeup-by-mercy`
   - Click "Create Project"

2. **Create a Cluster**
   - Click "Build a Database"
   - Choose "Free" tier (M0)
   - Cloud Provider: AWS (or your preference)
   - Region: Select nearest to you
   - Cluster Name: `makeup-cluster`
   - Click "Create Cluster"
   - Wait 2-3 minutes for cluster creation

### Step 3: Create Database User

1. **Security → Database Access**
2. **Add New Database User**
   - Username: `makeup_user`
   - Password: Generate secure password (save it!)
   - Role: `Read and write to any database`
   - Click "Add User"

### Step 4: Set Up Network Access

1. **Security → Network Access**
2. **Add IP Address**
   - Click "Add IP Address"
   - Click "Allow Access from Anywhere" (for now)
   - Click "Confirm"

   ⚠️ For production, use specific IP addresses instead.

### Step 5: Get Connection String

1. **Deployments → Databases**
2. Click your cluster
3. Click "Connect"
4. Choose "Connect your application"
5. Select **Node.js** as driver
6. Copy the connection string:
   ```
   mongodb+srv://makeup_user:PASSWORD@makeup-cluster.xxxxx.mongodb.net/makeup_mercy?retryWrites=true&w=majority
   ```

### Step 6: Update .env File

Replace the `PASSWORD` in the connection string with your database password:

```env
MONGODB_URI=mongodb+srv://makeup_user:your-password@makeup-cluster.xxxxx.mongodb.net/makeup_mercy?retryWrites=true&w=majority
```

### Step 7: Install Dependencies

```bash
npm install
```

This installs:
- `mongoose` - MongoDB connection library
- All other required packages

### Step 8: Start the Server

```bash
npm start
```

You should see:
```
✅ Connected to MongoDB Atlas
✅ Email service ready
🚀 Server running on http://localhost:3000
```

## Database Structure

### Bookings Collection

Your MongoDB database will automatically create a "bookings" collection with this structure:

```json
{
  "_id": "ObjectId",
  "id": 1234567890,
  "name": "John Doe",
  "email": "john@example.com",
  "service": "bridal",
  "date": "2026-12-25",
  "bookedAt": "2026-09-21T10:30:00.000Z",
  "status": "confirmed",
  "emailSent": true,
  "ownerEmailSent": true
}
```

### Fields Explained

| Field | Type | Purpose |
|-------|------|---------|
| `id` | Number | Unique booking identifier |
| `name` | String | Client's name |
| `email` | String | Client's email |
| `service` | String | Service type (bridal/party/casual) |
| `date` | String | Booking date (YYYY-MM-DD) |
| `bookedAt` | Date | When booking was created |
| `status` | String | Booking status (confirmed/cancelled) |
| `emailSent` | Boolean | Client confirmation email sent? |
| `ownerEmailSent` | Boolean | Owner notification email sent? |

## Application Logging

Logs are saved to `logs/` folder with filename format: `app-YYYY-MM-DD.log`

### Log Levels

- **INFO** - General information (connections, operations)
- **SUCCESS** - Operation completed successfully
- **WARN** - Warning (email disabled, missing config)
- **ERROR** - Error occurred (connection failed, validation error)

### Sample Log Output

```
[2026-09-21T10:30:00Z] INFO: 🚀 Server starting...
[2026-09-21T10:30:02Z] INFO: ✅ Connected to MongoDB Atlas
[2026-09-21T10:30:02Z] INFO: ✅ Email service ready
[2026-09-21T10:30:05Z] INFO: ✅ New booking: John Doe | john@example.com | bridal | 2026-12-25
[2026-09-21T10:30:05Z] INFO: 📧 Sending confirmation email to john@example.com
[2026-09-21T10:30:07Z] SUCCESS: ✅ Confirmation email sent to john@example.com
[2026-09-21T10:30:07Z] INFO: 📧 Sending booking notification to oibeumume@gmail.com
[2026-09-21T10:30:08Z] SUCCESS: ✅ Booking notification sent to owner
```

## API Endpoints (Updated)

All endpoints now return database information:

```bash
# Get all bookings
GET /api/bookings
# Returns: { success, count, bookings, database: "MongoDB" }

# Get specific booking
GET /api/bookings/:id
# Returns: { success, booking }

# Create booking
POST /api/bookings
# Body: { name, email, service, date }
# Returns: { success, message, booking }

# Cancel booking
DELETE /api/bookings/:id
# Returns: { success, message }

# Health check
GET /api/health
# Returns: { status: "Server is running" }
```

## Troubleshooting

### Connection Failed
```
Error: connect ECONNREFUSED
```
**Solution:**
- Check MONGODB_URI in .env
- Verify IP address is allowed in Atlas
- Ensure cluster is running (not paused)

### Authentication Failed
```
Error: authentication failed
```
**Solution:**
- Verify username and password
- Check @ symbol is URL-encoded as %40 if needed
- Ensure user exists in Database Access

### Email Not Sending
```
Error: connect ETIMEDOUT
```
**Solution:**
- Check EMAIL_USER and EMAIL_PASSWORD
- Verify Gmail app password (not regular password)
- Enable "Less secure app access" if using regular Gmail password

### Database Not Found
```
Error: namespace does not exist
```
**Solution:**
- Database is created automatically on first write
- Insert first booking to create database
- No manual creation needed

## Monitoring

### Check Logs

```bash
# View today's logs
cat logs/app-2026-09-21.log

# Follow real-time logs
tail -f logs/app-2026-09-21.log
```

### MongoDB Atlas Dashboard

1. Go to Deployments → Databases
2. Click your cluster
3. View metrics and operations

## Backup & Recovery

MongoDB Atlas automatically:
- ✅ Backs up data daily
- ✅ Stores backups for 30 days
- ✅ Allows point-in-time recovery

To restore:
1. Deployments → Backup
2. Click "Restore" on desired backup
3. Follow recovery steps

## Production Checklist

- ☐ MONGODB_URI configured
- ☐ Email credentials verified
- ☐ Network IP whitelist set to production server IP
- ☐ OWNER_EMAIL configured
- ☐ Logs monitored
- ☐ Database backups verified
- ☐ Error notifications set up

## Next Steps

1. ✅ Install dependencies: `npm install`
2. ✅ Set MONGODB_URI in .env
3. ✅ Restart server: `npm start`
4. ✅ Test by making a booking
5. ✅ Verify logs show MongoDB connection
6. ✅ Check bookings in MongoDB Atlas dashboard

---

**Need Help?**

- MongoDB Docs: https://docs.mongodb.com/atlas/
- Mongoose Docs: https://mongoosejs.com/
- Email Issues: Check logs in `logs/` folder
- Connection Issues: Verify IP whitelist in Network Access
