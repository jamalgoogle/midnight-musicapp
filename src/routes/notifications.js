const router = require('express').Router();
const { query } = require('../db');
const { HttpError, asyncHandler, parseId } = require('../middleware/errors');

router.get('/', asyncHandler(async (req, res) => {
  const [list, unread] = await Promise.all([
    query(
      `SELECT id, type, title, body, data, is_read, created_at FROM notifications
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.user.id]
    ),
    query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false', [req.user.id]),
  ]);
  res.json({ items: list.rows, unread: unread.rows[0].n });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [req.user.id]);
  res.json({ ok: true });
}));

router.patch('/:id/read', asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
    [parseId(req.params.id), req.user.id]
  );
  if (!rowCount) throw new HttpError(404, 'Notification not found');
  res.json({ ok: true });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [parseId(req.params.id), req.user.id]);
  res.status(204).end();
}));

module.exports = router;
