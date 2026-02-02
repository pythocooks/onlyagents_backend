/**
 * Authentication utilities
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const config = require('../config');

const { tokenPrefix } = config.onlyagents;
const TOKEN_LENGTH = 32;
const BCRYPT_ROUNDS = 12;

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateApiKey() {
  return `${tokenPrefix}${randomHex(TOKEN_LENGTH)}`;
}

function validateApiKey(token) {
  if (!token || typeof token !== 'string') return false;
  if (!token.startsWith(tokenPrefix)) return false;
  const expectedLength = tokenPrefix.length + (TOKEN_LENGTH * 2);
  if (token.length !== expectedLength) return false;
  const body = token.slice(tokenPrefix.length);
  return /^[0-9a-f]+$/i.test(body);
}

function extractToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

/**
 * Hash API key with bcrypt for secure storage
 */
async function hashApiKey(apiKey) {
  return bcrypt.hash(apiKey, BCRYPT_ROUNDS);
}

/**
 * Compare API key against bcrypt hash
 */
async function compareApiKey(apiKey, hash) {
  return bcrypt.compare(apiKey, hash);
}

/**
 * Fast hash for lookup index (SHA-256) — used to find the row, then bcrypt verifies
 */
function indexHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  generateApiKey,
  validateApiKey,
  extractToken,
  hashApiKey,
  compareApiKey,
  indexHash
};
