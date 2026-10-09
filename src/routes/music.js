const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { HttpError, asyncHandler, parse, parseId } = require('../middleware/errors');
const deezer = require('../services/deezer');
const catalog = require('../services/catalog');
const { upsertTracks } = require('../services/tracks');

router.get('/home', asyncHandler(async (req, res) => {
  const [popularRes, playlistsRes] = await Promise.allSettled([catalog.getPopular(), catalog.getHomePlaylists()]);
  if (popularRes.status === 'rejected' && playlistsRes.status === 'rejected') throw popularRes.reason;

  const popular = popularRes.status === 'fulfilled' ? popularRes.value : [];
  const playlists = playlistsRes.status === 'fulfilled' ? playlistsRes.value : [];
  await upsertTracks(popular);

  // Featured track rotates daily.
  let hero = null;
  let heroLikes = 0;
  if (popular.length) {
    hero = popular[Math.floor(Date.now() / 86400000) % popular.length];
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM liked_tracks WHERE track_id = $1', [hero.id]);
    heroLikes = rows[0].n;
  }
  res.json({ hero, hero_likes: heroLikes, popular, playlists });
}));

router.get('/categories', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT slug, label, icon, gradient FROM categories ORDER BY sort_order, id');
  res.json({ categories: rows });
}));

router.get('/categories/:slug', asyncHandler(async (req, res) => {
  const result = await catalog.getCategoryTracks(String(req.params.slug).slice(0, 40));
  if (!result) throw new HttpError(404, 'Category not found');
  await upsertTracks(result.tracks);
  res.json(result);
}));

const searchSchema = z.object({
  q: z.string({ required_error: 'q is required' }).trim().min(1, 'q is required').max(100, 'q is too long'),
  type: z.enum(['all', 'songs', 'artists', 'albums', 'playlists']).default('all'),
});

router.get('/search', asyncHandler(async (req, res) => {
  const { q, type } = parse(searchSchema, req.query);
  const all = type === 'all';
  const out = {};
  const jobs = [];
  if (all || type === 'songs') jobs.push(deezer.searchTracks(q, all ? 8 : 30).then((r) => { out.tracks = r; }));
  if (all || type === 'artists') jobs.push(deezer.searchArtists(q, all ? 6 : 24).then((r) => { out.artists = r; }));
  if (all || type === 'albums') jobs.push(deezer.searchAlbums(q, all ? 6 : 24).then((r) => { out.albums = r; }));
  if (all || type === 'playlists') jobs.push(deezer.searchPlaylists(q, all ? 6 : 24).then((r) => { out.playlists = r; }));
  await Promise.all(jobs);
  if (out.tracks) await upsertTracks(out.tracks);
  res.json(out);
}));

router.get('/artists/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const [artist, top, albums] = await Promise.all([
    deezer.getArtist(id),
    deezer.getArtistTop(id, 20),
    deezer.getArtistAlbums(id, 20).catch(() => []),
  ]);
  await upsertTracks(top);
  const f = await query('SELECT 1 FROM followed_artists WHERE user_id = $1 AND artist_id = $2', [req.user.id, id]);
  res.json({ artist, top, albums, following: f.rowCount > 0 });
}));

router.get('/albums/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const { album, tracks } = await deezer.getAlbum(id);
  await upsertTracks(tracks);
  const s = await query('SELECT 1 FROM saved_albums WHERE user_id = $1 AND album_id = $2', [req.user.id, id]);
  res.json({ album, tracks, saved: s.rowCount > 0 });
}));

// Public Deezer playlists (not the user's own playlists, those live under /api/playlists).
router.get('/playlists/:id', asyncHandler(async (req, res) => {
  const { playlist, tracks } = await deezer.getPlaylist(parseId(req.params.id));
  await upsertTracks(tracks);
  res.json({ playlist, tracks });
}));

router.get('/recommendations', asyncHandler(async (req, res) => {
  const tracks = await catalog.getRecommendations(req.user.id);
  await upsertTracks(tracks);
  res.json({ tracks });
}));

module.exports = router;
