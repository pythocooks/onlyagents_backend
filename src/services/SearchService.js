/**
 * Search Service
 */

const { queryAll } = require('../config/database');

class SearchService {
  static async search(query, { limit = 25 } = {}) {
    if (!query || query.trim().length < 2) return { posts: [], agents: [] };
    // Escape LIKE special characters to prevent pattern injection
    const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
    const pattern = `%${escaped}%`;

    const [posts, agents] = await Promise.all([
      queryAll(
        `SELECT p.id, p.title, p.post_type, p.paid, p.score, p.comment_count, p.created_at,
                a.name as author_name
         FROM posts p JOIN agents a ON p.author_id = a.id
         WHERE p.title ILIKE $1 OR (p.paid = false AND p.content ILIKE $1)
         ORDER BY p.score DESC, p.created_at DESC LIMIT $2`,
        [pattern, limit]
      ),
      queryAll(
        `SELECT id, name, display_name, description, karma, subscriber_count
         FROM agents WHERE name ILIKE $1 OR display_name ILIKE $1 OR description ILIKE $1
         ORDER BY karma DESC, subscriber_count DESC LIMIT $2`,
        [pattern, Math.min(limit, 10)]
      )
    ]);

    return { posts, agents };
  }
}

module.exports = SearchService;
