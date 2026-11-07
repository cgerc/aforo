// routes/auth.js
import express from 'express';
import crypto from 'crypto';
import { Resend } from 'resend';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, sanitizeText } from '../db.js';
import {
  rateLimitCompartido as rateLimit,
  consumirBucketCompartido as consumirBucket,
  resetBucketCompartido as resetBucket
} from '../middleware/rateLimit.js';
import { validarImagen } from '../utils/validacion.js';
import { leerTokenSesion } from '../middleware/auth.js';

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET || '';
const verificationTTL = Number(process.env.VERIFICATION_TTL_MS) || 15 * 60 * 1000;
const resetTTL = 15 * 60 * 1000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Hash señuelo para igualar el tiempo de respuesta cuando el correo no existe.
const DUMMY_PASSWORD_HASH = '$2b$10$mkdWQYmQZlbupq7Gdc6LJO.FhGOiQQWJAZyhj6yZccuTdIbIbc0y.';

function igualesSeguro(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function hashResetCode(codigo) {
  return crypto.createHash('sha256').update(String(codigo)).digest('hex');
}

// Rate limits compartidos (Postgres con fallback a memoria).
const limitLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `login:${req.ip || 'x'}` });
const limitRegister = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyFn: (req) => `register:${req.ip || 'x'}` });
const limitResend = rateLimit({ windowMs: 15 * 60 * 1000, max: 4, keyFn: (req) => `resend:${req.ip || 'x'}` });
const limitVerify = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `verify-ip:${req.ip || 'x'}` });
const limitForgot = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyFn: (req) => `forgot:${req.ip || 'x'}` });

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendVerificationEmail(to, code) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('La API Key de Resend no está configurada. Revisa RESEND_API_KEY en el archivo .env.');
  }

  await resend.emails.send({
    from: 'Vive Ticket <contacto@viveticket.cl>',
    to,
    subject: 'Código de verificación Vive Ticket',
    html: `<p>Tu código de verificación es:</p><h2>${code}</h2><p>Ingresa este código en la pantalla de verificación para completar tu registro.</p>`,
  });
}

async function sendPasswordResetEmail(to, code) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('La API Key de Resend no está configurada.');
  }
  await resend.emails.send({
    from: 'Vive Ticket <contacto@viveticket.cl>',
    to,
    subject: 'Recuperar contraseña Vive Ticket',
    html: `<p>Tu código para restablecer la contraseña es:</p><h2>${code}</h2><p>Vence en 15 minutos. Si no lo solicitaste, ignora este correo.</p>`,
  });
}

function generateVerificationCode() {
  // [SEGURIDAD] M1: número aleatorio criptográficamente seguro (nunca Math.random).
  return String(crypto.randomInt(100000, 1000000));
}

router.post('/register', limitRegister, async (req, res) => {
  try {
    if (!jwtSecret) {
      return res.status(500).json({ error: 'JWT_SECRET no configurado en el servidor.' });
    }
    const nombre = sanitizeText(req.body.nombre);
    const apellido = sanitizeText(req.body.apellido);
    const empresa = sanitizeText(req.body.empresa);
    const email = sanitizeText(req.body.email).toLowerCase();
    const password = req.body.password;
    const telefono = sanitizeText(req.body.telefono);
    const evento = (req.body.evento && typeof req.body.evento === 'object' && !Array.isArray(req.body.evento))
      ? req.body.evento
      : {};

    if (!nombre || !apellido || !empresa || !email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para registrar el usuario.' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'El correo electrónico no es válido.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
    }

    const imagenEvento = validarImagen(evento.imagen);
    if (!imagenEvento.ok) {
      return res.status(400).json({ error: 'La imagen del evento no es una URL válida.' });
    }
    if (imagenEvento.value !== undefined) evento.imagen = imagenEvento.value;

    // Limpiar pendientes expirados del mismo correo antes de re-registrar
    await pool.query('DELETE FROM registros_pendientes WHERE email = $1 AND expira < $2', [email, Date.now()]);

    const existingUser = await pool.query('SELECT email FROM usuarios WHERE email = $1', [email]);
    if (existingUser.rowCount > 0) {
      return res.status(409).json({ error: 'No se pudo completar el registro. Si ya tienes cuenta, inicia sesión.' });
    }

    const codigo = generateVerificationCode();
    const expira = Date.now() + verificationTTL;

    // [SEGURIDAD] M2: nunca persistir el password en texto plano. Se guarda el
    // hash bcrypt y verify-email lo usa directamente al crear el usuario.
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO registros_pendientes (email, nombre, apellido, empresa, telefono, password, evento, codigo, expira)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (email)
       DO UPDATE SET nombre = EXCLUDED.nombre,
                     apellido = EXCLUDED.apellido,
                     empresa = EXCLUDED.empresa,
                     telefono = EXCLUDED.telefono,
                     password = EXCLUDED.password,
                     evento = EXCLUDED.evento,
                     codigo = EXCLUDED.codigo,
                     expira = EXCLUDED.expira,
                     created_at = NOW();`,
      [email, nombre, apellido, empresa, telefono, hashedPassword, JSON.stringify(evento), codigo, expira]
    );

    await sendVerificationEmail(email, codigo);

    return res.status(201).json({ message: 'Código de verificación enviado.', modo: 'resend' });
  } catch (error) {
    console.error('Error en /api/auth/register:', error);
    return res.status(500).json({ error: 'No se pudo completar el registro. Intenta nuevamente.' });
  }
});

router.post('/verify-email', limitVerify, async (req, res) => {
  try {
    const email = sanitizeText(req.body.email).toLowerCase();
    const codigo = sanitizeText(req.body.codigo);

    if (!email || !codigo) {
      return res.status(400).json({ error: 'Correo y código son requeridos.' });
    }

    // Límite de intentos por correo (anti fuerza bruta del código de 6 dígitos)
    const intentos = await consumirBucket(`verify:${email}`, { windowMs: verificationTTL, max: 8 });
    if (!intentos.ok) {
      return res.status(429).json({ error: 'Demasiados intentos de verificación. Solicita un código nuevo.' });
    }

    const pending = await pool.query('SELECT * FROM registros_pendientes WHERE email = $1', [email]);
    if (pending.rowCount === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    const registro = pending.rows[0];
    if (!igualesSeguro(registro.codigo, codigo)) {
      return res.status(400).json({ error: 'Código de verificación incorrecto.' });
    }

    if (Date.now() > Number(registro.expira)) {
      return res.status(400).json({ error: 'El código ha expirado. Solicita uno nuevo.' });
    }

    // [SEGURIDAD] M2: `password` ya está hasheado (se guardó el hash en register).
    const hashedPassword = registro.password;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertUser = await client.query(
        `INSERT INTO usuarios (nombre, apellido, empresa, email, telefono, password, verificado)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING id, nombre, apellido, empresa, email, telefono, verificado;`,
        [registro.nombre, registro.apellido, registro.empresa, registro.email, registro.telefono, hashedPassword]
      );

      const user = insertUser.rows[0];
      const evento = typeof registro.evento === 'string' ? JSON.parse(registro.evento) : (registro.evento || null);
      if (evento && evento.titulo) {
        const imagenEvento = validarImagen(evento.imagen);
        if (!imagenEvento.ok) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'La imagen del evento no es una URL válida.' });
        }
        await client.query(
          `INSERT INTO eventos (usuario_id, titulo, descripcion, fecha, categoria, direccion, lat, lng, imagen, categorias)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
          [
            user.id,
            sanitizeText(evento.titulo),
            sanitizeText(evento.mensaje || ''),
            sanitizeText(evento.fecha || ''),
            sanitizeText(evento.categoria || ''),
            sanitizeText(evento.lugar || ''),
            Number(evento.lat) || null,
            Number(evento.lng) || null,
            imagenEvento.value || null,
            JSON.stringify(evento.categorias || []),
          ]
        );
      }

      await client.query('DELETE FROM registros_pendientes WHERE email = $1', [email]);
      await client.query('COMMIT');

      await resetBucket(`verify:${email}`);
      return res.json({ message: 'Correo verificado y usuario creado.' });
    } catch (innerError) {
      await client.query('ROLLBACK');
      throw innerError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error en /api/auth/verify-email:', error);
    return res.status(500).json({ error: 'No se pudo validar el correo. Intenta nuevamente.' });
  }
});

router.post('/resend-code', limitResend, async (req, res) => {
  try {
    const email = sanitizeText(req.body.email).toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'El correo es requerido.' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'El correo electrónico no es válido.' });
    }

    const pending = await pool.query('SELECT * FROM registros_pendientes WHERE email = $1', [email]);
    if (pending.rowCount === 0) {
      return res.json({ message: 'Si existe un registro pendiente, enviamos un nuevo código.' });
    }

    const codigo = generateVerificationCode();
    const expira = Date.now() + verificationTTL;

    await pool.query(
      'UPDATE registros_pendientes SET codigo = $1, expira = $2 WHERE email = $3',
      [codigo, expira, email]
    );

    await sendVerificationEmail(email, codigo);
    await resetBucket(`verify:${email}`);

    return res.json({ message: 'Código de verificación reenviado.', modo: 'resend' });
  } catch (error) {
    console.error('Error en /api/auth/resend-code:', error);
    return res.status(500).json({ error: 'No se pudo reenviar el código. Intenta nuevamente.' });
  }
});

router.post('/login', limitLogin, async (req, res) => {
  try {
    if (!jwtSecret) {
      return res.status(500).json({ error: 'JWT_SECRET no configurado en el servidor.' });
    }
    const email = sanitizeText(req.body.email).toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'El correo electrónico no es válido.' });
    }
    if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
      return res.status(400).json({ error: 'La contraseña es requerida (máximo 128 caracteres).' });
    }

    const userResult = await pool.query('SELECT id, nombre, apellido, empresa, email, telefono, password, verificado FROM usuarios WHERE email = $1', [email]);
    // [SEGURIDAD] Sin enumeración: mismo error y tiempo similar para usuario
    // inexistente y contraseña incorrecta.
    if (userResult.rowCount === 0) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH).catch(() => {});
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    if (!user.verificado) {
      return res.status(403).json({ error: 'Debes verificar tu correo antes de ingresar.' });
    }

    // [SEGURIDAD] Sesión SOLO por cookie HttpOnly: el JWT nunca se expone a JS
    // (evita robo por XSS). Expiración corta + SameSite=Lax.
    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '4h' });

    res.cookie('org_session', token, {
      httpOnly: true,
      secure: !!req.secure || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 4 * 60 * 60 * 1000,
      path: '/'
    });

    return res.json({
      usuario: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        empresa: user.empresa,
        email: user.email,
        telefono: user.telefono,
      },
    });
  } catch (error) {
    console.error('Error en /api/auth/login:', error);
    return res.status(500).json({ error: 'No se pudo iniciar sesión. Intenta nuevamente.' });
  }
});

// [SEGURIDAD] Devuelve la sesión actual sin exponer el token.
router.get('/me', async (req, res) => {
  const token = leerTokenSesion(req);
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  try {
    const decoded = jwt.verify(token, jwtSecret);
    const r = await pool.query(
      'SELECT id, nombre, apellido, empresa, email, telefono FROM usuarios WHERE id = $1 LIMIT 1',
      [decoded.id]
    );
    if (r.rowCount === 0) return res.status(401).json({ error: 'Sesión inválida.' });
    return res.json({ usuario: r.rows[0] });
  } catch (_) {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
});

// [SEGURIDAD] Recuperación de contraseña por código de 6 dígitos.
router.post('/forgot-password', limitForgot, async (req, res) => {
  const email = sanitizeText(req.body.email).toLowerCase();
  const respuesta = { message: 'Si el correo está registrado, enviamos un código de recuperación.' };
  try {
    if (!email || !EMAIL_REGEX.test(email)) return res.json(respuesta);

    // Límite por correo además del límite por IP (evita spam a un mismo buzón).
    const intentosEmail = await consumirBucket(`forgot:${email}`, { windowMs: 60 * 60 * 1000, max: 3 });
    if (!intentosEmail.ok) return res.json(respuesta);

    const userResult = await pool.query('SELECT id FROM usuarios WHERE email = $1 AND verificado = TRUE', [email]);
    if (userResult.rowCount === 0) return res.json(respuesta);

    const codigo = generateVerificationCode();
    const usuarioId = userResult.rows[0].id;
    await pool.query('DELETE FROM password_resets WHERE usuario_id = $1', [usuarioId]);
    await pool.query(
      'INSERT INTO password_resets (token_hash, usuario_id, expira) VALUES ($1, $2, $3)',
      [hashResetCode(codigo), usuarioId, Date.now() + resetTTL]
    );
    await sendPasswordResetEmail(email, codigo);
    return res.json(respuesta);
  } catch (error) {
    console.error('Error en /api/auth/forgot-password:', error);
    return res.json(respuesta);
  }
});

router.post('/reset-password', limitForgot, async (req, res) => {
  try {
    const email = sanitizeText(req.body.email).toLowerCase();
    const codigo = sanitizeText(req.body.codigo);
    const password = req.body.password;

    if (!email || !EMAIL_REGEX.test(email) || !codigo) {
      return res.status(400).json({ error: 'Correo y código son requeridos.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
    }

    const intentos = await consumirBucket(`reset:${email}`, { windowMs: resetTTL, max: 8 });
    if (!intentos.ok) {
      return res.status(429).json({ error: 'Demasiados intentos. Solicita un nuevo código.' });
    }

    const userResult = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (userResult.rowCount === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    const usuarioId = userResult.rows[0].id;
    const reset = await pool.query(
      'SELECT token_hash, expira FROM password_resets WHERE usuario_id = $1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [usuarioId]
    );
    if (reset.rowCount === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    const fila = reset.rows[0];
    if (Date.now() > Number(fila.expira) || !igualesSeguro(fila.token_hash, hashResetCode(codigo))) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hashedPassword, usuarioId]);
    await pool.query('UPDATE password_resets SET used_at = NOW() WHERE token_hash = $1', [fila.token_hash]);
    await resetBucket(`reset:${email}`);

    return res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error en /api/auth/reset-password:', error);
    return res.status(500).json({ error: 'No se pudo restablecer la contraseña. Intenta nuevamente.' });
  }
});

// [SEGURIDAD] Limpia la cookie HttpOnly de sesión (el frontend además borra localStorage).
router.post('/logout', (req, res) => {
  res.clearCookie('org_session', {
    path: '/',
    httpOnly: true,
    secure: !!req.secure || process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  return res.json({ ok: true });
});

export default router;