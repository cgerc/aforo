import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { initDb, pool, createOrder, getOrderById, getOrderByPreference, markOrderPaid, deductSeats } from './db.js';

// Importar rutas de autenticación
import authRoutes from './routes/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

const sanitizeText = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 200);
};

// Middlewares globales
app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
    }));

    return res.json(eventos);
  } catch (error) {
    console.error('Error interno al leer eventos:', error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// CREAR UN NUEVO EVENTO
app.post('/api/eventos', async (req, res) => {
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
      imagen
    } = req.body;

    const newEvent = {
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
      imagen: imagen || null
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
app.put('/api/eventos/:id', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }

    const { id } = req.params;
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
      imagen
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
      tickets_max: Number(ticketsMax) || 40
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

// MERCADO PAGO - CREAR PREFERENCIA
app.post('/api/create-preference', async (req, res) => {
  if (!mpClient) {
    return res.status(503).json({ error: 'Mercado Pago no está configurado. Define MERCADOPAGO_ACCESS_TOKEN en .env' });
  }

  const { titulo, precioUnitario, cantidad, comprador, user_id, taller_id } = req.body || {};

  if (!titulo || !Number.isFinite(Number(precioUnitario)) || Number(precioUnitario) <= 0 || !Number.isFinite(Number(cantidad)) || Number(cantidad) <= 0) {
    return res.status(400).json({ error: 'Datos de pago inválidos. Asegúrate de enviar título, precio unitario y cantidad.' });
  }

  const nombreComprador = sanitizeText(comprador?.nombre);
  const emailComprador = sanitizeText(comprador?.email);
  const whatsappComprador = sanitizeText(comprador?.whatsapp);

  if (!nombreComprador || !emailComprador) {
    return res.status(400).json({ error: 'Faltan datos del comprador.' });
  }

  try {
    // 1) Crear orden PENDIENTE en BD
    const order = await createOrder({ user_id: user_id || null, taller_id: taller_id || null, cantidad: Number(cantidad) || 1, preference_id: null });

    // Configurar URL del webhook dinámicamente si existe en .env
    const webhookUrl = process.env.WEBHOOK_URL || null;

    // 2) Crear preferencia en Mercado Pago usando SDK v2
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
          success: `http://127.0.0.1:${port}/confirmacion.html?order_id=${order.id}`,
          failure: `http://127.0.0.1:${port}/checkout.html`,
          pending: `http://127.0.0.1:${port}/checkout.html`
        }
      }
    };

    if (webhookUrl) {
      preferencePayload.body.notification_url = webhookUrl;
    }

    const preferenceResult = await preference.create(preferencePayload);

    // 3) Guardar preference_id en la orden local y en Supabase si aplica
    await pool.query(`UPDATE ordenes SET preference_id = $1 WHERE id = $2`, [preferenceResult.id, order.id]);

    if (supabase) {
      await supabase.from('ordenes').update({ preference_id: preferenceResult.id }).eq('id', order.id);
    }

    return res.status(200).json({ preference_id: preferenceResult.id, init_point: preferenceResult.init_point, order_id: order.id });
  } catch (error) {
    console.error('Error creando preferencia de Mercado Pago o guardando orden:', error);
    return res.status(500).json({ error: 'Error al crear la preferencia de pago' });
  }
});

// Función auxiliar para marcar la orden pagada y generar el QR sin expiración
async function processOrderPayment(orderId, tallerId, cantidad) {
  const qrSecret = process.env.QR_SECRET || process.env.JWT_SECRET || 'qr_secret_change_me';
  
  // Generar qr_token (JWT sin expiración por fecha)
  const token = jwt.sign({ order_id: orderId, taller_id: tallerId }, qrSecret);

  // Marcar orden como PAGADA en la base de datos
  await markOrderPaid(orderId, token);

  // Marcar orden como PAGADA en Supabase
  if (supabase) {
    await supabase.from('ordenes').update({ status: 'PAGADA', qr_token: token }).eq('id', orderId);
  }

  // Descontar cupos según cantidad
  await deductSeats(tallerId, Number(cantidad) || 1);

  return token;
}

// Endpoint de respaldo para confirmar el pago desde confirmacion.html
app.post('/api/orders/confirm-payment', async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ error: 'Falta order_id' });

    const order = await getOrderById(Number(order_id));
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    if (order.status === 'PAGADA') {
      return res.json({ ok: true, message: 'La orden ya estaba registrada como PAGADA', qr_token: order.qr_token });
    }

    const token = await processOrderPayment(order.id, order.taller_id, order.cantidad);
    return res.json({ ok: true, qr_token: token });
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

    // Intentar extraer id de pago desde body o query
    let body;
    try { body = JSON.parse(req.body.toString()); } catch (e) { body = req.body; }

    const paymentId = body?.data?.id || body?.id || req.query?.id || req.query?.['data.id'] || null;

    if (!paymentId) {
      return res.status(400).json({ ok: false, error: 'No se encontró id de pago en la notificación' });
    }

    const paymentInstance = new Payment(mpClient);
    const payment = await paymentInstance.get({ id: paymentId });
    const status = (payment?.status || payment?.collection?.status || '').toString().toLowerCase();

    // Tratar de resolver la orden: buscar external_reference o preference_id
    const externalRef = (payment?.external_reference) || (payment?.order?.external_reference) || (payment?.collection?.external_reference) || (payment?.preference_id) || (payment?.collection?.preference_id) || null;

    let order = null;
    if (externalRef && /^\d+$/.test(String(externalRef))) {
      order = await getOrderById(Number(externalRef));
    }

    if (!order) {
      const prefId = (payment?.preference_id) || (payment?.collection?.preference_id) || null;
      if (prefId) {
        order = await getOrderByPreference(prefId);
      }
    }

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    }

    if (status === 'approved') {
      if (order.status === 'PAGADA') {
        return res.status(200).json({ ok: true, message: 'Orden ya registrada como PAGADA' });
      }

      await processOrderPayment(order.id, order.taller_id, order.cantidad);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, status });
  } catch (err) {
    console.error('Error en webhook mercadopago:', err);
    return res.status(500).json({ ok: false, error: err.message || err });
  }
});

// Obtener QR/token de la orden
app.get('/api/orders/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await getOrderById(Number(id));
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (order.status !== 'PAGADA') return res.status(403).json({ error: 'Orden no está pagada' });

    const qrToken = order.qr_token;
    if (!qrToken) return res.status(404).json({ error: 'QR no disponible' });

    const qrDataUrl = await QRCode.toDataURL(qrToken);
    return res.json({ qr_token: qrToken, qr_data_url: qrDataUrl });
  } catch (err) {
    console.error('Error obteniendo QR:', err);
    return res.status(500).json({ error: 'Error interno' });
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
    console.error('No se pudo inicializar la base de datos:', err.message || err);
    process.exit(1);
  });