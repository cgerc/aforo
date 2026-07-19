const express = require('express');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const QRCode = require('qrcode');
const cron = require('node-cron');

const app = express();
app.use(express.json());
app.use(express.static('public')); 

// Configura tu Access Token de prueba de Mercado Pago aquí
const client = new MercadoPagoConfig({ accessToken: 'PROD_ACCESS_TOKEN_O_TEST_TOKEN' });

// Base de datos simulada global
let eventos = [
  {
    id: 1,
    titulo: "Taller de Teatro Comunitario",
    anfitrion: "Espacio Creativo Ñuñoa",
    fecha: "2026-07-26T12:30:00", 
    ticketsMax: 40,
    ticketsVendidos: 0,
    lat: -33.456,
    lng: -70.603,
    comuna: "ñuñoa",
    imagen: "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=500&auto=format&fit=crop&q=60",
    categorias: [
      { nombre: "Normal", precio: 30000 },
      { nombre: "Niño", precio: 15000 },
      { nombre: "Bebé", precio: 0 },
      { nombre: "Adulto mayor", precio: 20000 }
    ]
  }
];

let comprasRegistradas = [];

// API: Obtener todos los eventos
app.get('/api/eventos', (req, res) => {
  res.json(eventos);
});

// API: Modificar categorías desde el panel del tallerista
app.post('/api/eventos/actualizar-categorias', (req, res) => {
  const { eventoId, nuevasCategorias } = req.body;
  const evento = eventos.find(e => e.id === parseInt(eventoId));
  if (!evento) return res.status(404).json({ error: "Evento no encontrado" });
  
  evento.categorias = nuevasCategorias;
  res.json({ mensaje: "Categorías guardadas correctamente", evento });
});

// API: Integración de Mercado Pago con validación de cupos (Máx 40)
app.post('/api/crear-preferencia', async (req, res) => {
  const { eventoId, datosComprador, entradasSeleccionadas } = req.body;
  const evento = eventos.find(e => e.id === parseInt(eventoId));

  if (!evento) return res.status(404).json({ error: "Evento no encontrado" });

  const totalSolicitado = Object.values(entradasSeleccionadas).reduce((a, b) => a + b, 0);
  if ((evento.ticketsVendidos + totalSolicitado) > evento.ticketsMax) {
    return res.status(400).json({ error: "Cupos agotados para este aforo de 40 personas." });
  }

  let itemsMercadoPago = [];
  for (const [catNombre, cantidad] of Object.entries(entradasSeleccionadas)) {
    if (cantidad > 0) {
      const catInfo = evento.categorias.find(c => c.nombre === catNombre);
      itemsMercadoPago.push({
        title: `${evento.titulo} (${catNombre})`,
        quantity: parseInt(cantidad),
        unit_price: Number(catInfo.precio),
        currency_id: 'CLP'
      });
    }
  }

  try {
    const preference = new Preference(client);
    const ticketIdUnico = "TK-" + Math.floor(Math.random() * 90000 + 10000);

    const result = await preference.create({
      body: {
        items: itemsMercadoPago,
        payer: {
          name: datosComprador.nombre,
          email: datosComprador.email,
          phone: { number: datosComprador.whatsapp }
        },
        back_urls: {
          success: `http://localhost:3000/confirmacion.html?eventoId=${evento.id}&nombre=${encodeURIComponent(datosComprador.nombre)}&ticketId=${ticketIdUnico}`,
          failure: "http://localhost:3000/index.html",
        },
        auto_return: "approved",
      }
    });

    comprasRegistradas.push({
      ticketId: ticketIdUnico,
      eventoId: evento.id,
      datosComprador: datosComprador,
      usado: false
    });

    evento.ticketsVendidos += totalSolicitado;
    res.json({ id: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en Mercado Pago" });
  }
});

// API: Compilar código QR en base64
app.post('/api/generar-qr', async (req, res) => {
  const { ticketId } = req.body;
  try {
    const qrDataUrl = await QRCode.toDataURL(ticketId);
    res.json({ qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: "Error al generar QR" });
  }
});

// API: Validador de QR mediante escáner de cámara
app.post('/api/validar-ticket', (req, res) => {
  const { ticketId } = req.body;
  const ticket = comprasRegistradas.find(t => t.ticketId === ticketId);

  if (!ticket) {
    return res.status(404).json({ valido: false, mensaje: "❌ Ticket no válido o inexistente." });
  }
  if (ticket.usado) {
    return res.status(400).json({ valido: false, mensaje: "⚠️ ¡Alerta! Este ticket ya fue escaneado." });
  }

  ticket.usado = true;
  const evento = eventos.find(e => e.id === ticket.eventoId);
  res.json({
    valido: true,
    mensaje: "✅ ¡Acceso Autorizado!",
    comprador: ticket.datosComprador.nombre,
    evento: evento ? evento.titulo : "Taller"
  });
});

// CRON JOB: Envío automatizado simulado por WhatsApp 1 día antes a las 9 AM
cron.schedule('0 9 * * *', () => {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const fechaMananaStr = manana.toISOString().split('T')[0];

  comprasRegistradas.forEach(compra => {
    const evento = eventos.find(e => e.id === compra.eventoId);
    if (evento && evento.fecha.split('T')[0] === fechaMananaStr) {
      console.log(`[WhatsApp Recordatorio Sent] To: +56${compra.datosComprador.whatsapp} -> ¡Hola ${compra.datosComprador.nombre}! Recuerda tu función de mañana para ${evento.titulo}. Prepara tu QR.`);
    }
  });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Servidor unificado en http://localhost:${PORT}`));