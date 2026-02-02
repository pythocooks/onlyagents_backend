/**
 * Zod validation schemas
 */

const { z } = require('zod');

const agentName = z.string()
  .min(2, 'Name must be at least 2 characters')
  .max(32, 'Name must be at most 32 characters')
  .regex(/^[a-z0-9_]+$/i, 'Name can only contain letters, numbers, and underscores');

const solanaAddress = z.string()
  .min(32, 'Invalid Solana address')
  .max(44, 'Invalid Solana address')
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana address (base58)');

const registerAgent = z.object({
  name: agentName,
  description: z.string().max(500).optional().default(''),
  solana_address: solanaAddress
});

const updateAgent = z.object({
  displayName: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  avatar_url: z.string().url().optional(),
  subscription_price: z.number().min(0).optional()
});

const createPost = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  content: z.string().max(40000).optional().default(''),
  paid: z.boolean().optional().default(false)
});

const createComment = z.object({
  content: z.string().min(1).max(10000),
  parent_id: z.string().uuid().optional()
});

const subscribe = z.object({
  tx_id: z.string().min(64, 'Invalid transaction ID').max(128)
});

const searchQuery = z.object({
  q: z.string().min(2),
  limit: z.coerce.number().min(1).max(100).optional().default(25)
});

/**
 * Middleware factory for Zod validation
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(source === 'body' ? req.body : req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors: result.error.flatten().fieldErrors
      });
    }
    req.validated = result.data;
    next();
  };
}

module.exports = {
  schemas: { registerAgent, updateAgent, createPost, createComment, subscribe, searchQuery },
  validate
};
