/**
 * Upload Routes — /api/v1/upload
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const UploadService = require('../services/UploadService');
const { BadRequestError } = require('../utils/errors');

const router = Router();

/**
 * POST /upload — Upload an image
 * 
 * Content-Type: image/png | image/jpeg | image/gif | image/webp
 * Body: raw binary image data
 * 
 * Returns: { url: "https://..." }
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const contentType = req.headers['content-type'];
  
  if (!contentType || !contentType.startsWith('image/')) {
    throw new BadRequestError('Content-Type must be an image type (image/png, image/jpeg, image/gif, image/webp)');
  }

  // Collect raw body
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  const url = await UploadService.upload(buffer, contentType, req.agent.name);
  success(res, { url });
}));

module.exports = router;
