const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
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
// Tests supply their own environment; never let a developer's real .env
// (which may point at the live database) leak into a test run.
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a hosting proxy (Render etc.) every request arrives from the proxy's
// address, so without this req.ip is the same for all visitors and the rate
// limiters below would count the whole site as a single client. Trust one
// proxy hop in production; set TRUST_PROXY to a different hop count if needed.
const trustProxyHops = parseInt(process.env.TRUST_PROXY, 10);
if (Number.isInteger(trustProxyHops)) {
  app.set('trust proxy', trustProxyHops);
} else if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ========== WINSTON LOGGING SETUP ==========
const fs = require('fs');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  silent: process.env.NODE_ENV === 'test',
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
// Maps non-standard levels (e.g. 'SUCCESS') to valid Winston npm levels,
// since Winston silently drops log calls with an unrecognized level.
function log(level, message, data = '') {
  const normalizedLevel = level.toLowerCase() === 'success' ? 'info' : level.toLowerCase();
  logger.log({ level: normalizedLevel, message, data: data || null });
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
    .catch(err => log('ERROR', 'MongoDB connection failed - bookings will be refused until it connects:', err.message));
  mongoose.connection.on('disconnected', () => log('ERROR', 'MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => log('INFO', 'MongoDB reconnected'));
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
  time: { type: String, default: null }, // appointment time, HH:MM (older bookings have none)
  bookedAt: { type: Date, default: Date.now },
  status: { type: String, default: 'confirmed' },
  emailSent: { type: Boolean, default: false },
  ownerEmailSent: { type: Boolean, default: false },
  qrCode: { type: String, default: null },
  // The photo itself lives in the separate bookingphotos collection (ADR 0001);
  // this flag keeps booking lists light and tells the admin UI whether to look.
  hasPhoto: { type: Boolean, default: false },
  // Random per-booking secret returned only to the customer who made the
  // booking. It lets them download their own receipt without an admin login.
  receiptToken: { type: String, default: null }
});

const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);

// ========== EMAIL CONFIGURATION ==========
// Two providers, tried in this order:
//   1. SendGrid (HTTPS API). Preferred: Render's outbound SMTP connections to
//      Gmail were unreliable in production, HTTPS doesn't have that problem.
//   2. Gmail SMTP with an app password (EMAIL_USER + EMAIL_PASSWORD). Used when
//      SendGrid isn't configured, or when a SendGrid send fails.
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_USER;
const hasSendGrid = () => !!process.env.SENDGRID_API_KEY;
const hasGmail = () => !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);
const isEmailConfigured = () => hasSendGrid() || hasGmail();

if (hasSendGrid()) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}
log(isEmailConfigured() ? 'INFO' : 'WARN',
  `Email providers: SendGrid ${hasSendGrid() ? 'configured' : 'not configured'}, Gmail fallback ${hasGmail() ? 'configured' : 'not configured (set EMAIL_USER and EMAIL_PASSWORD)'}${isEmailConfigured() ? '' : ' - emails will not be sent'}`);

let gmailTransport = null;
function getGmailTransport() {
  if (!gmailTransport) {
    gmailTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
      // Fail within seconds rather than leave a booking waiting on a stalled connection
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }
  return gmailTransport;
}

function describeEmailError(error) {
  const detail = error && error.response && error.response.body && error.response.body.errors && error.response.body.errors[0];
  return (detail && detail.message) || (error && error.message) || 'unknown error';
}

// Send via the first provider that works. Resolves with the provider's name
// ('sendgrid' or 'gmail'); throws if every configured provider fails or none is
// configured, so existing try/catch call sites keep working unchanged.
async function sendEmail({ to, subject, html }) {
  const failures = [];

  if (hasSendGrid()) {
    try {
      await sgMail.send({ to, from: SENDGRID_FROM_EMAIL, subject, html });
      return 'sendgrid';
    } catch (error) {
      failures.push(`SendGrid: ${describeEmailError(error)}`);
      log('WARN', hasGmail() ? 'SendGrid failed, falling back to Gmail:' : 'SendGrid failed:', describeEmailError(error));
    }
  }

  if (hasGmail()) {
    try {
      await getGmailTransport().sendMail({
        from: `"MakeUP By Mercy" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html
      });
      return 'gmail';
    } catch (error) {
      failures.push(`Gmail: ${describeEmailError(error)}`);
    }
  }

  if (failures.length === 0) {
    throw new Error('No email provider configured (set SENDGRID_API_KEY, or EMAIL_USER and EMAIL_PASSWORD)');
  }
  throw new Error(failures.join(' | '));
}

// Middleware
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'https://makeup-by-mercy.onrender.com',
  process.env.CLIENT_URL || ''
].filter(Boolean).map(o => o.replace(/\/+$/, ''));

// A request is allowed when it has no Origin (same-origin GETs, curl), comes
// from a whitelisted origin, or comes from the very host serving it. The last
// rule matters: a same-origin POST still carries an Origin header, so a fixed
// whitelist rejected the site's own booking form on any domain not listed
// (a custom domain, Railway, a preview URL) unless CLIENT_URL matched exactly.
function isAllowedOrigin(origin, req) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch (error) {
    return false;
  }
}

const corsOptions = {
  // Disallowed origins are rejected by the middleware below with a 403, so by
  // the time cors() runs the origin has already been vetted.
  origin: true,
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
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
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
// Applied to /api only (see app.use below), so page, image and script loads
// don't eat into the budget. The admin console makes several API calls per
// view, hence the headroom over a public visitor's needs.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health'
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
  // Appointment start time, 24-hour HH:MM. Part of the booking number.
  time: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required().messages({
    'string.pattern.base': '"time" must be a valid time (HH:MM)'
  }),
  // The booking form only collects a date (no time-of-day), so the client
  // sends a date-only string like "2026-09-24", which Joi/JS parse as
  // midnight UTC. Comparing that against .min('now') (the exact current
  // instant) meant any same-day booking always failed, since midnight is
  // always earlier than "right now" later that day. Compare against the
  // start of today (UTC) instead, recomputed on every request.
  date: Joi.date().iso().required().custom((value, helpers) => {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    if (value < startOfToday) {
      return helpers.message('"date" must be today or in the future');
    }
    return value;
  }, 'reject dates before today')
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

// Update-user validation schema: every field optional, but not an empty body
const updateAdminSchema = Joi.object({
  email: Joi.string().email(),
  password: Joi.string().min(8).max(100).pattern(/[A-Z]/).pattern(/[0-9]/).pattern(/[!@#$%^&*]/),
  role: Joi.string().valid('admin', 'manager', 'viewer')
}).min(1);

// Pricing validation schema
const updatePricingSchema = Joi.object({
  price: Joi.number().min(0).required(),
  description: Joi.string().max(500).allow('').optional(),
  duration: Joi.string().max(100).allow('').optional()
});

// Bulk pricing: any of the three services, each with the single-update fields
const bulkServicePricing = Joi.object({
  price: Joi.number().min(0).required(),
  description: Joi.string().max(500).allow('').optional(),
  duration: Joi.string().max(100).allow('').optional()
});
const bulkPricingSchema = Joi.object({
  bridal: bulkServicePricing,
  party: bulkServicePricing,
  casual: bulkServicePricing
}).min(1);

// Email Template validation schema
const updateEmailTemplateSchema = Joi.object({
  subject: Joi.string().min(5).max(200).required(),
  body: Joi.string().min(20).max(5000).required()
});

// Availability validation schema
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const updateAvailabilitySchema = Joi.object({
  weekdayStart: Joi.string().pattern(timePattern).required(),
  weekdayEnd: Joi.string().pattern(timePattern).required(),
  weekendStart: Joi.string().pattern(timePattern).required(),
  weekendEnd: Joi.string().pattern(timePattern).required(),
  leadTimeDays: Joi.number().integer().min(0).max(90).required()
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

app.use('/api', generalLimiter);
app.use((req, res, next) => {
  if (!isAllowedOrigin(req.headers.origin, req)) {
    return res.status(403).json({ success: false, message: 'Origin not allowed' });
  }
  next();
});
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

// Serve static files. Only the files the site actually needs are exposed.
// Serving the whole project directory made server.js, package.json, logs/
// and docs such as MONGODB_CREDENTIALS.md publicly downloadable.
app.use('/Pictures', express.static(path.join(__dirname, 'Pictures'), { dotfiles: 'ignore', index: false }));

const PUBLIC_FILES = ['index.html', 'admin.html', 'admin-login.html', 'admin.js', 'admin-login.js'];
PUBLIC_FILES.forEach((file) => {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
});

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

// Plain-text email header values (subjects) must not carry line breaks.
function stripLineBreaks(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

// Where the admin console lives, for links in owner emails.
const ADMIN_URL = `${(process.env.CLIENT_URL || `http://localhost:${PORT}`).replace(/\/+$/, '')}/admin`;

// Last-resort copy of the confirmation template, used only if neither the
// database nor the in-memory store has one (matches the seeded default).
const DEFAULT_CONFIRMATION_TEMPLATE = {
  type: 'confirmation',
  subject: 'Your MakeUP By Mercy Booking Confirmed - ID: {bookingNumber}',
  body: 'Thank you for booking with MakeUP By Mercy! Your appointment is confirmed.\n\nBooking Details:\nBooking ID: {bookingNumber}\nDate: {date}\nTime: {time}\nService: {service}\nPhone: {phone}\nCountry: {country}\n\nWe look forward to making you look stunning!'
};

// Replace {placeholders} with values; unknown placeholders are left as-is.
function renderTemplate(text, values) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}

// Fetch an email template from wherever templates currently live, so edits
// made in the admin Settings > Email Templates tab actually reach customers.
async function getEmailTemplate(type) {
  try {
    if (isDbConnected()) {
      const stored = await EmailTemplate.findOne({ type }).lean();
      if (stored) return stored;
    } else {
      const stored = emailTemplatesMemory.find(t => t.type === type);
      if (stored) return stored;
    }
  } catch (error) {
    log('WARN', `Could not load ${type} email template, using default:`, error.message);
  }
  return type === 'confirmation' ? DEFAULT_CONFIRMATION_TEMPLATE : null;
}

// Function to send confirmation email to CLIENT
async function sendConfirmationEmail(booking) {
  try {
    if (!isEmailConfigured()) {
      log('WARN', 'Email disabled - no email provider configured');
      return false;
    }

    log('INFO', `Sending confirmation email to ${booking.email}`);

    const template = await getEmailTemplate('confirmation');
    const serviceLabel = booking.service.charAt(0).toUpperCase() + booking.service.slice(1).replace(/([A-Z])/g, ' $1');
    const dateLabel = new Date(booking.date).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
    });
    const values = {
      bookingNumber: booking.bookingNumber,
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
      country: booking.country,
      service: serviceLabel,
      date: dateLabel,
      time: formatTime12(booking.time)
    };

    // Subject is plain text; the body is escaped (admin-written text and the
    // customer's values alike) and then given line breaks.
    const subject = stripLineBreaks(renderTemplate(template.subject, values));
    const bodyHtml = escapeHtml(renderTemplate(template.body, values)).split(/\r\n|\r|\n/).join('<br>');

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: booking.email,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #cc3380 0%, #ff69b4 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">🎨 MakeUP By Mercy</h1>
            <p style="color: white; margin: 10px 0 0 0;">Your Booking is Confirmed!</p>
          </div>

          <div style="background: white; padding: 30px; border: 1px solid #e0e0e0;">
            <p style="color: #333; font-size: 16px;">Hi ${escapeHtml(booking.name)},</p>

            <div style="background: #f2ebf2; padding: 20px; border-radius: 8px; margin: 20px 0; color: #333; line-height: 1.6;">
              ${bodyHtml}
            </div>

            <p style="color: #666; line-height: 1.6;">
              We'll contact you soon to confirm the exact time for your appointment. If you need to reschedule or have any questions, please reply to this email.
            </p>

            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              Best regards,<br>
              <strong>MakeUP By Mercy Team</strong><br>
              Making you beautiful, one face at a time
            </p>
          </div>

          <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px;">
            <p style="margin: 0;">© ${new Date().getFullYear()} MakeUP By Mercy. All rights reserved.</p>
            <p style="margin: 10px 0 0 0;">For support, contact: support@makeupbymercy.com</p>
          </div>
        </div>
      `
    };

    const provider = await sendEmail(mailOptions);
    log('SUCCESS', `Confirmation email sent to ${booking.email} via ${provider}`);

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
    // If SendGrid is not configured, skip
    if (!isEmailConfigured()) {
      log('WARN', 'No email provider configured - skipping admin notification');
      return true;
    }

    const ownerEmail = process.env.OWNER_EMAIL || process.env.EMAIL_USER;
    log('INFO', `Sending admin notification to ${ownerEmail}`);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: ownerEmail,
      subject: `New Booking: ${stripLineBreaks(booking.name)} - ${booking.service.toUpperCase()}`,
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
              <p style="margin: 10px 0;"><strong>Client Name:</strong> ${escapeHtml(booking.name)}</p>
              <p style="margin: 10px 0;"><strong>Client Phone:</strong> ${escapeHtml(booking.phone)} (${escapeHtml(booking.country)})</p>
              <p style="margin: 10px 0;"><strong>Client Email:</strong> ${escapeHtml(booking.email)}</p>
              <p style="margin: 10px 0;"><strong>Service Type:</strong> ${escapeHtml(booking.service.charAt(0).toUpperCase() + booking.service.slice(1).replace(/([A-Z])/g, ' $1'))}</p>
              <p style="margin: 10px 0;"><strong>Booking Date:</strong> ${new Date(booking.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</p>
              <p style="margin: 10px 0;"><strong>Appointment Time:</strong> ${escapeHtml(formatTime12(booking.time) || 'Not specified')}</p>
              <p style="margin: 10px 0;"><strong>Booked At:</strong> ${new Date(booking.bookedAt).toLocaleString()}</p>
            </div>

            <p style="color: #666; line-height: 1.6;">
              Remember to:
              <br>✓ Confirm the appointment time with the client
              <br>✓ Prepare your makeup kit
              <br>✓ Set a reminder for the booking date
            </p>

            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              View all bookings at: <a href="${escapeHtml(ADMIN_URL)}" style="color: #cc3380; text-decoration: none;">Your Bookings Dashboard</a>
            </p>
          </div>

          <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px;">
            <p style="margin: 0;">© 2024 MakeUP By Mercy. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const provider = await sendEmail(mailOptions);
    log('SUCCESS', `Booking notification sent to owner (${ownerEmail}) via ${provider}`);

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
// Booking numbers read <TYPE>-<APPOINTMENT DATE>-<APPOINTMENT TIME>-<SEQ>, e.g.
// BRD-20261015-1400-01 = Bridal, 15 Oct 2026, 2:00pm, first booking for that slot.
// The sequence comes from the bookings already stored for that exact slot, so it
// never depends on a counter held in server memory (which restarts at zero).
const SERVICE_CODES = { bridal: 'BRD', party: 'PTY', casual: 'CSL' };

function bookingNumberPrefix(service, date, time) {
  const day = new Date(date).toISOString().slice(0, 10).replace(/-/g, '');
  return `${SERVICE_CODES[service]}-${day}-${time.replace(':', '')}-`;
}

// The next number for a slot, given the numbers already taken for it
function numberAfter(prefix, takenNumbers) {
  const highest = takenNumbers.reduce((max, number) => Math.max(max, parseInt(number.slice(prefix.length), 10) || 0), 0);
  return prefix + String(highest + 1).padStart(2, '0');
}

// Database mode: read what is stored for this exact slot
async function nextBookingNumber(service, date, time) {
  const prefix = bookingNumberPrefix(service, date, time);
  const rows = await Booking.find({ bookingNumber: { $regex: `^${prefix}` } }, { bookingNumber: 1 }).lean();
  return numberAfter(prefix, rows.map(b => b.bookingNumber));
}

// In-memory mode: same rule, synchronous, so it can be claimed in the same tick
function nextBookingNumberInMemory(service, date, time) {
  const prefix = bookingNumberPrefix(service, date, time);
  return numberAfter(prefix, bookings.filter(b => String(b.bookingNumber).startsWith(prefix)).map(b => b.bookingNumber));
}

// Opening hours that apply to an appointment date. Before the owner has saved
// availability settings the site's stated hours (9AM-8PM every day) apply.
function hoursForDate(date, availability) {
  if (!availability.configured) return { start: '09:00', end: '20:00', label: 'every day' };
  const weekend = [0, 6].includes(new Date(date).getUTCDay());
  return weekend
    ? { start: availability.weekendStart, end: availability.weekendEnd, label: 'on weekends' }
    : { start: availability.weekdayStart, end: availability.weekdayEnd, label: 'on weekdays' };
}

function formatTime12(hhmm) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// In-memory bookings database (fallback if MongoDB not connected)
let bookings = [];

// In-memory email templates (fallback if MongoDB not connected) - mirrors
// the defaults seeded into MongoDB by initializeDefaultEmailTemplates()
let emailTemplatesMemory = [
  {
    _id: 'mem-confirmation',
    type: 'confirmation',
    subject: 'Your MakeUP By Mercy Booking Confirmed - ID: {bookingNumber}',
    body: 'Thank you for booking with MakeUP By Mercy! Your appointment is confirmed.\n\nBooking Details:\nBooking ID: {bookingNumber}\nDate: {date}\nTime: {time}\nService: {service}\nPhone: {phone}\nCountry: {country}\n\nWe look forward to making you look stunning!',
    variables: ['bookingNumber', 'date', 'time', 'service', 'phone', 'country'],
    updatedBy: 'system',
    updatedAt: new Date()
  },
  {
    _id: 'mem-reminder',
    type: 'reminder',
    subject: 'Reminder: Your MakeUP By Mercy Appointment - {date}',
    body: 'Hi {name},\n\nThis is a friendly reminder about your upcoming appointment with MakeUP By Mercy.\n\nDate: {date}\nService: {service}\nBooking ID: {bookingNumber}\n\nIf you need to reschedule or cancel, please let us know as soon as possible.',
    variables: ['name', 'date', 'service', 'bookingNumber'],
    updatedBy: 'system',
    updatedAt: new Date()
  },
  {
    _id: 'mem-cancellation',
    type: 'cancellation',
    subject: 'Booking Cancelled - MakeUP By Mercy',
    body: 'Hi {name},\n\nYour booking {bookingNumber} has been successfully cancelled.\n\nIf you have any questions, please don\'t hesitate to contact us.',
    variables: ['name', 'bookingNumber'],
    updatedBy: 'system',
    updatedAt: new Date()
  }
];

// In-memory availability settings (fallback if MongoDB not connected)
let availabilityMemory = {
  // false until an admin saves settings, so nothing changes for customers
  // until the owner has actually chosen their hours / lead time.
  configured: false,
  weekdayStart: '09:00',
  weekdayEnd: '20:00',
  weekendStart: '10:00',
  weekendEnd: '18:00',
  leadTimeDays: 1,
  updatedBy: 'system',
  updatedAt: new Date()
};

// In-memory pricing (fallback if MongoDB not connected, e.g. briefly after
// a cold start before Mongoose finishes reconnecting)
let pricingMemory = [
  { service: 'bridal', price: 25000, duration: '2-3 hours', description: 'Bridal makeup and styling', updatedBy: 'system', updatedAt: new Date() },
  { service: 'party', price: 15000, duration: '1.5-2 hours', description: 'Party and event makeup', updatedBy: 'system', updatedAt: new Date() },
  { service: 'casual', price: 10000, duration: '1-1.5 hours', description: 'Casual daily makeup', updatedBy: 'system', updatedAt: new Date() }
];

// API Routes

// GET all bookings (admin route)
app.get('/api/bookings', verifyAdminToken, async (req, res) => {
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
    const { name, email, phone, country, service, date, time } = req.validatedBody;

    // A database is configured but not connected: refuse, rather than quietly
    // keeping the booking in server memory where it would vanish on restart
    // (and the customer would still be told it was confirmed).
    if (MONGO_URI && mongoose.connection.readyState !== 1) {
      log('ERROR', 'Booking refused: database is configured but not connected');
      return res.status(503).json({
        success: false,
        message: 'Booking is temporarily unavailable. Please try again in a few minutes, or contact Mercy on WhatsApp.'
      });
    }

    // Enforce the admin-set notice period (only once the owner has saved
    // availability settings). Checked before a booking number is allocated.
    const availability = await getAvailabilitySettings();
    if (availability.configured && availability.leadTimeDays > 0) {
      const earliest = new Date();
      earliest.setUTCHours(0, 0, 0, 0);
      earliest.setUTCDate(earliest.getUTCDate() + availability.leadTimeDays);
      if (new Date(date) < earliest) {
        const days = availability.leadTimeDays;
        const message = `Bookings need at least ${days} day${days === 1 ? '' : 's'} notice. Please choose a later date.`;
        return res.status(400).json({ success: false, message, errors: [{ field: 'date', message }] });
      }
    }

    // The appointment must start inside opening hours
    const hours = hoursForDate(date, availability);
    if (time < hours.start || time >= hours.end) {
      const message = `Appointments are available between ${formatTime12(hours.start)} and ${formatTime12(hours.end)} ${hours.label}. Please choose a time in that range.`;
      return res.status(400).json({ success: false, message, errors: [{ field: 'time', message }] });
    }

    const booking = {
      id: Date.now(),
      bookingNumber: null, // assigned below, from what is already stored
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      country: country || 'Nigeria',
      service,
      date,
      time,
      bookedAt: new Date().toISOString(),
      status: 'confirmed',
      receiptToken: crypto.randomBytes(16).toString('hex'),
      hasPhoto: false
    };

    // Allocate the number and save.
    const useDb = MONGO_URI && mongoose.connection.readyState === 1;

    if (useDb) {
      // Two customers booking the same slot in the same instant can be offered
      // the same sequence; the unique index rejects the second save, so take
      // the next number and try again.
      const MAX_ATTEMPTS = 10;
      for (let attempt = 1; ; attempt += 1) {
        booking.id = Date.now() + attempt - 1;
        booking.bookingNumber = await nextBookingNumber(service, date, time);
        // Pre-generate and cache the QR code for faster PDF generation
        booking.qrCode = (await generateQRCode(booking.bookingNumber)) || null;
        try {
          const newBooking = new Booking(booking);
          await newBooking.save();
          // Mirror Mongo's real _id back onto the response payload so the
          // admin UI (which always reads booking._id) has a valid identifier
          // regardless of storage backend.
          booking._id = newBooking._id.toString();
          log('SUCCESS', `Booking saved to MongoDB: ${booking.bookingNumber}`);
          break;
        } catch (error) {
          if (error.code !== 11000 || attempt >= MAX_ATTEMPTS) throw error;
          log('WARN', `Booking number ${booking.bookingNumber} was taken at the same moment, trying the next one`);
        }
      }
    } else {
      // No database (local development only): reserve the number and store the
      // booking in the same step, so two requests can never be given the same
      // number, then add the QR code.
      booking.bookingNumber = nextBookingNumberInMemory(service, date, time);
      booking.id = Date.now();
      while (bookings.some(b => b.id === booking.id)) booking.id += 1;
      // In-memory fallback has no database-assigned _id, so mint one from
      // the numeric id. Without this, admin actions (confirm/cancel/message)
      // that look bookings up by _id can never find an in-memory booking.
      booking._id = String(booking.id);
      bookings.push(booking);
      booking.qrCode = (await generateQRCode(booking.bookingNumber)) || null;
      log('INFO', `Booking saved to memory: ${booking.bookingNumber}`);
    }

    log('INFO', `New booking: ${booking.name} | ${booking.email} | ${booking.service} | ${booking.date}`);

    // The booking is already saved at this point, which is what actually
    // matters to the customer. Sending email over SMTP is comparatively
    // slow and occasionally unreliable (e.g. a stalled connection to
    // Gmail), so it must not block the response - previously, awaiting
    // this here meant a single slow/failing SMTP attempt held the
    // customer on "Booking..." for up to nodemailer's full connection
    // timeout. Fire the emails in the background instead, and log the
    // outcome for follow-up rather than promising delivery that hasn't
    // been confirmed yet.
    Promise.all([
      sendConfirmationEmail(booking),
      sendMercyNotification(booking)
    ]).then(([clientSent, ownerSent]) => {
      if (!clientSent || !ownerSent) {
        log('WARN', `Booking ${booking.bookingNumber} email delivery incomplete`, { clientSent, ownerSent });
      }
    }).catch((error) => {
      log('ERROR', `Booking ${booking.bookingNumber} email delivery threw unexpectedly:`, error.message);
    });

    res.status(201).json({
      success: true,
      message: `Booking confirmed! A confirmation email is on its way to you and Mercy.`,
      booking: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        country: booking.country,
        service: booking.service,
        date: booking.date,
        time: booking.time,
        bookedAt: booking.bookedAt,
        receiptToken: booking.receiptToken
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

// GET booking by ID (admin route)
app.get('/api/bookings/:id', verifyAdminToken, async (req, res) => {
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

// DELETE booking (admin or manager only; viewers are read-only)
app.delete('/api/bookings/:id', verifyAdminToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    auditLog('BOOKING_DELETE', req.admin.username, { bookingId });

    // Remember the booking number so its photo can be removed along with it
    const existing = (MONGO_URI && mongoose.connection.readyState === 1)
      ? await Booking.findOne({ id: bookingId }).select('bookingNumber')
      : bookings.find(b => b.id === bookingId);

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

    if (existing) {
      await photoStore.delete(existing.bookingNumber).catch((error) => log('ERROR', 'Could not delete photo with booking:', error.message));
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
  price: { type: Number, min: 0 },
  duration: { type: String, default: '' },
  // Legacy range fields, kept for backward compatibility with existing
  // documents; no longer written to by the admin pricing update endpoint.
  minPrice: { type: Number, min: 0 },
  maxPrice: { type: Number, min: 0 },
  description: { type: String, default: '' },
  updatedBy: { type: String, default: 'system' },
  updatedAt: { type: Date, default: Date.now }
});

const Pricing = mongoose.models.Pricing || mongoose.model('Pricing', pricingSchema);

// ========== AVAILABILITY SCHEMA ==========
// Singleton document holding business hours / booking lead time.
const availabilitySchema = new mongoose.Schema({
  weekdayStart: { type: String, required: true, default: '09:00' },
  weekdayEnd: { type: String, required: true, default: '20:00' },
  weekendStart: { type: String, required: true, default: '10:00' },
  weekendEnd: { type: String, required: true, default: '18:00' },
  leadTimeDays: { type: Number, required: true, default: 1, min: 0, max: 90 },
  updatedBy: { type: String, default: 'system' },
  updatedAt: { type: Date, default: Date.now }
});

const Availability = mongoose.models.Availability || mongoose.model('Availability', availabilitySchema);

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
            body: 'Thank you for booking with MakeUP By Mercy! Your appointment is confirmed.\n\nBooking Details:\nBooking ID: {bookingNumber}\nDate: {date}\nTime: {time}\nService: {service}\nPhone: {phone}\nCountry: {country}\n\nWe look forward to making you look stunning!',
            variables: ['bookingNumber', 'date', 'time', 'service', 'phone', 'country']
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
          { service: 'bridal', price: 25000, duration: '2-3 hours', minPrice: 15000, maxPrice: 25000, description: 'Bridal makeup and styling' },
          { service: 'party', price: 15000, duration: '1.5-2 hours', minPrice: 8000, maxPrice: 15000, description: 'Party and event makeup' },
          { service: 'casual', price: 10000, duration: '1-1.5 hours', minPrice: 5000, maxPrice: 10000, description: 'Casual daily makeup' }
        ]);
        logger.info('Default pricing initialized');
      }
    }
  } catch (error) {
    logger.error('Error initializing pricing:', error.message);
  }
}

// The password the original code seeded for the default admin. It is public
// knowledge, so it must never be accepted for login.
const KNOWN_DEFAULT_PASSWORD = 'admin123';
const MIN_INITIAL_PASSWORD_LENGTH = 12;

// Create (or repair) the first admin account.
// - No account yet: one is created only if ADMIN_INITIAL_PASSWORD is set.
//   Nothing is seeded with a built-in password.
// - Existing 'admin' account still using the old default password: it is
//   reset to ADMIN_INITIAL_PASSWORD if provided; otherwise login with the
//   default is refused (see the admin login route) and an error is logged.
async function initializeDefaultAdmin() {
  try {
    if (!(MONGO_URI && mongoose.connection.readyState === 1)) return;

    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
    const initialPasswordUsable = !!initialPassword && initialPassword.length >= MIN_INITIAL_PASSWORD_LENGTH && initialPassword !== KNOWN_DEFAULT_PASSWORD;
    if (initialPassword && !initialPasswordUsable) {
      log('ERROR', `ADMIN_INITIAL_PASSWORD ignored: it must be at least ${MIN_INITIAL_PASSWORD_LENGTH} characters.`);
    }

    const existingAdmin = await Admin.findOne({ username: 'admin' });

    if (!existingAdmin) {
      if (!initialPasswordUsable) {
        log('WARN', 'No admin account exists. Set ADMIN_INITIAL_PASSWORD (12+ characters) and restart to create one.');
        return;
      }
      await Admin.create({
        username: 'admin',
        email: process.env.OWNER_EMAIL || 'admin@makeup-mercy.com',
        password: await bcryptjs.hash(initialPassword, 10),
        role: 'admin',
        active: true
      });
      log('INFO', 'Admin user created from ADMIN_INITIAL_PASSWORD');
      return;
    }

    if (await bcryptjs.compare(KNOWN_DEFAULT_PASSWORD, existingAdmin.password)) {
      if (initialPasswordUsable) {
        existingAdmin.password = await bcryptjs.hash(initialPassword, 10);
        await existingAdmin.save();
        log('INFO', 'Admin account was using the default password; reset to ADMIN_INITIAL_PASSWORD');
      } else {
        log('ERROR', 'Admin account still uses the default password and cannot log in. Set ADMIN_INITIAL_PASSWORD (12+ characters) and restart to reset it.');
      }
    }
  } catch (error) {
    log('ERROR', 'Error initializing default admin:', error.message);
  }
}

// Verify JWT Token
async function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    log('WARN', 'Invalid token attempt:', error.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  // A valid signature only proves the token was issued; it says nothing about
  // whether the account still exists. Re-check the account (briefly cached) so
  // a deleted or deactivated admin loses access immediately, and a role change
  // takes effect without waiting up to 24h for the token to expire.
  if (MONGO_URI && mongoose.isValidObjectId(decoded.id)) {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
    }
    try {
      const account = await getAdminAccountState(decoded.id);
      if (!account || !account.active) {
        return res.status(401).json({ success: false, message: 'Account is no longer active' });
      }
      decoded.role = account.role;
    } catch (error) {
      log('ERROR', 'Admin account lookup failed:', error.message);
      return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
    }
  }

  req.admin = decoded;
  next();
}

// Short-lived cache of admin account state so the check above isn't a
// database round trip on every request.
const ADMIN_STATE_TTL_MS = 30 * 1000;
const adminStateCache = new Map();

async function getAdminAccountState(id) {
  const key = String(id);
  const cached = adminStateCache.get(key);
  if (cached && Date.now() - cached.at < ADMIN_STATE_TTL_MS) return cached.state;

  const doc = await Admin.findById(key).select('role active');
  const state = doc ? { role: doc.role, active: doc.active !== false } : null;
  adminStateCache.set(key, { state, at: Date.now() });
  return state;
}

function invalidateAdminState(id) {
  adminStateCache.delete(String(id));
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

    const dbReady = MONGO_URI && mongoose.connection.readyState === 1;
    // Local development without a database may log in with a password taken
    // from DEV_ADMIN_PASSWORD. It is never enabled in production, nor when a
    // database is configured but temporarily unreachable - otherwise a
    // database blip would let anyone in with a guessable password.
    const devPassword = process.env.DEV_ADMIN_PASSWORD;
    const devFallbackAllowed = !MONGO_URI && process.env.NODE_ENV !== 'production' && !!devPassword;

    let admin = null;
    if (dbReady) {
      admin = await Admin.findOne({ username, active: true });
    } else if (devFallbackAllowed) {
      if (username === 'admin' && password === devPassword) {
        admin = { username: 'admin', role: 'admin', email: 'admin@makeup-mercy.com' };
      }
    } else {
      log('WARN', 'Admin login refused: database not connected');
      return res.status(503).json({ success: false, message: 'Admin login is temporarily unavailable. Please try again shortly.' });
    }

    if (!admin) {
      auditLog('LOGIN_FAILED', username, { reason: 'user_not_found', ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Verify password
    if (dbReady) {
      const isPasswordValid = await bcryptjs.compare(password, admin.password);
      if (!isPasswordValid) {
        auditLog('LOGIN_FAILED', username, { reason: 'invalid_password', ip: req.ip });
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
      if (password === KNOWN_DEFAULT_PASSWORD) {
        auditLog('LOGIN_FAILED', username, { reason: 'default_password_refused', ip: req.ip });
        return res.status(403).json({ success: false, message: 'This account still uses the default password. Set ADMIN_INITIAL_PASSWORD on the server and restart to reset it.' });
      }
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

// Current price per service, from the admin-managed Pricing data (falls back
// to the built-in defaults for a service with no stored price).
async function getPriceMap() {
  const prices = { bridal: 25000, party: 15000, casual: 10000 };
  const rows = (MONGO_URI && mongoose.connection.readyState === 1)
    ? await Pricing.find().lean()
    : pricingMemory;
  rows.forEach(row => {
    if (prices[row.service] !== undefined && typeof row.price === 'number') {
      prices[row.service] = row.price;
    }
  });
  return prices;
}

// Booking dates are date-only values stored as UTC midnight, so month and
// weekday must be read in UTC or they shift a day in timezones behind UTC.
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

    // Cancelled bookings earn nothing and don't count as customers
    const activeBookings = allBookings.filter(b => b.status !== 'cancelled');

    // Monthly revenue at current admin-set prices
    const prices = await getPriceMap();
    const now = new Date();
    const currentMonth = now.getUTCMonth();
    const currentYear = now.getUTCFullYear();
    const monthlyBookings = activeBookings.filter(b => {
      const bookDate = new Date(b.date);
      return bookDate.getUTCMonth() === currentMonth && bookDate.getUTCFullYear() === currentYear;
    });
    const monthlyRevenue = monthlyBookings.reduce((sum, b) => sum + (prices[b.service] || 0), 0);

    // Repeat customers: distinct people with more than one booking
    const bookingsPerCustomer = {};
    activeBookings.forEach(b => {
      const email = String(b.email || '').trim().toLowerCase();
      if (email) bookingsPerCustomer[email] = (bookingsPerCustomer[email] || 0) + 1;
    });
    const repeatCustomers = Object.values(bookingsPerCustomer).filter(count => count > 1).length;

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
app.post('/api/admin/bookings/:id/message', verifyAdminToken, requireRole('admin', 'manager'), validateRequest(contactCustomerSchema), async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { message } = req.validatedBody;

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
          <p>Hi ${escapeHtml(booking.name)},</p>
          <p>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>
          <p>Best regards,<br>MakeUP By Mercy Team</p>
        </div>
      `
    };

    sendEmail(mailOptions).then(() => {
      log('SUCCESS', `Message sent to ${booking.email}`);
    }).catch((error) => {
      log('ERROR', 'Error sending message:', error.message);
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
      const day = new Date(b.date).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
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

// Serve admin pages
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

// Health check
function databaseState() {
  if (!MONGO_URI) return 'memory';
  return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', database: databaseState() });
});

function maskEmail(address) {
  const [user, domain] = String(address || '').split('@');
  return user && domain ? `${user[0]}***@${domain}` : null;
}

// What this server is actually using, so "is the database / email working?"
// can be answered without reading logs.
app.get('/api/admin/system-status', verifyAdminToken, (req, res) => {
  res.json({
    success: true,
    database: {
      configured: !!MONGO_URI,
      state: databaseState(),
      note: !MONGO_URI
        ? 'No MONGODB_URI: bookings are kept in server memory and are lost on restart.'
        : (mongoose.connection.readyState === 1 ? 'Bookings are stored in MongoDB.' : 'MongoDB is configured but not connected: new bookings are refused.')
    },
    email: {
      sendgrid: hasSendGrid(),
      gmailFallback: hasGmail(),
      order: [hasSendGrid() && 'sendgrid', hasGmail() && 'gmail'].filter(Boolean),
      ownerNotifications: maskEmail(process.env.OWNER_EMAIL || process.env.EMAIL_USER)
    }
  });
});

// Send a test email to the owner address and report which provider delivered it
app.post('/api/admin/email/test', verifyAdminToken, requireRole('admin'), async (req, res) => {
  const to = process.env.OWNER_EMAIL || process.env.EMAIL_USER;
  if (!to) {
    return res.status(400).json({ success: false, message: 'Set OWNER_EMAIL (or EMAIL_USER) so there is somewhere to send the test.' });
  }
  try {
    const provider = await sendEmail({
      to,
      subject: 'MakeUP By Mercy: email test',
      html: '<p>This is a test message from the MakeUP By Mercy admin console. If you can read it, booking emails are working.</p>'
    });
    auditLog('EMAIL_TEST', req.admin.username, { provider });
    res.json({ success: true, provider, sentTo: maskEmail(to) });
  } catch (error) {
    log('ERROR', 'Email test failed:', error.message);
    res.status(502).json({ success: false, message: `Email could not be sent. ${error.message}` });
  }
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
// Every line is placed with explicit x/y coordinates. (PDFKit's text() takes
// x then y, so passing a y value as the 2nd argument moved each line further
// right as the page filled up.)
async function generateReceiptPDF(booking) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const buffers = [];

      doc.on('data', (data) => buffers.push(data));
      doc.on('end', () => resolve(Buffer.concat(buffers).toString('base64')));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // Title
      doc.font('Helvetica-Bold').fontSize(24).text('BOOKING RECEIPT', left, 50, { width: contentWidth, align: 'center' });
      doc.font('Helvetica').fontSize(10).fillColor('#666666').text('MakeUP By Mercy', left, 82, { width: contentWidth, align: 'center' });
      doc.moveTo(left, 108).lineTo(left + contentWidth, 108).strokeColor('#cccccc').stroke();

      // Booking details as a label / value table
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(12).text('Booking Details', left, 128);

      const rows = [
        ['Booking ID', booking.bookingNumber],
        ['Name', booking.name],
        ['Email', booking.email],
        ['Phone', booking.phone],
        ['Country', booking.country],
        ['Service', String(booking.service).toUpperCase()],
        ['Date', new Date(booking.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })],
        ...(booking.time ? [['Time', formatTime12(booking.time)]] : []),
        ['Status', String(booking.status).toUpperCase()],
        ['Booked On', new Date(booking.bookedAt).toLocaleString('en-US')]
      ];

      const valueX = left + 110;
      let y = 156;
      rows.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text(label, left, y, { width: 100 });
        doc.font('Helvetica').fontSize(10).fillColor('#000000').text(String(value === undefined || value === null ? '' : value), valueX, y, { width: contentWidth - 110 });
        y += 22;
      });

      // QR code (use cached version for better performance)
      y += 14;
      let qrDrawn = false;
      if (booking.qrCode) {
        try {
          const img = Buffer.from(booking.qrCode.replace('data:image/png;base64,', ''), 'base64');
          doc.image(img, left, y, { width: 110, height: 110 });
          doc.font('Helvetica').fontSize(9).fillColor('#666666')
            .text('Scan this code to reference your booking.', left + 130, y + 8, { width: contentWidth - 130 })
            .text(`Booking ID: ${booking.bookingNumber}`, left + 130, y + 28, { width: contentWidth - 130 });
          qrDrawn = true;
        } catch (error) {
          log('WARN', 'Failed to embed cached QR code in PDF:', error.message);
        }
      }
      if (!qrDrawn) {
        doc.font('Helvetica').fontSize(9).fillColor('#666666').text(`Booking ID: ${booking.bookingNumber}`, left, y, { width: contentWidth });
      }

      // Footer, pinned near the bottom of the page
      const footerY = doc.page.height - doc.page.margins.bottom - 30;
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666')
        .text('Thank you for booking with MakeUP By Mercy!', left, footerY, { width: contentWidth, align: 'center', lineBreak: false })
        .text('For more details, visit our website or contact us on WhatsApp', left, footerY + 12, { width: contentWidth, align: 'center', lineBreak: false });

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
  // Current format (BRD-20261015-1400-01) and the older MKP-01001 format
  return /^([A-Z]{3}-\d{8}-\d{4}-\d{2,3}|MKP-\d{5})$/.test(id);
}

// Receipt access: an admin (Bearer token) can fetch any receipt; a customer
// can fetch only their own using the per-booking receiptToken they were given
// when they booked (?token=...). Returns 'admin', 'customer' or null.
async function getAdminFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    // Same account check as verifyAdminToken: deleted/deactivated admins don't count.
    if (MONGO_URI && mongoose.isValidObjectId(decoded.id)) {
      if (mongoose.connection.readyState !== 1) return null;
      const account = await getAdminAccountState(decoded.id);
      if (!account || !account.active) return null;
      decoded.role = account.role;
    }
    return decoded;
  } catch (error) {
    return null;
  }
}

async function receiptAccess(req, booking) {
  if (await getAdminFromRequest(req)) return 'admin';

  const supplied = typeof req.query.token === 'string' ? req.query.token : '';
  const expected = booking && booking.receiptToken ? String(booking.receiptToken) : '';
  if (!supplied || !expected || supplied.length !== expected.length) return null;

  const match = crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  return match ? 'customer' : null;
}

// ========== CUSTOMER PHOTOS (optional) ==========
// See docs/adr/0001-customer-photo-storage.md for why photos live in MongoDB.
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const PHOTO_RETENTION_SECONDS = 90 * 24 * 60 * 60; // deleted automatically after 90 days
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const bookingPhotoSchema = new mongoose.Schema({
  bookingNumber: { type: String, required: true, unique: true },
  contentType: { type: String, required: true, enum: PHOTO_TYPES },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true },
  // `expires` makes this a TTL index: MongoDB removes the document itself
  createdAt: { type: Date, default: Date.now, expires: PHOTO_RETENTION_SECONDS }
});

const BookingPhoto = mongoose.models.BookingPhoto || mongoose.model('BookingPhoto', bookingPhotoSchema);

// The one place that knows where photos are kept. To move to object storage
// (S3, R2, ...) implement these three functions; nothing else changes.
const photosMemory = new Map();

const photoStore = {
  async put(bookingNumber, { contentType, data }) {
    if (isDbConnected()) {
      await BookingPhoto.findOneAndUpdate(
        { bookingNumber },
        { contentType, size: data.length, data, createdAt: new Date() },
        { upsert: true }
      );
    } else {
      photosMemory.set(bookingNumber, { contentType, data, createdAt: new Date() });
    }
  },

  async get(bookingNumber) {
    if (isDbConnected()) {
      const doc = await BookingPhoto.findOne({ bookingNumber });
      return doc ? { contentType: doc.contentType, data: Buffer.from(doc.data) } : null;
    }
    return photosMemory.get(bookingNumber) || null;
  },

  async delete(bookingNumber) {
    if (isDbConnected()) {
      await BookingPhoto.deleteOne({ bookingNumber });
    } else {
      photosMemory.delete(bookingNumber);
    }
  }
};

// What the file actually is, from its first bytes - never from the filename or
// the Content-Type header the client sent.
function detectImageType(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

async function findBookingByNumber(bookingNumber) {
  if (isDbConnected()) return Booking.findOne({ bookingNumber });
  return bookings.find(b => b.bookingNumber === bookingNumber) || null;
}

async function setHasPhoto(bookingNumber, value) {
  if (isDbConnected()) {
    await Booking.updateOne({ bookingNumber }, { hasPhoto: value });
  } else {
    const booking = bookings.find(b => b.bookingNumber === bookingNumber);
    if (booking) booking.hasPhoto = value;
  }
}

const photoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many photo uploads from this IP, please try again later.' }
});

// Who may touch a booking's photo: an admin, or the customer holding that
// booking's receipt token. Runs before the body is read, so an unauthorised
// caller can't make the server buffer a 3 MB upload.
async function authorizePhotoAccess(req, res, next) {
  try {
    const { id } = req.params;
    if (!validateBookingId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await findBookingByNumber(id);
    const access = booking ? await receiptAccess(req, booking) : null;
    if (!access) {
      const isAdmin = !!(await getAdminFromRequest(req));
      return res.status(isAdmin ? 404 : 403).json({ success: false, message: isAdmin ? 'Booking not found' : 'Not authorized' });
    }
    req.photoBooking = booking;
    next();
  } catch (error) {
    log('ERROR', 'Photo authorization error:', error.message);
    res.status(500).json({ success: false, message: 'Error checking access' });
  }
}

// Customer (receipt token) or admin: attach or replace the photo
app.post('/api/bookings/:id/photo',
  photoLimiter,
  authorizePhotoAccess,
  express.raw({ type: PHOTO_TYPES, limit: PHOTO_MAX_BYTES }),
  async (req, res) => {
    try {
      const data = req.body;
      if (!Buffer.isBuffer(data) || data.length === 0) {
        return res.status(415).json({ success: false, message: 'Send the photo as image/jpeg, image/png or image/webp.' });
      }

      const detected = detectImageType(data);
      const declared = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!detected || detected !== declared) {
        return res.status(400).json({ success: false, message: 'That file is not a valid JPEG, PNG or WebP image.' });
      }

      const bookingNumber = req.photoBooking.bookingNumber;
      await photoStore.put(bookingNumber, { contentType: detected, data });
      await setHasPhoto(bookingNumber, true);

      log('INFO', `Photo stored for ${bookingNumber} (${data.length} bytes)`);
      res.status(201).json({ success: true, message: 'Photo received.', size: data.length });
    } catch (error) {
      log('ERROR', 'Photo upload error:', error.message);
      res.status(500).json({ success: false, message: 'Could not save the photo.' });
    }
  }
);

// Customer (receipt token) or admin: remove the photo
app.delete('/api/bookings/:id/photo', authorizePhotoAccess, async (req, res) => {
  try {
    const bookingNumber = req.photoBooking.bookingNumber;
    await photoStore.delete(bookingNumber);
    await setHasPhoto(bookingNumber, false);
    res.json({ success: true, message: 'Photo removed.' });
  } catch (error) {
    log('ERROR', 'Photo delete error:', error.message);
    res.status(500).json({ success: false, message: 'Could not remove the photo.' });
  }
});

// Admin only: view the photo. Never public, never cached, never sniffed.
app.get('/api/admin/bookings/:id/photo', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateBookingId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const photo = await photoStore.get(id);
    if (!photo) {
      return res.status(404).json({ success: false, message: 'No photo for this booking' });
    }
    res.set({
      'Content-Type': photo.contentType,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox"
    });
    res.send(photo.data);
  } catch (error) {
    log('ERROR', 'Photo fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load the photo.' });
  }
});

// Download Receipt as PDF
app.get('/api/bookings/:id/receipt/pdf', async (req, res) => {
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

    // Same response whether the booking is missing or the token is wrong, so
    // booking numbers can't be probed for existence.
    const access = booking ? await receiptAccess(req, booking) : null;
    if (!access) {
      const isAdmin = !!(await getAdminFromRequest(req));
      return res.status(isAdmin ? 404 : 403).json({ success: false, message: isAdmin ? 'Booking not found' : 'Not authorized to view this receipt' });
    }

    const pdfBase64 = await generateReceiptPDF(booking);
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename=booking-${booking.bookingNumber}.pdf`);
    res.send(pdfBuffer);

    log('INFO', `Receipt PDF downloaded: ${booking.bookingNumber}`);
  } catch (error) {
    log('ERROR', 'Receipt download error:', error.message);
    res.status(500).json({ success: false, message: 'Error generating receipt' });
  }
});

// Download Receipt as Image (PNG with booking details)
app.get('/api/bookings/:id/receipt/image', async (req, res) => {
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

    const access = booking ? await receiptAccess(req, booking) : null;
    if (!access) {
      const isAdmin = !!(await getAdminFromRequest(req));
      return res.status(isAdmin ? 404 : 403).json({ success: false, message: isAdmin ? 'Booking not found' : 'Not authorized to view this receipt' });
    }

    const qrCode = await generateQRCode(`${booking.bookingNumber}`);
    if (!qrCode) {
      return res.status(500).json({ success: false, message: 'Error generating QR code' });
    }

    res.setHeader('Cache-Control', 'no-store');
    // Customers get only the QR code; the full booking record is admin-only.
    res.json(access === 'admin' ? { success: true, qrCode, booking } : { success: true, qrCode });
    log('INFO', `Receipt image generated: ${booking.bookingNumber}`);
  } catch (error) {
    log('ERROR', 'Receipt image error:', error.message);
    res.status(500).json({ success: false, message: 'Error generating receipt' });
  }
});

// Escape HTML to prevent XSS
function escapeHtml(text) {
  text = String(text === undefined || text === null ? '' : text);
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
    await sendEmail({
      to: booking.email,
      subject: stripLineBreaks(subject || `Update regarding your booking ${booking.bookingNumber}`),
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
// Anyone may update their own email/password; only an admin may update other
// users or change roles. Without this check, any logged-in account (even a
// 'viewer') could reset the main admin's password and take the account over.
app.patch('/api/admin/users/:userId', verifyAdminToken, validateRequest(updateAdminSchema), async (req, res) => {
  try {
    const { userId } = req.params;
    const { email, password, role } = req.validatedBody;

    const isAdminRole = req.admin.role === 'admin';
    const isSelf = String(req.admin.id) === String(userId);
    if (!isSelf && !isAdminRole) {
      auditLog('USER_UPDATE_DENIED', req.admin.username, { targetUserId: userId });
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    if (role !== undefined && !isAdminRole) {
      return res.status(403).json({ success: false, message: 'Only an admin can change roles' });
    }

    if (!MONGO_URI || mongoose.connection.readyState !== 1) {
      return res.status(400).json({ success: false, message: 'Database required' });
    }
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }

    const updateData = {};
    if (email !== undefined) updateData.email = email;
    if (password !== undefined) updateData.password = await bcryptjs.hash(password, 10);
    if (role !== undefined) updateData.role = role;

    const updatedAdmin = await Admin.findByIdAndUpdate(userId, updateData, { new: true });
    if (!updatedAdmin) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    invalidateAdminState(userId);
    auditLog('USER_UPDATED', req.admin.username, {
      targetUserId: userId,
      updatedFields: Object.keys(updateData)
    });
    res.json({ success: true, admin: { username: updatedAdmin.username, email: updatedAdmin.email, role: updatedAdmin.role } });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'That email is already in use' });
    }
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
    invalidateAdminState(userId);
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
      res.json({ success: true, pricing: pricingMemory });
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
    const { price, description, duration } = req.validatedBody;

    // Validate service
    if (!['bridal', 'party', 'casual'].includes(service)) {
      return res.status(400).json({ success: false, message: 'Invalid service type' });
    }

    if (!MONGO_URI || mongoose.connection.readyState !== 1) {
      const entry = pricingMemory.find(p => p.service === service);
      if (!entry) {
        return res.status(404).json({ success: false, message: 'Pricing not found' });
      }
      entry.price = price;
      entry.description = description || '';
      entry.duration = duration || '';
      entry.updatedBy = req.admin.username;
      entry.updatedAt = new Date();

      auditLog('PRICING_UPDATE', req.admin.username, { service, price, duration });
      return res.json({ success: true, pricing: entry });
    }

    const updatedPricing = await Pricing.findOneAndUpdate(
      { service },
      {
        price,
        description: description || '',
        duration: duration || '',
        updatedBy: req.admin.username,
        updatedAt: new Date()
      },
      { new: true, upsert: true }
    );

    auditLog('PRICING_UPDATE', req.admin.username, {
      service,
      price,
      duration
    });

    res.json({ success: true, pricing: updatedPricing });
  } catch (error) {
    logger.error('Pricing update error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating pricing' });
  }
});

// Set pricing for multiple services (Admin only)
// Same fields and rules as the single-service PATCH, for several services at
// once. Only whitelisted fields are written (no arbitrary client fields), and
// a service with no stored document is created instead of crashing.
app.post('/api/admin/pricing', verifyAdminToken, requireRole('admin'), validateRequest(bulkPricingSchema), async (req, res) => {
  try {
    const entries = Object.entries(req.validatedBody);
    const useDb = MONGO_URI && mongoose.connection.readyState === 1;

    const results = [];
    for (const [service, { price, description, duration }] of entries) {
      const fields = {
        price,
        description: description || '',
        duration: duration || '',
        updatedBy: req.admin.username,
        updatedAt: new Date()
      };

      if (useDb) {
        results.push(await Pricing.findOneAndUpdate({ service }, fields, { new: true, upsert: true }));
      } else {
        const entry = pricingMemory.find(p => p.service === service);
        Object.assign(entry, fields);
        results.push(entry);
      }
    }

    auditLog('PRICING_BULK_UPDATE', req.admin.username, {
      servicesUpdated: entries.map(([service]) => service)
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
      // No database: serve the in-memory pricing, the same data the admin
      // console edits, so a price changed there shows on the public site.
      const entry = pricingMemory.find(p => p.service === service);
      if (!entry) {
        return res.status(404).json({ success: false, message: 'Pricing not found' });
      }
      res.json({ success: true, pricing: entry });
    }
  } catch (error) {
    logger.error('Pricing fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching pricing' });
  }
});

// ========== AVAILABILITY ENDPOINTS ==========

// Current availability settings. `configured` is false until an admin has
// saved them once; callers only enforce/display them when it is true.
const AVAILABILITY_DEFAULTS = {
  weekdayStart: '09:00',
  weekdayEnd: '20:00',
  weekendStart: '10:00',
  weekendEnd: '18:00',
  leadTimeDays: 1
};

async function getAvailabilitySettings() {
  try {
    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const doc = await Availability.findOne().lean();
      if (doc) return { ...AVAILABILITY_DEFAULTS, ...doc, configured: true };
      return { ...AVAILABILITY_DEFAULTS, configured: false };
    }
    return { ...AVAILABILITY_DEFAULTS, ...availabilityMemory };
  } catch (error) {
    logger.error('Availability lookup error:', error.message);
    return { ...AVAILABILITY_DEFAULTS, configured: false };
  }
}

// GET /api/availability - Public: hours and notice period for the booking page
app.get('/api/availability', async (req, res) => {
  const a = await getAvailabilitySettings();
  res.json({
    success: true,
    availability: {
      configured: a.configured,
      weekdayStart: a.weekdayStart,
      weekdayEnd: a.weekdayEnd,
      weekendStart: a.weekendStart,
      weekendEnd: a.weekendEnd,
      leadTimeDays: a.leadTimeDays
    }
  });
});

// GET /api/admin/availability - Retrieve business hours / lead time (requires JWT admin)
// Returns the defaults without saving them: creating the document here would
// silently switch on lead-time enforcement just because someone opened Settings.
app.get('/api/admin/availability', verifyAdminToken, async (req, res) => {
  const availability = await getAvailabilitySettings();
  res.json({ success: true, availability });
});

// PATCH /api/admin/availability - Update business hours / lead time (requires JWT admin)
app.patch('/api/admin/availability', verifyAdminToken, requireRole('admin'), validateRequest(updateAvailabilitySchema), async (req, res) => {
  try {
    const { weekdayStart, weekdayEnd, weekendStart, weekendEnd, leadTimeDays } = req.validatedBody;
    const updates = {
      weekdayStart,
      weekdayEnd,
      weekendStart,
      weekendEnd,
      leadTimeDays,
      updatedBy: req.admin.username,
      updatedAt: new Date()
    };

    if (MONGO_URI && mongoose.connection.readyState === 1) {
      const availability = await Availability.findOneAndUpdate({}, updates, {
        new: true,
        upsert: true
      });
      auditLog('AVAILABILITY_UPDATE', req.admin.username, updates);
      return res.json({ success: true, availability });
    }

    Object.assign(availabilityMemory, updates, { configured: true });
    auditLog('AVAILABILITY_UPDATE', req.admin.username, updates);
    res.json({ success: true, availability: availabilityMemory });
  } catch (error) {
    logger.error('Availability update error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating availability' });
  }
});

// ========== EMAIL TEMPLATES ENDPOINTS ==========

function isDbConnected() {
  return !!(MONGO_URI && mongoose.connection.readyState === 1);
}

// GET /api/admin/email-templates - Retrieve all email templates (requires JWT admin)
app.get('/api/admin/email-templates', verifyAdminToken, requireRole('admin'), async (req, res) => {
  try {
    if (isDbConnected()) {
      const templates = await EmailTemplate.find({}).select('-__v');
      return res.json({ success: true, templates });
    }
    res.json({ success: true, templates: emailTemplatesMemory });
  } catch (error) {
    logger.error('Get email templates error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve email templates' });
  }
});

// GET /api/email-templates/:type - Get specific email template by type (public)
app.get('/api/email-templates/:type', async (req, res) => {
  try {
    const { type } = req.params;

    if (isDbConnected()) {
      const template = await EmailTemplate.findOne({ type }).select('-__v');
      if (!template) {
        return res.status(404).json({ success: false, message: 'Template not found' });
      }
      return res.json({ success: true, template });
    }

    const template = emailTemplatesMemory.find(t => t.type === type);
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

    if (isDbConnected()) {
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

      auditLog('TEMPLATE_UPDATED', req.admin.username, {
        type,
        templateId: template._id,
        updatedFields: ['subject', 'body']
      });

      return res.json({ success: true, message: 'Email template updated successfully', template });
    }

    const template = emailTemplatesMemory.find(t => t.type === type);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    template.subject = validation.value.subject;
    template.body = validation.value.body;
    template.updatedBy = req.admin.username;
    template.updatedAt = new Date();

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

    if (isDbConnected()) {
      const template = await EmailTemplate.findOneAndUpdate(
        { type },
        updates,
        { new: true }
      ).select('-__v');

      if (!template) {
        return res.status(404).json({ success: false, message: 'Template not found' });
      }

      auditLog('TEMPLATE_UPDATED', req.admin.username, {
        type,
        templateId: template._id,
        updatedFields: Object.keys(updates).filter(k => k !== 'updatedBy' && k !== 'updatedAt')
      });

      return res.json({ success: true, message: 'Email template updated successfully', template });
    }

    const template = emailTemplatesMemory.find(t => t.type === type);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    Object.assign(template, updates);

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

// Start server (only when run directly, so tests can import the app without
// opening a port)
if (require.main === module) {
  app.listen(PORT, () => {
    log('INFO', `Server listening on http://localhost:${PORT}`);
  });
}

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

module.exports = app;
