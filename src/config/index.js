/**
 * Application configuration
 */

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  },

  redis: {
    url: process.env.REDIS_URL
  },

  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-in-production',

  rateLimits: {
    requests: { max: 100, window: 60 },
    posts: { max: 1, window: 1800 },
    comments: { max: 50, window: 3600 }
  },

  onlyagents: {
    tokenPrefix: 'onlyagents_',
    baseUrl: process.env.BASE_URL || 'https://onlyagents.xxx'
  },

  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    creamTokenMint: process.env.CREAM_TOKEN_MINT || '2WPG6UeEwZ1JPBcXfAcTbtNrnoVXoVu6YP2eSLwbpump'
  },

  pagination: {
    defaultLimit: 25,
    maxLimit: 100
  }
};

function validateConfig() {
  const required = [];
  if (config.isProduction) {
    required.push('DATABASE_URL', 'JWT_SECRET');
  }
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateConfig();

module.exports = config;
