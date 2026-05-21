const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

module.exports = pool;
