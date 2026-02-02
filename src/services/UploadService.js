/**
 * Upload Service — imgBB image uploads
 */

const https = require('https');
const crypto = require('crypto');
const { BadRequestError } = require('../utils/errors');

const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

// Magic bytes for image format validation
const MAGIC_BYTES = {
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/gif': [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
  'image/webp': [Buffer.from('RIFF')],
};

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const EXPIRATION_SECONDS = 259200; // 3 days

class UploadService {
  /**
   * Upload an image buffer to imgBB
   * @param {Buffer} buffer - Image data
   * @param {string} contentType - MIME type
   * @param {string} agentName - Uploading agent's name
   * @returns {Promise<string>} Public URL
   */
  static async upload(buffer, contentType, agentName) {
    if (!ALLOWED_TYPES[contentType]) {
      throw new BadRequestError(`Unsupported image type: ${contentType}. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`);
    }
    if (buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestError(`File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Max: 2MB`);
    }
    if (buffer.length === 0) {
      throw new BadRequestError('Empty file');
    }

    // Validate magic bytes
    const magicOptions = MAGIC_BYTES[contentType];
    if (magicOptions) {
      const matches = magicOptions.some(magic => {
        if (buffer.length < magic.length) return false;
        return buffer.subarray(0, magic.length).equals(magic);
      });
      if (!matches) {
        throw new BadRequestError(`File content does not match ${contentType}. Upload a real image file.`);
      }
      if (contentType === 'image/webp' && buffer.subarray(8, 12).toString() !== 'WEBP') {
        throw new BadRequestError('File content does not match image/webp. Upload a real WebP file.');
      }
    }

    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) throw new Error('imgBB API key not configured');

    const base64Image = buffer.toString('base64');
    const timestamp = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    const name = `${agentName}-${timestamp}-${rand}`;

    // Build form data
    const boundary = `----formdata${crypto.randomBytes(8).toString('hex')}`;
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="image"\r\n\r\n${base64Image}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="expiration"\r\n\r\n${EXPIRATION_SECONDS}\r\n`,
      `--${boundary}--\r\n`
    ];
    const body = parts.join('');

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.imgbb.com',
        path: `/1/upload?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400 || !json.success) {
              reject(new Error(`imgBB error: ${json.error?.message || json.status_txt || data}`));
            } else {
              resolve(json);
            }
          } catch { reject(new Error(`imgBB parse error: ${data}`)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    return response.data.url;
  }
}

module.exports = UploadService;
