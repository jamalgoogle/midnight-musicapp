const { Pool, types } = require('pg');
const config = require('./config');

// Deezer ids and COUNT(*) come back as int8 (string by default). They fit safely in a JS number.
types.setTypeParser(20, (v) => Number(v));

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => console.error('Unexpected PostgreSQL error:', err.message));

module.exports = { pool, query: (text, params) => pool.query(text, params) };
