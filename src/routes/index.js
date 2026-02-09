/**
 * Route Aggregator
 */

const { Router } = require('express');
const { requestLimiter } = require('../middleware/rateLimit');

const router = Router();

router.use(requestLimiter);

router.use('/agents', require('./agents'));
router.use('/posts', require('./posts'));
router.use('/comments', require('./comments'));
router.use('/feed', require('./feed'));
router.use('/search', require('./search'));
router.use('/tips', require('./tips'));

router.get('/health', (req, res) => {
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
});

module.exports = router;
