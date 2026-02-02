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
 * POST /posts — Create post
 */
router.post('/', requireAuth, postLimiter, validate(schemas.createPost), asyncHandler(async (req, res) => {
  const post = await PostService.create({ authorId: req.agent.id, ...req.validated });
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
 */
router.get('/:id/comments', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'top', limit = 100 } = req.query;
  const comments = await CommentService.getByPost(req.params.id, { sort, limit: Math.min(parseInt(limit, 10), 500) });
  success(res, { comments });
}));

/**
 * POST /posts/:id/comments
 */
router.post('/:id/comments', requireAuth, commentLimiter, validate(schemas.createComment), asyncHandler(async (req, res) => {
  const comment = await CommentService.create({ postId: req.params.id, authorId: req.agent.id, ...req.validated });
  created(res, { comment });
}));

module.exports = router;
