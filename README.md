# MakeUP By Mercy - Professional Booking Website

A modern, professional makeup artist booking website with admin console, automated emails, and beautiful animations.

## ✨ Features

### Client-Facing
- 🎨 Professional design with smooth animations
- 📱 Fully responsive (mobile, tablet, desktop)
- 💄 Service showcase (Bridal, Party, Casual)
- 💰 Pricing tiers with feature comparisons
- 📸 Before & After gallery with interactive sliders
- 📚 Searchable FAQ with category filters
- 📅 Easy booking form
- ✉️ Automated confirmation emails
- 💬 Client testimonials
- 📞 Direct contact links

### Admin Features
- 👤 Admin dashboard
- 📊 Real-time analytics
- 🔍 Advanced filtering
- 📧 Email notifications
- ⚙️ Settings management
- 💾 Data export (CSV/PDF)

## 🚀 Deploy to Render in 5 Minutes

### 1. Push to GitHub
```bash
git push origin main
```

### 2. Set Up Environment Variables

Get these values:
- **MONGODB_URI**: From MongoDB Atlas (free)
- **EMAIL_PASSWORD**: Gmail app password
- **OWNER_EMAIL**: Your email for notifications

### 3. Deploy on Render
- Visit https://render.com/dashboard
- New → Web Service
- Connect GitHub repo
- Set environment variables (see RENDER_DEPLOYMENT.md)
- Build: `npm install`
- Start: `npm start`

### 4. Verify
- Visit your live site
- Test booking form
- Check admin console

**Full instructions:** [RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md)

## 💻 Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your settings
npm start
```

Access at: http://localhost:3000

## 📁 Key Files

- `server.js` - Express backend
- `index.html` - Main website
- `admin.html` - Admin dashboard
- `.env.example` - Environment template
- `render.yaml` - Render config

## 🔐 Environment Variables

```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://...
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
OWNER_EMAIL=admin-email@gmail.com
```

## 🔑 Can't sign in to the admin?

The old default password (`admin123`) is no longer accepted. The sign-in page now says why it refused you:

- **"This account cannot sign in yet"**: the account still has the old default password. Reset it (below).
- **"Sign-in is temporarily unavailable"**: the server cannot reach its database. Check `MONGODB_URI` and the Settings > System tab once you are in, or the server logs.
- **"Too many login attempts"**: wait about 15 minutes.

**Reset the password** (works with your `.env`, or in a Render shell where `MONGODB_URI` is set):

```bash
npm run admin:reset
```

It asks for the new password (12+ characters, not shown as you type) and updates the `admin` account in the database. To reset a different account set `ADMIN_USERNAME` first. Alternatively set `ADMIN_INITIAL_PASSWORD` on the server and restart: that resets an account that is still on the old default.

## 🧪 Testing

### Automated tests

```bash
npm test               # run everything
npm run test:watch     # re-run on change
npm run test:coverage  # with a coverage report (fails if it drops below the floor)
```

- `tests/security.test.js` - static-file exposure, login and permission rules, CORS, rate limits
- `tests/bookings.test.js` - booking validation, notice period, emails and templates, receipts
- `tests/admin.test.js` - dashboard maths, pricing, admin actions
- `tests/db.test.js` - the same app against a real (in-memory) MongoDB: admin accounts, persistence, booking counter, settings

### Browser (end-to-end) tests

```bash
npx playwright install chromium   # once per machine
npm run test:e2e
```

Already have Chrome? Skip the download: `PW_CHANNEL=chrome npm run test:e2e` (PowerShell: `$env:PW_CHANNEL='chrome'; npm run test:e2e`).

They start their own copy of the app on port 3210 (in-memory data, no email) and drive a real browser:

- `tests/e2e/booking.spec.js` - booking form, validation, confirmation, PDF and QR downloads
- `tests/e2e/admin.spec.js` - sign-in and sign-out, managing bookings, pricing, opening hours, email template, and a check that customer-typed HTML cannot run in the console
- `tests/e2e/site.spec.js` - navigation, scroll reveals, FAQ, testimonials, images, reduced motion
- `tests/e2e/mobile.spec.js` - phone viewport: menu, no sideways scroll, booking, touch-target sizes
- `tests/e2e/a11y.spec.js` - automated WCAG A/AA scan (axe) of the public page, dialog, login and admin console

Tests never read your `.env`, never send real email (SendGrid is mocked) and never touch a real database. The first run of `tests/db.test.js` downloads a MongoDB binary (about 130 MB, cached afterwards in `node_modules/.cache`). Helpers live in `tests/helpers/app.js`.

### Manual checks

1. **Booking**: Fill form, verify email received
2. **Admin**: Login at `/admin-login` with the admin account stored in the database. Without a database (local development only), set `DEV_ADMIN_PASSWORD` in `.env` and log in as `admin`.
3. **Analytics**: Check dashboard stats

## 📊 Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript
- **Backend**: Node.js, Express, MongoDB
- **Hosting**: Render
- **Database**: MongoDB Atlas
- **Email**: Gmail SMTP

## 🎉 Next Steps

1. Read [RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md)
2. Deploy to Render
3. Share your live URL with clients!

---
**Ready to go live?** ✨
