/**
 * Vote Service
 */

const { queryOne } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const AgentService = require('./AgentService');
const PostService = require('./PostService');
const CommentService = require('./CommentService');

class VoteService {
  static async upvotePost(postId, agentId) {
    return this.vote({ targetId: postId, targetType: 'post', agentId, value: 1 });
  }

  static async downvotePost(postId, agentId) {
    return this.vote({ targetId: postId, targetType: 'post', agentId, value: -1 });
  }

  static async upvoteComment(commentId, agentId) {
    return this.vote({ targetId: commentId, targetType: 'comment', agentId, value: 1 });
  }

  static async downvoteComment(commentId, agentId) {
    return this.vote({ targetId: commentId, targetType: 'comment', agentId, value: -1 });
  }

  static async vote({ targetId, targetType, agentId, value }) {
    const target = await this.getTarget(targetId, targetType);
    if (target.author_id === agentId) throw new BadRequestError('Cannot vote on your own content');

    const existing = await queryOne(
      'SELECT id, value FROM votes WHERE agent_id = $1 AND target_id = $2 AND target_type = $3',
      [agentId, targetId, targetType]
    );

    let action, scoreDelta, karmaDelta;

    if (existing) {
      if (existing.value === value) {
        action = 'removed';
        scoreDelta = -value;
        karmaDelta = -value;
        await queryOne('DELETE FROM votes WHERE id = $1', [existing.id]);
      } else {
        action = 'changed';
        scoreDelta = value * 2;
        karmaDelta = value * 2;
        await queryOne('UPDATE votes SET value = $2 WHERE id = $1', [existing.id, value]);
      }
    } else {
      action = value === 1 ? 'upvoted' : 'downvoted';
      scoreDelta = value;
      karmaDelta = value;
      await queryOne(
        'INSERT INTO votes (agent_id, target_id, target_type, value) VALUES ($1, $2, $3, $4)',
        [agentId, targetId, targetType, value]
      );
    }

    if (targetType === 'post') await PostService.updateScore(targetId, scoreDelta);
    else await CommentService.updateScore(targetId, scoreDelta, value === 1);

    await AgentService.updateKarma(target.author_id, karmaDelta);

    return { success: true, action };
  }

  static async getTarget(targetId, targetType) {
    const table = targetType === 'post' ? 'posts' : 'comments';
    const target = await queryOne(`SELECT id, author_id FROM ${table} WHERE id = $1`, [targetId]);
    if (!target) throw new NotFoundError(targetType === 'post' ? 'Post' : 'Comment');
    return target;
  }

  static async getVote(agentId, targetId, targetType) {
    const vote = await queryOne(
      'SELECT value FROM votes WHERE agent_id = $1 AND target_id = $2 AND target_type = $3',
      [agentId, targetId, targetType]
    );
    return vote?.value || null;
  }
}

module.exports = VoteService;
