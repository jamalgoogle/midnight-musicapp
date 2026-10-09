// Higher-level "what should the home page / a genre tile show" logic built on the Deezer client.
const { query } = require('../db');
const deezer = require('./deezer');

const HOME_PLAYLIST_QUERIES = ['Arabic Hits', 'Egyptian Pop', 'Arabic Chill', 'Mahraganat', 'Arabic Classics'];

const uniqBy = (arr, key) => {
  const seen = new Set();
  return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
};
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

async function topTracksForNames(names, perArtist) {
  const artists = (await Promise.all(names.map((n) => deezer.resolveArtistByName(n).catch(() => null)))).filter(Boolean);
  const lists = await Promise.all(artists.map((a) => deezer.getArtistTop(a.id, perArtist).catch(() => [])));
  return uniqBy(lists.flat(), (t) => t.id);
}

// Arabic "charts": the top songs of the first two artists from every category, ranked by Deezer rank.
function getPopular() {
  return deezer.memo('popular', 3600, async () => {
    const { rows } = await query('SELECT artists FROM categories ORDER BY sort_order');
    const names = [...new Set(rows.flatMap((r) => r.artists.slice(0, 2)))];
    const tracks = await topTracksForNames(names, 3);
    return tracks.sort((a, b) => b.rank - a.rank).slice(0, 12);
  });
}

function getHomePlaylists() {
  return deezer.memo('home-playlists', 6 * 3600, async () => {
    const results = await Promise.all(HOME_PLAYLIST_QUERIES.map((q) => deezer.searchPlaylists(q, 5).catch(() => [])));
    const picked = results.map((list) => list.find((p) => p.nb_tracks >= 10)).filter(Boolean);
    return uniqBy(picked, (p) => p.id);
  });
}

function getCategoryTracks(slug) {
  return deezer.memo(`category:${slug}`, 3600, async () => {
    const { rows } = await query('SELECT slug, label, icon, gradient, artists FROM categories WHERE slug = $1', [slug]);
    if (!rows[0]) return null;
    const { artists, ...category } = rows[0];
    const tracks = await topTracksForNames(artists, 5);
    return { category, tracks: tracks.sort((a, b) => b.rank - a.rank) };
  });
}

// Mix based on the artists the user liked / played most recently (+ a couple of related artists).
async function getRecommendations(userId) {
  const { rows } = await query(
    `SELECT t.artist_id
       FROM (
         SELECT track_id, liked_at  AS ts FROM liked_tracks  WHERE user_id = $1
         UNION ALL
         SELECT track_id, played_at AS ts FROM play_history WHERE user_id = $1
       ) x
       JOIN tracks t ON t.id = x.track_id
      WHERE t.artist_id IS NOT NULL
      GROUP BY t.artist_id
      ORDER BY MAX(x.ts) DESC
      LIMIT 4`,
    [userId]
  );

  let pool = [];
  if (rows.length) {
    const lists = await Promise.all(rows.map(async (r) => {
      const top = await deezer.getArtistTop(r.artist_id, 6).catch(() => []);
      const related = await deezer.getRelatedArtists(r.artist_id, 3).catch(() => []);
      const relatedTop = await Promise.all(related.slice(0, 2).map((a) => deezer.getArtistTop(a.id, 4).catch(() => [])));
      return [...top, ...relatedTop.flat()];
    }));
    pool = lists.flat();
  }
  if (pool.length < 10) pool = pool.concat(await getPopular().catch(() => []));
  return shuffle(uniqBy(pool, (t) => t.id)).slice(0, 30);
}

module.exports = { getPopular, getHomePlaylists, getCategoryTracks, getRecommendations };
