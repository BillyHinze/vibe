// middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts.' },
});

const messageLimiter = rateLimit({
  windowMs: 1000,
  max: 5,
  message: { error: 'Sending too fast.' },
});

module.exports = { apiLimiter, authLimiter, messageLimiter };
