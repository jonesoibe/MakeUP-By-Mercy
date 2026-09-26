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
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const Joi = require('joi');
const winston = require('winston');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== WINSTON LOGGING SETUP ==========
const fs = require('fs');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'makeup-by-mercy' },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Combined logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// Legacy log function for compatibility
function log(level, message, data = '') {
  logger.log({ level: level.toLowerCase(), message, data: data || null });
}

logger.info('Server starting');

// ========== AUDIT LOGGING ==========
function auditLog(action, admin, details = {}) {
  logger.info(`AUDIT: ${action}`, {
    action,
    admin: admin || 'system',
    timestamp: new Date().toISOString(),
    ...details
  });
}

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
  bookingNumber: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  country: { type: String, default: 'Nigeria' },
  service: { type: String, required: true },
  date: { type: String, required: true },
  bookedAt: { type: Date, default: Date.now },
  status: { type: String, default: 'confirmed' },
  emailSent: { type: Boolean, default: false },
  ownerEmailSent: { type: Boolean, default: false },
  qrCode: { type: String, default: null }
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
const corsOptions = {
  origin: function(origin, callback) {
    const whitelist = [
      'http://localhost:3000',
      'http://localhost:5000',
      'https://makeup-by-mercy.onrender.com',
      process.env.CLIENT_URL || ''
    ];
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://smtp.gmail.com']
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Rate limiting middleware
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health'
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many bookings from this IP in one hour, please try again later.'
});

// ========== INPUT VALIDATION SCHEMAS ==========

// Booking form validation schema
const bookingValidationSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^[0-9+\-\s()]+$/).min(10).max(20).required(),
  country: Joi.string().trim().max(50).default('Nigeria'),
  service: Joi.string().valid('bridal', 'party', 'casual').required(),
  date: Joi.date().iso().min('now').required()
});

// Admin login validation schema
const adminLoginSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).max(100).required()
});

// Contact customer validation schema
const contactCustomerSchema = Joi.object({
  subject: Joi.string().trim().max(200),
  message: Joi.string().trim().min(1).max(5000).required()
});

// Status update validation schema
const statusUpdateSchema = Joi.object({
  status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled').required()
});

// User management validation schema
const createAdminSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(100).pattern(/[A-Z]/).pattern(/[0-9]/).pattern(/[!@#$%^&*]/).required(),
  role: Joi.string().valid('admin', 'manager', 'viewer').default('manager')
});

// Pricing validation schema
const updatePricingSchema = Joi.object({
  minPrice: Joi.number().min(0).required(),
  maxPrice: Joi.number().min(0).required(),
  description: Joi.string().max(500).allow('').optional()
}).custom((value, helpers) => {
  if (value.minPrice > value.maxPrice) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'price validation');

// Email Template validation schema
const updateEmailTemplateSchema = Joi.object({
  subject: Joi.string().min(5).max(200).required(),
  body: Joi.string().min(20).max(5000).required()
});

// Validation middleware
function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));
      log('WARN', 'Validation error:', JSON.stringify(details));
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: details
      });
    }

    req.validatedBody = value;
    next();
  };
}

app.use(generalLimiter);
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function(...args) {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: duration + 'ms',
      userAgent: req.get('user-agent')
    });
    originalEnd.apply(res, args);
  };
  next();
});

// Serve static files
app.use(express.static(__dirname));

// ========== SWAGGER API DOCUMENTATION ==========
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  swaggerOptions: {
    url: '/swagger.json',
    displayOperationId: false,
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 1
  },
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'MakeUP By Mercy API Documentation'
}));

// Serve swagger.json file
app.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerDocument);
});

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
app.post('/api/bookings', bookingLimiter, validateRequest(bookingValidationSchema), async (req, res) => {
  try {
    // Use validated data from middleware
    const { name, email, phone, country, service, date } = req.validatedBody;

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

    // Pre-generate and cache QR code for faster PDF generation
    const qrCode = await generateQRCode(booking.bookingNumber);
    booking.qrCode = qrCode || null;

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

    // Send confirmation emails to both client and owner in parallel (2x speedup)
    log('INFO', 'Sending confirmation emails...');
    await Promise.all([
      sendConfirmationEmail(booking),
      sendMercyNotification(booking)
    ]);

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

// ========== ADMIN SCHEMA & AUTHENTICATION ==========
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return 'dev-secret-key-change-in-production';
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

// ========== PRICING SCHEMA ==========
const pricingSchema = new mongoose.Schema({
  service: {
    type: String,
    enum: ['bridal', 'party', 'casual'],
    unique: true,
    required: true
  },
  minPrice: { type: Number, required: true, min: 0 },
  maxPrice: { type: Number, required: true, min: 0 },
  description: { type: String, default: '' },
  updatedBy: { type: String, default: 'system' },
  updatedAt: { type: Date, default: Date.now }
});

const Pricing = mongoose.models.Pricing || mongoose.model('Pricing', pricingSchema);

// ========== EMAIL TEMPLATES SCHEMA ==========
const emailTemplateSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['confirmation', 'reminder', 'cancellation', 'custom'],
    unique: true,
    required: true
  },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  variables: { type: [String], default: [] },
  updatedBy: { type: String, default: 'system' },
  updatedAt: { type: Date, default: Date.now }
});

const EmailTemplate = mongoose.models.EmailTemplate || mongoose.model('EmailTemplate', emailTemplateSchema);

// Initialize default email templates (only if not exists)
async function initializeDefaultEmailTemplates() {
  try {
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const count = await EmailTemplate.countDocuments();
      if (count === 0) {
        await EmailTemplate.create([
          {
            type: 'confirmation',
            subject: 'Your MakeUP By Mercy Booking Confirmed - ID: {bookingNumber}',
            body: 'Thank you for booking with MakeUP By Mercy! Your appointment is confirmed.\n\nBooking Details:\nBooking ID: {bookingNumber}\nDate: {date}\nService: {service}\nPhone: {phone}\nCountry: {country}\n\nWe look forward to making you look stunning!',
            variables: ['bookingNumber', 'date', 'service', 'phone', 'country']
          },
          {
            type: 'reminder',
            subject: 'Reminder: Your MakeUP By Mercy Appointment - {date}',
            body: 'Hi {name},\n\nThis is a friendly reminder about your upcoming appointment with MakeUP By Mercy.\n\nDate: {date}\nService: {service}\nBooking ID: {bookingNumber}\n\nIf you need to reschedule or cancel, please let us know as soon as possible.',
            variables: ['name', 'date', 'service', 'bookingNumber']
          },
          {
            type: 'cancellation',
            subject: 'Booking Cancelled - MakeUP By Mercy',
            body: 'Hi {name},\n\nYour booking {bookingNumber} has been successfully cancelled.\n\nIf you have any questions, please don\'t hesitate to contact us.',
            variables: ['name', 'bookingNumber']
          }
        ]);
        logger.info('Default email templates initialized');
      }
    }
  } catch (error) {
    logger.error('Error initializing email templates:', error.message);
  }
}

// Initialize default pricing (only if not exists)
async function initializeDefaultPricing() {
  try {
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const count = await Pricing.countDocuments();
      if (count === 0) {
        await Pricing.create([
          { service: 'bridal', minPrice: 15000, maxPrice: 25000, description: 'Bridal makeup and styling' },
          { service: 'party', minPrice: 8000, maxPrice: 15000, description: 'Party and event makeup' },
          { service: 'casual', minPrice: 5000, maxPrice: 10000, description: 'Casual daily makeup' }
        ]);
        logger.info('Default pricing initialized');
      }
    }
  } catch (error) {
    logger.error('Error initializing pricing:', error.message);
  }
}

// Initialize default admin (only if not exists)
async function initializeDefaultAdmin() {
  try {
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const existingAdmin = await Admin.findOne({ username: 'admin' });
      if (!existingAdmin) {
        const hashedPassword = await bcryptjs.hash('admin123', 10);
        await Admin.create({
          username: 'admin',
          email: process.env.OWNER_EMAIL || 'admin@makeup-mercy.com',
          password: hashedPassword,
          role: 'admin',
          active: true
        });
        log('INFO', 'Default admin user created');
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
app.post('/api/admin/login', authLimiter, validateRequest(adminLoginSchema), async (req, res) => {
  try {
    const { username, password } = req.validatedBody;
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
      auditLog('LOGIN_FAILED', username, { reason: 'user_not_found', ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Verify password
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const isPasswordValid = await bcryptjs.compare(password, admin.password);
      if (!isPasswordValid) {
        auditLog('LOGIN_FAILED', username, { reason: 'invalid_password', ip: req.ip });
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
    } else if (admin.username !== 'admin' || password !== 'admin123') {
      auditLog('LOGIN_FAILED', username, { reason: 'invalid_password', ip: req.ip });
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

    auditLog('LOGIN_SUCCESS', username, { ip: req.ip, role: admin.role });
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
      const booking_obj = bookings.find(b => b.id === parseInt(bookingId));
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
      const booking_obj = bookings.find(b => b.id === parseInt(bookingId));
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

    let booking = bookings.find(b => b.id === parseInt(bookingId));
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

      // QR Code (use cached version for better performance)
      if (booking.qrCode) {
        try {
          const img = Buffer.from(booking.qrCode.replace('data:image/png;base64,', ''), 'base64');
          doc.image(img, doc.page.margins.left, doc.y + 20, { width: 100, height: 100 });
          doc.fontSize(9).text('Scan QR code to track your booking', doc.x + 110, doc.y - 80);
        } catch (error) {
          log('WARN', 'Failed to embed cached QR code in PDF:', error.message);
          doc.fontSize(9).text('Booking ID: ' + booking.bookingNumber, doc.x + 110, doc.y - 80);
        }
      } else {
        doc.fontSize(9).text('Booking ID: ' + booking.bookingNumber, doc.x + 110, doc.y);
      }

      // Footer
      doc.fontSize(8).font('Helvetica-Oblique');
      doc.text('Thank you for booking with MakeUP By Mercy!', { align: 'center', y: 750 });
      doc.text('For more details, visit our website or contact us on WhatsApp', { align: 'center' });

      doc.end();
    } catch (error) {
      log('ERROR', 'Receipt PDF generation error:', error.message);
      reject(error);
    }
  });
}

// ========== NEW RECEIPT & MANAGEMENT ENDPOINTS ==========

// Validate booking ID format to prevent NoSQL injection
function validateBookingId(id) {
  return /^MKP-\d{5}$/.test(id);
}

// Download Receipt as PDF
app.get('/api/bookings/:id/receipt/pdf', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate booking ID format
    if (!validateBookingId(id)) {
      log('WARN', 'Invalid booking ID format attempt:', id);
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }

    let booking = null;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOne({ bookingNumber: id });
    } else {
      booking = bookings.find(b => b.bookingNumber === id);
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

// Download Receipt as Image (PNG with booking details)
app.get('/api/bookings/:id/receipt/image', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate booking ID format
    if (!validateBookingId(id)) {
      log('WARN', 'Invalid booking ID format attempt:', id);
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }

    let booking = null;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOne({ bookingNumber: id });
    } else {
      booking = bookings.find(b => b.bookingNumber === id);
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

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Validate redirect URLs to prevent open redirect attacks
function isValidRedirect(url) {
  if (!url) return false;

  // Whitelist of allowed redirect destinations
  const allowedHosts = [
    'localhost:3000',
    'localhost:5000',
    'makeup-by-mercy.onrender.com',
    process.env.CLIENT_URL || ''
  ];

  try {
    // Prevent protocol-relative and data: URIs
    if (url.startsWith('//') || url.startsWith('data:') || url.startsWith('javascript:')) {
      return false;
    }

    // Allow relative URLs (start with /)
    if (url.startsWith('/')) {
      return true;
    }

    // For absolute URLs, check against whitelist
    const urlObj = new URL(url);
    return allowedHosts.some(host => urlObj.host === host);
  } catch (e) {
    return false;
  }
}

// Contact Customer (Admin only)
app.post('/api/admin/bookings/:id/contact', verifyAdminToken, validateRequest(contactCustomerSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, message } = req.validatedBody;

    // Validate booking ID format
    if (!validateBookingId(id)) {
      log('WARN', 'Invalid booking ID format attempt:', id);
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }

    // Validate input
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ success: false, message: 'Message exceeds maximum length' });
    }

    let booking = null;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOne({ bookingNumber: id });
    } else {
      booking = bookings.find(b => b.bookingNumber === id);
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Send email to customer with escaped content
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: booking.email,
      subject: escapeHtml(subject || `Update regarding your booking ${booking.bookingNumber}`),
      html: `
        <h2>Hello ${escapeHtml(booking.name)},</h2>
        <p>${escapeHtml(message)}</p>
        <p><strong>Booking ID:</strong> ${escapeHtml(booking.bookingNumber)}</p>
        <p><strong>Service:</strong> ${escapeHtml(booking.service)}</p>
        <p><strong>Date:</strong> ${new Date(booking.date).toLocaleDateString()}</p>
        <p>Best regards,<br>MakeUP By Mercy</p>
      `
    });

    auditLog('CONTACT_CUSTOMER', req.admin.username, {
      bookingId: id,
      customerId: booking.email,
      messageLength: message.length
    });
    res.json({ success: true, message: 'Message sent to customer' });
  } catch (error) {
    log('ERROR', 'Contact customer error:', error.message);
    res.status(500).json({ success: false, message: 'Error sending message' });
  }
});

// Update Booking Status (Workflow: pending -> confirmed -> completed/cancelled)
app.patch('/api/admin/bookings/:id/status', verifyAdminToken, validateRequest(statusUpdateSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.validatedBody;

    let booking = null;
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      booking = await Booking.findOneAndUpdate(
        { bookingNumber: id },
        { status, updatedAt: new Date() },
        { new: true }
      );
    } else {
      booking = bookings.find(b => b.bookingNumber === id);
      if (booking) booking.status = status;
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    auditLog('STATUS_UPDATE', req.admin.username, { bookingId: id, newStatus: status });
    res.json({ success: true, booking, message: `Booking status updated to ${status}` });
  } catch (error) {
    log('ERROR', 'Status update error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating status' });
  }
});

// ========== ADMIN USER MANAGEMENT ENDPOINTS ==========

// Create Admin User (Super admin only)
app.post('/api/admin/users', verifyAdminToken, requireRole('admin'), validateRequest(createAdminSchema), async (req, res) => {
  try {
    const { username, email, password, role } = req.validatedBody;

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

    auditLog('USER_CREATED', req.admin.username, { newUsername: username, newRole: role, email });
    res.json({ success: true, admin: { username: newAdmin.username, email: newAdmin.email, role: newAdmin.role } });
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

// ========== PRICING MANAGEMENT ENDPOINTS ==========

// Get all pricing (Admin)
app.get('/api/admin/pricing', verifyAdminToken, async (req, res) => {
  try {
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const pricing = await Pricing.find().sort({ service: 1 });
      res.json({ success: true, pricing });
    } else {
      // Fallback for development
      res.json({ success: true, pricing: [
        { service: 'bridal', minPrice: 15000, maxPrice: 25000 },
        { service: 'party', minPrice: 8000, maxPrice: 15000 },
        { service: 'casual', minPrice: 5000, maxPrice: 10000 }
      ]});
    }
  } catch (error) {
    logger.error('Pricing fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching pricing' });
  }
});

// Update pricing for a service (Admin only)
app.patch('/api/admin/pricing/:service', verifyAdminToken, requireRole('admin'), validateRequest(updatePricingSchema), async (req, res) => {
  try {
    const { service } = req.params;
    const { minPrice, maxPrice, description } = req.validatedBody;

    // Validate service
    if (!['bridal', 'party', 'casual'].includes(service)) {
      return res.status(400).json({ success: false, message: 'Invalid service type' });
    }

    if (!MONGO_URI || mongoose.connection.readyState !== 1) {
      return res.status(400).json({ success: false, message: 'Database required for pricing management' });
    }

    const updatedPricing = await Pricing.findOneAndUpdate(
      { service },
      {
        minPrice,
        maxPrice,
        description: description || '',
        updatedBy: req.admin.username,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!updatedPricing) {
      return res.status(404).json({ success: false, message: 'Pricing not found' });
    }

    auditLog('PRICING_UPDATE', req.admin.username, {
      service,
      minPrice,
      maxPrice
    });

    res.json({ success: true, pricing: updatedPricing });
  } catch (error) {
    logger.error('Pricing update error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating pricing' });
  }
});

// Set pricing for multiple services (Admin only)
app.post('/api/admin/pricing', verifyAdminToken, requireRole('admin'), async (req, res) => {
  try {
    const { bridal, party, casual } = req.body;

    if (!MONGO_URI || mongoose.connection.readyState !== 1) {
      return res.status(400).json({ success: false, message: 'Database required' });
    }

    const updates = [];

    if (bridal && bridal.minPrice !== undefined && bridal.maxPrice !== undefined) {
      updates.push({ service: 'bridal', ...bridal, updatedBy: req.admin.username, updatedAt: new Date() });
    }
    if (party && party.minPrice !== undefined && party.maxPrice !== undefined) {
      updates.push({ service: 'party', ...party, updatedBy: req.admin.username, updatedAt: new Date() });
    }
    if (casual && casual.minPrice !== undefined && casual.maxPrice !== undefined) {
      updates.push({ service: 'casual', ...casual, updatedBy: req.admin.username, updatedAt: new Date() });
    }

    const results = [];
    for (const update of updates) {
      const result = await Pricing.findOneAndUpdate(
        { service: update.service },
        update,
        { new: true }
      );
      results.push(result);
    }

    auditLog('PRICING_BULK_UPDATE', req.admin.username, {
      servicesUpdated: results.map(p => p.service)
    });

    res.json({ success: true, pricing: results });
  } catch (error) {
    logger.error('Pricing batch update error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating pricing' });
  }
});

// Get pricing for a specific service
app.get('/api/pricing/:service', async (req, res) => {
  try {
    const { service } = req.params;

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const pricing = await Pricing.findOne({ service });
      if (!pricing) {
        return res.status(404).json({ success: false, message: 'Pricing not found' });
      }
      res.json({ success: true, pricing });
    } else {
      // Fallback
      const fallback = {
        bridal: { service: 'bridal', minPrice: 15000, maxPrice: 25000 },
        party: { service: 'party', minPrice: 8000, maxPrice: 15000 },
        casual: { service: 'casual', minPrice: 5000, maxPrice: 10000 }
      };
      res.json({ success: true, pricing: fallback[service] });
    }
  } catch (error) {
    logger.error('Pricing fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching pricing' });
  }
});

// ========== EMAIL TEMPLATES ENDPOINTS ==========

// GET /api/admin/email-templates - Retrieve all email templates (requires JWT admin)
app.get('/api/admin/email-templates', verifyAdminToken, requireRole('admin'), async (req, res) => {
  try {
    const templates = await EmailTemplate.find({}).select('-__v');
    res.json({ success: true, templates });
  } catch (error) {
    logger.error('Get email templates error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve email templates' });
  }
});

// GET /api/email-templates/:type - Get specific email template by type (public)
app.get('/api/email-templates/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const template = await EmailTemplate.findOne({ type }).select('-__v');

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true, template });
  } catch (error) {
    logger.error('Get email template error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve email template' });
  }
});

// PUT /api/admin/email-templates/:type - Update email template (requires JWT admin)
app.put('/api/admin/email-templates/:type', verifyAdminToken, requireRole('admin'), async (req, res) => {
  try {
    const { type } = req.params;
    const validation = updateEmailTemplateSchema.validate(req.body);

    if (validation.error) {
      return res.status(400).json({ success: false, message: validation.error.details[0].message });
    }

    const template = await EmailTemplate.findOneAndUpdate(
      { type },
      {
        subject: validation.value.subject,
        body: validation.value.body,
        updatedBy: req.admin.username,
        updatedAt: new Date()
      },
      { new: true }
    ).select('-__v');

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    // Audit log
    auditLog('TEMPLATE_UPDATED', req.admin.username, {
      type,
      templateId: template._id,
      updatedFields: ['subject', 'body']
    });

    res.json({ success: true, message: 'Email template updated successfully', template });
  } catch (error) {
    logger.error('Update email template error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update email template' });
  }
});

// PATCH /api/admin/email-templates/:type - Partial update email template (requires JWT admin)
app.patch('/api/admin/email-templates/:type', verifyAdminToken, requireRole('admin'), async (req, res) => {
  try {
    const { type } = req.params;
    const updates = {};

    if (req.body.subject) {
      const subjectValidation = Joi.string().min(5).max(200).validate(req.body.subject);
      if (subjectValidation.error) {
        return res.status(400).json({ success: false, message: 'Invalid subject' });
      }
      updates.subject = req.body.subject;
    }

    if (req.body.body) {
      const bodyValidation = Joi.string().min(20).max(5000).validate(req.body.body);
      if (bodyValidation.error) {
        return res.status(400).json({ success: false, message: 'Invalid body' });
      }
      updates.body = req.body.body;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    updates.updatedBy = req.admin.username;
    updates.updatedAt = new Date();

    const template = await EmailTemplate.findOneAndUpdate(
      { type },
      updates,
      { new: true }
    ).select('-__v');

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    // Audit log
    auditLog('TEMPLATE_UPDATED', req.admin.username, {
      type,
      templateId: template._id,
      updatedFields: Object.keys(updates).filter(k => k !== 'updatedBy' && k !== 'updatedAt')
    });

    res.json({ success: true, message: 'Email template updated successfully', template });
  } catch (error) {
    logger.error('Patch email template error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update email template' });
  }
});

// Initialize defaults on startup
mongoose.connection.once('connected', () => {
  initializeDefaultAdmin();
  initializeDefaultPricing();
  initializeDefaultEmailTemplates();
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  log('INFO', `Server listening on http://localhost:${PORT}`);
});

// ========== ERROR HANDLING MIDDLEWARE ==========
// Log errors but don't expose stack traces to clients
app.use((err, req, res, next) => {
  // Log full error server-side (with stack trace)
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.admin?.id || 'anonymous'
  });

  // Don't expose stack trace to client
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    success: false,
    message: isProduction ? 'Internal server error' : err.message,
    errorId: new Date().getTime() // For debugging/support reference
  });
});

// ========== 404 HANDLER ==========
app.use((req, res) => {
  logger.warn('Route not found', { path: req.path, method: req.method });
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});
