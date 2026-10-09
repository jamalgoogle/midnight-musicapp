// Periodically checks followed artists for new albums and notifies their followers.
const { query } = require('../db');
const deezer = require('./deezer');

const RECENT_DAYS = 30;

async function baseline(artistId) {
  try {
    const albums = await deezer.getArtistAlbums(artistId, 10);
    if (!albums[0]) return;
    await query(
      'INSERT INTO artist_watch (artist_id, last_album_id) VALUES ($1, $2) ON CONFLICT (artist_id) DO NOTHING',
      [artistId, albums[0].id]
    );
  } catch (err) {
    console.warn('release baseline failed:', err.message);
  }
}

async function checkReleases() {
  try {
    const { rows } = await query('SELECT DISTINCT artist_id, name FROM followed_artists');
    const cutoff = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString().slice(0, 10);

    for (const { artist_id: artistId, name } of rows) {
      try {
        const latest = (await deezer.getArtistAlbums(artistId, 10))[0];
        if (!latest) continue;

        const watch = await query('SELECT last_album_id FROM artist_watch WHERE artist_id = $1', [artistId]);
        const changed = !watch.rows[0] ? false : watch.rows[0].last_album_id !== latest.id;

        if (changed && (latest.release_date || '') >= cutoff) {
          await query(
            `INSERT INTO notifications (user_id, type, title, body, data)
             SELECT user_id, 'new_release', $2::text, $3::text, $4::jsonb FROM followed_artists WHERE artist_id = $1`,
            [artistId, `${name} released a new album`, latest.title, JSON.stringify({ album_id: latest.id, artist_id: artistId })]
          );
        }
        if (!watch.rows[0] || changed) {
          await query(
            `INSERT INTO artist_watch (artist_id, last_album_id, checked_at) VALUES ($1, $2, now())
             ON CONFLICT (artist_id) DO UPDATE SET last_album_id = EXCLUDED.last_album_id, checked_at = now()`,
            [artistId, latest.id]
          );
        }
      } catch (err) {
        console.warn(`release check failed for artist ${artistId}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('release watcher error:', err.message);
  }
}

function start(intervalMin) {
  setTimeout(checkReleases, 30 * 1000).unref();
  setInterval(checkReleases, intervalMin * 60 * 1000).unref();
}

module.exports = { start, baseline, checkReleases };
