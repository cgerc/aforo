import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { MercadoPagoConfig, Preference } from 'mercadopago';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT) || 3000;

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

const sanitizeText = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 200);
};

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));

const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const client = mpAccessToken ? new MercadoPagoConfig({ accessToken: mpAccessToken }) : null;

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

app.post('/api/create-preference', async (req, res) => {
  try {
    const titulo = sanitizeText(req.body?.titulo);
    const precioUnitario = Number(req.body?.precioUnitario);
    const cantidad = Number(req.body?.cantidad);
    const comprador = req.body?.comprador || {};

    if (!titulo || !Number.isFinite(precioUnitario) || precioUnitario <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Datos de compra inválidos' });
    }

    if (!client) {
      return res.status(503).json({ error: 'Servicio de pagos no configurado' });
    }

    const nombre = sanitizeText(comprador.nombre);
    const email = sanitizeText(comprador.email);
    const whatsapp = sanitizeText(comprador.whatsapp);

    if (!nombre || !email || !whatsapp) {
      return res.status(400).json({ error: 'Faltan datos del comprador' });
    }

    const preference = new Preference(client);
    const response = await preference.create({
      body: {
        items: [
          {
            title: `${titulo} - Entrada`,
            quantity: Number(cantidad),
            unit_price: Number(precioUnitario),
            currency_id: 'CLP',
          }
        ],
        payer: {
          name: nombre,
          email,
          phone: { number: whatsapp }
        },
        back_urls: {
          success: `http://localhost:${port}/confirmacion.html`,
          failure: `http://localhost:${port}/checkout.html`,
          pending: `http://localhost:${port}/checkout.html`
        },
        auto_return: 'approved',
      }
    });

    return res.json({ init_point: response.init_point, id: response.id });
  } catch (error) {
    console.error('Error al crear preferencia en Mercado Pago:', error.message || error);
    return res.status(500).json({ error: 'Error al generar preferencia' });
  }
});

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