// routes/auth.js
import express from 'express';
import { Resend } from 'resend';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, sanitizeText } from '../db.js';
import { rateLimit, consumirBucket, resetBucket } from '../middleware/rateLimit.js';

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET || '';
const verificationTTL = Number(process.env.VERIFICATION_TTL_MS) || 15 * 60 * 1000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rate limits básicos por IP (ventana en memoria, compartida entre rutas)
const limitLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const limitRegister = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const limitResend = rateLimit({ windowMs: 15 * 60 * 1000, max: 4 });
const limitVerify = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

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

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
    const evento = req.body.evento || {};

    if (!nombre || !apellido || !empresa || !email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para registrar el usuario.' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'El correo electrónico no es válido.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    // Limpiar pendientes expirados del mismo correo antes de re-registrar
    await pool.query('DELETE FROM registros_pendientes WHERE email = $1 AND expira < $2', [email, Date.now()]);

    const existingUser = await pool.query('SELECT email FROM usuarios WHERE email = $1', [email]);
    if (existingUser.rowCount > 0) {
      return res.status(409).json({ error: 'Ya existe un usuario registrado con ese correo.' });
    }

    const codigo = generateVerificationCode();
    const expira = Date.now() + verificationTTL;

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
      [email, nombre, apellido, empresa, telefono, password, JSON.stringify(evento), codigo, expira]
    );

    await sendVerificationEmail(email, codigo);

    return res.status(201).json({ message: 'Código de verificación enviado.', modo: 'resend' });
  } catch (error) {
    console.error('Error en /api/auth/register:', error);
    return res.status(500).json({ error: error.message || 'No se pudo enviar el código de verificación.' });
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
    const intentos = consumirBucket(`verify:${email}`, { windowMs: verificationTTL, max: 8 });
    if (!intentos.ok) {
      return res.status(429).json({ error: 'Demasiados intentos de verificación. Solicita un código nuevo.' });
    }

    const pending = await pool.query('SELECT * FROM registros_pendientes WHERE email = $1', [email]);
    if (pending.rowCount === 0) {
      return res.status(404).json({ error: 'No existe un registro pendiente para este correo.' });
    }

    const registro = pending.rows[0];
    if (registro.codigo !== codigo) {
      return res.status(400).json({ error: 'Código de verificación incorrecto.' });
    }

    if (Date.now() > Number(registro.expira)) {
      return res.status(400).json({ error: 'El código ha expirado. Solicita uno nuevo.' });
    }

    const hashedPassword = await bcrypt.hash(registro.password, 10);

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
            sanitizeText(evento.imagen || ''),
            JSON.stringify(evento.categorias || []),
          ]
        );
      }

      await client.query('DELETE FROM registros_pendientes WHERE email = $1', [email]);
      await client.query('COMMIT');

      resetBucket(`verify:${email}`);
      return res.json({ message: 'Correo verificado y usuario creado.' });
    } catch (innerError) {
      await client.query('ROLLBACK');
      throw innerError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error en /api/auth/verify-email:', error);
    return res.status(500).json({ error: error.message || 'No se pudo validar el correo.' });
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
      return res.status(404).json({ error: 'No existe un registro pendiente para este correo.' });
    }

    const codigo = generateVerificationCode();
    const expira = Date.now() + verificationTTL;

    await pool.query(
      'UPDATE registros_pendientes SET codigo = $1, expira = $2 WHERE email = $3',
      [codigo, expira, email]
    );

    await sendVerificationEmail(email, codigo);
    resetBucket(`verify:${email}`);

    return res.json({ message: 'Código de verificación reenviado.', modo: 'resend' });
  } catch (error) {
    console.error('Error en /api/auth/resend-code:', error);
    return res.status(500).json({ error: error.message || 'No se pudo reenviar el código.' });
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
    if (typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ error: 'La contraseña es requerida.' });
    }

    const userResult = await pool.query('SELECT id, nombre, apellido, empresa, email, telefono, password, verificado FROM usuarios WHERE email = $1', [email]);
    // [SEGURIDAD] Sin enumeración: mismo error para usuario inexistente y contraseña incorrecta.
    if (userResult.rowCount === 0) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    const user = userResult.rows[0];
    if (!user.verificado) {
      return res.status(403).json({ error: 'Debes verificar tu correo antes de ingresar.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '8h' });

    return res.json({
      token,
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
    return res.status(500).json({ error: error.message || 'No se pudo iniciar sesión.' });
  }
});

export default router;