const express = require('express');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
app.use(express.json());
app.use(express.static('public')); // Sirve los archivos de la carpeta public

// Configuración de Mercado Pago (Reemplaza con tu Access Token de prueba)
const client = new MercadoPagoConfig({ accessToken: 'PROD_ACCESS_TOKEN_O_TEST_TOKEN' });

// Base de datos simulada en memoria
let eventos = [
  {
    id: 1,
    titulo: "Taller de Teatro Comunitario",
    anfitrion: "Espacio Creativo Ñuñoa",
    precio: 5000,
    ticketsMax: 40,
    ticketsVendidos: 12,
    lat: -33.456, // Coordenadas de ejemplo
    lng: -70.603
  }
];

// Endpoint para obtener todos los eventos/talleres
app.get('/api/eventos', (req, res) => {
  res.json(eventos);
});

// Endpoint para crear la preferencia de pago en Mercado Pago
app.post('/api/crear-preferencia', async (req, res) => {
  const { eventoId } = req.body;
  const evento = eventos.find(e => e.id === parseInt(eventoId));

  if (!evento) return res.status(404).json({ error: "Evento no encontrado" });
  if (evento.ticketsVendidos >= evento.ticketsMax) {
    return res.status(400).json({ error: "Entradas agotadas para este aforo de 40 personas" });
  }

  try {
    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: evento.id.toString(),
            title: evento.titulo,
            quantity: 1,
            unit_price: Number(evento.precio),
            currency_id: 'CLP' // Cambiar según la moneda de tu país
          }
        ],
        back_urls: {
          success: "https://localhost:3000/success.html", // Reemplazar por la URL de tu Codespace
          failure: "https://localhost:3000/failure.html",
        },
        auto_return: "approved",
      }
    });

    // Devolvemos el ID de la transacción para abrir el checkout en el frontend
    res.json({ id: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al generar el pago" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));