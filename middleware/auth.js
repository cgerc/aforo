import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const jwtSecret = process.env.JWT_SECRET || '';

// [SEGURIDAD] Cookie HttpOnly de sesión de organizador (paralela al JSON token,
// sin romper la compatibilidad con login.html/localStorage).
export function leerCookie(req, nombre) {
  const raw = req.headers?.cookie || '';
  for (const parte of raw.split(';')) {
    const idx = parte.indexOf('=');
    if (idx === -1) continue;
    const key = parte.slice(0, idx).trim();
    const val = parte.slice(idx + 1).trim();
    if (key === nombre) return decodeURIComponent(val);
  }
  return '';
}

export function requireAuth(req, res, next) {
  if (!jwtSecret) {
    return res.status(500).json({ error: 'JWT_SECRET no configurado en el servidor.' });
  }

  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
  const cookieToken = leerCookie(req, 'org_session');
  const token = headerToken || cookieToken;
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = { id: decoded.id, email: decoded.email };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Token expirado. Inicia sesión nuevamente.' });
    }
    return res.status(403).json({ error: 'Token inválido.' });
  }
}

export async function usuarioEsDuenoDeEvento(userId, tallerId) {
  if (!userId || !tallerId) return false;
  try {
    const res = await pool.query('SELECT usuario_id FROM eventos WHERE id = $1 LIMIT 1', [Number(tallerId)]);
    if (res.rowCount === 0) return false;
    return String(res.rows[0].usuario_id) === String(userId);
  } catch (e) {
    return false;
  }
}