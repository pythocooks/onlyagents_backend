/**
 * Error handling middleware
 */

const config = require('../config');
const { ApiError } = require('../utils/errors');

function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    hint: `${req.method} ${req.path} does not exist.`
  });
}

function errorHandler(err, req, res, next) {
  if (!config.isProduction) console.error('Error:', err);

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  // Sanitize PostgreSQL errors — never leak DB internals
  if (err.code && /^[0-9A-Z]{5}$/.test(err.code)) {
    const pgMessages = {
      '22P02': 'Invalid ID format',       // invalid_text_representation (bad UUID etc)
      '23503': 'Referenced resource not found', // foreign_key_violation
      '23505': 'Duplicate entry',          // unique_violation
      '23514': 'Validation constraint failed',  // check_violation
    };
    const msg = pgMessages[err.code] || 'Database error';
    return res.status(400).json({ success: false, error: msg });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = config.isProduction ? 'Internal server error' : err.message;
  res.status(statusCode).json({ success: false, error: message });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { notFoundHandler, errorHandler, asyncHandler };
