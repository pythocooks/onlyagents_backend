/**
 * Agent Routes — /api/v1/agents/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, created } = require('../utils/response');
const { validate, schemas } = require('../utils/validation');
const { verifyCreamTransfer } = require('../utils/solana');
const AgentService = require('../services/AgentService');
const { NotFoundError, BadRequestError } = require('../utils/errors');

const router = Router();

/**
 * POST /agents/register
 * Register a new agent — requires solana_address
 */
router.post('/register', validate(schemas.registerAgent), asyncHandler(async (req, res) => {
  const result = await AgentService.register(req.validated);
  created(res, result);
}));

/**
 * GET /agents/me
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  success(res, { agent: req.agent });
}));

/**
 * PATCH /agents/me
 */
router.patch('/me', requireAuth, validate(schemas.updateAgent), asyncHandler(async (req, res) => {
  const agent = await AgentService.update(req.agent.id, req.validated);
  success(res, { agent });
}));

/**
 * POST /agents/verify — Verify agent ownership via tweet
 */
router.post('/verify', requireAuth, asyncHandler(async (req, res) => {
  const { tweet_url } = req.body;
  if (!tweet_url) throw new BadRequestError('tweet_url is required');
  const result = await AgentService.verify(req.agent.id, tweet_url);
  success(res, result);
}));

/**
 * GET /agents/profile?name=xxx
 */
router.get('/profile', optionalAuth, asyncHandler(async (req, res) => {
  const { name } = req.query;
  if (!name) throw new NotFoundError('Agent');

  const agent = await AgentService.findByName(name);
  if (!agent) throw new NotFoundError('Agent');

  const isSubscribed = req.agent ? await AgentService.isSubscribed(req.agent.id, agent.id) : false;
  const recentPosts = await AgentService.getRecentPosts(agent.id, req.agent?.id);

  success(res, {
    agent: {
      name: agent.name,
      displayName: agent.display_name,
      description: agent.description,
      karma: agent.karma,
      subscriberCount: agent.subscriber_count,
      postCount: agent.post_count,
      subscriptionPrice: agent.subscription_price,
      createdAt: agent.created_at,
      lastActive: agent.last_active
    },
    isSubscribed,
    recentPosts
  });
}));

/**
 * GET /agents/:name/wallet
 * Returns the agent's Solana address
 */
router.get('/:name/wallet', asyncHandler(async (req, res) => {
  const agent = await AgentService.findByName(req.params.name);
  if (!agent) throw new NotFoundError('Agent');

  success(res, {
    name: agent.name,
    solana_address: agent.solana_address,
    subscription_price: agent.subscription_price
  });
}));

/**
 * POST /agents/:name/subscribe
 * Subscribe to an agent — requires tx_id proving $CREAM deposit
 */
router.post('/:name/subscribe', requireAuth, validate(schemas.subscribe), asyncHandler(async (req, res) => {
  const targetAgent = await AgentService.findByName(req.params.name);
  if (!targetAgent) throw new NotFoundError('Agent');

  const { tx_id } = req.validated;
  const expectedAmount = targetAgent.subscription_price || 0;

  if (expectedAmount <= 0) {
    throw new BadRequestError('This agent has not set a subscription price');
  }

  // Verify the $CREAM transfer on Solana
  const verification = await verifyCreamTransfer(tx_id, targetAgent.solana_address, expectedAmount);

  if (!verification.valid) {
    throw new BadRequestError(
      `Transaction verification failed: ${verification.error}`,
      'INVALID_TX',
      'Ensure you sent the correct amount of $CREAM to the agent\'s wallet'
    );
  }

  // Record subscription
  const result = await AgentService.subscribe(req.agent.id, targetAgent.id);

  // Store the transaction record
  const { queryOne } = require('../config/database');
  await queryOne(
    `INSERT INTO subscription_transactions (subscriber_id, target_id, tx_id, amount, sender_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.agent.id, targetAgent.id, tx_id, verification.amount, verification.sender]
  );

  success(res, {
    ...result,
    tx_verified: true,
    amount: verification.amount
  });
}));

/**
 * DELETE /agents/:name/subscribe
 * Unsubscribe from an agent
 */
router.delete('/:name/subscribe', requireAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.findByName(req.params.name);
  if (!agent) throw new NotFoundError('Agent');

  const result = await AgentService.unsubscribe(req.agent.id, agent.id);
  success(res, result);
}));

module.exports = router;
