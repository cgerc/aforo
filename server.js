import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { MercadoPagoConfig, Preference } from 'mercadopago';

// Para obtener __dirname usando ES Modules (import)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(express.json());
app.use(cors());

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Configura tu Access Token de Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: 'APP_USR-3763128537034106-072515-4473400a2bb0c3ca77a623eedc138821-3568562848'
});

// Ruta principal: Redirige automáticamente a index.html (o checkout.html) al entrar a la raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint para crear la preferencia de pago
app.post('/api/create-preference', async (req, res) => {
  try {
    const { titulo, precioUnitario, cantidad, comprador } = req.body;

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
          name: comprador.nombre,
          email: comprador.email,
          phone: {
            number: comprador.whatsapp
          }
        },
        back_urls: {
          success: 'http://localhost:3000/confirmacion.html',
          failure: 'http://localhost:3000/checkout.html',
          pending: 'http://localhost:3000/checkout.html'
        },
        auto_return: 'approved',
      }
    });

    // Retornamos la URL de redirección (init_point)
    res.json({ init_point: response.init_point, id: response.id });
  } catch (error) {
    console.error('Error al crear preferencia en Mercado Pago:', error);
    res.status(500).json({ error: 'Error al generar preferencia' });
  }
});

// Arrancar el servidor en el puerto 3000
app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});