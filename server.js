const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== LOGGING SETUP ==========
const fs = require('fs');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logFile = path.join(logsDir, `app-${new Date().toISOString().split('T')[0]}.log`);

function log(level, message, data = '') {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    data: data || null
  };
  const logLine = JSON.stringify(logEntry) + '\n';
  console.log(logLine.trim());
  fs.appendFileSync(logFile, logLine);
}

log('INFO', 'Server starting');

// ========== DATABASE SETUP ==========
const MONGO_URI = process.env.MONGODB_URI;
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => log('INFO', 'Connected to MongoDB Atlas'))
    .catch(err => log('ERROR', 'MongoDB connection failed:', err.message));
} else {
  log('WARN', 'MONGODB_URI not set. Using in-memory storage.');
}

// ========== BOOKING SCHEMA ==========
const bookingSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  country: { type: String, default: 'Nigeria' },
  service: { type: String, required: true },
  date: { type: String, required: true },
  bookedAt: { type: Date, default: Date.now },
  status: { type: String, default: 'confirmed' },
  emailSent: { type: Boolean, default: false },
  ownerEmailSent: { type: Boolean, default: false }
});

const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);

// ========== EMAIL CONFIGURATION ==========
// Use TLS (port 587) for more reliable Gmail connection
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Test email connection
transporter.verify((error, success) => {
  if (error) {
    log('ERROR', 'Email configuration error:', error.message);
  } else {
    log('INFO', 'Email service ready');
  }
});

// ========== SECURITY: CORS WHITELIST ==========
const allowedOrigins = [
  'https://makeup-mercy.com',
  'https://www.makeup-mercy.com',
  'https://app.makeup-mercy.com',
  'http://localhost:3000',     // Dev only
  'http://localhost:5173',     // Dev (Vite) only
  'http://127.0.0.1:3000'      // Dev only
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);  // Allow non-browser requests
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      log('WARN', `CORS blocked from origin: ${origin}`);
      callback(new Error('CORS policy: origin not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function(...args) {
    const duration = Date.now() - start;
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: 'HTTP Request',
      data: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: duration + 'ms',
        userAgent: req.get('user-agent')
      }
    };
    console.log(JSON.stringify(logEntry));
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    originalEnd.apply(res, args);
  };
  next();
});

// Serve static files
app.use(express.static(__dirname));

// Function to send confirmation email to CLIENT
async function sendConfirmationEmail(booking) {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      log('WARN', 'Email disabled - no credentials configured');
      return false;
    }

    log('INFO', `Sending confirmation email to ${booking.email}`);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: booking.email,
      subject: `Your MakeUP By Mercy Booking Confirmed - ID: ${booking.bookingNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #cc3380 0%, #ff69b4 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">🎨 MakeUP By Mercy</h1>
            <p style="color: white; margin: 10px 0 0 0;">Your Booking is Confirmed!</p>
          </div>

          <div style="background: white; padding: 30px; border: 1px solid #e0e0e0;">
            <p style="color: #333; font-size: 16px;">Hi ${booking.name},</p>

            <p style="color: #666; line-height: 1.6;">
              Thank you for booking with <strong>MakeUP By Mercy</strong>! We're excited to make you look stunning.
            </p>

            <div style="background: #f2ebf2; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #cc3380; margin-top: 0;">Booking Details</h3>
              <p style="margin: 10px 0;"><strong>Booking ID:</strong> ${booking.bookingNumber}</p>
              <p style="margin: 10px 0;"><strong>Name:</strong> ${booking.name}</p>
              <p style="margin: 10px 0;"><strong>Phone:</strong> ${booking.phone} (${booking.country})</p>
              <p style="margin: 10px 0;"><strong>Email:</strong> ${booking.email}</p>
              <p style="margin: 10px 0;"><strong>Service:</strong> ${booking.service.charAt(0).toUpperCase() + booking.service.slice(1).replace(/([A-Z])/g, ' $1')}</p>
              <p style="margin: 10px 0;"><strong>Date:</strong> ${new Date(booking.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>

            <p style="color: #666; line-height: 1.6;">
              We'll contact you soon to confirm the exact time for your appointment. If you need to reschedule or have any questions, please reply to this email.
            </p>

            <p style="color: #666; line-height: 1.6;">
              <strong>What to expect:</strong>
              <br>✨ Professional makeup application
              <br>⏱️ Personalized consultation
              <br>💄 High-quality products
              <br>📸 Photo-ready results
            </p>

            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              Best regards,<br>
              <strong>MakeUP By Mercy Team</strong><br>
              Making you beautiful, one face at a time
            </p>
          </div>

          <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px;">
            <p style="margin: 0;">© 2024 MakeUP By Mercy. All rights reserved.</p>
            <p style="margin: 10px 0 0 0;">For support, contact: support@makeupbymercy.com</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    log('SUCCESS', `Confirmation email sent to ${booking.email}`);

    // Update booking in database
    if (MONGO_URI) {
      await Booking.findOneAndUpdate({ id: booking.id }, { emailSent: true });
    }
    return true;
  } catch (error) {
    log('ERROR', `Error sending confirmation email:`, error.message);
    return false;
  }
}

// Function to send notification email to MERCY (owner)
async function sendMercyNotification(booking) {
  try {
    // If email credentials are not configured or no owner email, skip
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      log('WARN', 'Email credentials not configured - skipping admin notification');
      return true;
    }

    const ownerEmail = process.env.OWNER_EMAIL || process.env.EMAIL_USER;
    log('INFO', `Sending admin notification to ${ownerEmail}`);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: ownerEmail,
      subject: `New Booking: ${booking.name} - ${booking.service.toUpperCase()}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #cc3380 0%, #ff69b4 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">New Booking Alert</h1>
            <p style="color: white; margin: 10px 0 0 0;">MakeUP By Mercy</p>
          </div>

          <div style="background: white; padding: 30px; border: 1px solid #e0e0e0;">
            <p style="color: #333; font-size: 16px;"><strong>You have a new booking!</strong></p>

            <div style="background: #f2ebf2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #cc3380;">
              <h3 style="color: #cc3380; margin-top: 0;">Booking Details</h3>
              <p style="margin: 10px 0;"><strong>Booking ID:</strong> ${booking.bookingNumber}</p>
              <p style="margin: 10px 0;"><strong>Client Name:</strong> ${booking.name}</p>
              <p style="margin: 10px 0;"><strong>Client Phone:</strong> ${booking.phone} (${booking.country})</p>
              <p style="margin: 10px 0;"><strong>Client Email:</strong> ${booking.email}</p>
              <p style="margin: 10px 0;"><strong>Service Type:</strong> ${booking.service.charAt(0).toUpperCase() + booking.service.slice(1).replace(/([A-Z])/g, ' $1')}</p>
              <p style="margin: 10px 0;"><strong>Booking Date:</strong> ${new Date(booking.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p style="margin: 10px 0;"><strong>Booked At:</strong> ${new Date(booking.bookedAt).toLocaleString()}</p>
            </div>

            <p style="color: #666; line-height: 1.6;">
              Remember to:
              <br>✓ Confirm the appointment time with the client
              <br>✓ Prepare your makeup kit
              <br>✓ Set a reminder for the booking date
            </p>

            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              View all bookings at: <a href="http://localhost:3000/api/bookings" style="color: #cc3380; text-decoration: none;">Your Bookings Dashboard</a>
            </p>
          </div>

          <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px;">
            <p style="margin: 0;">© 2024 MakeUP By Mercy. All rights reserved.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    log('SUCCESS', `Booking notification sent to owner (${ownerEmail})`);

    // Update booking in database
    if (MONGO_URI) {
      await Booking.findOneAndUpdate({ id: booking.id }, { ownerEmailSent: true });
    }
    return true;
  } catch (error) {
    log('ERROR', `Error sending owner notification:`, error.message);
    return false;
  }
}

// Booking number counter for sequential IDs
let bookingCounter = 1000; // Start at 1000

// In-memory bookings database (fallback if MongoDB not connected)
let bookings = [];

// API Routes

// GET all bookings (admin route)
app.get('/api/bookings', async (req, res) => {
  try {
    let allBookings;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      allBookings = await Booking.find().sort({ bookedAt: -1 });
      log('INFO', `Retrieved ${allBookings.length} bookings from MongoDB`);
    } else {
      allBookings = bookings;
      log('INFO', `Retrieved ${allBookings.length} bookings from memory`);
    }

    res.json({
      success: true,
      count: allBookings.length,
      bookings: allBookings,
      database: MONGO_URI ? 'MongoDB' : 'Memory'
    });
  } catch (error) {
    log('ERROR', 'Error retrieving bookings:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error retrieving bookings'
    });
  }
});

// POST new booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { name, email, phone, country, service, date } = req.body;

    // ========== VALIDATION CHECKS ==========
    if (!name || !email || !phone || !service || !date) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    if (name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid name'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    if (phone.trim().length < 7) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid phone number'
      });
    }

    const validServices = ['bridal', 'party', 'casual'];
    if (!validServices.includes(service)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service selected'
      });
    }

    const bookingDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    bookingDate.setHours(0, 0, 0, 0);

    if (isNaN(bookingDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format'
      });
    }

    if (bookingDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Booking date cannot be in the past. Please select a future date.'
      });
    }

    const maxDate = new Date(today);
    maxDate.setFullYear(maxDate.getFullYear() + 1);
    if (bookingDate > maxDate) {
      return res.status(400).json({
        success: false,
        message: 'Booking date cannot be more than 1 year in the future'
      });
    }

    // Create booking object with sequential booking number
    bookingCounter++;
    const bookingNumber = `MKP-${String(bookingCounter).padStart(5, '0')}`; // MKP-01001, MKP-01002, etc.

    const booking = {
      id: Date.now(),
      bookingNumber: bookingNumber,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      country: country || 'Nigeria',
      service,
      date,
      bookedAt: new Date().toISOString(),
      status: 'confirmed'
    };

    // Save to database
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const newBooking = new Booking(booking);
      await newBooking.save();
      log('SUCCESS', `Booking saved to MongoDB: ${booking.id}`);
    } else {
      bookings.push(booking);
      log('INFO', `Booking saved to memory: ${booking.id}`);
    }

    log('INFO', `New booking: ${booking.name} | ${booking.email} | ${booking.service} | ${booking.date}`);

    // Send confirmation emails to both client and owner
    log('INFO', 'Sending confirmation emails...');
    await sendConfirmationEmail(booking);
    await sendMercyNotification(booking);

    res.status(201).json({
      success: true,
      message: `Booking confirmed! Confirmation emails have been sent to you and Mercy.`,
      booking: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        country: booking.country,
        service: booking.service,
        date: booking.date,
        bookedAt: booking.bookedAt
      }
    });

  } catch (error) {
    log('ERROR', 'Error processing booking:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error processing booking. Please try again later.'
    });
  }
});

// GET booking by ID
app.get('/api/bookings/:id', async (req, res) => {
  try {
    let booking;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOne({ id: parseInt(req.params.id) });
    } else {
      booking = bookings.find(b => b.id === parseInt(req.params.id));
    }

    if (!booking) {
      log('WARN', `Booking not found: ${req.params.id}`);
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    log('INFO', `Retrieved booking: ${booking.id}`);
    res.json({
      success: true,
      booking
    });
  } catch (error) {
    log('ERROR', 'Error retrieving booking:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error retrieving booking'
    });
  }
});

// CANCEL booking
app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const result = await Booking.deleteOne({ id: bookingId });
      if (result.deletedCount === 0) {
        log('WARN', `Booking not found for deletion: ${bookingId}`);
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }
      log('INFO', `Booking deleted from MongoDB: ${bookingId}`);
    } else {
      const index = bookings.findIndex(b => b.id === bookingId);
      if (index === -1) {
        log('WARN', `Booking not found for deletion: ${bookingId}`);
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }
      bookings.splice(index, 1);
      log('INFO', `Booking deleted from memory: ${bookingId}`);
    }

    res.json({
      success: true,
      message: 'Booking cancelled successfully'
    });
  } catch (error) {
    log('ERROR', 'Error cancelling booking:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error cancelling booking'
    });
  }
});

// ========== SECURITY: INPUT VALIDATION ==========
// Validate booking number format to prevent NoSQL injection
function validateBookingNumber(bookingNumber) {
  if (typeof bookingNumber !== 'string') {
    throw new Error('Invalid booking number type');
  }
  // Booking numbers must match format: MKP-00001 (3 letters + dash + 5 digits)
  if (!/^MKP-\d{5}$/.test(bookingNumber)) {
    throw new Error('Invalid booking number format');
  }
  return bookingNumber;
}

// ========== ADMIN SCHEMA & AUTHENTICATION ==========
// Use strong random secret from environment, or generate one
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const crypto = require('crypto');
  const secret = crypto.randomBytes(32).toString('hex');
  log('WARN', 'JWT_SECRET not set in environment. Generated random secret for this session.');
  log('WARN', 'For production, set JWT_SECRET environment variable to persist across restarts.');
  if (process.env.NODE_ENV === 'production') {
    log('ERROR', 'CRITICAL: JWT_SECRET must be set in production environment!');
  }
  return secret;
})();

// Admin User Schema
const adminSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'manager', 'viewer'], default: 'manager' },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  active: { type: Boolean, default: true }
});

const Admin = mongoose.model('Admin', adminSchema);

// Initialize default admin (only if not exists)
async function initializeDefaultAdmin() {
  try {
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const existingAdmin = await Admin.findOne({ username: 'admin' });
      if (!existingAdmin) {
        // SECURITY FIX: Use strong random password instead of hardcoded 'admin123'
        const crypto = require('crypto');

        // Check if initial password is provided via environment (for automated setup)
        let initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
        let isDefaultSetup = false;

        if (!initialPassword) {
          // For production: require manual password setup
          if (process.env.NODE_ENV === 'production') {
            log('WARN', 'INITIAL_ADMIN_PASSWORD not set. Skipping admin creation. Set via environment variable.');
            return;
          }

          // For development: generate temporary password
          initialPassword = crypto.randomBytes(12).toString('hex');
          isDefaultSetup = true;
        }

        const hashedPassword = await bcryptjs.hash(initialPassword, 10);
        await Admin.create({
          username: 'admin',
          email: process.env.OWNER_EMAIL || 'admin@makeup-mercy.com',
          password: hashedPassword,
          role: 'admin',
          active: true,
          passwordChangeRequired: isDefaultSetup
        });

        if (isDefaultSetup) {
          log('WARN', `Default admin user created with temporary password: ${initialPassword}`);
          log('WARN', 'SECURITY: Change this password immediately after first login!');
        } else {
          log('INFO', 'Default admin user created with provided password');
        }
      }
    }
  } catch (error) {
    log('ERROR', 'Error initializing default admin:', error.message);
  }
}

// Verify JWT Token
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    log('WARN', 'Invalid token attempt:', error.message);
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// Role-Based Access Control
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
}

// ========== ADMIN API ENDPOINTS ==========

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    log('INFO', `Admin login attempt: ${username}`);

    let admin = null;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      admin = await Admin.findOne({ username, active: true });
    } else {
      // Fallback for development without MongoDB
      if (username === 'admin' && password === 'admin123') {
        admin = { username: 'admin', role: 'admin', email: 'admin@makeup-mercy.com' };
      }
    }

    if (!admin) {
      log('WARN', `Failed admin login attempt: ${username}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Verify password
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const isPasswordValid = await bcryptjs.compare(password, admin.password);
      if (!isPasswordValid) {
        log('WARN', `Failed admin login attempt: ${username}`);
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
    } else if (admin.username !== 'admin' || password !== 'admin123') {
      log('WARN', `Failed admin login attempt: ${username}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { id: admin._id || 'demo', username: admin.username, role: admin.role, email: admin.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Update last login
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      await Admin.findByIdAndUpdate(admin._id, { lastLogin: new Date() });
    }

    log('SUCCESS', `Admin logged in: ${username}`);
    res.json({ success: true, token, username: admin.username, role: admin.role });
  } catch (error) {
    log('ERROR', 'Login error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin Dashboard
app.get('/api/admin/dashboard', verifyAdminToken, async (req, res) => {
  try {
    let allBookings = bookings;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      allBookings = await Booking.find();
    }

    const totalBookings = allBookings.length;
    const confirmedBookings = allBookings.filter(b => b.status === 'confirmed').length;
    const pendingBookings = allBookings.filter(b => b.status === 'pending').length;

    // Calculate monthly revenue
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthlyBookings = allBookings.filter(b => {
      const bookDate = new Date(b.date);
      return bookDate.getMonth() === currentMonth && bookDate.getFullYear() === currentYear;
    });
    const monthlyRevenue = monthlyBookings.reduce((sum, b) => sum + (getPriceForService(b.service)), 0);

    // Calculate repeat customers
    const customerEmails = allBookings.map(b => b.email);
    const repeatCustomers = customerEmails.filter((email, index) => customerEmails.indexOf(email) !== index).length;

    res.json({
      success: true,
      totalBookings,
      confirmedBookings,
      pendingBookings,
      monthlyRevenue,
      repeatCustomers
    });
  } catch (error) {
    log('ERROR', 'Error fetching dashboard data:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching dashboard data' });
  }
});

// Get all bookings (admin)
app.get('/api/admin/bookings', verifyAdminToken, async (req, res) => {
  try {
    let allBookings = bookings;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      allBookings = await Booking.find().sort({ bookedAt: -1 });
    }

    res.json({
      success: true,
      bookings: allBookings,
      database: MONGO_URI ? 'MongoDB' : 'In-Memory'
    });
  } catch (error) {
    log('ERROR', 'Error fetching bookings:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching bookings' });
  }
});

// Get upcoming appointments
app.get('/api/admin/appointments/upcoming', verifyAdminToken, async (req, res) => {
  try {
    let allBookings = bookings;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      allBookings = await Booking.find();
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const upcoming = allBookings
      .filter(b => {
        const bookDate = new Date(b.date);
        return bookDate >= today && bookDate <= nextWeek && b.status !== 'cancelled';
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 10);

    res.json({ success: true, appointments: upcoming });
  } catch (error) {
    log('ERROR', 'Error fetching upcoming appointments:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching appointments' });
  }
});

// Get recent bookings
app.get('/api/admin/bookings/recent', verifyAdminToken, async (req, res) => {
  try {
    let allBookings = bookings;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      allBookings = await Booking.find().sort({ bookedAt: -1 }).limit(10);
    } else {
      allBookings = allBookings.sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt)).slice(0, 10);
    }

    res.json({ success: true, bookings: allBookings });
  } catch (error) {
    log('ERROR', 'Error fetching recent bookings:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching bookings' });
  }
});

// Confirm booking (admin)
app.patch('/api/admin/bookings/:id/confirm', verifyAdminToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    let booking = null;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findByIdAndUpdate(bookingId, { status: 'confirmed' }, { new: true });
    } else {
      const booking_obj = bookings.find(b => b._id === bookingId);
      if (booking_obj) {
        booking_obj.status = 'confirmed';
        booking = booking_obj;
      }
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    log('SUCCESS', `Booking confirmed by admin: ${booking.bookingNumber}`);
    res.json({ success: true, booking });
  } catch (error) {
    log('ERROR', 'Error confirming booking:', error.message);
    res.status(500).json({ success: false, message: 'Error confirming booking' });
  }
});

// Cancel booking (admin)
app.patch('/api/admin/bookings/:id/cancel', verifyAdminToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    let booking = null;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findByIdAndUpdate(bookingId, { status: 'cancelled' }, { new: true });
    } else {
      const booking_obj = bookings.find(b => b._id === bookingId);
      if (booking_obj) {
        booking_obj.status = 'cancelled';
        booking = booking_obj;
      }
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    log('SUCCESS', `Booking cancelled by admin: ${booking.bookingNumber}`);
    res.json({ success: true, booking });
  } catch (error) {
    log('ERROR', 'Error cancelling booking:', error.message);
    res.status(500).json({ success: false, message: 'Error cancelling booking' });
  }
});

// Send message to client
app.post('/api/admin/bookings/:id/message', verifyAdminToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { message } = req.body;

    let booking = bookings.find(b => b._id === bookingId);
    if (!booking && MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Send email to client
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: booking.email,
      subject: `Message from MakeUP By Mercy - ${booking.bookingNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Message from MakeUP By Mercy</h2>
          <p>Hi ${booking.name},</p>
          <p>${message}</p>
          <p>Best regards,<br>MakeUP By Mercy Team</p>
        </div>
      `
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        log('ERROR', 'Error sending message:', error.message);
      } else {
        log('SUCCESS', `Message sent to ${booking.email}`);
      }
    });

    res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    log('ERROR', 'Error sending message:', error.message);
    res.status(500).json({ success: false, message: 'Error sending message' });
  }
});

// Analytics
app.get('/api/admin/analytics', verifyAdminToken, async (req, res) => {
  try {
    let allBookings = bookings;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      allBookings = await Booking.find();
    }

    // Service breakdown
    const serviceBreakdown = {
      bridal: allBookings.filter(b => b.service === 'bridal').length,
      party: allBookings.filter(b => b.service === 'party').length,
      casual: allBookings.filter(b => b.service === 'casual').length
    };

    // Peak day
    const dayCount = {};
    allBookings.forEach(b => {
      const day = new Date(b.date).toLocaleDateString('en-US', { weekday: 'long' });
      dayCount[day] = (dayCount[day] || 0) + 1;
    });
    const peakDay = Object.keys(dayCount).reduce((a, b) => dayCount[a] > dayCount[b] ? a : b, 'Monday');

    res.json({
      success: true,
      serviceBreakdown,
      peakDay,
      peakDayCount: dayCount[peakDay] || 0
    });
  } catch (error) {
    log('ERROR', 'Error fetching analytics:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching analytics' });
  }
});

// Helper function to get price for service
function getPriceForService(service) {
  const prices = {
    bridal: 25000,
    party: 15000,
    casual: 10000
  };
  return prices[service] || 0;
}

// Serve admin pages
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// ========== RECEIPT GENERATION FUNCTIONS ==========

// Generate QR Code
async function generateQRCode(data) {
  try {
    return await QRCode.toDataURL(data);
  } catch (error) {
    log('ERROR', 'QR code generation error:', error.message);
    return null;
  }
}

// Generate Receipt as Base64
async function generateReceiptPDF(booking) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      let buffers = [];

      doc.on('data', (data) => buffers.push(data));
      doc.on('end', () => {
        const pdf = Buffer.concat(buffers);
        resolve(pdf.toString('base64'));
      });

      // Title
      doc.fontSize(24).font('Helvetica-Bold').text('BOOKING RECEIPT', { align: 'center' });
      doc.fontSize(10).text('MakeUP By Mercy', { align: 'center' });
      doc.moveTo(40, doc.y + 10).lineTo(560, doc.y + 10).stroke();

      // Booking Details
      doc.fontSize(12).font('Helvetica-Bold').text('Booking Details', doc.y + 15);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Booking ID: ${booking.bookingNumber}`, doc.y + 5);
      doc.text(`Name: ${booking.name}`, doc.y + 5);
      doc.text(`Email: ${booking.email}`, doc.y + 5);
      doc.text(`Phone: ${booking.phone}`, doc.y + 5);
      doc.text(`Country: ${booking.country}`, doc.y + 5);
      doc.text(`Service: ${booking.service.toUpperCase()}`, doc.y + 5);
      doc.text(`Date: ${new Date(booking.date).toLocaleDateString()}`, doc.y + 5);
      doc.text(`Status: ${booking.status.toUpperCase()}`, doc.y + 5);
      doc.text(`Booked On: ${new Date(booking.bookedAt).toLocaleString()}`, doc.y + 5);

      // QR Code
      generateQRCode(`${booking.bookingNumber}`).then((qrCode) => {
        if (qrCode) {
          const img = Buffer.from(qrCode.replace('data:image/png;base64,', ''), 'base64');
          doc.image(img, doc.page.margins.left, doc.y + 20, { width: 100, height: 100 });
        }

        doc.fontSize(9).text('Scan QR code to track your booking', doc.x + 110, doc.y - 80);

        // Footer
        doc.fontSize(8).font('Helvetica-Oblique');
        doc.text('Thank you for booking with MakeUP By Mercy!', { align: 'center', y: 750 });
        doc.text('For more details, visit our website or contact us on WhatsApp', { align: 'center' });

        doc.end();
      });
    } catch (error) {
      log('ERROR', 'Receipt PDF generation error:', error.message);
      reject(error);
    }
  });
}

// ========== NEW RECEIPT & MANAGEMENT ENDPOINTS ==========

// Download Receipt as PDF (Admin only - SECURITY FIX: Added authentication)
app.get('/api/bookings/:id/receipt/pdf', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // SECURITY FIX: Validate booking number format to prevent NoSQL injection
    let bookingNumber;
    try {
      bookingNumber = validateBookingNumber(id);
    } catch (validationError) {
      return res.status(400).json({ success: false, message: validationError.message });
    }

    let booking = null;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOne({ bookingNumber });
    } else {
      booking = bookings.find(b => b.bookingNumber === bookingNumber);
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const pdfBase64 = await generateReceiptPDF(booking);
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=booking-${booking.bookingNumber}.pdf`);
    res.send(pdfBuffer);

    log('INFO', `Receipt PDF downloaded: ${booking.bookingNumber}`);
  } catch (error) {
    log('ERROR', 'Receipt download error:', error.message);
    res.status(500).json({ success: false, message: 'Error generating receipt' });
  }
});

// Download Receipt as Image (PNG with booking details) (Admin only - SECURITY FIX: Added authentication)
app.get('/api/bookings/:id/receipt/image', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // SECURITY FIX: Validate booking number format to prevent NoSQL injection
    let bookingNumber;
    try {
      bookingNumber = validateBookingNumber(id);
    } catch (validationError) {
      return res.status(400).json({ success: false, message: validationError.message });
    }

    let booking = null;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOne({ bookingNumber });
    } else {
      booking = bookings.find(b => b.bookingNumber === bookingNumber);
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const qrCode = await generateQRCode(`${booking.bookingNumber}`);
    if (!qrCode) {
      return res.status(500).json({ success: false, message: 'Error generating QR code' });
    }

    res.json({ success: true, qrCode, booking });
    log('INFO', `Receipt image generated: ${booking.bookingNumber}`);
  } catch (error) {
    log('ERROR', 'Receipt image error:', error.message);
    res.status(500).json({ success: false, message: 'Error generating receipt' });
  }
});

// Contact Customer (Admin only)
app.post('/api/admin/bookings/:id/contact', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, message } = req.body;

    // SECURITY FIX: Validate booking number format to prevent NoSQL injection
    let bookingNumber;
    try {
      bookingNumber = validateBookingNumber(id);
    } catch (validationError) {
      return res.status(400).json({ success: false, message: validationError.message });
    }

    let booking = null;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOne({ bookingNumber });
    } else {
      booking = bookings.find(b => b.bookingNumber === bookingNumber);
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Send email to customer
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: booking.email,
      subject: subject || `Update regarding your booking ${booking.bookingNumber}`,
      html: `
        <h2>Hello ${booking.name},</h2>
        <p>${message}</p>
        <p><strong>Booking ID:</strong> ${booking.bookingNumber}</p>
        <p><strong>Service:</strong> ${booking.service}</p>
        <p><strong>Date:</strong> ${new Date(booking.date).toLocaleDateString()}</p>
        <p>Best regards,<br>MakeUP By Mercy</p>
      `
    });

    res.json({ success: true, message: 'Message sent to customer' });
    log('INFO', `Contact message sent to ${booking.email} for booking ${id}`);
  } catch (error) {
    log('ERROR', 'Contact customer error:', error.message);
    res.status(500).json({ success: false, message: 'Error sending message' });
  }
});

// Update Booking Status (Workflow: pending -> confirmed -> completed/cancelled)
app.patch('/api/admin/bookings/:id/status', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // SECURITY FIX: Validate booking number format to prevent NoSQL injection
    let bookingNumber;
    try {
      bookingNumber = validateBookingNumber(id);
    } catch (validationError) {
      return res.status(400).json({ success: false, message: validationError.message });
    }

    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    let booking = null;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOneAndUpdate(
        { bookingNumber },
        { status, updatedAt: new Date() },
        { new: true }
      );
    } else {
      booking = bookings.find(b => b.bookingNumber === bookingNumber);
      if (booking) booking.status = status;
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    res.json({ success: true, booking, message: `Booking status updated to ${status}` });
    log('INFO', `Booking status updated: ${id} -> ${status}`);
  } catch (error) {
    log('ERROR', 'Status update error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating status' });
  }
});

// ========== ADMIN USER MANAGEMENT ENDPOINTS ==========

// Create Admin User (Super admin only)
app.post('/api/admin/users', verifyAdminToken, requireRole('admin'), async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!MONGO_URI || mongoose.connection.readyState !== 1) {
      return res.status(400).json({ success: false, message: 'Database required for user management' });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);
    const newAdmin = await Admin.create({
      username,
      email,
      password: hashedPassword,
      role: role || 'manager',
      active: true
    });

    res.json({ success: true, admin: { username: newAdmin.username, email: newAdmin.email, role: newAdmin.role } });
    log('INFO', `New admin user created: ${username} (${role})`);
  } catch (error) {
    log('ERROR', 'User creation error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get All Admin Users (Admin only)
app.get('/api/admin/users', verifyAdminToken, requireRole('admin'), async (req, res) => {
  try {
    if (!MONGO_URI || mongoose.connection.readyState !== 1) {
      return res.json({ success: true, users: [] });
    }

    const users = await Admin.find({}, '-password');
    res.json({ success: true, users });
  } catch (error) {
    log('ERROR', 'Get users error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
});

// Update Admin User (Self or Admin)
app.patch('/api/admin/users/:userId', verifyAdminToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { email, password, role } = req.body;

    if (!MONGO_URI || mongoose.connection.readyState !== 1) {
      return res.status(400).json({ success: false, message: 'Database required' });
    }

    const updateData = { email };
    if (password) {
      updateData.password = await bcryptjs.hash(password, 10);
    }
    if (role && req.admin.role === 'admin') {
      updateData.role = role;
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(userId, updateData, { new: true });
    res.json({ success: true, admin: { username: updatedAdmin.username, email: updatedAdmin.email, role: updatedAdmin.role } });
    log('INFO', `Admin user updated: ${updatedAdmin.username}`);
  } catch (error) {
    log('ERROR', 'User update error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating user' });
  }
});

// Delete Admin User (Admin only)
app.delete('/api/admin/users/:userId', verifyAdminToken, requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;

    if (!MONGO_URI || mongoose.connection.readyState !== 1) {
      return res.status(400).json({ success: false, message: 'Database required' });
    }

    await Admin.findByIdAndDelete(userId);
    res.json({ success: true, message: 'User deleted' });
    log('INFO', `Admin user deleted: ${userId}`);
  } catch (error) {
    log('ERROR', 'User deletion error:', error.message);
    res.status(500).json({ success: false, message: 'Error deleting user' });
  }
});

// Initialize default admin on startup
mongoose.connection.once('connected', () => {
  initializeDefaultAdmin();
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  log('INFO', `Server listening on http://localhost:${PORT}`);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});
