import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { Resend } from 'resend';
import { initDb, pool, createOrder, getOrderById, getOrderByPreference, markOrderPaid, deductSeats, createTickets, getTicketsByOrder, getTicketByToken, getTicketByUuid, countPendingTickets, countTicketsByOrder, markTicketUsedAtomic } from './db.js';

// Importar middleware de autenticación
import { requireAuth } from './middleware/auth.js';

// Importar rutas de autenticación
import authRoutes from './routes/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Blindaje anti-crash: en Node >= 15 un unhandledRejection/uncaughtException mata
// el proceso y deja la web en blanco sin aviso. Aquí se registra y se sigue sirviendo.
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH-GUARD] unhandledRejection (el servidor sigue activo):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[CRASH-GUARD] uncaughtException (el servidor sigue activo):', err);
});

const app = express();
const port = Number(process.env.PORT) || 3000;

// 1. Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

if (!supabase) {
  console.warn('Supabase no está configurado. Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en tu .env');
}

// 2. Inicialización del SDK v2 de Mercado Pago
const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
let mpClient = null;

if (mpAccessToken) {
  mpClient = new MercadoPagoConfig({ accessToken: mpAccessToken });
} else {
  console.warn('Mercado Pago no está configurado. Define MERCADOPAGO_ACCESS_TOKEN en tu .env');
}
console.log('>>> [DEBUG] process.env.MERCADOPAGO_ACCESS_TOKEN:', process.env.MERCADOPAGO_ACCESS_TOKEN ? 'Existe' : 'No encontrado (undefined)');
console.log('>>> [DEBUG] mpClient inicializado:', Boolean(mpClient));

const resend = new Resend(process.env.RESEND_API_KEY);

const sanitizeText = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 200);
};

const baseUrl = process.env.CLIENT_URL || 'https://viveticket.cl';

// --- Helpers compartidos (entradas / QR por ticket) ---
function normalizarFecha(f) {
  if (!f) return '';
  const s = String(f).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

async function ordenLookup(id) {
  let order = null;
  if (supabase) {
    try {
      const { data } = await supabase.from('ordenes').select('*').eq('id', Number(id)).single();
      order = data;
    } catch (e) { order = null; }
  }
  if (!order) {
    try { order = await getOrderById(Number(id)); } catch (e) { order = null; }
  }
  return order;
}

async function eventoLookup(eventoId) {
  let evento = null;
  if (supabase) {
    try {
      const { data } = await supabase.from('eventos').select('*').eq('id', Number(eventoId)).maybeSingle();
      evento = data;
    } catch (e) { evento = null; }
  }
  if (!evento) {
    try {
      const r = await pool.query('SELECT * FROM eventos WHERE id = $1 LIMIT 1', [Number(eventoId)]);
      if (r.rowCount > 0) evento = r.rows[0];
    } catch (e) { evento = null; }
  }
  return evento;
}

async function obtenerFechaEvento(tallerId) {
  if (!tallerId) return null;
  const ev = await eventoLookup(tallerId);
  return ev ? ev.fecha : null;
}

async function hasOrderTickets(orderId) {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('entradas').select('id').eq('order_id', Number(orderId)).limit(1);
      if (!error && data && data.length > 0) return data.length;
    } catch (e) { /* seguir a pool */ }
  }
  try { return await countTicketsByOrder(orderId); } catch (e) { return 0; }
}

async function leerEntradasOrden(orderId) {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('entradas').select('*').eq('order_id', Number(orderId)).order('id', { ascending: true });
      if (!error && data && data.length > 0) return data;
    } catch (e) { /* seguir a pool */ }
  }
  try { return await getTicketsByOrder(orderId); } catch (e) { return []; }
}

async function buscarEntradaPorUuid(ticketUuid) {
  if (supabase) {
    try {
      const { data } = await supabase.from('entradas').select('*').eq('ticket_uuid', ticketUuid).maybeSingle();
      if (data) return data;
    } catch (e) { /* seguir a pool */ }
  }
  try { return await getTicketByUuid(ticketUuid); } catch (e) { return null; }
}

async function buscarEntradaPorToken(token) {
  if (supabase) {
    try {
      const { data } = await supabase.from('entradas').select('*').eq('token', token).maybeSingle();
      if (data) return data;
    } catch (e) { /* seguir a pool */ }
  }
  try { return await getTicketByToken(token); } catch (e) { return null; }
}

async function marcarUsadaTicket(ticketUuid) {
  let usedAt = null;
  try { usedAt = await markTicketUsedAtomic(ticketUuid); } catch (e) { console.warn('marcarUsadaTicket (pool):', e.message); }
  if (!usedAt && supabase) {
    try {
      const { data, error } = await supabase
        .from('entradas')
        .update({ status: 'USADA', used_at: new Date().toISOString() })
        .eq('ticket_uuid', ticketUuid)
        .eq('status', 'PAGADA')
        .select('used_at');
      if (!error && data && data.length > 0) usedAt = data[0].used_at;
    } catch (e) { console.warn('marcarUsadaTicket (supabase):', e.message); }
  }
  return usedAt;
}

async function contarRestantes(orderId) {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('entradas').select('id').eq('order_id', Number(orderId)).eq('status', 'PAGADA');
      if (!error && data) return data.length;
    } catch (e) { /* seguir a pool */ }
  }
  try { return await countPendingTickets(orderId); } catch (e) { return 0; }
}

async function resolverTituloEvento(order) {
  let titulo = sanitizeText(order?.titulo_evento) || sanitizeText(order?.tituloEvento) || sanitizeText(order?.taller_nombre) || sanitizeText(order?.titulo) || '';
  if (!titulo && order?.taller_id) {
    const ev = await eventoLookup(order.taller_id);
    if (ev && ev.titulo) titulo = ev.titulo;
  }
  return titulo;
}

// Middlewares globales
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// Servir favicon explícitamente para evitar 500 / 404
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'), (err) => {
    if (err) res.status(204).end();
  });
});

// RUTAS API
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', async (req, res) => {
  try {
    const health = {
      ok: true,
      port,
      time: new Date().toISOString(),
      supabase: !!supabase,
      mercadopago: !!mpClient,
    };

    if (supabase) {
      const { error } = await supabase.from('usuarios').select('id').limit(1);
      health.supabase = !error;
    }

    res.json(health);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Health check failed' });
  }
});

// INSCRIPCIÓN A TALLER - Enviar correo a contacto@viveticket.cl
app.post('/api/inscribir', async (req, res) => {
  try {
    const nombre = sanitizeText(req.body.nombre);
    const celular = sanitizeText(req.body.celular);
    const correo = sanitizeText(req.body.correo).toLowerCase();
    const eventoId = req.body.eventoId || null;
    const eventoNombre = sanitizeText(req.body.eventoNombre);

    if (!nombre || !celular || !correo) {
      return res.status(400).json({ error: 'Nombre, celular y correo son requeridos.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correo)) {
      return res.status(400).json({ error: 'El correo electrónico no es válido.' });
    }

    let tituloEvento = eventoNombre || 'Taller no especificado';
    if (eventoId && !eventoNombre && supabase) {
      try {
        const { data: ev } = await supabase.from('eventos').select('titulo').eq('id', Number(eventoId)).single();
        if (ev) tituloEvento = ev.titulo;
      } catch (_) {}
    }

    await resend.emails.send({
      from: 'Vive Ticket <contacto@viveticket.cl>',
      to: 'contacto@viveticket.cl',
      subject: `Nueva inscripción: ${tituloEvento}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #f9fafb; border-radius: 12px;">
          <h2 style="color: #10b981;">Nueva inscripción a un taller</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr>
              <td style="padding: 8px; font-weight: bold; color: #374151;">Taller:</td>
              <td style="padding: 8px; color: #111827;">${tituloEvento}</td>
            </tr>
            <tr style="background: #f3f4f6;">
              <td style="padding: 8px; font-weight: bold; color: #374151;">Nombre:</td>
              <td style="padding: 8px; color: #111827;">${nombre}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold; color: #374151;">Celular:</td>
              <td style="padding: 8px; color: #111827;">${celular}</td>
            </tr>
            <tr style="background: #f3f4f6;">
              <td style="padding: 8px; font-weight: bold; color: #374151;">Correo:</td>
              <td style="padding: 8px; color: #111827;">${correo}</td>
            </tr>
          </table>
          <p style="margin-top: 20px; font-size: 12px; color: #9ca3af;">Mensaje enviado desde Vive Ticket — ${new Date().toLocaleString('es-CL')}</p>
        </div>
      `
    });

    return res.json({ message: 'Inscripción enviada correctamente.' });
  } catch (error) {
    console.error('Error en /api/inscribir:', error);
    return res.status(500).json({ error: 'No se pudo procesar la inscripción.' });
  }
});

// OBTENER TODOS LOS EVENTOS
app.get('/api/eventos', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en tu .env' });
    }

    const { data, error } = await supabase
      .from('eventos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error al consultar eventos en Supabase:', error.message || error);
      return res.status(500).json({ error: 'No se pudieron cargar los eventos', details: error.message || 'unknown' });
    }

    const eventos = (data || []).map((evento) => ({
      ...evento,
      categorias: Array.isArray(evento.categorias) ? evento.categorias : [],
      fecha: evento.fecha || null,
      imagen: evento.imagen || null,
      titulo: evento.titulo || 'Sin título',
      descripcion: evento.descripcion || '',
      categoria: evento.categoria || 'General',
      comuna: evento.comuna || '',
      direccion: evento.direccion || '',
      lat: evento.lat ?? null,
      lng: evento.lng ?? null,
      profesional_nombre: evento.profesional_nombre || '',
      profesional_imagen: evento.profesional_imagen || null,
      validador_token: evento.validador_token || null
    }));

    return res.json(eventos);
  } catch (error) {
    console.error('Error interno al leer eventos:', error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// OBTENER EVENTOS DEL USUARIO AUTENTICADO
app.get('/api/eventos/mios', requireAuth, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }

    const { data, error } = await supabase
      .from('eventos')
      .select('*')
      .eq('usuario_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error al consultar eventos del usuario:', error.message || error);
      return res.status(500).json({ error: 'No se pudieron cargar tus eventos', details: error.message });
    }

    const eventos = (data || []).map((evento) => ({
      ...evento,
      categorias: Array.isArray(evento.categorias) ? evento.categorias : [],
      fecha: evento.fecha || null,
      imagen: evento.imagen || null,
      titulo: evento.titulo || 'Sin título',
      descripcion: evento.descripcion || '',
      categoria: evento.categoria || 'General',
      comuna: evento.comuna || '',
      direccion: evento.direccion || '',
      lat: evento.lat ?? null,
      lng: evento.lng ?? null,
      profesional_nombre: evento.profesional_nombre || '',
      profesional_imagen: evento.profesional_imagen || null,
      validador_token: evento.validador_token || null
    }));

    return res.json(eventos);
  } catch (error) {
    console.error('Error interno al leer eventos del usuario:', error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// CREAR UN NUEVO EVENTO
app.post('/api/eventos', requireAuth, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }

    const {
      titulo,
      descripcion,
      fecha,
      categoria,
      comuna,
      direccion,
      lat,
      lng,
      categorias,
      ticketsMax,
      imagen,
      profesionalNombre,
      profesionalImagen
    } = req.body;

    const newEvent = {
      usuario_id: req.user.id,
      titulo: sanitizeText(titulo),
      descripcion: sanitizeText(descripcion),
      fecha: fecha || null,
      categoria: sanitizeText(categoria),
      comuna: sanitizeText(comuna),
      direccion: sanitizeText(direccion),
      lat: Number(lat) || null,
      lng: Number(lng) || null,
      categorias: Array.isArray(categorias) ? categorias : [],
      tickets_max: Number(ticketsMax) || 40,
      imagen: imagen || null,
      profesional_nombre: sanitizeText(profesionalNombre) || null,
      profesional_imagen: profesionalImagen || null,
      validador_token: crypto.randomUUID()
    };

    const { data, error } = await supabase
      .from('eventos')
      .insert([newEvent])
      .select();

    if (error) {
      console.error('Error al crear evento en Supabase:', error.message || error);
      return res.status(500).json({ error: 'No se pudo crear el evento', details: error.message });
    }

    return res.status(201).json({ message: 'Evento creado exitosamente', evento: data[0] });
  } catch (error) {
    console.error('Error interno al crear evento:', error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// EDITAR UN EVENTO EXISTENTE
app.put('/api/eventos/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }

    const { id } = req.params;

    // Verificar que el evento pertenece al usuario autenticado
    const { data: existing, error: checkErr } = await supabase
      .from('eventos')
      .select('id, usuario_id')
      .eq('id', Number(id))
      .single();

    if (checkErr || !existing) {
      return res.status(404).json({ error: 'Evento no encontrado.' });
    }

    if (existing.usuario_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso para editar este evento.' });
    }

    const {
      titulo,
      descripcion,
      fecha,
      categoria,
      comuna,
      direccion,
      lat,
      lng,
      categorias,
      ticketsMax,
      imagen,
      profesionalNombre,
      profesionalImagen
    } = req.body;

    const updateData = {
      titulo: sanitizeText(titulo),
      descripcion: sanitizeText(descripcion),
      fecha: fecha || null,
      categoria: sanitizeText(categoria),
      comuna: sanitizeText(comuna),
      direccion: sanitizeText(direccion),
      lat: Number(lat) || null,
      lng: Number(lng) || null,
      categorias: Array.isArray(categorias) ? categorias : [],
      tickets_max: Number(ticketsMax) || 40,
      profesional_nombre: sanitizeText(profesionalNombre) ?? null,
      profesional_imagen: profesionalImagen ?? null
    };

    if (imagen) {
      updateData.imagen = imagen;
    }

    const { data, error } = await supabase
      .from('eventos')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) {
      console.error('Error al actualizar evento en Supabase:', error.message || error);
      return res.status(500).json({ error: 'No se pudo actualizar el evento', details: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'El evento no existe o no fue encontrado.' });
    }

    return res.json({ message: 'Evento actualizado exitosamente', evento: data[0] });
  } catch (error) {
    console.error('Error interno al editar evento:', error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ELIMINAR UN EVENTO EXISTENTE
app.delete('/api/eventos/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID de evento requerido.' });

    // Verificar que el evento pertenece al usuario autenticado
    if (supabase) {
      const { data: existing, error: checkErr } = await supabase
        .from('eventos')
        .select('id, usuario_id')
        .eq('id', Number(id))
        .single();

      if (checkErr || !existing) {
        return res.status(404).json({ error: 'Evento no encontrado.' });
      }

      if (existing.usuario_id !== req.user.id) {
        return res.status(403).json({ error: 'No tienes permiso para eliminar este evento.' });
      }
    }

    // 1. Eliminar en Supabase
    if (supabase) {
      await supabase.from('ordenes').delete().eq('taller_id', Number(id));

      const { error } = await supabase
        .from('eventos')
        .delete()
        .eq('id', Number(id));

      if (error) {
        console.error('Error eliminando evento en Supabase:', error.message);
        return res.status(500).json({ error: 'No se pudo eliminar el evento', details: error.message });
      }
    }

    // 2. Eliminar en BD local pool si aplica
    if (pool) {
      try {
        await pool.query('DELETE FROM ordenes WHERE taller_id = $1', [Number(id)]);
        await pool.query('DELETE FROM eventos WHERE id = $1', [Number(id)]);
      } catch (err) {
        console.warn('Advertencia borrando evento local:', err.message);
      }
    }

    return res.json({ ok: true, message: 'Evento eliminado exitosamente' });
  } catch (error) {
    console.error('Error interno al eliminar evento:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== PUBLICIDAD (carrusel de la portada) ====================
// GET publico: solo activas, la MAS RECIENTE primero (created_at desc)
// Si llega un Bearer token valido (organizador), filtra por su usuario_id (para "Mis publicidades")
app.get('/api/publicidad', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }

    let usuarioId = null;
    const authHeader = req.headers?.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'supersecretlocal');
        usuarioId = decoded?.id ?? null;
      } catch (_) { usuarioId = null; }
    }

    let query = supabase
      .from('publicidad')
      .select('*')
      .eq('activo', true)
      .order('created_at', { ascending: false });

    if (usuarioId) {
      query = query.eq('usuario_id', Number(usuarioId));
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error leyendo publicidad desde Supabase:', error.message || error);
      return res.status(500).json({ error: 'No se pudieron cargar las publicidades', details: error.message || 'unknown' });
    }

    const lista = (data || []).map((pub) => ({
      id: pub.id,
      titulo: pub.titulo || '',
      imagen: pub.imagen || '',
      enlace: pub.enlace || null,
      created_at: pub.created_at || null
    }));
    res.json(lista);
  } catch (err) {
    console.error('Error interno al listar publicidades:', err.message || err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST: crear publicidad (solo organizador autenticado)
app.post('/api/publicidad', requireAuth, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }
const { titulo, imagen, enlace } = req.body || {};
    if (!imagen) {
      return res.status(400).json({ error: 'La imagen es obligatoria.' });
    }

    const nuevo = {
      usuario_id: req.user.id,
      titulo: titulo ? sanitizeText(titulo) : 'Publicidad',
      imagen,
      enlace: enlace ? sanitizeText(enlace) : null
    };

    const { data, error } = await supabase
      .from('publicidad')
      .insert([nuevo])
      .select();

    if (error) {
      console.error('Error creando publicidad en Supabase:', error.message || error);
      return res.status(500).json({ error: 'No se pudo publicar la publicidad', details: error.message || 'unknown' });
    }

    res.status(201).json({ message: 'Publicidad publicada correctamente', publicidad: data[0] });
  } catch (err) {
    console.error('Error interno al crear publicidad:', err.message || err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE: desactivar publicidad (solo dueno)
app.delete('/api/publicidad/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }
    const { id } = req.params;
    const numId = Number(id);
    if (!numId) {
      return res.status(400).json({ error: 'ID de publicidad requerido.' });
    }

    const { data: existente, error: chkErr } = await supabase
      .from('publicidad')
      .select('id, usuario_id, activo')
      .eq('id', numId)
      .single();

    if (chkErr || !existente) {
      return res.status(404).json({ error: 'Publicidad no encontrada.' });
    }
    if (existente.usuario_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso para desactivar esta publicidad.' });
    }

    const { error: updErr } = await supabase
      .from('publicidad')
      .update({ activo: false })
      .eq('id', numId);

    if (updErr) {
      console.error('Error desactivando publicidad:', updErr.message || updErr);
      return res.status(500).json({ error: 'No se pudo desactivar la publicidad', details: updErr.message || 'unknown' });
    }

    res.json({ ok: true, message: 'Publicidad desactivada.' });
  } catch (err) {
    console.error('Error interno al desactivar publicidad:', err.message || err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// MERCADO PAGO - CREAR PREFERENCIA
app.post('/api/create-preference', async (req, res) => {
  if (!mpClient) {
    return res.status(503).json({ error: 'Mercado Pago no está configurado. Define MERCADOPAGO_ACCESS_TOKEN en .env' });
  }

  const { titulo, precioUnitario, cantidad, comprador, user_id } = req.body || {};
  const taller_id = Number(req.body?.taller_id || req.body?.evento_id || req.body?.tallerId || req.body?.id || NaN);
  const tallerIdValido = Number.isInteger(taller_id) && taller_id > 0;

  if (!titulo || !Number.isFinite(Number(precioUnitario)) || Number(precioUnitario) <= 0 || !Number.isFinite(Number(cantidad)) || Number(cantidad) <= 0) {
    return res.status(400).json({ error: 'Datos de pago inválidos. Asegúrate de enviar título, precio unitario y cantidad.' });
  }

  if (!tallerIdValido) {
    return res.status(400).json({ error: 'Falta el taller/evento vinculado a la compra (taller_id). No se puede generar una orden sin taller.' });
  }

  let eventoExiste = true;
  if (supabase) {
    const { error: errEvento } = await supabase.from('eventos').select('id').eq('id', taller_id).maybeSingle();
    if (errEvento) console.warn('No se pudo verificar el evento en Supabase:', errEvento.message);
    eventoExiste = !errEvento;
  }
  if (eventoExiste && pool) {
    try {
      const resEvento = await pool.query('SELECT id FROM eventos WHERE id = $1 LIMIT 1', [taller_id]);
      eventoExiste = resEvento.rowCount > 0;
    } catch (e) {
      console.warn('No se pudo verificar el evento en DB local pool:', e.message);
    }
  }
  if (!eventoExiste) {
    return res.status(404).json({ error: 'El taller/evento vinculado no existe. Verifica el evento seleccionado.' });
  }

  const nombreComprador = sanitizeText(comprador?.nombre);
  const emailComprador = sanitizeText(comprador?.email);
  const whatsappComprador = sanitizeText(comprador?.whatsapp);

  if (!nombreComprador || !emailComprador) {
    return res.status(400).json({ error: 'Faltan datos del comprador.' });
  }

  try {
    let order = null;
    try {
      order = await createOrder({ 
        user_id: user_id ? Number(user_id) : null, 
        taller_id: taller_id, 
        cantidad: Number(cantidad) || 1, 
        preference_id: null,
        email_comprador: emailComprador,
        nombre_comprador: nombreComprador
      });
    } catch (dbErr) {
      console.warn('Fallo al crear orden con helper local, usando Supabase:', dbErr.message);
    }

    if (!order && supabase) {
      const { data: ordenSupabase, error: errSupabase } = await supabase
        .from('ordenes')
        .insert([{
          user_id: user_id ? Number(user_id) : null,
          taller_id: taller_id,
          cantidad: Number(cantidad) || 1,
          status: 'PENDIENTE',
          email_comprador: emailComprador || null,
          nombre_comprador: nombreComprador || null
        }])
        .select()
        .single();

      if (errSupabase) throw errSupabase;
      order = ordenSupabase;
    }

    if (!order) {
      throw new Error('No se pudo inicializar la orden en la base de datos.');
    }

    const clientUrl = process.env.CLIENT_URL || `https://${req.get('host')}`;
    const webhookUrl = process.env.WEBHOOK_URL || null;

    const preference = new Preference(mpClient);
    const preferencePayload = {
      body: {
        items: [
          {
            title: sanitizeText(titulo) || 'Entrada',
            quantity: Number(cantidad),
            unit_price: Number(precioUnitario),
            currency_id: 'CLP',
          }
        ],
        payer: {
          name: nombreComprador,
          email: emailComprador,
          phone: { number: whatsappComprador || '' }
        },
        external_reference: String(order.id),
        back_urls: {
          success: `${clientUrl}/confirmacion.html?order_id=${order.id}`,
          failure: `${clientUrl}/checkout.html`,
          pending: `${clientUrl}/checkout.html`
        },
        auto_return: 'approved',
        metadata: {
          email_comprador: emailComprador || '',
          nombre_comprador: nombreComprador || '',
          taller_id: taller_id || ''
        }
      }
    };

    if (webhookUrl) {
      preferencePayload.body.notification_url = webhookUrl;
    }

    const preferenceResult = await preference.create(preferencePayload);

    try {
      if (pool) {
        await pool.query(
          `UPDATE ordenes SET preference_id = $1, taller_id = COALESCE(taller_id, $2) WHERE id = $3`, 
          [preferenceResult.id, taller_id ? Number(taller_id) : null, order.id]
        );
      }
    } catch (e) {
      console.warn('No se pudo actualizar DB local pool:', e.message);
    }

    if (supabase) {
      const { error: errUpdate } = await supabase
        .from('ordenes')
        .update({ 
          preference_id: preferenceResult.id,
          taller_id: taller_id || order.taller_id,
          email_comprador: emailComprador || order.email_comprador || '',
          nombre_comprador: nombreComprador || order.nombre_comprador || ''
        })
        .eq('id', order.id)
        .select('id, taller_id, status');

      if (errUpdate) {
        console.error('Error actualizando preferencia/taller en Supabase:', errUpdate.message);
      }
    }

    return res.status(200).json({ preference_id: preferenceResult.id, init_point: preferenceResult.init_point, order_id: order.id });
  } catch (error) {
    console.error('Error creando preferencia de Mercado Pago o guardando orden:', error);
    return res.status(500).json({ error: 'Error al crear la preferencia de pago' });
  }
});

// Crea la orden PAGADA y genera un QR (registro en `entradas`) por cada entrada de la compra.
// Es idempotente: si la orden ya tiene entradas, no las duplica.
async function processOrderPayment(orderId, tallerId, cantidad) {
  const tallerIdFinal = tallerId ? Number(tallerId) : null;

  if (!tallerIdFinal) {
    console.error(`⚠️ Orden #${orderId} pagada sin taller_id: su QR no podrá validarse por taller. Revisa el flujo de compra.`);
  }

  const qrSecret = process.env.QR_SECRET || process.env.JWT_SECRET || 'qr_secret_change_me';

  // 1. Idempotencia: si la orden ya generó sus entradas, no volver a crearlas
  let entradasExistentes = 0;
  try { entradasExistentes = await hasOrderTickets(orderId); } catch (_) {}

  // 2. Marcado atómico PENDIENTE -> PAGADA (solo "gana" el primero que llegue)
  let flipped = false;
  try {
    if (pool) {
      const r = await pool.query(
        `UPDATE ordenes SET status = 'PAGADA' WHERE id = $1 AND status = 'PENDIENTE' RETURNING id`,
        [Number(orderId)]
      );
      flipped = (r.rowCount || 0) > 0;
    }
  } catch (err) {
    console.warn('No se pudo marcar PAGADA en DB local pool:', err.message);
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .update({ status: 'PAGADA' })
        .eq('id', Number(orderId))
        .eq('status', 'PENDIENTE')
        .select('id');
      if (data && data.length > 0) flipped = true;
      if (error) console.warn('Error flipeando estado en Supabase:', error.message);
    } catch (err) {
      console.warn('Error marcando PAGADA en Supabase:', err.message);
    }
  }

  // 3. Generar UN QR por entrada (solo quien ganó el marcado PENDIENTE->PAGADA lo hace;
  //    así, aunque el webhook llegue dos veces, no se duplican entradas)
  if (flipped && entradasExistentes === 0) {
    const fechaTaller = await obtenerFechaEvento(tallerIdFinal);
    const tokens = [];
    for (let i = 0; i < (Number(cantidad) || 1); i++) {
      const ticketUuid = crypto.randomUUID();
      tokens.push({
        ticket_uuid: ticketUuid,
        jwt: jwt.sign(
          { ticket_id: ticketUuid, order_id: Number(orderId), taller_id: tallerIdFinal, fecha: fechaTaller },
          qrSecret
        )
      });
    }

    try {
      if (pool) await createTickets({ order_id: orderId, taller_id: tallerIdFinal, cantidad: tokens.length, tokens });
    } catch (err) {
      console.warn('No se pudieron crear entradas (pool):', err.message);
    }

    if (supabase) {
      try {
        const filas = tokens.map(t => ({
          ticket_uuid: t.ticket_uuid,
          order_id: Number(orderId),
          taller_id: tallerIdFinal,
          token: t.jwt,
          status: 'PAGADA'
        }));
        const { error } = await supabase.from('entradas').insert(filas).select('id');
        if (error) console.warn('No se pudieron crear entradas (Supabase):', error.message);
      } catch (err) {
        console.warn('Error creando entradas en Supabase:', err.message);
      }
    }
  }

  // 4. Descontar cupos solo si esta llamada ganó el marcado
  if (flipped && tallerIdFinal) {
    try {
      await deductSeats(tallerIdFinal, Number(cantidad) || 1);
    } catch (err) {
      console.warn('Error descontando cupos:', err.message);
    }
  }

  const tickets = await leerEntradasOrden(orderId);
  return { token: tickets && tickets.length > 0 ? tickets[0].token : null, tickets: tickets || [] };
}

async function enviarQRAlComprador({ orderId = null, tickets = [], token = null, email, nombreComprador, tituloEvento }) {
  const destino = typeof email === 'string' && /\S+@\S+\.\S+/.test(email.trim()) ? email.trim() : null;
  if (!destino) {
    console.warn('⚠️ No se pudo enviar QR por correo: falta email del comprador (registrado con el pago).');
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('❌ No se envió el correo: falta RESEND_API_KEY en .env');
    return;
  }
  if (!Array.isArray(tickets) || tickets.length === 0) {
    if (!token) {
      console.warn('⚠️ No hay QR/entradas para enviar (order_id=' + orderId + ').');
      return;
    }
    tickets = [{ token, ticket_uuid: null }];
  }

  let qrArchivo = null;
  const adjuntos = [];
  const qrInline = [];
  try {
    const dirEnvios = path.join(__dirname, 'envios');
    fs.mkdirSync(dirEnvios, { recursive: true });

    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      if (!t || !t.token) continue;
      const png = await QRCode.toBuffer(t.token, { type: 'png', width: 512, margin: 2 });
      const b64 = png.toString('base64');
      const num = i + 1;

      adjuntos.push({
        filename: `entrada-${num}.png`,
        content: png,
        contentType: 'image/png'
      });
      qrInline.push(`
        <div style="display:inline-block;margin:10px;text-align:center;">
          <p style="font-weight:bold;color:#374151;margin-bottom:6px;">Entrada ${num}</p>
          <img src="data:image/png;base64,${b64}" alt="Entrada ${num}" style="width:170px;height:170px;border:2px solid #e5e7eb;border-radius:12px;background:#fff;"/>
          <br/>
          <a href="${baseUrl}/ticket.html?ticket=${encodeURIComponent(t.token)}" style="font-size:12px;color:#059669;text-decoration:underline;">Ver / descargar esta entrada</a>
        </div>
      `);

      if (i === 0) {
        qrArchivo = path.join(dirEnvios, `entrada-qr-${orderId || 'sin-id'}-${Date.now()}.png`);
        await QRCode.toFile(qrArchivo, t.token, { type: 'png', width: 512, margin: 2 });
        console.log('💾 Copia del QR guardada en:', qrArchivo);
      }
    }
  } catch (err) {
    console.warn('No se pudieron generar los QR adjuntos:', err.message);
  }

  if (adjuntos.length === 0) {
    console.warn('⚠️ No se generó ningún QR para enviar (order_id=' + orderId + ').');
    return;
  }

  // Registro de auditoría
  try {
    if (pool) {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS envios_qr (
          id BIGSERIAL PRIMARY KEY,
          order_id BIGINT,
          qr_token TEXT,
          qr_archivo TEXT,
          email_to TEXT,
          titulo_evento TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )`
      );
      await pool.query(
        `INSERT INTO envios_qr (order_id, qr_token, qr_archivo, email_to, titulo_evento) VALUES ($1, $2, $3, $4, $5)`,
        [orderId ? Number(orderId) : null, tickets[0].token, qrArchivo, destino, tituloEvento || null]
      );
      console.log('🗄️ Referencia del envío registrada en envios_qr (order_id=' + orderId + ', email=' + destino + ')');
    }
    if (supabase && qrArchivo) {
      const { error } = await supabase.from('ordenes').update({ qr_archivo: qrArchivo }).eq('id', Number(orderId));
      if (error && !/column .*qr_archivo.* does not exist/i.test(error.message)) {
        console.warn('No se pudo actualizar qr_archivo en Supabase:', error.message);
      }
    }
  } catch (err) {
    console.warn('No se pudo registrar referencia del envío en BD:', err.message);
  }

  const plural = tickets.length === 1 ? 'tu entrada' : `tus ${tickets.length} entradas`;
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; background: #f9fafb; border-radius: 12px;">
      <h2 style="color: #10b981;">¡Pago confirmado!</h2>
      <p style="color: #374151;">Hola ${sanitizeText(nombreComprador) || ''}, aquí ${plural === 'tu entrada' ? 'está tu entrada' : 'están tus entradas'} con código QR.</p>
      <p style="margin-top: 16px;">Cada QR va <strong>adjunto</strong> a este correo y también lo puedes abrir aquí debajo. Muéstralo en la entrada del taller para canjear tu cupo (cada QR se consume de forma individual).</p>
      <div style="margin-top: 16px; text-align: center;">${qrInline.join('')}</div>
      <p style="margin-top: 20px; font-size: 12px; color: #9ca3af;">Vive Ticket — ${new Date().toLocaleString('es-CL')}</p>
    </div>
  `;

  const intentarEnvio = () => resend.emails.send({
    from: 'Vive Ticket <contacto@viveticket.cl>',
    to: destino,
    subject: `🎟️ Tu entrada - ${sanitizeText(tituloEvento) || 'Taller Vive Ticket'}`,
    html,
    attachments: adjuntos
  });

  try {
    await intentarEnvio();
    console.log(`📨 QR(s) enviado(s) a ${destino} (order_id=` + orderId + ')');
  } catch (e) {
    console.error('Error enviando correo con QR al comprador:', e.message);
    // Un reintento inmediato antes de rendirse
    try {
      await intentarEnvio();
      console.log(`📨 QR(s) enviado(s) en reintento a ${destino} (order_id=` + orderId + ')');
    } catch (e2) {
      console.error('❌ Reintento de envío de QR fallido:', e2.message);
    }
  }
}

// Endpoint de respaldo para confirmar el pago desde confirmacion.html
app.post('/api/orders/confirm-payment', async (req, res) => {
  try {
    const { order_id, email, nombre_comprador } = req.body || {};
    if (!order_id) return res.status(400).json({ error: 'Falta order_id' });

    let order = null;
    if (supabase) {
      const { data } = await supabase.from('ordenes').select('*').eq('id', Number(order_id)).single();
      order = data;
    }

    if (!order && pool) {
      order = await getOrderById(Number(order_id));
    }

    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    if (order.status === 'PAGADA') {
      const tickets = await leerEntradasOrden(order.id);
      return res.json({
        ok: true,
        message: 'La orden ya estaba registrada como PAGADA',
        qr_token: (tickets && tickets[0]) ? tickets[0].token : (order.qr_token || null),
        entradas: tickets || []
      });
    }

    const resultado = await processOrderPayment(order.id, order.taller_id, order.cantidad);
    const emailEnvio = sanitizeText(order?.email_comprador) || sanitizeText(email) || sanitizeText(order?.email) || '';
    if (emailEnvio) {
      await enviarQRAlComprador({
        orderId: order.id,
        tickets: resultado.tickets,
        token: resultado.token,
        email: emailEnvio,
        nombreComprador: sanitizeText(order?.nombre_comprador) || sanitizeText(nombre_comprador) || sanitizeText(order?.nombre) || '',
        tituloEvento: await resolverTituloEvento(order)
      });
    }
    return res.json({ ok: true, qr_token: resultado.token, entradas: resultado.tickets });
  } catch (err) {
    console.error('Error confirmando pago desde frontend:', err);
    return res.status(500).json({ error: 'Error interno procesando la confirmación' });
  }
});

// Webhook de Mercado Pago
app.post('/api/webhook/mercadopago', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    if (!mpClient) {
      return res.status(503).json({ ok: false, error: 'Mercado Pago no está configurado.' });
    }

    let body;
    try { body = JSON.parse(req.body.toString()); } catch (e) { body = req.body; }

    const paymentId = body?.data?.id || body?.id || req.query?.id || req.query?.['data.id'] || null;

    if (!paymentId) {
      return res.status(400).json({ ok: false, error: 'No se encontró id de pago en la notificación' });
    }

    const paymentInstance = new Payment(mpClient);
    const payment = await paymentInstance.get({ id: paymentId });
    const status = (payment?.status || payment?.collection?.status || '').toString().toLowerCase();

    const externalRef = (payment?.external_reference) || (payment?.order?.external_reference) || (payment?.collection?.external_reference) || (payment?.preference_id) || (payment?.collection?.preference_id) || null;

    let order = null;
    if (externalRef && /^\d+$/.test(String(externalRef))) {
      if (supabase) {
        const { data } = await supabase.from('ordenes').select('*').eq('id', Number(externalRef)).single();
        order = data;
      }
      if (!order && pool) {
        order = await getOrderById(Number(externalRef));
      }
    }

    if (!order) {
      const prefId = (payment?.preference_id) || (payment?.collection?.preference_id) || null;
      if (prefId) {
        if (supabase) {
          const { data } = await supabase.from('ordenes').select('*').eq('preference_id', prefId).single();
          order = data;
        }
        if (!order && pool) {
          order = await getOrderByPreference(prefId);
        }
      }
    }

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    }

    if (status === 'approved') {
      if (order.status === 'PAGADA') {
        return res.status(200).json({ ok: true, message: 'Orden ya registrada como PAGADA' });
      }

      const resultado = await processOrderPayment(order.id, order.taller_id, order.cantidad);
      const emailCompradorPago = sanitizeText(order?.email_comprador)
        || sanitizeText((payment?.metadata?.email_comprador) || (payment?.payer?.email) || '');
      const nombreCompradorPago = sanitizeText(order?.nombre_comprador)
        || sanitizeText((payment?.metadata?.nombre_comprador) || (payment?.payer?.first_name) || '');
      const tituloEventoWebhook = sanitizeText((payment?.metadata?.titulo_evento) || '') || await resolverTituloEvento(order);
      await enviarQRAlComprador({
        orderId: order.id,
        tickets: resultado.tickets,
        token: resultado.token,
        email: emailCompradorPago || '',
        nombreComprador: nombreCompradorPago,
        tituloEvento: tituloEventoWebhook
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, status });
  } catch (err) {
    console.error('Error en webhook mercadopago:', err);
    return res.status(500).json({ ok: false, error: err.message || err });
  }
});

// Obtener QR/token de la orden (multi-entrada; conserva compat con qr_data_url único)
app.get('/api/orders/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await ordenLookup(Number(id));

    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (order.status !== 'PAGADA') return res.status(403).json({ error: 'Orden no está pagada' });

    const tickets = await leerEntradasOrden(Number(id));
    const entradas = [];
    for (const t of tickets) {
      entradas.push({
        ticket_uuid: t.ticket_uuid,
        token: t.token,
        qr_data_url: await QRCode.toDataURL(t.token),
        status: t.status,
        used_at: t.used_at
      });
    }

    if (entradas.length === 0 && order.qr_token) {
      const qrDataUrl = await QRCode.toDataURL(order.qr_token);
      return res.json({ qr_token: order.qr_token, qr_data_url: qrDataUrl, entradas: [] });
    }
    if (entradas.length === 0) return res.status(404).json({ error: 'QR no disponible' });

    return res.json({
      qr_token: entradas[0].token,
      qr_data_url: entradas[0].qr_data_url,
      entradas
    });
  } catch (err) {
    console.error('Error obteniendo QR:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// Listar todas las entradas (QR) de una orden pagada
app.get('/api/orders/:id/entradas', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await ordenLookup(Number(id));
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (order.status !== 'PAGADA') return res.status(403).json({ error: 'Orden no está pagada' });

    const tickets = await leerEntradasOrden(Number(id));
    const entradas = [];
    for (const t of tickets) {
      entradas.push({
        ticket_uuid: t.ticket_uuid,
        token: t.token,
        qr_data_url: await QRCode.toDataURL(t.token),
        status: t.status,
        used_at: t.used_at
      });
    }

    if (entradas.length === 0 && order.qr_token) {
      entradas.push({
        ticket_uuid: null,
        token: order.qr_token,
        qr_data_url: await QRCode.toDataURL(order.qr_token),
        status: order.status,
        used_at: null
      });
    }

    return res.json({ ok: true, order_id: Number(id), cantidad: Number(order.cantidad) || 1, entradas });
  } catch (err) {
    console.error('Error listando entradas:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// Página pública de una entrada individual (usada por ticket.html desde el correo)
app.get('/api/entradas/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Falta el token de la entrada' });

    const ticket = await buscarEntradaPorToken(token);
    // Retrocompatibilidad: si el QR es un token legacy de la orden completa
    if (!ticket) {
      const decoded = (() => { try { return jwt.verify(token, qrSecret); } catch { return null; } })();
      if (decoded && decoded.order_id) {
        const order = await ordenLookup(decoded.order_id);
        if (order && (order.qr_token === token || (decoded.ticket_id == null))) {
          const evento = order.taller_id ? await eventoLookup(order.taller_id) : null;
          const qrDataUrl = await QRCode.toDataURL(token);
          return res.json({
            ok: true,
            ticket: { order_id: order.id, status: order.status, used_at: null, taller_id: order.taller_id, ticket_uuid: `order_${order.id}` },
            evento,
            qr_data_url: qrDataUrl
          });
        }
      }
      return res.status(404).json({ error: 'Entrada no encontrada' });
    }

    let evento = null;
    if (ticket.taller_id) {
      evento = await eventoLookup(ticket.taller_id);
    }

    const qrDataUrl = await QRCode.toDataURL(token);
    return res.json({
      ok: true,
      ticket: {
        ticket_uuid: ticket.ticket_uuid,
        token: ticket.token,
        status: ticket.status,
        used_at: ticket.used_at,
        order_id: ticket.order_id,
        taller_id: ticket.taller_id
      },
      evento,
      qr_data_url: qrDataUrl
    });
  } catch (err) {
    console.error('Error obteniendo entrada:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// Reenviar correo con el/los QR al comprador (panel del comprador)
app.post('/api/orders/:id/re-enviar-qr', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, nombre_comprador } = req.body || {};
    const order = await ordenLookup(Number(id));

    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (order.status !== 'PAGADA') return res.status(403).json({ error: 'La orden no está pagada' });

    const tickets = await leerEntradasOrden(Number(id));
    if (tickets.length === 0 && !order.qr_token) {
      return res.status(404).json({ error: 'No hay QR disponible para esta orden' });
    }

    const emailEnvio = sanitizeText(order?.email_comprador) || sanitizeText(email) || sanitizeText(order?.email) || '';
    if (!emailEnvio) {
      return res.status(400).json({ error: 'Falta el correo del comprador para reenviar el QR.' });
    }

    await enviarQRAlComprador({
      orderId: order.id,
      tickets,
      token: tickets[0] ? tickets[0].token : order.qr_token,
      email: emailEnvio,
      nombreComprador: sanitizeText(order?.nombre_comprador) || sanitizeText(nombre_comprador) || sanitizeText(order?.nombre) || '',
      tituloEvento: await resolverTituloEvento(order)
    });
    return res.json({ ok: true, message: 'QR reenviado por correo.' });
  } catch (err) {
    console.error('Error reenviando QR:', err);
    return res.status(500).json({ error: 'Error interno reenviando el QR' });
  }
});

// OBTENER INFORMACIÓN DEL EVENTO PARA VALIDADOR.HTML
app.get('/api/validador/info/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    let evento = null;
    const esUUID = String(token).includes('-');

    if (supabase) {
      const query = supabase.from('eventos').select('id, titulo, fecha, comuna');
      const { data } = esUUID 
        ? await query.eq('validador_token', token).single()
        : await query.eq('id', Number(token)).single();
      evento = data;
    }

    if (!evento && pool) {
      const sql = esUUID 
        ? 'SELECT id, titulo, fecha, comuna FROM eventos WHERE validador_token = $1'
        : 'SELECT id, titulo, fecha, comuna FROM eventos WHERE id = $1';
      const result = await pool.query(sql, [token]);
      if (result.rowCount > 0) evento = result.rows[0];
    }

    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado o token inválido' });
    }

    return res.json({ ok: true, evento });
  } catch (error) {
    console.error('Error obteniendo info del validador:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// VALIDAR CÓDIGO QR ESCANEADO DESDE VALIDADOR.HTML
app.post('/api/validador/scan', async (req, res) => {
  try {
    const { qr_token, organizador_token, taller_id_actual } = req.body;
    const tokenRecibido = organizador_token || taller_id_actual;

    if (!qr_token || !tokenRecibido) {
      return res.status(400).json({ valid: false, message: 'Faltan datos para validar.' });
    }

    const qrSecret = process.env.QR_SECRET || process.env.JWT_SECRET || 'qr_secret_change_me';

    // 1. Desencriptar el token JWT del QR
    let decoded;
    try {
      decoded = jwt.verify(qr_token, qrSecret);
    } catch (err) {
      return res.status(401).json({ valid: false, message: 'Código QR inválido o falsificado.' });
    }

    // 2. Resolver el ID del evento según si recibimos un UUID seguro o un ID numérico
    let eventoIdAutorizado = null;
    const esUUID = String(tokenRecibido).includes('-');

    if (esUUID) {
      if (supabase) {
        const { data: eventoData } = await supabase
          .from('eventos')
          .select('id, titulo')
          .eq('validador_token', tokenRecibido)
          .single();
        if (eventoData) eventoIdAutorizado = eventoData.id;
      }
      if (!eventoIdAutorizado && pool) {
        const result = await pool.query('SELECT id, titulo FROM eventos WHERE validador_token = $1', [tokenRecibido]);
        if (result.rowCount > 0) eventoIdAutorizado = result.rows[0].id;
      }
    } else {
      eventoIdAutorizado = Number(tokenRecibido);
    }

    if (!eventoIdAutorizado) {
      return res.status(403).json({ valid: false, message: 'Enlace de validador no autorizado o caducado.' });
    }

    // 3. Verificar que el QR pertenezca al taller correspondiente
    if (String(decoded.taller_id) !== String(eventoIdAutorizado)) {
      return res.status(403).json({ valid: false, message: 'Este QR pertenece a otro taller/evento.' });
    }

    // FLUJO NUEVO POR ENTRADA: cada QR representa UNA entrada de la compra (se consume individual)
    if (decoded.ticket_id) {
      const ticket = await buscarEntradaPorUuid(decoded.ticket_id);
      if (!ticket) {
        return res.status(404).json({ valid: false, message: 'Entrada no encontrada en la base de datos.' });
      }

      // Control de fecha: la entrada debe corresponder a la fecha del taller/evento
      if (decoded.fecha) {
        const evAutorizado = await eventoLookup(eventoIdAutorizado);
        const fechaValidador = evAutorizado ? normalizarFecha(evAutorizado.fecha) : '';
        const fechaTicket = normalizarFecha(decoded.fecha);
        if (fechaValidador && fechaTicket && fechaValidador !== fechaTicket) {
          return res.status(403).json({ valid: false, message: 'Esta entrada no corresponde a la fecha de este taller/evento.' });
        }
      }

      // Estado de uso de ESTA entrada (el resto de la compra no se afecta)
      if (ticket.status === 'USADA') {
        const cuando = ticket.used_at ? ` (${new Date(ticket.used_at).toLocaleString('es-CL')})` : '';
        return res.status(409).json({ valid: false, message: '¡ALERTA! Esta entrada ya fue escaneada y utilizada.' + cuando });
      }
      if (ticket.status !== 'PAGADA') {
        return res.status(400).json({ valid: false, message: `La entrada tiene estado: ${ticket.status}. No autorizada.` });
      }

      // Marcado individual atómico: solo "gana" un escaneo; el resto permanece PAGADA
      const usedAt = await marcarUsadaTicket(ticket.ticket_uuid);
      if (!usedAt) {
        return res.status(409).json({ valid: false, message: '¡ALERTA! Esta entrada ya fue escaneada y utilizada.' });
      }

      const restantes = await contarRestantes(ticket.order_id);
      const msgRestantes = restantes > 0
        ? `Entrada válida. Quedan ${restantes} entrada(s) de esta compra.`
        : 'Entrada válida. ¡Acceso permitido!';
      return res.json({ valid: true, message: msgRestantes, order_id: ticket.order_id, ticket_id: ticket.ticket_uuid });
    }

    // FLUJO LEGACY: QR antiguo referenciaba a la orden completa (retrocompatibilidad)
    let order = null;
    if (supabase) {
      const { data } = await supabase.from('ordenes').select('*').eq('id', decoded.order_id).single();
      order = data;
    }

    if (!order && pool) {
      order = await getOrderById(decoded.order_id);
    }

    if (!order) {
      return res.status(404).json({ valid: false, message: 'Orden no encontrada en la base de datos.' });
    }

    if (order.status === 'USADA') {
      return res.status(409).json({ valid: false, message: '¡ALERTA! Esta entrada ya fue escaneada y utilizada.' });
    }

    if (order.status !== 'PAGADA') {
      return res.status(400).json({ valid: false, message: `La entrada tiene estado: ${order.status}. No autorizada.` });
    }

    if (supabase) {
      await supabase.from('ordenes').update({ status: 'USADA' }).eq('id', order.id);
    }
    try {
      if (pool) await pool.query(`UPDATE ordenes SET status = 'USADA' WHERE id = $1`, [order.id]);
    } catch (e) {
      console.warn('No se pudo actualizar DB local pool:', e.message);
    }

    return res.json({ valid: true, message: 'Entrada Válida. ¡Acceso permitido!', order_id: order.id });

  } catch (error) {
    console.error('Error validando QR:', error);
    return res.status(500).json({ valid: false, message: 'Error interno del servidor.' });
  }
});

// Manejo centralizado de rutas 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

initDb()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`Servidor corriendo en http://localhost:${port}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Puerto ${port} ocupado. Usa PORT=... para cambiar el puerto.`);
        process.exit(1);
      }

      console.error('Error al iniciar el servidor:', error.message || error);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('No se pudo inicializar la base de datos local (usando Supabase por defecto):', err.message || err);
  });
