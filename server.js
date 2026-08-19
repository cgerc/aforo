Aquí tienes el código completo y actualizado para **`server.js`**, listo para copiar y pegar.

Se agregó la ruta `DELETE /api/eventos/:id` (que elimina el evento tanto en Supabase como en la base de datos local y maneja las órdenes asociadas si existieran) y se mantuvieron las mejoras previas (límite de 20mb y vinculación segura de `taller_id`):

```javascript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
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
console.log('>>> [DEBUG] process.env.MERCADOPAGO_ACCESS_TOKEN:', process.env.MERCADOPAGO_ACCESS_TOKEN ? 'Existe' : 'No encontrado (undefined)');
console.log('>>> [DEBUG] mpClient inicializado:', Boolean(mpClient));

const sanitizeText = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 200);
};

// Middlewares globales (límite para subida de flyers ampliado)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
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
      validador_token: evento.validador_token || null
    }));

    return res.json(eventos);
  } catch (error) {
    console.error('Error interno al leer eventos:', error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// CREAR UN NUEVO EVENTO (Incluye generación de validador_token único)
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
      imagen: imagen || null,
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

// ELIMINAR UN EVENTO EXISTENTE
app.delete('/api/eventos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID de evento requerido.' });

    // 1. Eliminar en Supabase
    if (supabase) {
      // Opcional: Desvincular o eliminar órdenes asociadas si existieran
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

// MERCADO PAGO - CREAR PREFERENCIA
app.post('/api/create-preference', async (req, res) => {
  if (!mpClient) {
    return res.status(503).json({ error: 'Mercado Pago no está configurado. Define MERCADOPAGO_ACCESS_TOKEN en .env' });
  }

  const { titulo, precioUnitario, cantidad, comprador, user_id } = req.body || {};
  const taller_id = req.body?.taller_id || req.body?.evento_id || req.body?.tallerId || req.body?.id || null;

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
    let order = null;
    try {
      order = await createOrder({ 
        user_id: user_id ? Number(user_id) : null, 
        taller_id: taller_id ? Number(taller_id) : null, 
        cantidad: Number(cantidad) || 1, 
        preference_id: null 
      });
    } catch (dbErr) {
      console.warn('Fallo al crear orden con helper local, usando Supabase:', dbErr.message);
    }

    if (!order && supabase) {
      const { data: ordenSupabase, error: errSupabase } = await supabase
        .from('ordenes')
        .insert([{
          user_id: user_id ? Number(user_id) : null,
          taller_id: taller_id ? Number(taller_id) : null,
          cantidad: Number(cantidad) || 1,
          status: 'PENDIENTE'
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
        auto_return: 'approved'
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
      await supabase
        .from('ordenes')
        .update({ 
          preference_id: preferenceResult.id,
          taller_id: taller_id ? Number(taller_id) : order.taller_id
        })
        .eq('id', order.id);
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
  
  const token = jwt.sign({ order_id: Number(orderId), taller_id: tallerId ? Number(tallerId) : null }, qrSecret);

  try {
    if (pool) await markOrderPaid(orderId, token);
  } catch (err) {
    console.warn('No se pudo marcar como pagada en DB local pool:', err.message);
  }

  if (supabase) {
    const { error } = await supabase
      .from('ordenes')
      .update({ status: 'PAGADA', qr_token: token, taller_id: tallerId ? Number(tallerId) : null })
      .eq('id', Number(orderId));

    if (error) {
      console.error('Error actualizando estado en Supabase:', error.message);
    }
  }

  try {
    if (tallerId) await deductSeats(tallerId, Number(cantidad) || 1);
  } catch (err) {
    console.warn('Error descontando cupos:', err.message);
  }

  return token;
}

// Endpoint de respaldo para confirmar el pago desde confirmacion.html
app.post('/api/orders/confirm-payment', async (req, res) => {
  try {
    const { order_id } = req.body;
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

    if (order.status === 'PAGADA' && order.qr_token) {
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
      if (order.status === 'PAGADA' && order.qr_token) {
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
    let order = null;

    if (supabase) {
      const { data } = await supabase.from('ordenes').select('*').eq('id', Number(id)).single();
      order = data;
    }

    if (!order && pool) {
      order = await getOrderById(Number(id));
    }

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

    // 4. Buscar la orden
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

    // 5. Verificar estado de uso
    if (order.status === 'USADA') {
      return res.status(409).json({ valid: false, message: '¡ALERTA! Esta entrada ya fue escaneada y utilizada.' });
    }

    if (order.status !== 'PAGADA') {
      return res.status(400).json({ valid: false, message: `La entrada tiene estado: ${order.status}. No autorizada.` });
    }

    // 6. Marcar como USADA
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

```