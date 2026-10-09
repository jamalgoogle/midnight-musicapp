const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { query } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { HttpError, asyncHandler, parse } = require('../middleware/errors');
const { notify } = require('../services/notifications');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

const registerSchema = z.object({
  username: z.string({ required_error: 'Username is required' }).trim()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[A-Za-z0-9_.-]+$/, 'Username can only contain letters, numbers, dots, dashes and underscores'),
  email: z.string({ required_error: 'Email is required' }).trim().max(255).email('Enter a valid email address'),
  password: z.string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
});

const loginSchema = z.object({
  identifier: z.string({ required_error: 'Enter your email or username' }).trim().min(1, 'Enter your email or username'),
  password: z.string({ required_error: 'Enter your password' }).min(1, 'Enter your password'),
});

// Compared against when the account doesn't exist, so response time doesn't leak which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/register', limiter, asyncHandler(async (req, res) => {
  const { username, email, password } = parse(registerSchema, req.body);
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email.toLowerCase(), hash]
    );
    const user = rows[0];
    await notify(user.id, {
      type: 'welcome',
      title: `Welcome to Midnight, ${user.username}`,
      body: 'Like songs, build playlists and follow artists to get new-release alerts.',
    });
    res.status(201).json({ token: signToken(user.id), user });
  } catch (err) {
    if (err.code === '23505') {
      throw new HttpError(409, /email/.test(err.constraint || '') ? 'That email is already registered' : 'That username is taken');
    }
    throw err;
  }
}));

router.post('/login', limiter, asyncHandler(async (req, res) => {
  const { identifier, password } = parse(loginSchema, req.body);
  const { rows } = await query(
    `SELECT id, username, email, password_hash, created_at FROM users
      WHERE lower(email) = lower($1) OR lower(username) = lower($1) LIMIT 1`,
    [identifier]
  );
  const row = rows[0];
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, 'Invalid email/username or password');
  const { password_hash, ...user } = row;
  res.json({ token: signToken(user.id), user });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, username, email, created_at FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) throw new HttpError(401, 'Account no longer exists');
  res.json({ user: rows[0] });
}));

module.exports = router;
