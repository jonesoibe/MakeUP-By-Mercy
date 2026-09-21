# Render Deployment Checklist

## ✅ Pre-Deployment (Do Locally)

- [ ] All changes committed to Git
- [ ] Pushed to GitHub: `git push origin main`
- [ ] `.env` file is in `.gitignore` (never push secrets)
- [ ] `package.json` has all dependencies
- [ ] Server starts: `npm start`
- [ ] Website loads: http://localhost:3000
- [ ] Booking form works locally
- [ ] Admin console loads: http://localhost:3000/admin-login.html

## 📋 Render Setup Checklist

### Step 1: Get Credentials

- [ ] MongoDB Atlas connection string ready
  - Sign up: https://www.mongodb.com/cloud/atlas
  - Connection format: `mongodb+srv://user:pass@cluster...`

- [ ] Gmail app password ready (16 chars)
  - Enable 2FA: https://myaccount.google.com/security
  - Get app password: https://myaccount.google.com/apppasswords

### Step 2: Deploy on Render

- [ ] Sign up at https://render.com (free)
- [ ] Click "New +" → "Web Service"
- [ ] Select "Deploy an existing Git repository"
- [ ] Authorize and select your GitHub repo
- [ ] Fill in deployment details:
  - [ ] Name: `makeup-by-mercy`
  - [ ] Environment: Node.js
  - [ ] Build: `npm install`
  - [ ] Start: `npm start`

### Step 3: Add Environment Variables

- [ ] `NODE_ENV` = `production`
- [ ] `MONGODB_URI` = (your connection string)
- [ ] `EMAIL_USER` = `jonesoibe@gmail.com`
- [ ] `EMAIL_PASSWORD` = (your 16-char app password)
- [ ] `OWNER_EMAIL` = `oibeumume@gmail.com`

### Step 4: Deploy

- [ ] Click "Create Web Service"
- [ ] Wait 2-3 minutes for build and deploy
- [ ] Confirm URL in dashboard: `https://makeup-by-mercy.onrender.com`

## 🧪 Post-Deployment Testing

- [ ] Website loads at Render URL
- [ ] Hero section displays
- [ ] Services visible
- [ ] Pricing section shows
- [ ] Before & After gallery loads
- [ ] FAQ search works
- [ ] Booking form functional
- [ ] Test booking:
  - [ ] Fill form
  - [ ] Submit
  - [ ] Confirmation modal appears
  - [ ] Check email inbox (client)
  - [ ] Check email inbox (admin)
- [ ] Admin console loads
- [ ] Admin login works (demo: admin/admin123)
- [ ] Dashboard shows stats
- [ ] Bookings visible in admin
- [ ] Filtering works

## 🔧 If Something Goes Wrong

1. **Check Render logs**
   - Dashboard → Service → "Logs"
   - Look for error messages

2. **Verify environment variables**
   - All required vars set?
   - No typos?
   - MongoDB URI correct?
   - Gmail credentials valid?

3. **Check .gitignore**
   - `.env` should NOT be in Git
   - `node_modules/` should NOT be committed

4. **Restart service**
   - Dashboard → Service → "Manual Deploy"
   - Select "Deploy latest commit"

## 📞 Support Links

- Render Docs: https://render.com/docs
- MongoDB: https://docs.atlas.mongodb.com/
- Gmail Setup: https://nodemailer.com/smtp/gmail/

## ✨ Success!

After all tests pass, your website is LIVE! 🎉

Share URL with clients: `https://makeup-by-mercy.onrender.com`

---

**Remember:**
- Changes push to GitHub automatically deploy
- View logs anytime in Render dashboard
- Monitor email deliverability
- Check analytics regularly
