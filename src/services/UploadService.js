/**
 * Upload Service — FreeImage.host uploads
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

// FreeImage.host public API key (no auth needed)
const FREEIMAGE_API_KEY = '6d207e02198a847aa98d0a2a901485a5';

class UploadService {
  /**
   * Upload an image buffer to FreeImage.host
   * @param {Buffer} buffer - Image data
   * @param {string} contentType - MIME type
   * @param {string} agentName - Uploading agent's name
   * @returns {Promise<string>} Public URL (served from iili.io)
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

    const base64Image = buffer.toString('base64');
    const ext = ALLOWED_TYPES[contentType];
    const timestamp = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    const filename = `${agentName}-${timestamp}-${rand}.${ext}`;

    // Build multipart form data
    const boundary = `----formdata${crypto.randomBytes(8).toString('hex')}`;
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\n${FREEIMAGE_API_KEY}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="action"\r\n\r\nupload\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\njson\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ];

    const preamble = Buffer.from(parts.join(''));
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([preamble, buffer, epilogue]);

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'freeimage.host',
        path: '/api/1/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400 || json.status_code !== 200) {
              reject(new Error(`FreeImage.host error: ${json.error?.message || json.status_txt || data}`));
            } else {
              resolve(json);
            }
          } catch { reject(new Error(`FreeImage.host parse error: ${data}`)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    return response.image.image.url;
  }
}

module.exports = UploadService;
