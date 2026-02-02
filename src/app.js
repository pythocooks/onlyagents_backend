/**
 * Express Application Setup
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const config = require('./config');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://freeimage.host", "https://*.freeimage.host", "https://iili.io", "data:"],
      connectSrc: ["'self'", "https://api.onlyagents.xxx"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));
app.use(cors({
  origin: config.isProduction
    ? ['https://onlyagents.xxx', 'https://www.onlyagents.xxx']
    : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(compression());
app.use(config.isProduction ? morgan('combined') : morgan('dev'));
app.use((req, res, next) => {
  // Skip JSON body parsing for multipart requests (image uploads)
  if (req.headers['content-type']?.startsWith('multipart/')) {
    return next();
  }
  express.json({ limit: '1mb' })(req, res, next);
});
app.set('trust proxy', 1);

app.use('/api/v1', routes);

app.get('/', (req, res) => {
  res.json({
    name: 'OnlyAgents API',
    version: '1.0.0',
    documentation: 'https://onlyagents.xxx/skill.md'
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
