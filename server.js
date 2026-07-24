const express = require('express');
const app = express();

// Configuración para permitir imágenes y archivos de hasta 50MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// BASE DE DATOS INICIAL EN MEMORIA RAM
let eventos = [
  {
    id: 1,
    titulo: "Taller de Manejo de la Ansiedad",
    descripcion: "Un espacio práctico donde aprenderás técnicas de regulación emocional y mindfulness.",
    fecha: "2026-07-31T20:00",
    categoria: "Salud mental",
    comuna: "providencia",
    direccion: "Av. Santa Isabel 1240",
    lat: -33.435,
    lng: -70.620,
    imagen: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800",
    ticketsVendidos: 0,
    ticketsMax: 40,
    categorias: [{ nombre: "General", precio: 15000, cupos: 40 }]
  }
];

// Obtener todos los eventos
app.get('/api/eventos', (req, res) => {
  res.json(eventos);
});

// Crear nuevo evento
app.post('/api/eventos', (req, res) => {
  try {
    const { titulo, descripcion, fecha, categoria, comuna, direccion, lat, lng, imagen, categorias, ticketsMax } = req.body;

    const nuevoEvento = {
      id: eventos.length > 0 ? Math.max(...eventos.map(e => e.id)) + 1 : 1,
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
    };

    eventos.push(nuevoEvento);
    console.log(`[EVENTO CREADO] "${nuevoEvento.titulo}" | Fecha: ${nuevoEvento.fecha}`);
    res.status(201).json({ mensaje: "Evento creado exitosamente", evento: nuevoEvento });
  } catch (error) {
    res.status(500).json({ error: "Error interno al crear el evento." });
  }
});

// Editar/Actualizar evento existente
app.put('/api/eventos/:id', (req, res) => {
  try {
    const eventoId = parseInt(req.params.id);
    const index = eventos.findIndex(e => e.id === eventoId);

    if (index === -1) {
      return res.status(404).json({ error: "Evento no encontrado." });
    }

    const { titulo, descripcion, fecha, categoria, comuna, direccion, lat, lng, imagen, categorias, ticketsMax } = req.body;

    eventos[index] = {
      ...eventos[index],
      titulo: titulo || eventos[index].titulo,
      descripcion: descripcion !== undefined ? descripcion : eventos[index].descripcion,
      fecha: fecha ? fecha : eventos[index].fecha, // Conserva o actualiza la fecha
      categoria: categoria || eventos[index].categoria,
      comuna: comuna || eventos[index].comuna,
      direccion: direccion || eventos[index].direccion,
      lat: lat ? parseFloat(lat) : eventos[index].lat,
      lng: lng ? parseFloat(lng) : eventos[index].lng,
      imagen: imagen ? imagen : eventos[index].imagen,
      categorias: categorias || eventos[index].categorias,
      ticketsMax: ticketsMax ? parseInt(ticketsMax) : eventos[index].ticketsMax
    };

    console.log(`[EVENTO ACTUALIZADO] ID: ${eventoId} | Nueva Fecha: ${eventos[index].fecha}`);
    res.json({ mensaje: "Evento actualizado correctamente", evento: eventos[index] });
  } catch (error) {
    res.status(500).json({ error: "Error interno al actualizar el evento." });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`));