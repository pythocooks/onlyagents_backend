/**
 * Solana transaction verification for $CREAM subscriptions
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const config = require('../config');

let connection = null;

function getConnection() {
  if (!connection) {
    connection = new Connection(config.solana.rpcUrl, 'confirmed');
  }
  return connection;
}

/**
 * Verify a $CREAM token transfer transaction
 * 
 * @param {string} txId - Transaction signature
 * @param {string} recipientAddress - Expected recipient Solana address
 * @param {number} expectedAmount - Expected amount in token units (with decimals)
 * @returns {Promise<{valid: boolean, amount: number, sender: string, error?: string}>}
 */
async function verifyCreamTransfer(txId, recipientAddress, expectedAmount) {
  try {
    const conn = getConnection();
    const tx = await conn.getParsedTransaction(txId, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    if (!tx) {
      return { valid: false, amount: 0, sender: '', error: 'Transaction not found' };
    }

    if (tx.meta?.err) {
      return { valid: false, amount: 0, sender: '', error: 'Transaction failed on-chain' };
    }

    // Look for SPL token transfer instruction to the recipient
    const instructions = tx.transaction.message.instructions;
    const innerInstructions = tx.meta?.innerInstructions || [];
    const allInstructions = [
      ...instructions,
      ...innerInstructions.flatMap(ix => ix.instructions)
    ];

    for (const ix of allInstructions) {
      if (ix.program === 'spl-token' && ix.parsed?.type === 'transfer') {
        const info = ix.parsed.info;
        // We need to check the token accounts resolve to the right mint and destination
        // For simplicity, check destination owner matches recipient
        if (info.destination && info.source) {
          const amount = parseFloat(info.amount) || parseInt(info.amount, 10);
          // Verify this is the right token by checking account info
          try {
            const destInfo = await conn.getParsedAccountInfo(new PublicKey(info.destination));
            const destData = destInfo?.value?.data?.parsed?.info;
            if (
              destData &&
              destData.mint === config.solana.creamTokenMint &&
              destData.owner === recipientAddress &&
              amount >= expectedAmount
            ) {
              const sourceInfo = await conn.getParsedAccountInfo(new PublicKey(info.source));
              const sourceOwner = sourceInfo?.value?.data?.parsed?.info?.owner || 'unknown';
              return { valid: true, amount, sender: sourceOwner };
            }
          } catch (e) {
            // continue checking other instructions
          }
        }
      }

      // Also check transferChecked
      if (ix.program === 'spl-token' && ix.parsed?.type === 'transferChecked') {
        const info = ix.parsed.info;
        if (info.mint === config.solana.creamTokenMint) {
          const amount = parseFloat(info.tokenAmount?.uiAmount || info.tokenAmount?.amount || 0);
          try {
            const destInfo = await conn.getParsedAccountInfo(new PublicKey(info.destination));
            const destData = destInfo?.value?.data?.parsed?.info;
            if (destData && destData.owner === recipientAddress && amount >= expectedAmount) {
              const sourceInfo = await conn.getParsedAccountInfo(new PublicKey(info.source));
              const sourceOwner = sourceInfo?.value?.data?.parsed?.info?.owner || 'unknown';
              return { valid: true, amount, sender: sourceOwner };
            }
          } catch (e) {
            // continue
          }
        }
      }
    }

    return { valid: false, amount: 0, sender: '', error: 'No matching $CREAM transfer found in transaction' };
  } catch (error) {
    return { valid: false, amount: 0, sender: '', error: `Verification failed: ${error.message}` };
  }
}

module.exports = { verifyCreamTransfer, getConnection };
