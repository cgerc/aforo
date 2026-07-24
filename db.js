const { Pool } = require('pg');

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/aforo';
  return connectionString;
}

function isRemoteConnection(connectionString) {
  return /^(postgres(?:ql)?:\/\/)/.test(connectionString) && /db\.[^./]+\.supabase\.co|localhost/.test(connectionString) === false;
}

const pool = new Pool({
  connectionString: getConnectionString(),
  ssl: isRemoteConnection(getConnectionString())
    ? { rejectUnauthorized: false }
    : false
});

pool.on('error', (err) => {
  console.error('Error inesperado del pool de PostgreSQL', err);
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');

    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        apellido TEXT NOT NULL,
        empresa TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        telefono TEXT,
        password TEXT NOT NULL,
        verificado BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS eventos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        descripcion TEXT,
        fecha TEXT,
        categoria TEXT,
        comuna TEXT,
        direccion TEXT,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        imagen TEXT,
        tickets_vendidos INTEGER DEFAULT 0,
        tickets_max INTEGER DEFAULT 40,
        categorias JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS registros_pendientes (
        email TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        apellido TEXT NOT NULL,
        empresa TEXT NOT NULL,
        telefono TEXT,
        password TEXT NOT NULL,
        evento JSONB,
        codigo TEXT NOT NULL,
        expira BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Base de datos lista y tablas preparadas');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
