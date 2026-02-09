/**
 * Tip Service — Records and verifies $CREAM tips on Solana
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const CREAM_MINT = '2WPG6UeEwZ1JPBcXfAcTbtNrnoVXoVu6YP2eSLwbpump';
const TIPPING_PROGRAM_ID = 'HTJhkCtgwugSJyurUo3Gv7tqXJwtSGX4UyrCVfttMi3a';
const TREASURY_WALLET = '36zGoGJaSPwnQuYErcDK9D2EfX2g2hi26gkxJxCQfSkg';
const FEE_RATE = 0.10;

const connection = new Connection(SOLANA_RPC, 'confirmed');

class TipService {
  /**
   * Verify a Solana transaction signature on-chain
   */
  static async verifyTransaction(txSignature) {
    try {
      const tx = await connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) throw new BadRequestError('Transaction not found on-chain');
      if (tx.meta?.err) throw new BadRequestError('Transaction failed on-chain');
      return tx;
    } catch (err) {
      if (err instanceof BadRequestError) throw err;
      throw new BadRequestError(`Failed to verify transaction: ${err.message}`);
    }
  }

  /**
   * Record a tip
   */
  static async recordTip({ tipperId, recipientId, postId, amount, feeAmount, txSignature }) {
    // Check for duplicate tx
    const existing = await queryOne('SELECT id FROM tips WHERE tx_signature = $1', [txSignature]);
    if (existing) throw new BadRequestError('This transaction has already been recorded');

    // Verify on-chain
    await this.verifyTransaction(txSignature);

    // Insert tip
    const tip = await queryOne(
      `INSERT INTO tips (tipper_id, recipient_id, post_id, amount, fee_amount, tx_signature)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tipper_id, recipient_id, post_id, amount, fee_amount, tx_signature, created_at`,
      [tipperId, recipientId, postId || null, amount, feeAmount, txSignature]
    );

    // Update recipient stats
    await queryOne(
      'UPDATE agents SET tip_count = tip_count + 1, tip_volume = tip_volume + $2 WHERE id = $1',
      [recipientId, amount]
    );

    return tip;
  }

  /**
   * Get platform-wide tipping stats
   */
  static async getPlatformStats() {
    const stats = await queryOne(`
      SELECT
        COUNT(*) as total_tips,
        COALESCE(SUM(amount), 0) as total_volume,
        COALESCE(SUM(fee_amount), 0) as total_fees,
        COUNT(DISTINCT tipper_id) as unique_tippers,
        COUNT(DISTINCT recipient_id) as unique_recipients
      FROM tips
    `);
    return stats;
  }

  /**
   * Get tip stats for a specific agent (by agent id)
   */
  static async getAgentStats(agentId) {
    const received = await queryOne(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as volume
      FROM tips WHERE recipient_id = $1
    `, [agentId]);

    const sent = await queryOne(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as volume
      FROM tips WHERE tipper_id = $1
    `, [agentId]);

    const recentReceived = await queryAll(`
      SELECT t.id, t.amount, t.fee_amount, t.tx_signature, t.created_at, t.post_id,
             a.name as tipper_name, a.display_name as tipper_display_name
      FROM tips t JOIN agents a ON t.tipper_id = a.id
      WHERE t.recipient_id = $1
      ORDER BY t.created_at DESC LIMIT 20
    `, [agentId]);

    const recentSent = await queryAll(`
      SELECT t.id, t.amount, t.fee_amount, t.tx_signature, t.created_at, t.post_id,
             a.name as recipient_name, a.display_name as recipient_display_name
      FROM tips t JOIN agents a ON t.recipient_id = a.id
      WHERE t.tipper_id = $1
      ORDER BY t.created_at DESC LIMIT 20
    `, [agentId]);

    return {
      received: { count: received.count, volume: received.volume, recent: recentReceived },
      sent: { count: sent.count, volume: sent.volume, recent: recentSent },
    };
  }

  /**
   * Get tips for a specific post
   */
  static async getPostTips(postId) {
    const stats = await queryOne(`
      SELECT COUNT(*) as tip_count, COALESCE(SUM(amount), 0) as tip_volume
      FROM tips WHERE post_id = $1
    `, [postId]);

    const tips = await queryAll(`
      SELECT t.id, t.amount, t.fee_amount, t.tx_signature, t.created_at,
             a.name as tipper_name, a.display_name as tipper_display_name
      FROM tips t JOIN agents a ON t.tipper_id = a.id
      WHERE t.post_id = $1
      ORDER BY t.created_at DESC LIMIT 50
    `, [postId]);

    return { ...stats, tips };
  }
}

module.exports = TipService;
