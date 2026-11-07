// Ventana deslizante en memoria por clave (IP, email, order, ...).
// Suficiente para un solo proceso; no requiere deps externas.

const buckets = new Map();

function limpiar() {
  const now = Date.now();
  for (const [key, rec] of buckets) {
    if (now >= rec.resetAt) buckets.delete(key);
  }
}
const timer = setInterval(limpiar, 60000);
timer.unref && timer.unref();

function rateLimit({ windowMs = 60 * 1000, max = 60, keyFn } = {}) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    let rec = buckets.get(key);
    if (!rec || now >= rec.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    rec.count += 1;
    if (rec.count > max) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.' });
    }
    next();
  };
}

// Para checks programáticos dentro de un handler (p. ej. intentos de código)
function consumirBucket(key, { windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const now = Date.now();
  let rec = buckets.get(key);
  if (!rec || now >= rec.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, count: 1 };
  }
  rec.count += 1;
  if (rec.count > max) {
    return { ok: false, count: rec.count, resetAt: rec.resetAt };
  }
  return { ok: true, count: rec.count };
}

function resetBucket(key) {
  buckets.delete(key);
}

// --- Rate limiting compartido (Postgres) con fallback a memoria ---
// En Vercel cada invocación es un proceso distinto; el Map en memoria no
// comparte estado. Si hay pool disponible, se usa una fila por clave.

async function consumirDb(key, windowMs, max) {
  try {
    const { pool } = await import('../db.js');
    const now = Date.now();
    const resetAt = now + windowMs;
    const r = await pool.query(
      `INSERT INTO rate_limits (key, count, reset_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= $3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= $3 THEN $2 ELSE rate_limits.reset_at END
       RETURNING count, reset_at`,
      [key, resetAt, now]
    );
    const row = r.rows[0];
    if (!row) return null;
    const count = Number(row.count);
    return { ok: count <= max, count, resetAt: Number(row.reset_at) };
  } catch (_) {
    return null;
  }
}

function rateLimitCompartido({ windowMs = 60 * 1000, max = 60, keyFn } = {}) {
  const fallback = rateLimit({ windowMs, max, keyFn });
  return async (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || req.socket?.remoteAddress || 'unknown');
    const r = await consumirDb(key, windowMs, max);
    if (r) {
      if (!r.ok) {
        const retry = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retry));
        return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.' });
      }
      return next();
    }
    return fallback(req, res, next);
  };
}

async function consumirBucketCompartido(key, { windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const r = await consumirDb(key, windowMs, max);
  return r || consumirBucket(key, { windowMs, max });
}

async function resetBucketCompartido(key) {
  resetBucket(key);
  try {
    const { pool } = await import('../db.js');
    await pool.query('DELETE FROM rate_limits WHERE key = $1', [key]);
  } catch (_) {
    // Sin DB disponible: queda limpio el fallback en memoria.
  }
}

export {
  rateLimit,
  consumirBucket,
  resetBucket,
  rateLimitCompartido,
  consumirBucketCompartido,
  resetBucketCompartido
};