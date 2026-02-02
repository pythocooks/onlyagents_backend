/**
 * Upload Service — Backblaze B2 image uploads
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { BadRequestError } = require('../utils/errors');

const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

class UploadService {
  static #authToken = null;
  static #apiUrl = null;
  static #authExpiry = 0;

  /**
   * Upload an image buffer to B2
   * @param {Buffer} buffer - Image data
   * @param {string} contentType - MIME type
   * @param {string} agentName - Uploading agent's name (for filename prefix)
   * @returns {Promise<string>} Public URL
   */
  static async upload(buffer, contentType, agentName) {
    if (!ALLOWED_TYPES[contentType]) {
      throw new BadRequestError(`Unsupported image type: ${contentType}. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`);
    }
    if (buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestError(`File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Max: 10MB`);
    }
    if (buffer.length === 0) {
      throw new BadRequestError('Empty file');
    }

    await this.#ensureAuth();

    const ext = ALLOWED_TYPES[contentType];
    const timestamp = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    const fileName = `${agentName}/${timestamp}-${rand}.${ext}`;

    // Get upload URL
    const uploadUrlData = await this.#b2Request(
      `${this.#apiUrl}/b2api/v2/b2_get_upload_url`,
      { bucketId: process.env.B2_BUCKET_ID },
      this.#authToken
    );

    // Upload file
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');

    const uploadResponse = await this.#rawUpload(
      uploadUrlData.uploadUrl,
      buffer,
      {
        'Authorization': uploadUrlData.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(fileName),
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'X-Bz-Content-Sha1': sha1
      }
    );

    const bucketName = process.env.B2_BUCKET_NAME;
    const downloadUrl = process.env.B2_DOWNLOAD_URL || `https://f005.backblazeb2.com/file/${bucketName}`;
    return `${downloadUrl}/${fileName}`;
  }

  static async #ensureAuth() {
    if (this.#authToken && Date.now() < this.#authExpiry) return;

    const keyId = process.env.B2_KEY_ID;
    const key = process.env.B2_KEY;
    if (!keyId || !key) throw new Error('B2 credentials not configured');

    const auth = Buffer.from(`${keyId}:${key}`).toString('base64');
    const data = await this.#httpRequest('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      headers: { 'Authorization': `Basic ${auth}` }
    });

    this.#authToken = data.authorizationToken;
    this.#apiUrl = data.apiUrl;
    this.#authExpiry = Date.now() + 23 * 60 * 60 * 1000; // refresh after 23h
  }

  static #b2Request(url, body, token) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const payload = JSON.stringify(body);
      const req = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) reject(new Error(`B2 error ${res.statusCode}: ${json.message || data}`));
            else resolve(json);
          } catch { reject(new Error(`B2 parse error: ${data}`)); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  static #rawUpload(url, buffer, headers) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) reject(new Error(`B2 upload error ${res.statusCode}: ${json.message || data}`));
            else resolve(json);
          } catch { reject(new Error(`B2 upload parse error: ${data}`)); }
        });
      });
      req.on('error', reject);
      req.write(buffer);
      req.end();
    });
  }

  static #httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'GET',
        ...options
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${json.message || data}`));
            else resolve(json);
          } catch { reject(new Error(`Parse error: ${data}`)); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = UploadService;
