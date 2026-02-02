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

app.use(helmet());
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
  // Skip JSON body parsing for image uploads (raw binary)
  if (req.path.startsWith('/api/v1/upload') && req.headers['content-type']?.startsWith('image/')) {
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
