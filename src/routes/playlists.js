const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { HttpError, asyncHandler, parse, parseId } = require('../middleware/errors');
const { TRACK_COLS, ensureTrack } = require('../services/tracks');

const createSchema = z.object({
  name: z.string({ required_error: 'Playlist name is required' }).trim()
    .min(1, 'Playlist name is required').max(100, 'Playlist name is too long'),
  description: z.string().trim().max(500, 'Description is too long').optional(),
});
const updateSchema = createSchema.partial();
const addTrackSchema = z.object({ trackId: z.number({ required_error: 'trackId is required' }).int().positive() });

async function getOwned(playlistId, userId) {
  const { rows } = await query(
    'SELECT id, name, description, created_at, updated_at FROM playlists WHERE id = $1 AND user_id = $2',
    [playlistId, userId]
  );
  if (!rows[0]) throw new HttpError(404, 'Playlist not found');
  return rows[0];
}

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
            COUNT(pt.track_id)::int AS track_count,
            (SELECT t.cover_medium FROM playlist_tracks x JOIN tracks t ON t.id = x.track_id
              WHERE x.playlist_id = p.id ORDER BY x.position LIMIT 1) AS cover
       FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
      WHERE p.user_id = $1
      GROUP BY p.id ORDER BY p.updated_at DESC`,
    [req.user.id]
  );
  res.json({ playlists: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, description } = parse(createSchema, req.body);
  const { rows } = await query(
    'INSERT INTO playlists (user_id, name, description) VALUES ($1, $2, $3) RETURNING id, name, description, created_at, updated_at',
    [req.user.id, name, description || '']
  );
  res.status(201).json({ playlist: { ...rows[0], track_count: 0, cover: null } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const playlist = await getOwned(parseId(req.params.id), req.user.id);
  const { rows } = await query(
    `SELECT ${TRACK_COLS}, pt.position, pt.added_at
       FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = $1 ORDER BY pt.position`,
    [playlist.id]
  );
  res.json({ playlist, tracks: rows });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const { name, description } = parse(updateSchema, req.body);
  if (name === undefined && description === undefined) throw new HttpError(400, 'Nothing to update');
  const { rows } = await query(
    `UPDATE playlists SET name = COALESCE($1, name), description = COALESCE($2, description), updated_at = now()
      WHERE id = $3 AND user_id = $4 RETURNING id, name, description, created_at, updated_at`,
    [name ?? null, description ?? null, id, req.user.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Playlist not found');
  res.json({ playlist: rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM playlists WHERE id = $1 AND user_id = $2', [parseId(req.params.id), req.user.id]);
  if (!rowCount) throw new HttpError(404, 'Playlist not found');
  res.status(204).end();
}));

router.post('/:id/tracks', asyncHandler(async (req, res) => {
  const playlist = await getOwned(parseId(req.params.id), req.user.id);
  const { trackId } = parse(addTrackSchema, req.body);
  await ensureTrack(trackId);
  const { rowCount } = await query(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position)
     SELECT $1::bigint, $2::bigint, COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = $1::bigint
     ON CONFLICT DO NOTHING`,
    [playlist.id, trackId]
  );
  if (rowCount) await query('UPDATE playlists SET updated_at = now() WHERE id = $1', [playlist.id]);
  res.status(rowCount ? 201 : 200).json({ added: rowCount > 0 });
}));

router.delete('/:id/tracks/:trackId', asyncHandler(async (req, res) => {
  const playlist = await getOwned(parseId(req.params.id), req.user.id);
  await query('DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2', [playlist.id, parseId(req.params.trackId, 'track id')]);
  await query('UPDATE playlists SET updated_at = now() WHERE id = $1', [playlist.id]);
  res.status(204).end();
}));

module.exports = router;
