-- MIDNIGHT music player schema. Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      VARCHAR(30)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx    ON users (lower(email));

-- Local cache of Deezer tracks so likes / playlists / history can reference them.
CREATE TABLE IF NOT EXISTS tracks (
  id           BIGINT PRIMARY KEY,           -- Deezer track id
  title        TEXT    NOT NULL,
  artist_id    BIGINT,
  artist_name  TEXT    NOT NULL DEFAULT '',
  album_id     BIGINT,
  album_title  TEXT    NOT NULL DEFAULT '',
  cover_small  TEXT,
  cover_medium TEXT,
  cover_big    TEXT,
  duration     INTEGER NOT NULL DEFAULT 0,   -- seconds (full track)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS liked_tracks (
  user_id  BIGINT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  track_id BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  liked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX IF NOT EXISTS liked_tracks_user_time_idx ON liked_tracks (user_id, liked_at DESC);
CREATE INDEX IF NOT EXISTS liked_tracks_track_idx     ON liked_tracks (track_id);

CREATE TABLE IF NOT EXISTS playlists (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS playlists_user_idx ON playlists (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id BIGINT  NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    BIGINT  NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX IF NOT EXISTS playlist_tracks_order_idx ON playlist_tracks (playlist_id, position);

CREATE TABLE IF NOT EXISTS play_history (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  track_id  BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS play_history_user_idx ON play_history (user_id, played_at DESC);

CREATE TABLE IF NOT EXISTS followed_artists (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id   BIGINT NOT NULL,                 -- Deezer artist id
  name        TEXT   NOT NULL,
  picture     TEXT,
  followed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS followed_artists_artist_idx ON followed_artists (artist_id);

CREATE TABLE IF NOT EXISTS saved_albums (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id    BIGINT NOT NULL,                 -- Deezer album id
  title       TEXT   NOT NULL,
  artist_name TEXT   NOT NULL DEFAULT '',
  cover       TEXT,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, album_id)
);

-- Remembers the newest album we've seen per followed artist (for new-release notifications).
CREATE TABLE IF NOT EXISTS artist_watch (
  artist_id     BIGINT PRIMARY KEY,
  last_album_id BIGINT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(30) NOT NULL,             -- welcome | new_release | ...
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

-- Persisted player: last track, volume, shuffle, repeat and queue.
CREATE TABLE IF NOT EXISTS player_state (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  track_id    BIGINT REFERENCES tracks(id) ON DELETE SET NULL,
  volume      SMALLINT    NOT NULL DEFAULT 80 CHECK (volume BETWEEN 0 AND 100),
  shuffle     BOOLEAN     NOT NULL DEFAULT false,
  repeat_mode VARCHAR(5)  NOT NULL DEFAULT 'off' CHECK (repeat_mode IN ('off','all','one')),
  queue       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Genre / mood tiles on the Search page. Each one is resolved to tracks through the
-- listed artists, so you can edit these rows to tune the Arabic catalogue.
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  slug       VARCHAR(40) UNIQUE NOT NULL,
  label      VARCHAR(60) NOT NULL,
  icon       VARCHAR(40) NOT NULL DEFAULT 'fa-music',   -- Font Awesome free-solid class
  gradient   VARCHAR(80) NOT NULL DEFAULT 'from-zinc-900 to-stone-900',  -- Tailwind classes
  artists    TEXT[] NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO categories (slug, label, icon, gradient, artists, sort_order) VALUES
 ('arabic-pop',      'Arabic Pop',        'fa-microphone-lines', 'from-rose-900/60 to-purple-900/40',  ARRAY['Amr Diab','Tamer Hosny','Nancy Ajram','Elissa','Hamaki'], 1),
 ('mahraganat-rap',  'Mahraganat & Rap',  'fa-fire',             'from-orange-950/60 to-rose-950/40',  ARRAY['Wegz','Hassan Shakosh','Marwan Pablo','Marwan Moussa','Mohamed Ramadan'], 2),
 ('tarab-classics',  'Tarab & Classics',  'fa-record-vinyl',     'from-amber-950/60 to-stone-900/40',  ARRAY['Umm Kulthum','Abdel Halim Hafez','Fairuz','Mohamed Abdel Wahab','Warda'], 3),
 ('khaleeji',        'Khaleeji',          'fa-sun',              'from-emerald-950/60 to-teal-900/40', ARRAY['Rashed Al Majed','Hussain Al Jassmi','Balqees','Kadim Al Sahir','Majid Al Mohandis'], 4),
 ('chill-acoustic',  'Chill & Acoustic',  'fa-cloud-moon',       'from-indigo-900/60 to-blue-900/40',  ARRAY['Cairokee','Hamza Namira','Mohamed Mounir','Sherine','Souad Massi'], 5),
 ('midnight-mood',   'Midnight Mood',     'fa-moon',             'from-zinc-900 to-stone-900',         ARRAY['Wael Kfoury','Fadel Shaker','Marwan Khoury','Assala','Elissa'], 6)
ON CONFLICT (slug) DO NOTHING;
