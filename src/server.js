const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { pool } = require('./db');
const { requireAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');
const releaseWatcher = require('./services/releaseWatcher');

const app = express();
app.set('trust proxy', 1);

// CSP is off because the bundled frontend uses the Tailwind CDN and inline scripts.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins }));
app.use(express.json({ limit: '100kb' }));
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down' },
}));

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/stream', require('./routes/stream')); // public: <audio> can't send an Authorization header
app.use('/api/music', requireAuth, require('./routes/music'));
app.use('/api/likes', requireAuth, require('./routes/likes'));
app.use('/api/playlists', requireAuth, require('./routes/playlists'));
app.use('/api/library', requireAuth, require('./routes/library'));
app.use('/api/notifications', requireAuth, require('./routes/notifications'));
app.use('/api/player', requireAuth, require('./routes/player'));
app.use('/api', notFound);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`MIDNIGHT running at http://localhost:${config.port}`);
});
releaseWatcher.start(config.releaseWatchIntervalMin);

function shutdown() {
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
