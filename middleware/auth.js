import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const jwtSecret = process.env.JWT_SECRET || 'supersecretlocal';

export function requireAuth(req, res, next) {
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
