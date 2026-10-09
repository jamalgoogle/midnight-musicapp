const router = require('express').Router();
const { query } = require('../db');
const { asyncHandler, parseId } = require('../middleware/errors');
const { TRACK_COLS, ensureTrack } = require('../services/tracks');

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT ${TRACK_COLS}, l.liked_at
       FROM liked_tracks l JOIN tracks t ON t.id = l.track_id
      WHERE l.user_id = $1 ORDER BY l.liked_at DESC LIMIT 1000`,
    [req.user.id]
  );
  res.json({ tracks: rows });
}));

router.get('/ids', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT track_id FROM liked_tracks WHERE user_id = $1', [req.user.id]);
  res.json({ ids: rows.map((r) => r.track_id) });
}));

router.post('/:trackId', asyncHandler(async (req, res) => {
  const trackId = parseId(req.params.trackId, 'track id');
  await ensureTrack(trackId);
  await query(
    'INSERT INTO liked_tracks (user_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.user.id, trackId]
  );
  res.status(201).json({ liked: true });
}));

router.delete('/:trackId', asyncHandler(async (req, res) => {
  const trackId = parseId(req.params.trackId, 'track id');
  await query('DELETE FROM liked_tracks WHERE user_id = $1 AND track_id = $2', [req.user.id, trackId]);
  res.json({ liked: false });
}));

module.exports = router;
