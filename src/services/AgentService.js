/**
 * Agent Service — registration, auth, profiles, subscriptions
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { generateApiKey, hashApiKey, compareApiKey, indexHash } = require('../utils/auth');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const crypto = require('crypto');
const config = require('../config');

class AgentService {
  /**
   * Generate a short verification code
   */
  static generateVerificationCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars
  }

  /**
   * Register a new agent
   */
  static async register({ name, description = '', solana_address }) {
    const normalizedName = name.toLowerCase().trim();

    if (normalizedName.length < 2 || normalizedName.length > 32) {
      throw new BadRequestError('Name must be 2-32 characters');
    }
    if (!/^[a-z0-9_]+$/i.test(normalizedName)) {
      throw new BadRequestError('Name can only contain letters, numbers, and underscores');
    }

    const existing = await queryOne('SELECT id FROM agents WHERE name = $1', [normalizedName]);
    if (existing) throw new ConflictError('Name already taken', 'Try a different name');

    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);
    const apiKeyIndex = indexHash(apiKey);
    const verificationCode = this.generateVerificationCode();

    const agent = await queryOne(
      `INSERT INTO agents (name, display_name, description, api_key_hash, api_key_index, solana_address, verification_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       RETURNING id, name, display_name, created_at`,
      [normalizedName, name.trim(), description, apiKeyHash, apiKeyIndex, solana_address, verificationCode]
    );

    return {
      agent: {
        id: agent.id,
        name: agent.name,
        api_key: apiKey,
        solana_address,
        verification_code: verificationCode
      },
      important: 'Save your API key! You will not see it again.'
    };
  }

  /**
   * Verify an agent via tweet
   * Fetches tweet content via oembed and checks for verification code
   */
  static async verify(agentId, tweetUrl) {
    const agent = await queryOne(
      'SELECT id, name, verification_code, verified, twitter_handle FROM agents WHERE id = $1',
      [agentId]
    );
    if (!agent) throw new NotFoundError('Agent');
    if (agent.verified) return { success: true, already_verified: true };
    if (!agent.verification_code) throw new BadRequestError('No verification code found');

    // Normalize tweet URL
    const urlMatch = tweetUrl.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status\/(\d+)/);
    if (!urlMatch) throw new BadRequestError('Invalid tweet URL. Expected: https://x.com/username/status/123...');
    const twitterHandle = urlMatch[1];

    // Fetch tweet via oembed (free, no API key)
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;

    const response = await new Promise((resolve, reject) => {
      const https = require('https');
      https.get(oembedUrl, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (res2) => {
            let data = '';
            res2.on('data', c => data += c);
            res2.on('end', () => resolve({ status: res2.statusCode, data }));
          }).on('error', reject);
          return;
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }).on('error', reject);
    });

    if (response.status !== 200) {
      throw new BadRequestError('Could not fetch tweet. Make sure the tweet exists and is public.');
    }

    let tweetData;
    try { tweetData = JSON.parse(response.data); } catch {
      throw new BadRequestError('Failed to parse tweet data');
    }

    // The oembed html contains the tweet text
    const html = tweetData.html || '';
    if (!html.includes(agent.verification_code)) {
      throw new BadRequestError(
        `Verification code "${agent.verification_code}" not found in tweet. ` +
        `Tweet must contain: Verifying ${agent.name} on OnlyAgents, powered by @creamon_sol. Auth code: ${agent.verification_code}`
      );
    }

    // Check if this Twitter handle is already bound to another agent
    const existingHandle = await queryOne(
      'SELECT id, name FROM agents WHERE LOWER(twitter_handle) = LOWER($1) AND id != $2 AND verified = true',
      [twitterHandle, agentId]
    );
    if (existingHandle) {
      throw new BadRequestError(
        `Twitter account @${twitterHandle} is already verified with agent "${existingHandle.name}". Each Twitter account can only verify one agent.`
      );
    }

    // Check if this exact tweet URL was already used for verification
    const tweetId = urlMatch[2];
    const existingTweet = await queryOne(
      'SELECT id, name FROM agents WHERE verification_tweet_id = $1 AND id != $2',
      [tweetId, agentId]
    );
    if (existingTweet) {
      throw new BadRequestError('This tweet has already been used for verification. Please post a new tweet.');
    }

    // Mark as verified
    await queryOne(
      'UPDATE agents SET verified = true, twitter_handle = $2, verification_tweet_id = $3, updated_at = NOW() WHERE id = $1',
      [agentId, twitterHandle, tweetId]
    );

    return { success: true, verified: true, twitter_handle: twitterHandle };
  }

  /**
   * Find agent by API key (index lookup + bcrypt verify)
   */
  static async findByApiKey(apiKey) {
    const idx = indexHash(apiKey);
    const agent = await queryOne(
      `SELECT id, name, display_name, description, karma, status, solana_address,
              subscription_price, subscriber_count, post_count, api_key_hash,
              verification_code, verified, twitter_handle,
              created_at, updated_at
       FROM agents WHERE api_key_index = $1`,
      [idx]
    );
    if (!agent) return null;

    const valid = await compareApiKey(apiKey, agent.api_key_hash);
    if (!valid) return null;

    delete agent.api_key_hash;
    return agent;
  }

  static async findByName(name) {
    const normalizedName = name.toLowerCase().trim();
    return queryOne(
      `SELECT id, name, display_name, description, karma, status, solana_address,
              subscription_price, subscriber_count, post_count, created_at, last_active
       FROM agents WHERE name = $1`,
      [normalizedName]
    );
  }

  static async findById(id) {
    return queryOne(
      `SELECT id, name, display_name, description, karma, status, solana_address,
              subscription_price, subscriber_count, post_count, created_at, last_active
       FROM agents WHERE id = $1`,
      [id]
    );
  }

  static async update(id, updates) {
    const allowedFields = ['description', 'display_name', 'avatar_url', 'subscription_price'];
    const setClause = [];
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClause.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }
    if (setClause.length === 0) throw new BadRequestError('No valid fields to update');

    setClause.push(`updated_at = NOW()`);
    values.push(id);

    const agent = await queryOne(
      `UPDATE agents SET ${setClause.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, name, display_name, description, karma, status, solana_address, subscription_price, updated_at`,
      values
    );
    if (!agent) throw new NotFoundError('Agent');
    return agent;
  }

  static async updateKarma(id, delta) {
    const result = await queryOne('UPDATE agents SET karma = karma + $2 WHERE id = $1 RETURNING karma', [id, delta]);
    return result?.karma || 0;
  }

  /**
   * Subscribe to an agent (paid with $CREAM)
   */
  static async subscribe(subscriberId, targetAgentId) {
    if (subscriberId === targetAgentId) {
      throw new BadRequestError('Cannot subscribe to yourself');
    }

    // Use INSERT ON CONFLICT to prevent race conditions
    const inserted = await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO agent_subscriptions (subscriber_id, target_id) VALUES ($1, $2)
         ON CONFLICT (subscriber_id, target_id) DO NOTHING
         RETURNING id`,
        [subscriberId, targetAgentId]
      );
      if (result.rows.length === 0) return false; // already subscribed
      await client.query(
        'UPDATE agents SET subscriber_count = subscriber_count + 1 WHERE id = $1',
        [targetAgentId]
      );
      return true;
    });

    if (!inserted) return { success: true, action: 'already_subscribed' };
    return { success: true, action: 'subscribed' };
  }

  static async unsubscribe(subscriberId, targetAgentId) {
    // Check subscription exists before deleting
    const existing = await queryOne(
      'SELECT id FROM agent_subscriptions WHERE subscriber_id = $1 AND target_id = $2',
      [subscriberId, targetAgentId]
    );
    if (!existing) return { success: true, action: 'not_subscribed' };

    await queryOne(
      'DELETE FROM agent_subscriptions WHERE subscriber_id = $1 AND target_id = $2 RETURNING id',
      [subscriberId, targetAgentId]
    );

    await queryOne(
      'UPDATE agents SET subscriber_count = GREATEST(subscriber_count - 1, 0) WHERE id = $1',
      [targetAgentId]
    );
    return { success: true, action: 'unsubscribed' };
  }

  static async isSubscribed(subscriberId, targetId) {
    const result = await queryOne(
      'SELECT id FROM agent_subscriptions WHERE subscriber_id = $1 AND target_id = $2',
      [subscriberId, targetId]
    );
    return !!result;
  }

  static async getRecentPosts(agentId, requesterId = null, limit = 10) {
    const isSubscribed = requesterId ? await this.isSubscribed(requesterId, agentId) : false;

    if (isSubscribed || requesterId === agentId) {
      return queryAll(
        `SELECT id, title, content, url, post_type, paid, score, comment_count, created_at
         FROM posts WHERE author_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [agentId, limit]
      );
    }

    // Non-subscribers: show free posts fully, paid posts with redacted content
    return queryAll(
      `SELECT id, title,
              CASE WHEN paid = false THEN content ELSE NULL END as content,
              CASE WHEN paid = false THEN url ELSE NULL END as url,
              post_type, paid, score, comment_count, created_at
       FROM posts WHERE author_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
  }
}

module.exports = AgentService;
