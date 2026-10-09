// Persists the player (last track, volume, shuffle, repeat, queue) so it comes back after a refresh.
const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { asyncHandler, parse } = require('../middleware/errors');
const { TRACK_COLS } = require('../services/tracks');

const stateSchema = z.object({
  trackId: z.number().int().positive().nullable().optional(),
  volume: z.number().int().min(0).max(100),
  shuffle: z.boolean(),
  repeat: z.enum(['off', 'all', 'one']),
  queue: z.array(z.number().int().positive()).max(200),
});

router.get('/state', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT track_id, volume, shuffle, repeat_mode, queue FROM player_state WHERE user_id = $1',
    [req.user.id]
  );
  const s = rows[0];
  if (!s) return res.json({ state: null });

  const queueIds = Array.isArray(s.queue) ? s.queue : [];
  const ids = [...new Set([...queueIds, s.track_id].filter(Boolean))];
  const byId = new Map();
  if (ids.length) {
    const found = await query(`SELECT ${TRACK_COLS} FROM tracks t WHERE t.id = ANY($1::bigint[])`, [ids]);
    found.rows.forEach((t) => byId.set(t.id, t));
  }
  res.json({
    state: {
      volume: s.volume,
      shuffle: s.shuffle,
      repeat: s.repeat_mode,
      track: byId.get(s.track_id) || null,
      queue: queueIds.map((id) => byId.get(id)).filter(Boolean),
    },
  });
}));

router.put('/state', asyncHandler(async (req, res) => {
  const { trackId, volume, shuffle, repeat, queue } = parse(stateSchema, req.body);
  await query(
    `INSERT INTO player_state (user_id, track_id, volume, shuffle, repeat_mode, queue, updated_at)
     VALUES ($1, (SELECT id FROM tracks WHERE id = $2::bigint), $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET
       track_id = EXCLUDED.track_id, volume = EXCLUDED.volume, shuffle = EXCLUDED.shuffle,
       repeat_mode = EXCLUDED.repeat_mode, queue = EXCLUDED.queue, updated_at = now()`,
    [req.user.id, trackId ?? null, volume, shuffle, repeat, JSON.stringify(queue)]
  );
  res.status(204).end();
}));

module.exports = router;
