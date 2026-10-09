const { query } = require('../db');

async function notify(userId, { type, title, body = '', data = {} }) {
  await query(
    'INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [userId, type, title, body, JSON.stringify(data)]
  );
}

module.exports = { notify };
