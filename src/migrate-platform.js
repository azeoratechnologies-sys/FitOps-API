const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const password = encodeURIComponent(process.env.DB_PASSWORD || 'Pranaecpl@5');
  // Supabase direct connection URL on port 5432
  const connectionString = `postgresql://postgres:${password}@db.xxitykqhqarzioifdmkg.supabase.co:5432/postgres`;

  console.log('Connecting to Supabase PostgreSQL database...');
  const client = new Client({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected successfully!');

    console.log('Adding platform and app_version columns if they do not exist...');
    await client.query(`
      ALTER TABLE public.clients 
      ADD COLUMN IF NOT EXISTS platform TEXT,
      ADD COLUMN IF NOT EXISTS app_version TEXT;
    `);
    console.log('Columns added successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

run();
