# 🎨 MakeUP By Mercy - Professional Booking Website

[![Version](https://img.shields.io/badge/version-1.0.0-blue)]()
[![Status](https://img.shields.io/badge/status-Production%20Ready-green)]()
[![License](https://img.shields.io/badge/license-ISC-blue)]()

## ✨ Features

### 🎯 Frontend Features
✅ **Responsive Design**
- Mobile-first approach
- Works on all devices (mobile, tablet, desktop)
- Touch-friendly interface

✅ **Animations** (Inspired by Saluni)
- Fade-in animations on page load
- Slide animations for sections
- Bounce effect on CTA button
- Phone mockup with animated gallery carousel
- Staggered animations for service cards

✅ **Sections**
1. **Navigation Bar** - Branding and menu
2. **Hero Section** - Main headline and CTA
3. **Services Section** - 3 makeup service offerings
4. **Portfolio Section** - Phone mockup with animated gallery
5. **Booking Form** - Professional booking interface
6. **Footer** - Social media links

### ⚙️ Backend Features
✅ **Node.js / Express Server**
- RESTful API endpoints
- CORS enabled
- Professional error handling
- Comprehensive validation

✅ **Form Validation**
- Name validation (minimum 2 characters)
- Email format validation
- Service selection validation
- **Date validation** (prevents past dates, max 1 year future)
- All fields required

✅ **Automated Email Notifications**
- Confirmation emails on booking
- Professional HTML email templates
- Gmail/Outlook support
- Graceful fallback if email unavailable

✅ **Booking Management**
- Create bookings via API
- View all bookings
- Get individual booking details
- Cancel bookings

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Create .env file with email settings (optional)
cp .env.example .env
# Edit .env with your email credentials

# Start the server
npm start

# Open in browser
http://localhost:3000
```

### API Endpoints

```
GET     /                       Serve frontend
POST    /api/bookings          Create new booking
GET     /api/bookings          Get all bookings (admin)
GET     /api/bookings/:id      Get booking details
DELETE  /api/bookings/:id      Cancel booking
GET     /api/health            Health check
```

## 📧 Email Setup

### Gmail (Recommended)
1. Enable 2-Factor Authentication
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Create `.env` file:
   ```env
   EMAIL_SERVICE=gmail
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASSWORD=your-16-char-app-password
   ```

### Outlook/Hotmail
```env
EMAIL_SERVICE=outlook
EMAIL_USER=your-email@outlook.com
EMAIL_PASSWORD=your-password
```

## ☁️ Deploy to Production

### Recommended Hosting Services

#### Railway.app (Easiest - Recommended)
```bash
# Push to GitHub
git push origin main

# Create Railway project and connect GitHub
# Add environment variables in Railway dashboard
# Deploy!
```

#### Render.com
- Create account at render.com
- Connect GitHub repository
- Set environment variables
- Deploy web service

#### Heroku
```bash
heroku login
heroku create your-app-name
heroku config:set EMAIL_USER=your-email@gmail.com
heroku config:set EMAIL_PASSWORD=your-app-password
git push heroku main
```

#### DigitalOcean App Platform
- Create DigitalOcean account
- Connect GitHub
- Configure build/run commands
- Deploy

## 📋 Project Structure

```
MakeUP By Mercy/
├── index.html           # Frontend website
├── server.js            # Node.js backend
├── package.json         # Dependencies
├── package-lock.json    # Lock file
├── .env.example         # Email configuration template
├── .gitignore           # Git ignore rules
├── DEPLOYMENT.md        # Detailed deployment guide
└── README.md            # This file
```

## 🎨 Design Highlights

**Color Scheme:**
- Primary: #cc3380 (Pink)
- Secondary: #f2ebf2 (Light Pink)
- Dark: #333 (Dark Gray)
- Accent: #ff69b4 (Hot Pink)

**Typography:**
- Font Family: Inter, system fonts
- Responsive sizing for all devices

**Animations:**
- Smooth fade-in effects
- Staggered card animations
- Bouncing CTA button
- Rotating gallery carousel in phone mockup

## 🔐 Security Features

✅ Email validation
✅ Date range validation
✅ Name validation
✅ Service type validation
✅ CORS protection
✅ Environment variables for sensitive data
✅ Comprehensive error messages

## 📊 Current State

- **Frontend:** Fully functional ✅
- **Backend:** Fully functional ✅
- **Email:** Configured (optional) ✅
- **Date Validation:** Prevents past dates ✅
- **Portfolio:** Animated phone mockup ✅
- **Mobile Responsive:** Full support ✅
- **Production Ready:** Yes ✅

## 🎯 Test Booking

Visit http://localhost:3000 and:
1. Fill in the booking form
2. Select a future date
3. Submit
4. Check email for confirmation (if configured)
5. View booking via `/api/bookings`

## 📱 Responsive Breakpoints

- **Mobile:** < 768px
- **Tablet:** 768px - 1024px
- **Desktop:** > 1024px

## 🔄 Latest Updates

- ✅ Added email sending functionality
- ✅ Enhanced date validation (prevents past dates)
- ✅ Added portfolio section with phone mockup
- ✅ Animated gallery carousel
- ✅ Comprehensive validation checks
- ✅ Professional email templates
- ✅ Deployment configuration
- ✅ Environment variable support

## 🚨 Troubleshooting

**Port 3000 already in use?**
```bash
# Windows
Get-Process -Name node | Stop-Process -Force

# macOS/Linux
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9
```

**Emails not sending?**
- Check `.env` file has correct credentials
- Verify EMAIL_USER and EMAIL_PASSWORD are set
- For Gmail, ensure App Password is used (not regular password)

**Date validation issues?**
- Booking dates must be in future
- Maximum 1 year from today
- Format: YYYY-MM-DD

## 📞 Support

For deployment help, see `DEPLOYMENT.md` for detailed instructions for each platform.

## 📄 License

ISC License - Feel free to use for your business

## 👨‍💻 Built With

- **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
- **Backend:** Node.js, Express.js
- **Email:** Nodemailer
- **Configuration:** Dotenv
- **CORS:** Express CORS middleware

## 🎉 Ready to Launch!

Your MakeUP By Mercy booking website is production-ready. Follow the deployment guide to go live!

**Quick Links:**
- 📖 [Deployment Guide](DEPLOYMENT.md)
- 🌐 [Railway.app](https://railway.app)
- 🎨 [Render.com](https://render.com)
- ☁️ [Heroku](https://heroku.com)

---

**Made with ❤️ for MakeUP By Mercy**

Version: 1.0.0  
Last Updated: 2024
