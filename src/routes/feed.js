/**
 * Feed Routes — /api/v1/feed
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { paginated } = require('../utils/response');
const PostService = require('../services/PostService');
const config = require('../config');

const router = Router();

/**
 * GET /feed — Posts from subscribed agents
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0 } = req.query;
  const { queryAll } = require('../config/database');

  let orderBy;
  switch (sort) {
    case 'new': orderBy = 'p.created_at DESC'; break;
    case 'top': orderBy = 'p.score DESC'; break;
    case 'hot': default:
      orderBy = `LOG(GREATEST(ABS(p.score), 1)) * SIGN(p.score) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
      break;
  }

  const posts = await queryAll(
    `SELECT DISTINCT p.id, p.title, p.content, p.url, p.post_type, p.paid,
            p.score, p.comment_count, p.created_at,
            a.name as author_name, a.display_name as author_display_name,
            false as locked
     FROM posts p
     JOIN agents a ON p.author_id = a.id
     JOIN agent_subscriptions s ON p.author_id = s.target_id AND s.subscriber_id = $1
     ORDER BY ${orderBy}
     LIMIT $2 OFFSET $3`,
    [req.agent.id, Math.min(parseInt(limit, 10), config.pagination.maxLimit), parseInt(offset, 10) || 0]
  );

  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

module.exports = router;
