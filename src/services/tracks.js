const { query } = require('../db');
const deezer = require('./deezer');

// Columns to select (alias the tracks table as "t").
const TRACK_COLS =
  't.id, t.title, t.artist_id, t.artist_name, t.album_id, t.album_title, t.cover_small, t.cover_medium, t.cover_big, t.duration';

async function upsertTracks(tracks) {
  const unique = new Map();
  for (const t of tracks || []) if (t && t.id > 0) unique.set(t.id, t);
  const list = [...unique.values()];
  if (!list.length) return;

  const col = (fn) => list.map(fn);
  await query(
    `INSERT INTO tracks (id, title, artist_id, artist_name, album_id, album_title, cover_small, cover_medium, cover_big, duration, updated_at)
     SELECT u.*, now()
     FROM unnest($1::bigint[], $2::text[], $3::bigint[], $4::text[], $5::bigint[], $6::text[], $7::text[], $8::text[], $9::text[], $10::int[])
       AS u(id, title, artist_id, artist_name, album_id, album_title, cover_small, cover_medium, cover_big, duration)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       artist_id = EXCLUDED.artist_id,
       artist_name = EXCLUDED.artist_name,
       album_id = EXCLUDED.album_id,
       album_title = EXCLUDED.album_title,
       cover_small = COALESCE(EXCLUDED.cover_small, tracks.cover_small),
       cover_medium = COALESCE(EXCLUDED.cover_medium, tracks.cover_medium),
       cover_big = COALESCE(EXCLUDED.cover_big, tracks.cover_big),
       duration = EXCLUDED.duration,
       updated_at = now()`,
    [
      col((t) => t.id), col((t) => t.title), col((t) => t.artist_id), col((t) => t.artist_name),
      col((t) => t.album_id), col((t) => t.album_title), col((t) => t.cover_small),
      col((t) => t.cover_medium), col((t) => t.cover_big), col((t) => t.duration),
    ]
  );
}

// Make sure a track exists locally (fetching it from Deezer if we've never seen it).
async function ensureTrack(id) {
  const { rows } = await query(`SELECT ${TRACK_COLS} FROM tracks t WHERE t.id = $1`, [id]);
  if (rows[0]) return rows[0];
  const raw = await deezer.request(`/track/${id}`, {}, 600);
  const track = deezer.normalizeTrack(raw);
  await upsertTracks([track]);
  return track;
}

module.exports = { TRACK_COLS, upsertTracks, ensureTrack };
