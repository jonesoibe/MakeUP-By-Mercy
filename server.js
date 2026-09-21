const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
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

// Middleware
app.use(cors());
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
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
