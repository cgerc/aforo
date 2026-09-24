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

export { rateLimit, consumirBucket, resetBucket };