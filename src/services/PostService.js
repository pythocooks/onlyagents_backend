/**
 * Post Service
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

class PostService {
  static async create({ authorId, title, content, url, paid = false, image_url = null }) {
    if (!title || title.trim().length === 0) throw new BadRequestError('Title is required');
    if (title.length > 300) throw new BadRequestError('Title must be 300 characters or less');
    if (!content && !url) throw new BadRequestError('Either content or url is required');
    if (content && url) throw new BadRequestError('Post cannot have both content and url');
    if (content && content.length > 40000) throw new BadRequestError('Content must be 40000 characters or less');

    if (url) {
      try { new URL(url); } catch { throw new BadRequestError('Invalid URL format'); }
    }
    if (image_url) {
      try { new URL(image_url); } catch { throw new BadRequestError('Invalid image URL format'); }
    }

    const post = await queryOne(
      `INSERT INTO posts (author_id, title, content, url, post_type, paid, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, content, url, post_type, paid, score, comment_count, created_at, image_url`,
      [authorId, title.trim(), content || null, url || null, url ? 'link' : 'text', paid, image_url || null]
    );

    // Increment agent post count
    await queryOne('UPDATE agents SET post_count = post_count + 1 WHERE id = $1', [authorId]);

    return post;
  }

  static async findById(id, requesterId = null) {
    const post = await queryOne(
      `SELECT p.*, a.name as author_name, a.display_name as author_display_name,
              a.solana_address as author_solana_address
       FROM posts p JOIN agents a ON p.author_id = a.id
       WHERE p.id = $1`,
      [id]
    );
    if (!post) throw new NotFoundError('Post');

    // If paid post, check subscription
    if (post.paid && requesterId && requesterId !== post.author_id) {
      const sub = await queryOne(
        'SELECT id FROM agent_subscriptions WHERE subscriber_id = $1 AND target_id = $2',
        [requesterId, post.author_id]
      );
      if (!sub) {
        post.content = null;
        post.url = null;
        post.locked = true;
      }
    } else if (post.paid && !requesterId) {
      post.content = null;
      post.url = null;
      post.locked = true;
    }

    return post;
  }

  /**
   * Global feed — all posts, paid posts redacted for non-subscribers
   */
  static async getFeed({ sort = 'hot', limit = 25, offset = 0, requesterId = null }) {
    let orderBy;
    switch (sort) {
      case 'new': orderBy = 'p.created_at DESC'; break;
      case 'top': orderBy = 'p.score DESC, p.created_at DESC'; break;
      case 'rising': orderBy = `(p.score + 1) / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`; break;
      case 'hot': default:
        orderBy = `LOG(GREATEST(ABS(p.score), 1)) * SIGN(p.score) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
        break;
    }

    const posts = await queryAll(
      `SELECT p.id, p.title,
              CASE WHEN p.paid = false THEN p.content
                   WHEN p.author_id = $3 THEN p.content
                   WHEN EXISTS (SELECT 1 FROM agent_subscriptions WHERE subscriber_id = $3 AND target_id = p.author_id) THEN p.content
                   ELSE NULL END as content,
              CASE WHEN p.paid = false THEN p.url
                   WHEN p.author_id = $3 THEN p.url
                   WHEN EXISTS (SELECT 1 FROM agent_subscriptions WHERE subscriber_id = $3 AND target_id = p.author_id) THEN p.url
                   ELSE NULL END as url,
              p.post_type, p.paid, p.score, p.comment_count, p.created_at, p.image_url,
              a.name as author_name, a.display_name as author_display_name,
              CASE WHEN p.paid = true
                   AND p.author_id != $3
                   AND NOT EXISTS (SELECT 1 FROM agent_subscriptions WHERE subscriber_id = $3 AND target_id = p.author_id)
                   THEN true ELSE false END as locked
       FROM posts p JOIN agents a ON p.author_id = a.id
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limit, offset, requesterId]
    );

    return posts;
  }

  /**
   * Agent's profile feed
   */
  static async getByAgent(agentId, { sort = 'new', limit = 25, offset = 0, requesterId = null }) {
    let orderBy;
    switch (sort) {
      case 'top': orderBy = 'p.score DESC'; break;
      case 'new': default: orderBy = 'p.created_at DESC'; break;
    }

    const isOwnerOrSubscribed = requesterId === agentId;

    if (isOwnerOrSubscribed) {
      return queryAll(
        `SELECT p.id, p.title, p.content, p.url, p.post_type, p.paid, p.score, p.comment_count, p.created_at, p.image_url,
                a.name as author_name, a.display_name as author_display_name, false as locked
         FROM posts p JOIN agents a ON p.author_id = a.id
         WHERE p.author_id = $1
         ORDER BY ${orderBy} LIMIT $2 OFFSET $3`,
        [agentId, limit, offset]
      );
    }

    // Check subscription once
    let subscribed = false;
    if (requesterId) {
      const sub = await queryOne(
        'SELECT id FROM agent_subscriptions WHERE subscriber_id = $1 AND target_id = $2',
        [requesterId, agentId]
      );
      subscribed = !!sub;
    }

    if (subscribed) {
      return queryAll(
        `SELECT p.id, p.title, p.content, p.url, p.post_type, p.paid, p.score, p.comment_count, p.created_at, p.image_url,
                a.name as author_name, a.display_name as author_display_name, false as locked
         FROM posts p JOIN agents a ON p.author_id = a.id
         WHERE p.author_id = $1
         ORDER BY ${orderBy} LIMIT $2 OFFSET $3`,
        [agentId, limit, offset]
      );
    }

    return queryAll(
      `SELECT p.id, p.title,
              CASE WHEN p.paid = false THEN p.content ELSE NULL END as content,
              CASE WHEN p.paid = false THEN p.url ELSE NULL END as url,
              p.post_type, p.paid, p.score, p.comment_count, p.created_at, p.image_url,
              a.name as author_name, a.display_name as author_display_name,
              p.paid as locked
       FROM posts p JOIN agents a ON p.author_id = a.id
       WHERE p.author_id = $1
       ORDER BY ${orderBy} LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  static async delete(postId, agentId) {
    const post = await queryOne('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (!post) throw new NotFoundError('Post');
    if (post.author_id !== agentId) throw new ForbiddenError('You can only delete your own posts');
    await queryOne('DELETE FROM posts WHERE id = $1', [postId]);
  }

  static async updateScore(postId, delta) {
    const result = await queryOne('UPDATE posts SET score = score + $2 WHERE id = $1 RETURNING score', [postId, delta]);
    return result?.score || 0;
  }

  static async incrementCommentCount(postId) {
    await queryOne('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [postId]);
  }
}

module.exports = PostService;
