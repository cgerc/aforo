import { pool } from '../db.js';

async function main() {
  const client = await pool.connect();
  try {
    console.log('Migrando: tabla publicidad (idempotente)...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS publicidad (
        id BIGSERIAL PRIMARY KEY,
        usuario_id BIGINT,
        titulo TEXT,
        imagen TEXT,
        enlace TEXT,
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    const r = await client.query(
      "SELECT to_regclass('public.publicidad') AS t, (SELECT count(*) FROM information_schema.columns WHERE table_name='publicidad') AS cols"
    );
    console.log('tabla publicidad:', r.rows[0].t || 'NO EXISTE', '| columnas:', r.rows[0].cols);
  } catch (e) {
    console.error('ERROR migración:', e.message || e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
