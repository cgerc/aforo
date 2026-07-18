// Inicializar el Mapa Grande en la parte inferior
const map = L.map('mapa').setView([-33.456, -70.603], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Simulación de base de datos de eventos para renderizar
const eventosSimulados = [
    {
        id: 1,
        titulo: "Taller de Teatro Comunitario",
        anfitrion: "Espacio Creativo Ñuñoa",
        precio: 5000,
        ticketsMax: 40,
        ticketsVendidos: 28,
        comuna: "ñuñoa",
        lat: -33.456,
        lng: -70.603,
        imagen: "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=500&auto=format&fit=crop&q=60"
    }
];

function cargarCarruselYMapa() {
    const carrusel = document.getElementById('carrusel-eventos');
    carrusel.innerHTML = '';

    eventosSimulados.forEach(evento => {
        // 1. Añadir Marcador al Mapa Grande
        const marker = L.marker([evento.lat, evento.lng]).addTo(map);
        marker.bindPopup(`<b>${evento.titulo}</b><br>${evento.anfitrion}`);

        // 2. Añadir Tarjeta de Estilo Profesional al Carrusel Horizontal
        const card = document.createElement('div');
        card.className = "min-w-[280px] md:min-w-[320px] bg-white rounded-xl shadow-md overflow-hidden border border-gray-200 flex-shrink-0 flex flex-col justify-between";
        card.innerHTML = `
            <div>
                <img class="h-44 w-full object-cover" src="${evento.imagen}" alt="Imagen del evento">
                <div class="p-4">
                    <span class="text-xs font-bold text-amber-600 uppercase tracking-wider">${evento.anfitrion}</span>
                    <h3 class="text-lg font-bold text-gray-900 mt-1 line-clamp-2">${evento.titulo}</h3>
                    <p class="text-sm text-gray-500 mt-2">Cupos: ${evento.ticketsMax - evento.ticketsVendidos} disponibles de 40</p>
                </div>
            </div>
            <div class="p-4 pt-0">
                <div class="flex justify-between items-center mt-4">
                    <span class="text-xl font-black text-gray-900">$${evento.precio} <span class="text-xs font-normal text-gray-500">CLP</span></span>
                    <button class="bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold px-4 py-2 rounded-lg transition">Ver Tickets</button>
                </div>
            </div>
        `;
        carrusel.appendChild(card);
    });
}

// Inicializar la carga visual
cargarCarruselYMapa();