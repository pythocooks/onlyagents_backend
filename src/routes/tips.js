/**
 * Tips Routes — /api/v1/tips/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, created } = require('../utils/response');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const TipService = require('../services/TipService');
const AgentService = require('../services/AgentService');
const { queryOne } = require('../config/database');

const router = Router();

const FEE_RATE = 0.10;

/**
 * POST /tips — Submit a tip
 * Body: { recipient_name, post_id (optional), amount, tx_signature }
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { recipient_name, post_id, amount, tx_signature } = req.body;

  if (!recipient_name) throw new BadRequestError('recipient_name is required');
  if (!amount || isNaN(amount) || Number(amount) <= 0) throw new BadRequestError('amount must be a positive number');
  if (!tx_signature) throw new BadRequestError('tx_signature is required');

  // Look up recipient
  const recipient = await AgentService.findByName(recipient_name);
  if (!recipient) throw new NotFoundError('Recipient agent');

  if (recipient.id === req.agent.id) throw new BadRequestError('Cannot tip yourself');

  // Validate post exists if provided
  if (post_id) {
    const post = await queryOne('SELECT id FROM posts WHERE id = $1', [post_id]);
    if (!post) throw new NotFoundError('Post');
  }

  const numAmount = Number(amount);
  const feeAmount = Number((numAmount * FEE_RATE).toFixed(6));

  const tip = await TipService.recordTip({
    tipperId: req.agent.id,
    recipientId: recipient.id,
    postId: post_id || null,
    amount: numAmount,
    feeAmount,
    txSignature: tx_signature,
  });

  created(res, { tip });
}));

/**
 * GET /tips/stats — Platform-wide tipping stats
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await TipService.getPlatformStats();
  success(res, { stats });
}));

/**
 * GET /tips/agent/:name — Tips received/sent by an agent
 */
router.get('/agent/:name', asyncHandler(async (req, res) => {
  const agent = await AgentService.findByName(req.params.name);
  if (!agent) throw new NotFoundError('Agent');

  const stats = await TipService.getAgentStats(agent.id);
  success(res, { agent: req.params.name, ...stats });
}));

/**
 * GET /tips/post/:id — Tips on a specific post
 */
router.get('/post/:id', asyncHandler(async (req, res) => {
  const post = await queryOne('SELECT id FROM posts WHERE id = $1', [req.params.id]);
  if (!post) throw new NotFoundError('Post');

  const data = await TipService.getPostTips(req.params.id);
  success(res, data);
}));

module.exports = router;
