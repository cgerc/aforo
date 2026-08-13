import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

function getConnectionString() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!url) {
    console.warn('⚠️ No se detectó DATABASE_URL ni SUPABASE_DATABASE_URL en las variables de entorno. Usando localhost.');
    return 'postgresql://postgres:postgres@127.0.0.1:5432/aforo';
  }
  return url;
}

function isRemoteConnection(connectionString) {
  // Activa SSL siempre que la conexión NO sea hacia localhost o 127.0.0.1 (ej. Supabase)
  return !/localhost|127\.0\.0\.1/.test(connectionString);
}

const connectionString = getConnectionString();

const pool = new Pool({
  connectionString,
  ssl: isRemoteConnection(connectionString)
    ? { rejectUnauthorized: false }
    : false,
  max: 10,                      // Límite máximo de conexiones simultáneas en la piscina
  idleTimeoutMillis: 30000,     // Cierra conexiones inactivas después de 30 segundos
  connectionTimeoutMillis: 2000 // Tiempo máximo para esperar una conexión libre antes de dar timeout
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS ordenes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        taller_id INTEGER REFERENCES eventos(id) ON DELETE SET NULL,
        cantidad INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'PENDIENTE',
        preference_id TEXT,
        qr_token TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ Base de datos lista y tablas preparadas');
  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err);
    throw err;
  } finally {
    client.release();
  }
}

function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 255);
}

// --- Funciones para ordenar y actualizar estados ---
async function createOrder({ user_id, taller_id, cantidad = 1, preference_id = null }) {
  const client = await pool.connect();
  try {
    let validTallerId = null;

    // Verificar si el taller_id existe antes de insertarlo como clave foránea
    if (taller_id) {
      const checkTaller = await client.query(`SELECT id FROM eventos WHERE id = $1 LIMIT 1`, [taller_id]);
      if (checkTaller.rows.length > 0) {
        validTallerId = taller_id;
      }
    }

    const res = await client.query(
      `INSERT INTO ordenes (user_id, taller_id, cantidad, status, preference_id) VALUES ($1, $2, $3, 'PENDIENTE', $4) RETURNING *`,
      [user_id || null, validTallerId, Number(cantidad) || 1, preference_id]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
}

async function getOrderById(id) {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM ordenes WHERE id = $1 LIMIT 1`, [id]);
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

async function getOrderByPreference(preferenceId) {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM ordenes WHERE preference_id = $1 LIMIT 1`, [preferenceId]);
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

async function markOrderPaid(orderId, qrToken) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE ordenes SET status = 'PAGADA', qr_token = $1 WHERE id = $2 RETURNING *`,
      [qrToken, orderId]
    );
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

// Descontar cupos del taller (incrementar tickets_vendidos si hay cupos)
async function deductSeats(tallerId, cantidad) {
  if (!tallerId) return { ok: true, message: 'Sin taller asociado' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sel = await client.query(`SELECT tickets_vendidos, tickets_max FROM eventos WHERE id = $1 FOR UPDATE`, [tallerId]);
    
    if (sel.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Taller no encontrado' };
    }
    
    const { tickets_vendidos = 0, tickets_max = 0 } = sel.rows[0];
    const available = Number(tickets_max) - Number(tickets_vendidos);
    
    if (available < cantidad) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'No hay cupos suficientes', available };
    }
    
    const upd = await client.query(
      `UPDATE eventos SET tickets_vendidos = tickets_vendidos + $1 WHERE id = $2 RETURNING tickets_vendidos, tickets_max`,
      [cantidad, tallerId]
    );
    
    await client.query('COMMIT');
    return { ok: true, data: upd.rows[0] };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error durante el rollback:', rollbackErr);
    }
    return { ok: false, error: err.message || err };
  } finally {
    client.release();
  }
}

export {
  pool,
  initDb,
  sanitizeText,
  createOrder,
  getOrderById,
  getOrderByPreference,
  markOrderPaid,
  deductSeats
};