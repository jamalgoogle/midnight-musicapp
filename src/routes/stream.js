// GET /api/stream/:id -> 302 to a *fresh* Deezer preview URL.
// Deezer preview URLs are signed and expire, so we never store them; the <audio> tag points here instead.
const router = require('express').Router();
const { HttpError, asyncHandler, parseId } = require('../middleware/errors');
const deezer = require('../services/deezer');

router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const track = await deezer.request(`/track/${id}`, {}, 0);
  if (!track.preview) throw new HttpError(404, 'No audio preview available for this track');
  res.set('Cache-Control', 'no-store');
  res.redirect(302, track.preview);
}));

module.exports = router;
