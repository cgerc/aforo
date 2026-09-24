import 'dotenv/config';
import pkg from 'pg';
import dns from 'node:dns'; // <--- AGREGAR ESTA LÍNEA

dns.setDefaultResultOrder('ipv4first'); // <--- AGREGAR ESTA LÍNEA
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
        validador_token TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Migración segura: agregar validador_token si falta (tablas ya existentes)
    await client.query(`
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS validador_token TEXT;
    `);

    // Migración segura: profesional que imparte el taller
    await client.query(`
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS profesional_nombre TEXT;
    `);
    await client.query(`
      ALTER TABLE eventos ADD COLUMN IF NOT EXISTS profesional_imagen TEXT;
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

    // Migración: correo/nombre del comprador (obligatorio al inicio del pago)
    await client.query(`ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS email_comprador TEXT;`);
    await client.query(`ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS nombre_comprador TEXT;`);

    // Un QR (registro) por entrada: cada compra con cantidad>1 crea N filas aquí
    await client.query(`
      CREATE TABLE IF NOT EXISTS entradas (
        id BIGSERIAL PRIMARY KEY,
        ticket_uuid TEXT UNIQUE NOT NULL,
        order_id BIGINT REFERENCES ordenes(id) ON DELETE CASCADE,
        taller_id INTEGER,
        token TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'PAGADA',
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Migraciones seguras por si la tabla ya existe parcialmente
    await client.query(`ALTER TABLE entradas ADD COLUMN IF NOT EXISTS ticket_uuid TEXT;`);
    await client.query(`ALTER TABLE entradas ADD COLUMN IF NOT EXISTS order_id BIGINT;`);
    await client.query(`ALTER TABLE entradas ADD COLUMN IF NOT EXISTS taller_id INTEGER;`);
    await client.query(`ALTER TABLE entradas ADD COLUMN IF NOT EXISTS token TEXT;`);
    await client.query(`ALTER TABLE entradas ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PAGADA';`);
    await client.query(`ALTER TABLE entradas ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_entradas_order ON entradas(order_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_entradas_uuid ON entradas(ticket_uuid);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_entradas_token ON entradas(token);`);

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
async function createOrder({ user_id, taller_id, cantidad = 1, preference_id = null, email_comprador = null, nombre_comprador = null }) {
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
      `INSERT INTO ordenes (user_id, taller_id, cantidad, status, preference_id, email_comprador, nombre_comprador)
       VALUES ($1, $2, $3, 'PENDIENTE', $4, $5, $6) RETURNING *`,
      [user_id || null, validTallerId, Number(cantidad) || 1, preference_id, email_comprador || null, nombre_comprador || null]
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

// --- Entradas (un registro / QR por ticket de la compra) ---
async function createTickets({ order_id, taller_id, cantidad = 1, tokens = [] }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < cantidad; i++) {
      const item = tokens[i];
      if (!item || !item.ticket_uuid || !item.jwt) continue;
      await client.query(
        `INSERT INTO entradas (ticket_uuid, order_id, taller_id, token, status) VALUES ($1, $2, $3, $4, 'PAGADA')`,
        [item.ticket_uuid, Number(order_id), taller_id ? Number(taller_id) : null, item.jwt]
      );
    }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function getTicketsByOrder(orderId) {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM entradas WHERE order_id = $1 ORDER BY id ASC`, [Number(orderId)]);
    return res.rows;
  } finally {
    client.release();
  }
}

async function getTicketByToken(token) {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM entradas WHERE token = $1 LIMIT 1`, [token]);
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

async function getTicketByUuid(ticketUuid) {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM entradas WHERE ticket_uuid = $1 LIMIT 1`, [ticketUuid]);
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

async function countPendingTickets(orderId) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT COUNT(*)::int AS total FROM entradas WHERE order_id = $1 AND status = 'PAGADA'`,
      [Number(orderId)]
    );
    return res.rows[0] ? Number(res.rows[0].total) : 0;
  } finally {
    client.release();
  }
}

async function countTicketsByOrder(orderId) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT COUNT(*)::int AS total FROM entradas WHERE order_id = $1`,
      [Number(orderId)]
    );
    return res.rows[0] ? Number(res.rows[0].total) : 0;
  } finally {
    client.release();
  }
}

// Marca la entrada como USADA de forma atómica (evita doble escaneo).
// Devuelve used_at si esta llamada "ganó" la marca; null si ya estaba usada.
async function markTicketUsedAtomic(ticketUuid) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE entradas SET status = 'USADA', used_at = NOW() WHERE ticket_uuid = $1 AND status = 'PAGADA' RETURNING used_at`,
      [ticketUuid]
    );
    if (res.rowCount === 0) return null;
    return res.rows[0].used_at;
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
  deductSeats,
  createTickets,
  getTicketsByOrder,
  getTicketByToken,
  getTicketByUuid,
  countPendingTickets,
  countTicketsByOrder,
  markTicketUsedAtomic
};