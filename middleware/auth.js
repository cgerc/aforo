import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const jwtSecret = process.env.JWT_SECRET || '';

export function requireAuth(req, res, next) {
  if (!jwtSecret) {
    return res.status(500).json({ error: 'JWT_SECRET no configurado en el servidor.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido.' });
  }

  const token = authHeader.split(' ')[1];
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