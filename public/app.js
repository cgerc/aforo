// 1. Inicializar el Mapa de Leaflet en el contenedor inferior
const map = L.map('mapa').setView([-33.456, -70.603], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let eventosData = [];

// 2. Cargar los eventos desde el backend unificado en Node.js
async function cargarCarruselYMapa() {
    try {
        const res = await fetch('/api/eventos');
        eventosData = await res.json();
        
        const carrusel = document.getElementById('carrusel-eventos');
        if (!carrusel) return;
        
        carrusel.innerHTML = '';

        eventosData.forEach(evento => {
            // Añadir el marcador correspondiente en el mapa
            L.marker([evento.lat, evento.lng]).addTo(map)
                .bindPopup(`<b>${evento.titulo}</b><br>${evento.anfitrion}`);

            // Crear la tarjeta con scroll horizontal estilo Tailwind
            const card = document.createElement('div');
            card.className = "min-w-[280px] md:min-w-[320px] bg-white rounded-xl shadow-md overflow-hidden border border-gray-200 flex-shrink-0 flex flex-col justify-between";
            card.innerHTML = `
                <div>
                    <img class="h-44 w-full object-cover" src="${evento.imagen || 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=500'}" alt="Imagen del evento">
                    <div class="p-4">
                        <span class="text-xs font-bold text-amber-600 uppercase tracking-wider">${evento.anfitrion}</span>
                        <h3 class="text-lg font-bold text-gray-900 mt-1 line-clamp-2">${evento.titulo}</h3>
                        <p class="text-sm text-gray-500 mt-2">Cupos: ${evento.ticketsMax - evento.ticketsVendidos} disponibles de 40</p>
                    </div>
                </div>
                <div class="p-4 pt-0">
                    <div class="flex justify-between items-center mt-4">
                        <span class="text-xl font-black text-gray-900">$${evento.categorias[0].precio.toLocaleString('es-CL')} <span class="text-xs font-normal text-gray-500">CLP</span></span>
                        <button onclick="irAlCheckout(${evento.id})" class="bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold px-4 py-2 rounded-lg transition">
                            Seleccionar Entradas
                        </button>
                    </div>
                </div>
            `;
            carrusel.appendChild(card);
        });
    } catch (error) {
        console.error("Error al renderizar los datos del servidor:", error);
    }
}

// 3. Redireccionar de forma segura guardando el estado en el navegador
function irAlCheckout(id) {
    const seleccion = eventosData.find(e => e.id === id);
    if (seleccion) {
        localStorage.setItem('evento_seleccionado', JSON.stringify(seleccion));
        window.location.href = 'checkout.html';
    }
}

// Ejecución inicial de renderizado
cargarCarruselYMapa();