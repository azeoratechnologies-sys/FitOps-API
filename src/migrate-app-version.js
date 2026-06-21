const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const password = encodeURIComponent(process.env.DB_PASSWORD || 'Pranaecpl@5');
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

    console.log('Creating app_versions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.app_versions (
        id SERIAL PRIMARY KEY,
        platform TEXT UNIQUE NOT NULL,
        latest_version TEXT NOT NULL,
        last_version TEXT NOT NULL,
        is_mandatory BOOLEAN DEFAULT FALSE,
        download_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table created!');

    console.log('Seeding initial app versions for android and ios...');
    await client.query(`
      INSERT INTO public.app_versions (platform, latest_version, last_version, is_mandatory, download_url)
      VALUES 
        ('android', '1.0.0', '1.0.0', false, 'https://play.google.com/store/apps/details?id=com.fitsuite.fitops'),
        ('ios', '1.0.0', '1.0.0', false, 'https://apps.apple.com/app/fitops')
      ON CONFLICT (platform) DO NOTHING;
    `);
    console.log('Seed data inserted successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

run();
