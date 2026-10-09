# MIDNIGHT backend

Express + PostgreSQL backend for the MIDNIGHT dark music player. Music data (images, metadata, audio previews)
comes from the Deezer API through the server; users, likes, playlists, history, notifications and player state live in PostgreSQL.

## Run it

```bash
npm install
cp .env.example .env        # then set DATABASE_URL and JWT_SECRET
createdb midnight           # or create the database in pgAdmin
npm run db:init             # creates tables + seeds the genre tiles (safe to re-run)
npm start                   # http://localhost:3000  (serves public/index.html too)
```

Open http://localhost:3000, create an account, and you're in.
If you open `public/index.html` from another origin (Live Server, file://), it automatically talks to `http://localhost:3000`.

## Where the Arabic catalogue comes from
The Search page tiles are rows in the `categories` table. Each row lists artist names; the server resolves them on
Deezer and shows their top tracks. Edit the rows to tune it:

```sql
UPDATE categories SET artists = ARRAY['Amr Diab','Wegz','Fairuz'] WHERE slug = 'arabic-pop';
```
"Made for you" playlists come from the `HOME_PLAYLIST_QUERIES` list in `src/services/catalog.js`.

## API (all JSON, Bearer token except /auth and /stream)
| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register` `POST /api/auth/login` `GET /api/auth/me` |
| Music | `GET /api/music/home` `/categories` `/categories/:slug` `/search?q=&type=all\|songs\|artists\|albums\|playlists` `/artists/:id` `/albums/:id` `/playlists/:id` `/recommendations` |
| Audio | `GET /api/stream/:trackId` (302 to a fresh Deezer preview URL) |
| Likes | `GET /api/likes` `GET /api/likes/ids` `POST/DELETE /api/likes/:trackId` |
| Playlists | `GET/POST /api/playlists` `GET/PATCH/DELETE /api/playlists/:id` `POST /api/playlists/:id/tracks` `DELETE /api/playlists/:id/tracks/:trackId` |
| Library | `GET /api/library/summary` `/history` `POST /history` `GET /artists` `POST/DELETE /artists/:id/follow` `GET /albums` `POST/DELETE /albums/:id/save` |
| Notifications | `GET /api/notifications` `POST /read-all` `PATCH /:id/read` `DELETE /:id` |
| Player | `GET/PUT /api/player/state` (last track, volume, shuffle, repeat, queue) |

## Notes
- Deezer gives **30-second previews**, not full songs (licensing). The player bar shows the preview's length.
- Preview URLs expire, so `<audio>` points at `/api/stream/:id`, which fetches a fresh one each time.
- New-release notifications: a background job checks followed artists every `RELEASE_WATCH_INTERVAL_MIN` minutes.
- Deezer allows ~50 requests / 5 s per IP; responses are cached in memory (swap for Redis if you scale out).
