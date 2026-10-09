// Everything that belongs to "Your Library": history, followed artists, saved albums, counts.
const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { asyncHandler, parse, parseId } = require('../middleware/errors');
const deezer = require('../services/deezer');
const { TRACK_COLS, ensureTrack } = require('../services/tracks');
const releaseWatcher = require('../services/releaseWatcher');

router.get('/summary', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT (SELECT COUNT(*)::int FROM liked_tracks    WHERE user_id = $1) AS likes,
            (SELECT COUNT(*)::int FROM playlists       WHERE user_id = $1) AS playlists,
            (SELECT COUNT(*)::int FROM saved_albums    WHERE user_id = $1) AS albums,
            (SELECT COUNT(*)::int FROM followed_artists WHERE user_id = $1) AS artists`,
    [req.user.id]
  );
  res.json(rows[0]);
}));

/* ---------- recently played ---------- */
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
const historyBody = z.object({ trackId: z.number({ required_error: 'trackId is required' }).int().positive() });

router.get('/history', asyncHandler(async (req, res) => {
  const { limit } = parse(historyQuery, req.query);
  const { rows } = await query(
    `SELECT ${TRACK_COLS}
       FROM (SELECT track_id, MAX(played_at) AS last_played FROM play_history
              WHERE user_id = $1 GROUP BY track_id ORDER BY last_played DESC LIMIT $2) h
       JOIN tracks t ON t.id = h.track_id
      ORDER BY h.last_played DESC`,
    [req.user.id, limit]
  );
  res.json({ tracks: rows });
}));

router.post('/history', asyncHandler(async (req, res) => {
  const { trackId } = parse(historyBody, req.body);
  await ensureTrack(trackId);
  await query('INSERT INTO play_history (user_id, track_id) VALUES ($1, $2)', [req.user.id, trackId]);
  res.status(201).json({ ok: true });
}));

/* ---------- followed artists ---------- */
router.get('/artists', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT artist_id AS id, name, picture, followed_at FROM followed_artists WHERE user_id = $1 ORDER BY followed_at DESC',
    [req.user.id]
  );
  res.json({ artists: rows });
}));

router.post('/artists/:id/follow', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const artist = await deezer.getArtist(id);
  await query(
    `INSERT INTO followed_artists (user_id, artist_id, name, picture) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [req.user.id, id, artist.name, artist.picture_big]
  );
  releaseWatcher.baseline(id); // fire and forget: start watching for new albums
  res.status(201).json({ following: true });
}));

router.delete('/artists/:id/follow', asyncHandler(async (req, res) => {
  await query('DELETE FROM followed_artists WHERE user_id = $1 AND artist_id = $2', [req.user.id, parseId(req.params.id)]);
  res.json({ following: false });
}));

/* ---------- saved albums ---------- */
router.get('/albums', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT album_id AS id, title, artist_name, cover, saved_at FROM saved_albums WHERE user_id = $1 ORDER BY saved_at DESC',
    [req.user.id]
  );
  res.json({ albums: rows });
}));

router.post('/albums/:id/save', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const { album } = await deezer.getAlbum(id);
  await query(
    `INSERT INTO saved_albums (user_id, album_id, title, artist_name, cover) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [req.user.id, id, album.title, album.artist_name, album.cover_big || album.cover]
  );
  res.status(201).json({ saved: true });
}));

router.delete('/albums/:id/save', asyncHandler(async (req, res) => {
  await query('DELETE FROM saved_albums WHERE user_id = $1 AND album_id = $2', [req.user.id, parseId(req.params.id)]);
  res.json({ saved: false });
}));

module.exports = router;
