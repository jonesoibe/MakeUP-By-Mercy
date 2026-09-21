# Render Deployment Guide - MakeUP By Mercy

Quick deployment guide for hosting on Render.

---

## 🚀 Quick Start

### 1. Prerequisites
- GitHub account with your code pushed
- Render account (free at render.com)
- MongoDB Atlas account (for database) OR use Render's PostgreSQL
- Gmail app password (for email notifications)

### 2. Environment Variables to Set in Render

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/makeup_mercy
EMAIL_USER=jonesoibe@gmail.com
EMAIL_PASSWORD=your-16-char-app-password
OWNER_EMAIL=oibeumume@gmail.com
```

### 3. Deployment Steps

**On Render.com:**

1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Set **Build Command:** `npm install`
4. Set **Start Command:** `npm start`
5. Add environment variables (see above)
6. Click **"Create Web Service"**

### 4. Verify Deployment

After deployment completes (2-3 minutes):
- ✅ Visit your site: `https://makeup-by-mercy.onrender.com`
- ✅ Test booking form
- ✅ Check admin console: `/admin-login.html`
- ✅ Verify emails sending

---

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| MongoDB connection fails | Check connection string in MONGODB_URI env var |
| Emails not sending | Verify EMAIL_USER, EMAIL_PASSWORD, and Gmail app password |
| Website 404 error | Check that server is running (view logs in Render dashboard) |
| Admin login fails | Verify OWNER_EMAIL env var is set correctly |

---

## 📊 Monitoring

View live logs in Render dashboard:
- Dashboard → Your Service → "Logs" tab
- Look for connection messages and errors

---

## 🔄 Updates

After making changes:
```bash
git push origin main
```

Render will auto-deploy (if enabled), or manually trigger in dashboard.

---

**Website is now live! Share your Render URL with clients.** 🎉
