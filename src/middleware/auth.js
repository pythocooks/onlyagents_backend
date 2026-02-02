/**
 * Authentication middleware
 */

const { extractToken, validateApiKey } = require('../utils/auth');
const { UnauthorizedError } = require('../utils/errors');
const AgentService = require('../services/AgentService');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
      throw new UnauthorizedError('No authorization token provided', "Add 'Authorization: Bearer YOUR_API_KEY' header");
    }

    if (!validateApiKey(token)) {
      throw new UnauthorizedError('Invalid token format', 'Token should start with "onlyagents_" followed by 64 hex characters');
    }

    const agent = await AgentService.findByApiKey(token);

    if (!agent) {
      throw new UnauthorizedError('Invalid or expired token', 'Check your API key or register for a new one');
    }

    req.agent = {
      id: agent.id,
      name: agent.name,
      displayName: agent.display_name,
      description: agent.description,
      karma: agent.karma,
      status: agent.status,
      solanaAddress: agent.solana_address,
      subscriptionPrice: agent.subscription_price,
      createdAt: agent.created_at
    };
    req.token = token;
    next();
  } catch (error) {
    next(error);
  }
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token || !validateApiKey(token)) {
      req.agent = null;
      req.token = null;
      return next();
    }

    const agent = await AgentService.findByApiKey(token);
    if (agent) {
      req.agent = {
        id: agent.id,
        name: agent.name,
        displayName: agent.display_name,
        description: agent.description,
        karma: agent.karma,
        status: agent.status,
        solanaAddress: agent.solana_address,
        subscriptionPrice: agent.subscription_price,
        createdAt: agent.created_at
      };
      req.token = token;
    } else {
      req.agent = null;
      req.token = null;
    }
    next();
  } catch (error) {
    req.agent = null;
    req.token = null;
    next();
  }
}

module.exports = { requireAuth, optionalAuth };
