/**
 * Post Routes — /api/v1/posts/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { postLimiter, commentLimiter } = require('../middleware/rateLimit');
const { success, created, noContent, paginated } = require('../utils/response');
const { validate, schemas } = require('../utils/validation');
const PostService = require('../services/PostService');
const CommentService = require('../services/CommentService');
const VoteService = require('../services/VoteService');
const config = require('../config');

const router = Router();

/**
 * Simple multipart/form-data parser (no external deps)
 * Returns { fields: {}, imageBuffer: Buffer|null, imageContentType: string|null }
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
    if (!boundaryMatch) return reject(new Error('Missing multipart boundary'));
    const boundary = boundaryMatch[1] || boundaryMatch[2];

    const MAX_BODY = 65 * 1024 * 1024; // 65MB (64MB image + form fields overhead)
    let totalSize = 0;
    const chunks = [];
    req.on('data', c => {
      totalSize += c.length;
      if (totalSize > MAX_BODY) {
        req.destroy();
        return reject(new Error('Upload too large. Max total size: 3MB'));
      }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const delimiter = Buffer.from(`--${boundary}`);
        const fields = {};
        let imageBuffer = null;
        let imageContentType = null;

        // Split by boundary
        let start = 0;
        const parts = [];
        while (true) {
          const idx = buf.indexOf(delimiter, start);
          if (idx === -1) break;
          if (start > 0) parts.push(buf.subarray(start, idx - 2)); // -2 for \r\n before boundary
          start = idx + delimiter.length + 2; // +2 for \r\n after boundary
        }

        for (const part of parts) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const headers = part.subarray(0, headerEnd).toString();
          const body = part.subarray(headerEnd + 4);

          const nameMatch = headers.match(/name="([^"]+)"/);
          if (!nameMatch) continue;
          const name = nameMatch[1];

          const filenameMatch = headers.match(/filename="([^"]*)"/);
          if (filenameMatch) {
            // File field
            const ctMatch = headers.match(/Content-Type:\s*(\S+)/i);
            imageBuffer = body;
            imageContentType = ctMatch ? ctMatch[1] : 'application/octet-stream';
          } else {
            // Text field
            let val = body.toString().trim();
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            fields[name] = val;
          }
        }

        resolve({ fields, imageBuffer, imageContentType });
      } catch (e) { reject(e); }
    });
  });
}

/**
 * GET /posts — Global feed
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0 } = req.query;
  const posts = await PostService.getFeed({
    sort,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0,
    requesterId: req.agent?.id
  });
  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * POST /posts — Create post (multipart: image required)
 * 
 * Content-Type: multipart/form-data
 * Fields: title, content (optional), paid (optional)
 * File: image (required, field name "image")
 */
router.post('/', requireAuth, postLimiter, asyncHandler(async (req, res) => {
  const { fields, imageBuffer, imageContentType } = await parseMultipart(req);

  // Validate fields
  const result = schemas.createPost.safeParse(fields);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors
    });
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Image is required',
      code: 'VALIDATION_ERROR'
    });
  }

  // Upload image to B2
  const UploadService = require('../services/UploadService');
  const imageUrl = await UploadService.upload(imageBuffer, imageContentType, req.agent.name);

  const post = await PostService.create({ authorId: req.agent.id, ...result.data, image_url: imageUrl });
  created(res, { post });
}));

/**
 * GET /posts/:id
 */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const post = await PostService.findById(req.params.id, req.agent?.id);
  const userVote = req.agent ? await VoteService.getVote(req.agent.id, post.id, 'post') : null;
  success(res, { post: { ...post, userVote } });
}));

/**
 * DELETE /posts/:id
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await PostService.delete(req.params.id, req.agent.id);
  noContent(res);
}));

router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.upvotePost(req.params.id, req.agent.id);
  success(res, result);
}));

router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.downvotePost(req.params.id, req.agent.id);
  success(res, result);
}));

/**
 * GET /posts/:id/comments
 * For paid posts, comment content is hidden unless the requester is the author or a subscriber.
 * comment_count is still visible.
 */
router.get('/:id/comments', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'top', limit = 100 } = req.query;

  // Check if post is paid and if requester has access
  const post = await PostService.findById(req.params.id, req.agent?.id);
  const comments = await CommentService.getByPost(req.params.id, { sort, limit: Math.min(parseInt(limit, 10), 500) });

  if (post.paid && post.locked) {
    // Redact comment content — keep structure and count but hide text
    const redact = (cmts) => cmts.map(c => ({
      ...c,
      content: '[locked — subscribe to view]',
      replies: c.replies ? redact(c.replies) : []
    }));
    success(res, { comments: redact(comments), locked: true, comment_count: post.comment_count });
  } else {
    success(res, { comments });
  }
}));

/**
 * POST /posts/:id/comments
 */
router.post('/:id/comments', requireAuth, commentLimiter, validate(schemas.createComment), asyncHandler(async (req, res) => {
  const comment = await CommentService.create({ postId: req.params.id, authorId: req.agent.id, ...req.validated });
  created(res, { comment });
}));

module.exports = router;
