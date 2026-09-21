# MakeUP By Mercy - Deployment Guide

## 🚀 Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open in browser
http://localhost:3000
```

## 📧 Email Configuration

### Setup Gmail (Recommended)

1. **Enable 2-Factor Authentication** on your Google Account
2. **Generate App Password**:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Windows Computer"
   - Copy the 16-character password
3. **Create `.env` file** in project root:

```env
PORT=3000
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-16-character-app-password
NODE_ENV=production
```

4. **Restart server** - emails will now be sent on booking confirmations

### Alternative: Use Outlook/Hotmail

```env
EMAIL_SERVICE=outlook
EMAIL_USER=your-email@outlook.com
EMAIL_PASSWORD=your-password
```

## ☁️ Deploy to Production

### Option 1: Railway.app (Recommended - Easiest)

1. **Create Railway Account**: https://railway.app
2. **Connect GitHub** (push code to GitHub first)
3. **Create New Project** → Select your repo
4. **Add Environment Variables**:
   - `PORT`: 3000
   - `EMAIL_USER`: your email
   - `EMAIL_PASSWORD`: your app password
   - `NODE_ENV`: production
5. **Deploy** - Railway will automatically run `npm start`
6. **Get Live URL** from Railway dashboard

### Option 2: Render.com

1. **Create Render Account**: https://render.com
2. **Create New Web Service**
3. **Connect GitHub** and select repository
4. **Configure**:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
5. **Add Environment Variables** in Dashboard
6. **Deploy** and get live URL

### Option 3: Heroku

1. **Install Heroku CLI**
2. **Login**: `heroku login`
3. **Create app**: `heroku create your-app-name`
4. **Set environment variables**:
   ```bash
   heroku config:set EMAIL_USER=your-email@gmail.com
   heroku config:set EMAIL_PASSWORD=your-app-password
   heroku config:set NODE_ENV=production
   ```
5. **Deploy**: `git push heroku main`

### Option 4: DigitalOcean App Platform

1. Create DigitalOcean Account
2. Create App Platform project
3. Connect GitHub repository
4. Set Build/Run commands
5. Add environment variables
6. Deploy

## 🔧 Environment Variables Reference

```env
# Server
PORT=3000
NODE_ENV=production

# Email (Required for bookings to send confirmation emails)
EMAIL_SERVICE=gmail (or outlook)
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password

# Optional: Database (for future enhancement)
DATABASE_URL=postgresql://user:pass@host/db
```

## 📋 Features Included

✅ **Frontend**
- Responsive design (mobile, tablet, desktop)
- Smooth animations (Saluni-style)
- Service showcase with cards
- Phone mockup animation with gallery
- Professional booking form
- Live email notifications

✅ **Backend (Node.js)**
- Express.js REST API
- Form validation (date, email, name)
- Prevents past date bookings
- Automated email confirmations
- CORS enabled for frontend
- In-memory booking storage (upgrade to database for production)

## 📊 API Endpoints

```
POST   /api/bookings          Create new booking
GET    /api/bookings          Get all bookings
GET    /api/bookings/:id      Get specific booking
DELETE /api/bookings/:id      Cancel booking
GET    /api/health            Health check
```

## 🔐 Security Considerations

1. **Upgrade Database**: Currently uses in-memory storage (lost on restart)
   - Recommended: MongoDB, PostgreSQL
   
2. **Add Authentication**: For admin/management features
   - JWT tokens recommended

3. **Rate Limiting**: Add rate limiter to prevent spam

4. **Email Validation**: Already includes validation

5. **HTTPS**: Enabled by default on Railway/Render/Heroku

## 📱 Testing the Deployment

1. Visit live URL: `https://your-app.railway.app` (or similar)
2. Fill out booking form
3. Check email for confirmation
4. Admin: Visit `/api/bookings` to see all bookings

## 🐛 Troubleshooting

**Emails not sending?**
- Check `.env` has correct email credentials
- For Gmail: Use 16-character app password (not regular password)
- Check EMAIL_SERVICE is set correctly

**Date validation issues?**
- Server validates dates cannot be in past
- Dates must be in format: YYYY-MM-DD
- Must be within 1 year from today

**API not responding?**
- Check server is running: `npm start`
- Check PORT is correct
- Check CORS is enabled

## 📞 Support

For issues:
1. Check `.env` configuration
2. Review server logs in terminal
3. Check browser console for errors
4. Verify all dependencies installed: `npm install`

## 🎯 Next Steps

1. Deploy to production (Railway/Render recommended)
2. Set up email (Gmail or Outlook)
3. Share URL with clients
4. Monitor bookings via API
5. (Optional) Add payment integration
6. (Optional) Add booking calendar/scheduling

---

**Version**: 1.0.0  
**Last Updated**: 2024  
**Status**: Ready for Production ✅
