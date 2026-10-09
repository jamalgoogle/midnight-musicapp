// Thin Deezer client: caching, quota-aware retries and normalisation of Deezer's shapes.
const config = require('../config');
const { HttpError } = require('../middleware/errors');

const cache = new Map();
const inflight = new Map();
const MAX_CACHE = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, attempt = 0) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  } catch {
    throw new HttpError(502, 'The music service is unreachable right now');
  }
  if (!res.ok) throw new HttpError(502, `The music service returned ${res.status}`);
  const data = await res.json();

  // Deezer reports many errors with HTTP 200 and an { error } body.
  if (data && data.error) {
    const code = data.error.code;
    if (code === 4) { // quota exceeded (50 requests / 5 seconds)
      if (attempt < 2) { await sleep(1200); return fetchJson(url, attempt + 1); }
      throw new HttpError(429, 'The music service is busy, try again in a moment');
    }
    if (code === 800) throw new HttpError(404, 'Not found');
    throw new HttpError(502, data.error.message || 'Music service error');
  }
  return data;
}

// ttlSec = 0 skips the cache entirely (used for stream URLs, which expire).
async function request(path, params = {}, ttlSec = 600) {
  const url = new URL(config.deezerUrl + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const key = url.toString();

  if (ttlSec > 0) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.data;
    if (inflight.has(key)) return inflight.get(key);
  }

  const p = fetchJson(url)
    .then((data) => {
      if (ttlSec > 0) {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
        cache.set(key, { data, exp: Date.now() + ttlSec * 1000 });
      }
      return data;
    })
    .finally(() => inflight.delete(key));

  if (ttlSec > 0) inflight.set(key, p);
  return p;
}

// Cache the result of an expensive multi-request computation.
const memos = new Map();
function memo(key, ttlSec, fn) {
  const hit = memos.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = fn().catch((err) => { memos.delete(key); throw err; });
  memos.set(key, { p, exp: Date.now() + ttlSec * 1000 });
  return p;
}

/* ---------- normalisers ---------- */
const num = (v) => (v === undefined || v === null ? null : Number(v));

function normalizeTrack(t, fallback = {}) {
  const album = t.album || fallback.album || {};
  const artist = t.artist || fallback.artist || {};
  return {
    id: Number(t.id),
    title: t.title || t.title_short || 'Untitled',
    artist_id: num(artist.id),
    artist_name: artist.name || '',
    album_id: num(album.id),
    album_title: album.title || '',
    cover_small: album.cover_small || null,
    cover_medium: album.cover_medium || null,
    cover_big: album.cover_big || album.cover_xl || null,
    duration: Number(t.duration) || 0,
    rank: Number(t.rank) || 0,
  };
}

const toTracks = (list, fallback) =>
  (list || []).filter((t) => t && Number(t.id) > 0).map((t) => normalizeTrack(t, fallback));

function normalizeArtist(a) {
  return {
    id: Number(a.id),
    name: a.name,
    picture: a.picture_medium || a.picture || null,
    picture_big: a.picture_big || a.picture_xl || a.picture_medium || null,
    fans: Number(a.nb_fan) || 0,
  };
}

function normalizeAlbum(a, fallback = {}) {
  const artist = a.artist || fallback.artist || {};
  return {
    id: Number(a.id),
    title: a.title,
    cover: a.cover_medium || a.cover || null,
    cover_big: a.cover_big || a.cover_xl || a.cover_medium || null,
    artist_id: num(artist.id),
    artist_name: artist.name || '',
    release_date: a.release_date || null,
    nb_tracks: Number(a.nb_tracks) || 0,
  };
}

function normalizePlaylist(p) {
  return {
    id: Number(p.id),
    title: p.title,
    description: p.description || '',
    cover: p.picture_medium || p.picture || null,
    cover_big: p.picture_big || p.picture_xl || p.picture_medium || null,
    nb_tracks: Number(p.nb_tracks) || 0,
    creator: (p.user && p.user.name) || (p.creator && p.creator.name) || '',
  };
}

/* ---------- endpoints ---------- */
const items = (res) => (res && res.data) || [];

async function searchTracks(q, limit = 20) {
  return toTracks(items(await request('/search', { q, limit }, 300)));
}
async function searchArtists(q, limit = 10) {
  return items(await request('/search/artist', { q, limit }, 300)).map(normalizeArtist);
}
async function searchAlbums(q, limit = 10) {
  return items(await request('/search/album', { q, limit }, 300)).map((a) => normalizeAlbum(a));
}
async function searchPlaylists(q, limit = 10) {
  return items(await request('/search/playlist', { q, limit }, 300)).map(normalizePlaylist);
}

async function getArtist(id) {
  return normalizeArtist(await request(`/artist/${id}`, {}, 3600));
}
async function getArtistTop(id, limit = 20) {
  return toTracks(items(await request(`/artist/${id}/top`, { limit }, 1800)));
}
async function getArtistAlbums(id, limit = 20) {
  const list = items(await request(`/artist/${id}/albums`, { limit }, 1800)).map((a) => normalizeAlbum(a));
  return list.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
}
async function getRelatedArtists(id, limit = 5) {
  return items(await request(`/artist/${id}/related`, { limit }, 3600)).map(normalizeArtist);
}

async function getAlbum(id) {
  const raw = await request(`/album/${id}`, {}, 1800);
  return {
    album: normalizeAlbum(raw),
    tracks: toTracks(raw.tracks && raw.tracks.data, { album: raw, artist: raw.artist }),
  };
}

async function getPlaylist(id) {
  const raw = await request(`/playlist/${id}`, {}, 900);
  return {
    playlist: normalizePlaylist(raw),
    tracks: toTracks(raw.tracks && raw.tracks.data).slice(0, 100),
  };
}

// "Amr Diab" -> the best matching Deezer artist (cached for a day).
function resolveArtistByName(name) {
  return memo(`artist-name:${name.toLowerCase()}`, 86400, async () => {
    const [artist] = await searchArtists(name, 1);
    return artist || null;
  });
}

module.exports = {
  request, memo, normalizeTrack, normalizeArtist, normalizeAlbum, normalizePlaylist,
  searchTracks, searchArtists, searchAlbums, searchPlaylists,
  getArtist, getArtistTop, getArtistAlbums, getRelatedArtists, getAlbum, getPlaylist,
  resolveArtistByName,
};
