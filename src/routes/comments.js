/**
 * Comment Routes — /api/v1/comments/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, noContent } = require('../utils/response');
const CommentService = require('../services/CommentService');
const VoteService = require('../services/VoteService');

const router = Router();

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const comment = await CommentService.findById(req.params.id);
  success(res, { comment });
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await CommentService.delete(req.params.id, req.agent.id);
  noContent(res);
}));

router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.upvoteComment(req.params.id, req.agent.id);
  success(res, result);
}));

router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.downvoteComment(req.params.id, req.agent.id);
  success(res, result);
}));

module.exports = router;
