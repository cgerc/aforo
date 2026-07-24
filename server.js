require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { pool, initDb } = require('./db');
const app = express();

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const SMTP_USER = process.env.SMTP_USER || 'homefree.cl@gmail.com';
const SMTP_PASS = (process.env.SMTP_PASS || '').replace(/\s/g, '');

const transporteCorreo = SMTP_PASS
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    })
  : null;

// Configuración para permitir imágenes y archivos de hasta 50MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

function crearToken(usuario) {
  return jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '8h' });
}

function autenticar(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : '';

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Tu sesión no es válida o ha expirado.' });
  }
}

async function enviarCodigoVerificacion(email, codigo) {
  if (!transporteCorreo) {
    console.log(`[VERIFICACIÓN LOCAL] Código para ${email}: ${codigo}`);
    return { enviado: false, modo: 'local' };
  }

  await transporteCorreo.sendMail({
    from: process.env.SMTP_FROM || SMTP_USER,
    to: email,
    subject: 'Código de verificación de Vive Ticket',
    text: `Tu código de verificación es ${codigo}. Expira en 15 minutos.`
  });
  return { enviado: true, modo: 'smtp' };
}

async function insertarEventoBase(evento) {
  const result = await pool.query(
    `INSERT INTO eventos (usuario_id, titulo, descripcion, fecha, categoria, comuna, direccion, lat, lng, imagen, tickets_vendidos, tickets_max, categorias)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      evento.usuario_id || null,
      evento.titulo,
      evento.descripcion,
      evento.fecha,
      evento.categoria,
      evento.comuna,
      evento.direccion,
      evento.lat,
      evento.lng,
      evento.imagen,
      evento.ticketsVendidos || 0,
      evento.ticketsMax || 40,
      JSON.stringify(evento.categorias || [])
    ]
  );
  return result.rows[0];
}

async function obtenerEventosBase() {
  const result = await pool.query('SELECT * FROM eventos ORDER BY id ASC');
  return result.rows.map(evento => ({
    ...evento,
    ticketsVendidos: evento.tickets_vendidos,
    ticketsMax: evento.tickets_max,
    categorias: evento.categorias || []
  }));
}

async function actualizarEventoBase(id, cambios) {
  const result = await pool.query(
    `UPDATE eventos
     SET titulo = COALESCE($1, titulo), descripcion = COALESCE($2, descripcion), fecha = COALESCE($3, fecha), categoria = COALESCE($4, categoria), comuna = COALESCE($5, comuna), direccion = COALESCE($6, direccion), lat = COALESCE($7, lat), lng = COALESCE($8, lng), imagen = COALESCE($9, imagen), tickets_max = COALESCE($10, tickets_max), categorias = COALESCE($11, categorias)
     WHERE id = $12
     RETURNING *`,
    [
      cambios.titulo,
      cambios.descripcion,
      cambios.fecha,
      cambios.categoria,
      cambios.comuna,
      cambios.direccion,
      cambios.lat,
      cambios.lng,
      cambios.imagen,
      cambios.ticketsMax,
      cambios.categorias ? JSON.stringify(cambios.categorias) : null,
      id
    ]
  );
  return result.rows[0];
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { nombre, apellido, empresa, email, password, telefono, evento } = req.body;
    const emailNormalizado = String(email || '').trim().toLowerCase();

    if (!nombre || !apellido || !empresa || !emailNormalizado || !password) {
      return res.status(400).json({ error: 'Completa todos los datos obligatorios.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    const existe = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [emailNormalizado]);
    if (existe.rowCount > 0) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    }

    const codigo = String(crypto.randomInt(100000, 1000000));
    const passwordHash = await bcrypt.hash(password, 10);
    const registro = {
      nombre,
      apellido,
      empresa,
      email: emailNormalizado,
      telefono: telefono || '',
      password: passwordHash,
      evento,
      codigo: await bcrypt.hash(codigo, 10),
      expira: Date.now() + (15 * 60 * 1000)
    };

    await pool.query(
      `INSERT INTO registros_pendientes (email, nombre, apellido, empresa, telefono, password, evento, codigo, expira)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, apellido = EXCLUDED.apellido, empresa = EXCLUDED.empresa, telefono = EXCLUDED.telefono, password = EXCLUDED.password, evento = EXCLUDED.evento, codigo = EXCLUDED.codigo, expira = EXCLUDED.expira`,
      [emailNormalizado, registro.nombre, registro.apellido, registro.empresa, registro.telefono, registro.password, JSON.stringify(registro.evento || null), registro.codigo, registro.expira]
    );

    const entrega = await enviarCodigoVerificacion(emailNormalizado, codigo);

    res.status(202).json({
      mensaje: entrega.enviado
        ? 'Te enviamos un código de verificación.'
        : 'Modo local: revisa la consola del servidor para ver el código.',
      modo: entrega.modo
    });
  } catch (error) {
    console.error('[REGISTRO]', error.message);
    if (error.code === 'EAUTH') {
      return res.status(502).json({ error: 'Gmail rechazó la autenticación. Revisa la contraseña de aplicación y vuelve a intentarlo.' });
    }
    res.status(500).json({ error: 'No fue posible enviar el código de verificación.' });
  }
});

app.post('/api/auth/verify-email', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const codigo = String(req.body.codigo || '').trim();
  const pendienteResult = await pool.query('SELECT * FROM registros_pendientes WHERE email = $1', [email]);
  const registro = pendienteResult.rows[0];

  if (!registro || Number(registro.expira) < Date.now()) {
    await pool.query('DELETE FROM registros_pendientes WHERE email = $1', [email]);
    return res.status(400).json({ error: 'El código expiró. Registra la cuenta nuevamente.' });
  }
  if (!/^\d{6}$/.test(codigo) || !(await bcrypt.compare(codigo, registro.codigo))) {
    return res.status(400).json({ error: 'El código de verificación es incorrecto.' });
  }

  const usuarioResult = await pool.query(
    `INSERT INTO usuarios (nombre, apellido, empresa, email, telefono, password, verificado)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id, nombre, apellido, empresa, email, telefono, password, verificado`,
    [registro.nombre, registro.apellido, registro.empresa, registro.email, registro.telefono, registro.password]
  );
  const usuario = usuarioResult.rows[0];
  await pool.query('DELETE FROM registros_pendientes WHERE email = $1', [email]);

  if (registro.evento && registro.evento.titulo) {
    await insertarEventoBase({
      usuario_id: usuario.id,
      titulo: registro.evento.titulo,
      descripcion: registro.evento.mensaje || 'Sin descripción',
      fecha: registro.evento.fecha && registro.evento.hora ? `${registro.evento.fecha}T${registro.evento.hora}` : registro.evento.fecha || '2026-07-31T20:00',
      categoria: registro.evento.categoria || 'Salud mental',
      comuna: 'providencia',
      direccion: registro.evento.lugar || '',
      lat: -33.435,
      lng: -70.620,
      imagen: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800',
      ticketsVendidos: 0,
      ticketsMax: 40,
      categorias: [{ nombre: 'General', precio: 15000, cupos: 40 }]
    });
  }

  res.status(201).json({ mensaje: 'Correo verificado. Ya puedes iniciar sesión.' });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const pendienteResult = await pool.query('SELECT 1 FROM registros_pendientes WHERE email = $1', [email]);
  if (pendienteResult.rowCount > 0) {
    return res.status(403).json({ error: 'Debes verificar tu correo antes de entrar al portal.' });
  }

  const usuarioResult = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  const usuario = usuarioResult.rows[0];

  if (!usuario) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }
  if (!usuario.verificado) {
    return res.status(403).json({ error: 'Debes verificar tu correo antes de entrar al portal.' });
  }
  if (!(await bcrypt.compare(password, usuario.password))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }

  res.json({
    token: crearToken(usuario),
    usuario: { nombre: usuario.nombre, apellido: usuario.apellido, empresa: usuario.empresa, email: usuario.email }
  });
});

// Obtener todos los eventos
app.get('/api/eventos', async (req, res) => {
  try {
    const eventos = await obtenerEventosBase();
    res.json(eventos);
  } catch (error) {
    console.error('[EVENTOS]', error.message);
    res.status(500).json({ error: 'No fue posible cargar los eventos.' });
  }
});

// Crear nuevo evento
app.post('/api/eventos', autenticar, async (req, res) => {
  try {
    const { titulo, descripcion, fecha, categoria, comuna, direccion, lat, lng, imagen, categorias, ticketsMax } = req.body;

    const nuevoEvento = await insertarEventoBase({
      usuario_id: req.usuario.id,
      titulo: titulo || "Sin título",
      descripcion: descripcion || "Sin descripción",
      fecha: fecha || "2026-07-31T20:00",
      categoria: categoria || "Salud mental",
      comuna: comuna || "providencia",
      direccion: direccion || "",
      lat: parseFloat(lat) || -33.435,
      lng: parseFloat(lng) || -70.620,
      imagen: imagen || 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800',
      ticketsVendidos: 0,
      ticketsMax: parseInt(ticketsMax) || 40,
      categorias: categorias || []
    });

    console.log(`[EVENTO CREADO] "${nuevoEvento.titulo}" | Fecha: ${nuevoEvento.fecha}`);
    res.status(201).json({ mensaje: "Evento creado exitosamente", evento: {
      ...nuevoEvento,
      ticketsVendidos: nuevoEvento.tickets_vendidos,
      ticketsMax: nuevoEvento.tickets_max,
      categorias: nuevoEvento.categorias || []
    }});
  } catch (error) {
    console.error('[CREAR EVENTO]', error.message);
    res.status(500).json({ error: "Error interno al crear el evento." });
  }
});

// Editar/Actualizar evento existente
app.put('/api/eventos/:id', autenticar, async (req, res) => {
  try {
    const eventoId = parseInt(req.params.id);
    const existente = await pool.query('SELECT id FROM eventos WHERE id = $1', [eventoId]);

    if (existente.rowCount === 0) {
      return res.status(404).json({ error: "Evento no encontrado." });
    }

    const { titulo, descripcion, fecha, categoria, comuna, direccion, lat, lng, imagen, categorias, ticketsMax } = req.body;

    const eventoActualizado = await actualizarEventoBase(eventoId, {
      titulo,
      descripcion,
      fecha,
      categoria,
      comuna,
      direccion,
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      imagen,
      categorias,
      ticketsMax: ticketsMax ? parseInt(ticketsMax) : undefined
    });

    console.log(`[EVENTO ACTUALIZADO] ID: ${eventoId} | Nueva Fecha: ${eventoActualizado.fecha}`);
    res.json({ mensaje: "Evento actualizado correctamente", evento: {
      ...eventoActualizado,
      ticketsVendidos: eventoActualizado.tickets_vendidos,
      ticketsMax: eventoActualizado.tickets_max,
      categorias: eventoActualizado.categorias || []
    }});
  } catch (error) {
    console.error('[ACTUALIZAR EVENTO]', error.message);
    res.status(500).json({ error: "Error interno al actualizar el evento." });
  }
});

async function iniciarServidor() {
  await initDb();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`));
}

iniciarServidor();