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

## 🧪 Testing

1. **Booking**: Fill form, verify email received
2. **Admin**: Login with admin/admin123
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
